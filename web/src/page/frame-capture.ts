import { formData } from '../lib/api';
import { fmtTime } from '../lib/format';
import { blockImageRef } from '../lib/markdown';
import { save, send } from '../lib/saves';
import { toast } from '../lib/shell-state';
import type { Block } from '../lib/types';
import { placeByTime } from './block-place';
import type { NotebookEnv } from './notebook-ops';
import type { NotebookStore } from './notebook-store';

/** Grabs the frame the video shows, at its own size, as a PNG (no clipboard involved). */
export function grabFrame(el: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !el.videoWidth) {
      reject(new Error('The video has no frame to capture yet. Play it for a moment first.'));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error('Could not capture the frame.'));
    context.drawImage(el, 0, 0);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the frame.'))), 'image/png');
  });
}

/**
 * F: the current frame goes (a) after the paragraph being typed in, (b) into the selected own text or
 * question block stamped within 90 s, or (c) into a new stamped block. Undo in the toast takes it back.
 */
export async function captureFrame(store: NotebookStore, env: NotebookEnv): Promise<void> {
  const { player, myId, activeEditor } = env;
  const el = player.element;
  const { videoId, t } = store.stampNow();
  if (!el || !videoId || player.state.get().problem) {
    toast(videoId ? 'The video file is missing, so no frame can be captured.' : 'This page has no video to capture from.');
    return;
  }
  let blob: Blob;
  try {
    blob = await grabFrame(el);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not capture the frame.');
    return;
  }
  const sec = player.now();
  const source = { sourceVideoId: videoId, sourceSec: sec };
  const upload = async (blockId: number): Promise<{ block: Block; imageId: number } | null> => {
    const before = new Set((store.find(blockId)?.images ?? []).map((i) => i.id));
    try {
      const block = await send<Block>(`/blocks/${blockId}/images`, { method: 'POST', body: formData(source, [{ name: 'image', blob, filename: 'frame.png' }]) });
      const added = block.images.find((i) => !before.has(i.id));
      if (!added) return null;
      store.patchLocal(blockId, { images: block.images });
      return { block, imageId: added.id };
    } catch (error) {
      store.fail(error);
      return null;
    }
  };
  const undoToast = (blockId: number, imageId: number, removeBlock: boolean) => toast(`Frame ${fmtTime(sec)} added to the note`, {
    label: 'Undo',
    run: () => {
      if (removeBlock) {
        store.setList((blocks) => blocks.filter((b) => b.id !== blockId));
        void save('DELETE', `/blocks/${blockId}`).then(store.refreshCounts, store.fail);
        return;
      }
      const editing = activeEditor.current;
      if (editing?.blockId === blockId) {
        const { state } = editing.editor;
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'blockImage' && node.attrs.id === imageId) editing.editor.view.dispatch(state.tr.delete(pos, pos + 1));
        });
      } else {
        const body = (store.find(blockId)?.body ?? '').replace(blockImageRef(imageId), '').replace(/\n{3,}/g, '\n\n').trim();
        void store.update(blockId, { body });
      }
      store.patchLocal(blockId, { images: (store.find(blockId)?.images ?? []).filter((i) => i.id !== imageId) });
      void save('DELETE', `/block-images/${imageId}`).catch(store.fail);
    },
  });

  // (a) Typing in a text or question block: after the paragraph holding the caret.
  const editing = activeEditor.current;
  const editingBlock = editing ? store.find(editing.blockId) : undefined;
  if (editing && editing.editor.isFocused && editingBlock && (editingBlock.kind === 'text' || editingBlock.kind === 'question') && editingBlock.type === 'note') {
    const done = await upload(editing.blockId);
    if (!done) return;
    const { editor } = editing;
    const { $from } = editor.state.selection;
    const after = $from.depth >= 1 ? $from.after(1) : editor.state.doc.content.size;
    editor.chain().insertContentAt(after, { type: 'paragraph', content: [{ type: 'blockImage', attrs: { id: done.imageId } }] }).run();
    undoToast(editing.blockId, done.imageId, false);
    return;
  }
  // (b) The selected own text or question block, stamped within 90 s on this video.
  const selectedId = env.selected();
  const selected = selectedId ? store.find(selectedId) : undefined;
  if (selected && selected.authorId === myId && selected.type === 'note' && (selected.kind === 'text' || selected.kind === 'question')
    && selected.pageVideoId === videoId && selected.videoTimeSec != null && Math.abs(selected.videoTimeSec - sec) < 90) {
    const done = await upload(selected.id);
    if (!done) return;
    const body = (store.find(selected.id)?.body ?? '').trimEnd();
    await store.update(selected.id, { body: `${body}${body ? '\n\n' : ''}${blockImageRef(done.imageId)}` });
    env.flash(selected.id);
    undoToast(selected.id, done.imageId, false);
    return;
  }
  // (c) A new block stamped at this second, holding the frame.
  const block = await store.create({ kind: 'text', pageVideoId: videoId, videoTimeSec: t }, placeByTime(store.list(), videoId, t), { blob, source: { videoId, sec } });
  if (!block || !block.images[0]) return;
  await store.update(block.id, { body: blockImageRef(block.images[0].id) });
  env.select(block.id, { scroll: true });
  env.flash(block.id);
  undoToast(block.id, block.images[0].id, true);
}
