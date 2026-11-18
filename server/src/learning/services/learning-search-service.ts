import { sqlite } from '../../db/client.js';
import type { BlockKind } from '../../db/schema.js';
import { foldText, foldWithMap } from '../../lib/fold-text.js';
import { stripMarkdownImages } from '../../lib/markdown-images.js';
import { PAGE_ORDER } from './page-service.js';
import { ownBlockSql, readableSourceSql, type Viewer } from '../../access/visibility.js';

/**
 * Search across what the viewer can see: source names and authors, page titles, block text, the viewer's own
 * private annotations, and tags. Case- and accent-insensitive (`fold_text`, lib/fold-text.ts), so "hap thu"
 * finds "hấp thụ". A query starting with `#` searches tags only: matching tags and the blocks carrying them.
 */

export type SourceHit = { sourceId: number; name: string; kind: string | null; author: string | null; color: string | null };
export type PageHit = { pageId: number; pageTitle: string; sourceId: number; sourceName: string; sourceColor: string | null };
export type BlockHit = {
  blockId: number;
  /** Null for standalone insights. */
  pageId: number | null;
  pageTitle: string | null;
  sourceId: number;
  sourceName: string;
  sourceColor: string | null;
  type: 'note';
  kind: BlockKind;
  pageVideoId: number | null;
  videoTimeSec: number | null;
  /** Plain text around the first match, accents kept. */
  snippet: string;
};
export type TagHit = { tag: string; count: number };
export type SearchGroup<T> = { items: T[]; total: number };
export type SearchResult = {
  sources: SearchGroup<SourceHit>;
  pages: SearchGroup<PageHit>;
  notes: SearchGroup<BlockHit>;
  annotations: SearchGroup<BlockHit>;
  tags: SearchGroup<TagHit>;
};

/** Characters kept before and after the match: the match sits near the start, where a one-line row shows it. */
const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 110;
const TAG_SCAN_LIMIT = 2000;

