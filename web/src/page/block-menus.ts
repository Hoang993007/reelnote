import { joinTags, keys, splitTags } from '../lib/data';
import { fmtTime } from '../lib/format';
import { invalidate } from '../lib/resource';
import { send } from '../lib/saves';
import { overlay, toast } from '../lib/shell-state';
import type { Block, BlockKind } from '../lib/types';
import { openMenu, type MenuItem } from '../shell/menu';
import type { NotebookCtx } from './notebook-context';

/** Insight (I): pick a category, make a new one (writers of the source), or remove the insight. */
export function insightMenu(anchor: Element, block: Block, ctx: NotebookCtx): void {
  const labels = [...new Set([...ctx.categories.map((c) => c.label), ...(block.insightCategory ? [block.insightCategory] : [])])];
  const set = (category: string | null) => void ctx.ops.update(block.id, category ? { isInsight: true, insightCategory: category } : { isInsight: false, insightCategory: '' })
    .then(() => toast(category ? `Insight · ${category}` : 'No longer an insight'));
  const items: MenuItem[] = labels.map((label) => ({ label, check: !!block.isInsight && block.insightCategory === label, run: () => set(label) }));
  if (!labels.length) items.push({ label: 'Insight without a category', icon: 'star', run: () => void ctx.ops.update(block.id, { isInsight: true }) });
  if (block.isInsight) items.push({ label: 'Remove insight', danger: true, run: () => set(null) });
  openMenu(anchor, items, {
    placeholder: 'Category',
    create: ctx.canWrite ? {
      label: 'New category',
      run: (label) => void send(`/sources/${ctx.sourceId}/insight-categories`, { method: 'POST', body: { label } })
        .catch(() => undefined).finally(() => { invalidate(keys.categories(ctx.sourceId)); set(label); }),
    } : undefined,
  });
}

/** Tag (T): toggle a tag used on this page, or add a new one. */
export function tagMenu(anchor: Element, block: Block, ctx: NotebookCtx): void {
  const mine = splitTags(block.tags);
  const all = [...new Set([...ctx.tags, ...mine])].sort((a, b) => a.localeCompare(b));
  const save = (next: string[]) => void ctx.ops.update(block.id, { tags: joinTags(next) });
  openMenu(anchor, all.map((tag) => ({
    label: `#${tag}`,
    check: mine.includes(tag),
    run: () => save(mine.includes(tag) ? mine.filter((t) => t !== tag) : [...mine, tag]),
  })), { placeholder: 'Add a tag', create: { label: 'Add tag', run: (text) => save([...mine, text.trim()]) } });
}

/** More: move up or down, set the stamp to now, delete. */
export function moreMenu(anchor: Element, block: Block, ctx: NotebookCtx, now: number | null): void {
  const items: MenuItem[] = [
    { label: 'Move up', icon: 'up', run: () => ctx.ops.move(block.id, -1) },
    { label: 'Move down', icon: 'down', run: () => ctx.ops.move(block.id, 1) },
  ];
  if (now !== null) items.push({ label: block.videoTimeSec != null ? `Set time to ${fmtTime(now)}` : `Stamp at ${fmtTime(now)}`, icon: 'note', run: () => ctx.ops.stampHere(block.id) });
  if (block.videoTimeSec != null) items.push({ label: 'Remove the time stamp', icon: 'close', run: () => void ctx.ops.update(block.id, { stamp: null }) });
  items.push({ label: 'Delete block', icon: 'trash', danger: true, hint: 'Del', run: () => ctx.ops.remove(block.id) });
  openMenu(anchor, items);
}

/** `/` in an empty block (design-spec §6.3): Text · Heading · Summary · Quote from transcript · Open question · Frame from video. */
export function slashMenu(anchor: Element, block: Block, ctx: NotebookCtx): void {
  const kind = (k: BlockKind) => () => {
    void ctx.ops.setKind(block.id, k);
    ctx.edit(block.id);
  };
  openMenu(anchor, [
    { label: 'Text', icon: 'note', run: kind('text') },
    { label: 'Heading', icon: 'heading', run: kind('heading') },
    { label: 'Summary', icon: 'list', run: kind('summary') },
    { label: 'Quote from transcript', icon: 'quote', run: () => { ctx.ops.removeEmpty(block.id); void ctx.ops.quote(); } },
    { label: 'Open question', icon: 'question', run: kind('question') },
    { label: 'Frame from video', icon: 'camera', run: () => { ctx.edit(block.id); setTimeout(() => void ctx.ops.capture(), 60); } },
  ], { placeholder: 'Block type' });
}

export function searchTag(tag: string): void {
  overlay.set({ kind: 'search', mode: 'all', scope: null, query: `#${tag}` });
}
