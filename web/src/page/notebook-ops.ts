import { useEffect, useMemo, useRef } from 'react';
import { formData } from '../lib/api';
import { plainText } from '../lib/markdown';
import { invalidate } from '../lib/resource';
import { save, send } from '../lib/saves';
import { toast } from '../lib/shell-state';
import type { Block, BlockKind, PageVideo } from '../lib/types';
import type { ActiveEditor } from '../editor/block-editor';
import { insertAt, placeByTime, type Place } from './block-place';
import { captureFrame } from './frame-capture';
import { saveNoteAt } from './notebook-save-note';
import { makeNotebookStore } from './notebook-store';
import type { PlayerController } from './player-controller';
import type { QuoteSource } from './transcript';

export type BlockPatch = Partial<Pick<Block, 'body' | 'kind' | 'questionState' | 'tags' | 'annotation' | 'insightCategory'>>
  & { pinned?: boolean; isInsight?: boolean; stamp?: { pageVideoId: number; videoTimeSec: number } | null };

export type NotebookEnv = {
  pageId: number;
  sourceId: number;
  myId: number;
  ownerName: string;
  author: string | null;
  player: PlayerController;
  videos: () => PageVideo[];
  select: (id: number | null, opts?: { scroll?: boolean }) => void;
  edit: (id: number | null, at?: { x: number; y: number } | null) => void;
  selected: () => number | null;
  flash: (id: number) => void;
  activeEditor: { current: ActiveEditor | null };
  quote: { current: () => QuoteSource | null };
};

const DELETE_DELAY_MS = 6200;

/**
 * Everything the notebook changes. Blocks live in the shared cache (`keys.blocks(pageId)`), in page order;
 * each change updates it at once and saves (lib/saves.ts). Deletes wait 6 s for Undo before they are sent.
 */