/** LIKE pattern matching the folded `query` literally; compare against `fold_text(column)` with `ESCAPE '\'`. */
function likePattern(query: string): string {
  return `%${foldText(query).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Markdown as one line of plain text: images dropped, links keep their text, list and emphasis markers removed. */
function plainText(markdown: string): string {
  return stripMarkdownImages(markdown)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain-text window of `text` (markdown) around the first accent-insensitive match of `query`. */
export function searchSnippet(text: string, query: string): string {
  const plain = plainText(text);
  const { folded, map } = foldWithMap(plain);
  const needle = foldText(query);
  const found = needle ? folded.indexOf(needle) : -1;
  const at = found < 0 ? 0 : map[found];
  const end0 = found < 0 ? 0 : map[found + needle.length];
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(plain.length, end0 + SNIPPET_AFTER);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

/** Splits a stored tag list ("a, b"). */
export function splitTags(tags: string | null): string[] {
  return (tags ?? '').split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean);
}

type Scope = { pattern: string; sourceId: number | null; viewerId: number; limit: number };

function group<T>(select: string, from: string, order: string, scope: Scope): SearchGroup<T> {
  const items = sqlite.prepare(`SELECT ${select} ${from} ORDER BY ${order} LIMIT @limit`).all(scope) as T[];
  const { total } = sqlite.prepare(`SELECT COUNT(*) as total ${from}`).get(scope) as { total: number };
  return { items, total };
}

const BLOCK_FROM = `
  FROM blocks b
  LEFT JOIN block_text bt ON bt.block_id = b.id
  LEFT JOIN pages p ON p.id = b.page_id
  JOIN sources s ON s.id = COALESCE(p.source_id, b.source_id)
  WHERE s.deleted_at IS NULL AND (@sourceId IS NULL OR s.id = @sourceId)
    AND ${readableSourceSql('s', '@viewerId')}`;
const BLOCK_SELECT = `b.id as blockId, p.id as pageId, p.title as pageTitle, s.id as sourceId, s.name as sourceName,
  s.color as sourceColor, b.type, b.kind, b.page_video_id as pageVideoId, b.video_time_sec as videoTimeSec`;
const BLOCK_ORDER = `s.position, s.id, (b.page_id IS NOT NULL), ${PAGE_ORDER}, b.position`;

function blockGroup(where: string, textColumn: string, query: string, scope: Scope): SearchGroup<BlockHit> {
  const found = group<Omit<BlockHit, 'snippet'> & { text: string | null }>(
    `${BLOCK_SELECT}, ${textColumn} as text`, `${BLOCK_FROM} AND ${where}`, BLOCK_ORDER, scope);
  return {
    total: found.total,
    items: found.items.map(({ text, ...hit }) => ({ ...hit, snippet: searchSnippet(text ?? '', query) })),
  };
}

function tagGroup(needle: string, scope: Scope): SearchGroup<TagHit> {
  const rows = sqlite.prepare(`SELECT b.tags ${BLOCK_FROM} AND fold_text(b.tags) LIKE @pattern ESCAPE '\\' LIMIT ${TAG_SCAN_LIMIT}`)
    .all(scope) as Array<{ tags: string | null }>;
  const counts = new Map<string, TagHit>();
  for (const { tags } of rows) {
    for (const tag of new Set(splitTags(tags))) {
      if (!foldText(tag).includes(needle)) continue;
      const key = foldText(tag);
      const hit = counts.get(key) ?? { tag, count: 0 };
      hit.count += 1;
      counts.set(key, hit);
    }
  }
  const items = [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { items: items.slice(0, scope.limit), total: items.length };
}

const empty = <T>(): SearchGroup<T> => ({ items: [], total: 0 });

export const learningSearchService = {
  /** At most `limit` items per group, each group with its full count. */
  search(rawQuery: string, sourceId: number | null, viewer: Viewer, limit = 8): SearchResult {
    const tagOnly = rawQuery.startsWith('#');
    const query = (tagOnly ? rawQuery.slice(1) : rawQuery).trim();
    const scope: Scope = { pattern: likePattern(query), sourceId, viewerId: viewer.id, limit };
    const tags = tagGroup(foldText(query), scope);
    if (tagOnly) {
      return {
        sources: empty(), pages: empty(), annotations: empty(), tags,
        notes: blockGroup(`fold_text(b.tags) LIKE @pattern ESCAPE '\\'`, 'bt.body', query, scope),
      };
    }
    return {
      sources: group<SourceHit>(
        's.id as sourceId, s.name, s.kind, s.author, s.color',
        `FROM sources s WHERE s.deleted_at IS NULL AND (@sourceId IS NULL OR s.id = @sourceId)
           AND (fold_text(s.name) LIKE @pattern ESCAPE '\\' OR fold_text(s.author) LIKE @pattern ESCAPE '\\')
           AND ${readableSourceSql('s', '@viewerId')}`,
        's.position, s.id', scope),
      pages: group<PageHit>(
        'p.id as pageId, p.title as pageTitle, s.id as sourceId, s.name as sourceName, s.color as sourceColor',
        `FROM pages p JOIN sources s ON s.id = p.source_id
         WHERE fold_text(p.title) LIKE @pattern ESCAPE '\\' AND s.deleted_at IS NULL AND (@sourceId IS NULL OR s.id = @sourceId)
           AND ${readableSourceSql('s', '@viewerId')}`,
        `s.position, s.id, ${PAGE_ORDER}`, scope),
      notes: blockGroup(`fold_text(strip_markdown_images(bt.body)) LIKE @pattern ESCAPE '\\'`, 'bt.body', query, scope),
      // Private annotations are their author's alone, in search too.
      annotations: blockGroup(`fold_text(b.annotation) LIKE @pattern ESCAPE '\\' AND ${ownBlockSql('b', '@viewerId')}`, 'b.annotation', query, scope),
      tags,
    };
  },
};
