import { useEffect, useRef, type RefObject } from 'react';
import { api } from '../lib/api';
import { flashNotice } from '../lib/shell-state';
import type { Block, Page, Source } from '../lib/types';
import type { PlayerController } from './player-controller';

/**
 * Landing on a page, and on each new link to it (design-spec §5.4): the linked block centred, selected and
 * flashed; else the viewer's reading position scrolled to the top with "You stopped here". Waits until the
 * sheet can render (page, source and blocks in).
 */
export function useLanding({ visit, page, source, blocks, block, t, videoId, player, select, flash, setResumeId }: {
  visit: number;
  page: Page | undefined;
  source: Source | undefined;
  blocks: Block[] | undefined;
  block: number | null;
  t: number | null;
  videoId: number | null;
  player: PlayerController;
  select: (id: number) => void;
  flash: (id: number) => void;
  setResumeId: (id: number | null) => void;
}): void {
  const landed = useRef<number | null>(null);
  useEffect(() => {
    if (!blocks || !page || !source || landed.current === visit) return;
    landed.current = visit;
    const target = block ?? page.lastBlockId;
    setResumeId(block ? null : page.lastBlockId);
    if (block && t != null && videoId && player.state.get().videoId === videoId) player.seek(t);
    if (!target) return;
    select(target);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.blk[data-id="${target}"]`);
      if (!el) return;
      el.scrollIntoView({ block: block ? 'center' : 'start' });
      if (block) flash(target);
    });
  }, [blocks, page, source, visit, block, t, flash, player, videoId, select, setResumeId]);
}

/**
 * Reading position: the top visible block, 700 ms after scrolling stops, saved per viewer. The sheet scrolls on
 * a wide screen, the window on a narrow one; both are watched.
 */
export function useReadingPosition(pageId: number, sheet: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: number | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const box = sheet.current;
        if (!box) return;
        const top = Math.max(0, box.getBoundingClientRect().top) + 60;
        const el = [...box.querySelectorAll<HTMLElement>('.blk[data-id]')].find((x) => x.getBoundingClientRect().bottom > top);
        const id = el ? Number(el.dataset.id) : null;
        if (!id || id === last) return;
        last = id;
        void api(`/pages/${pageId}/reading-state`, { method: 'PUT', body: { lastBlockId: id } }).then(() => flashNotice('Reading position saved'), () => undefined);
      }, 700);
    };
    const box = sheet.current;
    box?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      box?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    };
  }, [pageId, sheet, ready]);
}
