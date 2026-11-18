import { sqlite } from '../db/client.js';
import { userService } from '../auth/user-service.js';
import { blockService } from '../learning/services/block-service.js';
import { findSource } from './find-source.js';
import { sourceInsightCategoryService } from '../learning/services/source-insight-category-service.js';

/**
 * Notes written on this PC (by Claude, from a video's transcript) added straight into Reelnote as the owner's:
 * stamped notes on a video page, and standalone insights on a source. Each refuses a target that already has the
 * owner's notes, so running it twice never duplicates them.
 */

/** One video page's notes. The page is named by `pageId`, by `video` (path or file name) or by `key` (`[key]` in the file name). */
export type PageNotes = {
  pageId?: number;
  video?: string;
  key?: string;
  summary?: string;
  segments: Array<{ t: number; body: string }>;
};

type PageVideoRow = { id: number; pageId: number; relPath: string; durationSec: number | null };

const slashes = (p: string) => p.replace(/\\/g, '/').toLowerCase();

function ownerId(): number {
  const owner = userService.owner();
  if (!owner) throw new Error('No owner account yet: pnpm user create … --role owner');
  return owner.id;
}

function findPageVideo(notes: PageNotes): PageVideoRow {
  const rows = sqlite.prepare(`
    SELECT pv.id, pv.page_id AS pageId, pv.rel_path AS relPath, pv.duration_sec AS durationSec
    FROM page_videos pv JOIN pages p ON p.id = pv.page_id
    WHERE p.deleted_at IS NULL
  `).all() as PageVideoRow[];
  let matches: PageVideoRow[];
  let named: string;
  if (notes.pageId !== undefined) {
    matches = rows.filter((r) => r.pageId === notes.pageId);
    named = `page ${notes.pageId}`;
  } else if (notes.video) {
    const want = slashes(notes.video);
    matches = rows.filter((r) => slashes(r.relPath) === want || slashes(r.relPath).endsWith(`/${want}`));
    named = notes.video;
  } else if (notes.key) {
    matches = rows.filter((r) => r.relPath.includes(`[${notes.key}]`));
    named = `key ${notes.key}`;
  } else {
    throw new Error('Name the page: "pageId", "video" (file path or name) or "key" (the id in [brackets] in the file name).');
  }
  if (matches.length === 0) throw new Error(`No video page for ${named}: import the video's folder in Reelnote first.`);
  if (matches.length > 1) throw new Error(`${named} matches ${matches.length} videos: use "pageId" or a longer "video" path.`);
  return matches[0];
}

function checkSegments(segments: PageNotes['segments'], durationSec: number | null): void {
  if (!Array.isArray(segments)) throw new Error('"segments" must be a list of { "t": seconds, "body": markdown }.');
  let previous = -1;
  for (const { t, body } of segments) {
    if (!Number.isInteger(t) || t < 0) throw new Error(`Segment time ${t} is not a whole number of seconds.`);
    if (t <= previous) throw new Error(`Segment times must increase: ${t} comes after ${previous}.`);
    if (durationSec !== null && t > durationSec) throw new Error(`Segment time ${t} is past the video's end (${Math.floor(durationSec)} s).`);
    if (typeof body !== 'string' || !body.trim()) throw new Error(`The segment at ${t} s has no body.`);
    previous = t;
  }
}

/** Adds a summary (kind summary) and one stamped note per segment to the video's page. Returns what it did. */
export function addPageNotes(notes: PageNotes, dryRun = false): string {
  const authorId = ownerId();
  const video = findPageVideo(notes);
  checkSegments(notes.segments, video.durationSec);
  const label = `page ${video.pageId} (${video.relPath})`;
  const existing = (sqlite.prepare(
    'SELECT COUNT(*) AS n FROM blocks WHERE page_id = ? AND deleted_at IS NULL AND (author_id IS NULL OR author_id = ?)',
  ).get(video.pageId, authorId) as { n: number }).n;
  if (existing) return `${label}: already has ${existing} of your blocks, nothing added`;
  const what = `${notes.summary ? 'summary + ' : ''}${notes.segments.length} stamped notes`;
  if (dryRun) return `${label}: ${what} (dry run)`;

  sqlite.transaction(() => {
    if (notes.summary) blockService.create(video.pageId, authorId, { type: 'note', kind: 'summary', body: notes.summary }, []);
    for (const { t, body } of notes.segments) {
      blockService.create(video.pageId, authorId, { type: 'note', body, pageVideoId: video.id, videoTimeSec: t }, []);
    }
  })();
  return `${label}: ${what} added`;
}

/** `=== <category>` starts a section; the text up to the next one is its insight. */
export function parseInsightSections(markdown: string): Array<{ label: string; body: string }> {
  return markdown.replace(/\r\n/g, '\n').split(/^=== /m).slice(1).map((chunk) => {
    const [first, ...rest] = chunk.split('\n');
    return { label: first.trim(), body: rest.join('\n').trim() };
  }).filter((s) => s.label && s.body);
}

/** Adds each section as a standalone insight of the source, in file order, creating missing categories. */
export function addSourceInsights(sourceRef: string, markdown: string, dryRun = false): string {
  const authorId = ownerId();
  const source = findSource(sourceRef);
  const sections = parseInsightSections(markdown);
  if (!sections.length) throw new Error('No sections: each insight starts with a line "=== <category>".');
  const existing = (sqlite.prepare(
    'SELECT COUNT(*) AS n FROM blocks WHERE source_id = ? AND page_id IS NULL AND deleted_at IS NULL AND (author_id IS NULL OR author_id = ?)',
  ).get(source.id, authorId) as { n: number }).n;
  if (existing) return `${source.name}: already has ${existing} of your standalone insights, nothing added`;
  if (dryRun) return `${source.name}: ${sections.length} insights (dry run)`;

  sqlite.transaction(() => {
    const labels = new Set(sourceInsightCategoryService.list(source.id).map((c) => c.label));
    sections.forEach(({ label }, position) => {
      if (!labels.has(label)) sourceInsightCategoryService.create(source.id, { label, position });
      labels.add(label);
    });
    for (const { label, body } of sections) {
      blockService.createStandaloneBlock(source.id, authorId, { type: 'note', body, insightCategory: label }, []);
    }
  })();
  return `${source.name}: ${sections.length} insights added`;
}