export function useNotebookOps(env: NotebookEnv) {
  const ref = useRef(env);
  ref.current = env;
  const pendingDeletes = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    // Leaving the page: deletes still waiting for Undo go out now.
    for (const [id, timer] of pendingDeletes.current) {
      clearTimeout(timer);
      void save('DELETE', `/blocks/${id}`).catch(() => undefined);
    }
    pendingDeletes.current.clear();
  }, []);

  return useMemo(() => {
    const store = makeNotebookStore(() => ref.current);
    const { key, list, find, setList, fail, refreshCounts, create, update, startEditing, stampNow, patchLocal } = store;

    const ops = {
      update,

      /** N: a text block stamped at this second, in time order, focused. */
      async noteAt() {
        const { videoId, t } = stampNow();
        const place = videoId ? placeByTime(list(), videoId, t) : {};
        startEditing(await create(videoId ? { kind: 'text', pageVideoId: videoId, videoTimeSec: t } : { kind: 'text' }, place));
      },

      /** A text block at the end of the page, without a stamp. */
      async writeAtEnd() {
        startEditing(await create({ kind: 'text' }, {}));
      },

      /** Enter at the end of a block, or its "+" (Alt: above): a text block right next to it (no stamp). */
      async newBlockNextTo(id: number, above = false): Promise<boolean> {
        const block = await create({ kind: 'text' }, above ? { beforeBlockId: id } : { afterBlockId: id });
        startEditing(block);
        return !!block;
      },

      /** "My note here": the viewer's own block right after another's, with its stamp. */
      async reply(id: number) {
        const anchor = find(id);
        if (!anchor) return;
        const stamp = anchor.pageVideoId != null && anchor.videoTimeSec != null ? { pageVideoId: anchor.pageVideoId, videoTimeSec: anchor.videoTimeSec } : {};
        startEditing(await create({ kind: 'text', ...stamp }, { afterBlockId: id }));
      },

      /** Q: the selected transcript text or the current line, as a quote at its time; an empty text block after it. */
      async quote(source?: QuoteSource | null) {
        const picked = source ?? ref.current.quote.current();
        const { videoId } = stampNow();
        if (!picked || !videoId) {
          toast('This video has no transcript to quote.');
          return;
        }
        window.getSelection()?.removeAllRanges();
        const t = Math.floor(picked.t);
        const quote = await create({ kind: 'quote', body: picked.text, pageVideoId: videoId, videoTimeSec: t }, placeByTime(list(), videoId, t));
        if (!quote) return;
        const take = await create({ kind: 'text' }, { afterBlockId: quote.id });
        startEditing(take);
        ref.current.flash(quote.id);
        toast('Quoted. Now write your own take below it.');
      },

      /** F: the current frame into a note (frame-capture.ts). */
      capture: () => captureFrame(store, ref.current),

      /** A word lookup or chat answer kept as a note at its line's time (notebook-save-note.ts). */
      saveNote: (body: string, t: number) => saveNoteAt(store, ref.current, body, t),

      /** Pasted or dropped image files: uploaded to the block, then placed where they landed. */
      async addFiles(blockId: number, files: File[], at: number) {
        for (const file of files) {
          const before = new Set((find(blockId)?.images ?? []).map((i) => i.id));
          try {
            const block = await send<Block>(`/blocks/${blockId}/images`, { method: 'POST', body: formData({}, [{ name: 'image', blob: file, filename: file.name || 'image.png' }]) });
            patchLocal(blockId, { images: block.images });
            const added = block.images.find((i) => !before.has(i.id));
            const editing = ref.current.activeEditor.current;
            if (added && editing?.blockId === blockId) {
              editing.editor.chain().insertContentAt(Math.min(at, editing.editor.state.doc.content.size), { type: 'blockImage', attrs: { id: added.id } }).run();
            }
          } catch (error) {
            fail(error);
          }
        }
      },

      /** Delete (key or menu): gone at once, sent after 6 s unless Undo. */
      remove(id: number) {
        const blocks = list();
        const index = blocks.findIndex((b) => b.id === id);
        if (index < 0) return;
        const removed = blocks[index];
        setList((all) => all.filter((b) => b.id !== id));
        const next = list()[Math.max(0, index - 1)];
        ref.current.select(next?.id ?? null);
        const timer = setTimeout(() => {
          pendingDeletes.current.delete(id);
          void save('DELETE', `/blocks/${id}`).then(refreshCounts, fail);
        }, DELETE_DELAY_MS);
        pendingDeletes.current.set(id, timer);
        toast('Block deleted', {
          label: 'Undo',
          run: () => {
            clearTimeout(pendingDeletes.current.get(id));
            pendingDeletes.current.delete(id);
            setList((all) => {
              const copy = all.filter((b) => b.id !== id);
              copy.splice(Math.min(index, copy.length), 0, removed);
              return copy;
            });
            ref.current.select(id, { scroll: true });
          },
        });
      },

      /** Backspace in an empty block: removed at once (nothing to undo), caret to the block above. */
      removeEmpty(id: number) {
        const blocks = list();
        const index = blocks.findIndex((b) => b.id === id);
        const block = blocks[index];
        if (!block || block.images.length) return;
        setList((all) => all.filter((b) => b.id !== id));
        void save('DELETE', `/blocks/${id}`).then(refreshCounts, fail);
        const above = [...blocks.slice(0, index)].reverse().find((b) => b.authorId === ref.current.myId);
        ref.current.select(above?.id ?? null);
        ref.current.edit(above?.id ?? null);
      },

      /** Editing stopped on a block with nothing in it (N pressed, nothing written): it goes, silently. */
      dropIfEmpty(id: number) {
        const block = find(id);
        if (!block || block.type !== 'note' || block.images.length || block.annotation || block.tags || block.isInsight || block.pinned) return;
        if (plainText(block.body)) return;
        setList((all) => all.filter((b) => b.id !== id));
        void save('DELETE', `/blocks/${id}`).then(refreshCounts, fail);
      },

      /** Move up or down one place among the blocks shown. */
      move(id: number, direction: -1 | 1) {
        const blocks = list();
        const index = blocks.findIndex((b) => b.id === id);
        const neighbour = blocks[index + direction];
        if (index < 0 || !neighbour) return;
        const place: Place = direction < 0 ? { beforeBlockId: neighbour.id } : { afterBlockId: neighbour.id };
        setList((all) => insertAt(all, all[index], place));
        void save('PUT', `/blocks/${id}/position`, place).catch((error: unknown) => {
          fail(error);
          invalidate(key());
        });
        ref.current.select(id, { scroll: true });
      },

      /** The More menu's "Set time to now" / "Stamp at now". */
      stampHere(id: number) {
        const { videoId, t } = stampNow();
        if (!videoId) return;
        void update(id, { stamp: { pageVideoId: videoId, videoTimeSec: t } });
      },

      setKind(id: number, kind: BlockKind) {
        const block = find(id);
        if (!block) return;
        if (kind === 'question' && block.videoTimeSec == null) {
          const { videoId, t } = stampNow();
          if (videoId) return update(id, { kind, stamp: { pageVideoId: videoId, videoTimeSec: t } });
        }
        return update(id, { kind });
      },
    };
    return ops;
  }, []);
}

export type NotebookOps = ReturnType<typeof useNotebookOps>;
