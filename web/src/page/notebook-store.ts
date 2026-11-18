import { formData } from '../lib/api';
import { keys } from '../lib/data';
import { invalidate, mutate, peek } from '../lib/resource';
import { failureText, save, send } from '../lib/saves';
import { toast } from '../lib/shell-state';
import type { Block } from '../lib/types';
import { insertAt, type Place } from './block-place';
import type { BlockPatch, NotebookEnv } from './notebook-ops';

/**
 * The notebook's blocks in the shared cache (`keys.blocks(pageId)`, page order) and the writes every operation
 * builds on: create (placed like the server places it), update (local first, then the save queue).
 */
export function makeNotebookStore(env: () => NotebookEnv) {
  const key = () => keys.blocks(env().pageId);
  const list = () => peek<Block[]>(key()) ?? [];
  const find = (id: number) => list().find((b) => b.id === id);
  const setList = (update: (blocks: Block[]) => Block[]) => mutate<Block[]>(key(), update);
  const patchLocal = (id: number, patch: Partial<Block>) => setList((blocks) => blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const fail = (error: unknown) => toast(failureText(error, env().ownerName));
  const refreshCounts = () => invalidate(keys.page(env().pageId), keys.pages(env().sourceId), keys.source(env().sourceId), keys.sources, 'questions:', keys.insights(env().sourceId));

  async function create(fields: Record<string, string | number | boolean | undefined | null>, place: Place, file?: { blob: Blob; source?: { videoId: number; sec: number } }): Promise<Block | null> {
    try {
      const body = formData({
        type: 'note',
        ...fields,
        afterBlockId: place.afterBlockId,
        beforeBlockId: place.beforeBlockId,
        imageSourceVideoId: file?.source?.videoId,
        imageSourceSec: file?.source?.sec,
      }, file ? [{ name: 'image', blob: file.blob, filename: 'frame.png' }] : []);
      const block = await send<Block>(`/pages/${env().pageId}/blocks`, { method: 'POST', body });
      setList((blocks) => insertAt(blocks, block, place));
      refreshCounts();
      return block;
    } catch (error) {
      fail(error);
      return null;
    }
  }

  function update(id: number, patch: BlockPatch, coalesce?: string): Promise<void> {
    const { stamp, pinned, isInsight, ...rest } = patch;
    patchLocal(id, {
      ...rest,
      ...(pinned !== undefined ? { pinned: pinned ? 1 : 0 } : {}),
      ...(isInsight !== undefined ? { isInsight: isInsight ? 1 : 0 } : {}),
      ...(stamp !== undefined ? { pageVideoId: stamp?.pageVideoId ?? null, videoTimeSec: stamp?.videoTimeSec ?? null } : {}),
      ...(patch.kind === 'question' && !find(id)?.questionState ? { questionState: 'open' as const } : {}),
      ...(patch.kind && patch.kind !== 'question' ? { questionState: null } : {}),
    });
    const structural = patch.kind !== undefined || patch.questionState !== undefined || isInsight !== undefined || patch.insightCategory !== undefined;
    return save<Block>('PUT', `/blocks/${id}`, patch, coalesce ?? null).then((saved) => {
      // The server's kind and state win (a question's state); the text stays what is being typed.
      if (structural) patchLocal(id, { kind: saved.kind, questionState: saved.questionState });
      if (structural) refreshCounts();
    }, (error: unknown) => {
      fail(error);
      invalidate(key());
    });
  }

  function startEditing(block: Block | null) {
    if (!block) return;
    env().select(block.id, { scroll: true });
    env().edit(block.id);
    env().flash(block.id);
  }

  function stampNow(): { videoId: number | null; t: number } {
    const { player } = env();
    const videoId = player.state.get().videoId;
    return { videoId, t: Math.floor(player.now()) };
  }

  return { key, list, find, setList, patchLocal, fail, refreshCounts, create, update, startEditing, stampNow };
}

export type NotebookStore = ReturnType<typeof makeNotebookStore>;
