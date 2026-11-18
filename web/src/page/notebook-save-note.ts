import { toast } from '../lib/shell-state';
import { placeByTime } from './block-place';
import type { NotebookEnv } from './notebook-ops';
import type { NotebookStore } from './notebook-store';

/**
 * A finished note from elsewhere (a word lookup, a chat answer): a text block holding `body`, stamped at second `t`
 * of the video playing, in time order, flashed so it is seen. Not opened for editing: it is already written.
 */
export async function saveNoteAt(store: NotebookStore, env: NotebookEnv, body: string, t: number): Promise<void> {
  const { videoId } = store.stampNow();
  const sec = Math.floor(t);
  const fields = videoId ? { kind: 'text', body, pageVideoId: videoId, videoTimeSec: sec } : { kind: 'text', body };
  const block = await store.create(fields, videoId ? placeByTime(store.list(), videoId, sec) : {});
  if (!block) return;
  env.flash(block.id);
  toast('Saved to notes.');
}
