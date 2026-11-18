import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Block bodies are markdown; images are refs `![](block-image:ID)` into the block's images. The reading view
 * renders markdown to sanitized HTML; images become figures (React) between the text segments.
 */

export const BLOCK_IMAGE_SCHEME = 'block-image:';
const IMAGE_REF = /!\[[^\]]*\]\(block-image:(\d+)\)/g;
const ANY_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

export const blockImageRef = (id: number) => `![](${BLOCK_IMAGE_SCHEME}${id})`;

export function blockImageIdFromHref(href: string | undefined): number | null {
  if (!href?.startsWith(BLOCK_IMAGE_SCHEME)) return null;
  const id = Number(href.slice(BLOCK_IMAGE_SCHEME.length));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Ids of the images a body shows, in reading order, each once. */
export function bodyImageIds(body: string): number[] {
  return [...new Set([...body.matchAll(IMAGE_REF)].map((match) => Number(match[1])))];
}

/**
 * A stored body as it is shown: refs to images the block no longer has are dropped, and the block's images the
 * body does not show follow as a last line (the original app bodies from before images moved into the text).
 */
export function bodyWithImages(body: string, imageIds: readonly number[]): string {
  const known = new Set(imageIds);
  const kept = body.replace(IMAGE_REF, (ref, id: string) => (known.has(Number(id)) ? ref : ''));
  const shown = new Set(bodyImageIds(kept));
  const missing = imageIds.filter((id) => !shown.has(id));
  if (!missing.length) return kept;
  const refs = missing.map(blockImageRef).join('\n\n');
  const text = kept.trimEnd();
  return text ? `${text}\n\n${refs}` : refs;
}

export type Segment = { kind: 'text'; markdown: string } | { kind: 'image'; id: number };

/** The body cut at its image refs: text between them, and each image on its own. */
export function segments(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(IMAGE_REF)) {
    const before = body.slice(last, match.index);
    if (before.trim()) out.push({ kind: 'text', markdown: before });
    out.push({ kind: 'image', id: Number(match[1]) });
    last = (match.index ?? 0) + match[0].length;
  }
  const rest = body.slice(last);
  if (rest.trim()) out.push({ kind: 'text', markdown: rest });
  return out;
}

if (DOMPurify.isSupported) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Markdown to sanitized HTML (no images: they are figures; no style attributes: the CSP has none). */
export function renderMarkdown(markdown: string): string {
  if (!markdown.trim()) return '';
  if (!DOMPurify.isSupported) return `<p>${escapeHtml(markdown)}</p>`;
  const html = marked.parse(markdown.replace(ANY_IMAGE, ''), { gfm: true, breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_ATTR: ['style'], FORBID_TAGS: ['img', 'style'] });
}

/** Markdown as one line of plain text: images dropped, links keep their text, list and emphasis markers removed. */
export function plainText(markdown: string | null | undefined): string {
  return (markdown ?? '')
    .replace(ANY_IMAGE, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-+*]|\d+\.)\s+/gm, '')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first paragraph of a body as plain text (a question's question; its answer follows). */
export function firstParagraph(markdown: string | null | undefined): string {
  const body = (markdown ?? '').replace(ANY_IMAGE, '').trim();
  return plainText(body.split(/\n\s*\n/)[0] ?? '');
}

export function excerpt(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
