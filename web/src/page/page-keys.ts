import { closestTo, useKeys } from '../lib/keys';
import { pageUi } from '../lib/page-ui';
import { navigate, paths } from '../lib/router';
import type { Block, Page } from '../lib/types';
import { insightMenu, tagMenu } from './block-menus';
import { canEditBlock, isMine, type NotebookCtx } from './notebook-context';
import type { PlayerController } from './player-controller';

/**
 * The page's keys (design-spec §8): video (Space, ← →, M, < >, N F Q, \), blocks in navigation mode (J K, Enter, I T A P
 * O, Delete, Esc), pages ([ ], Ctrl \). Single keys only outside text fields; Backspace never deletes a block.
 */
export function usePageKeys({ ctx, player, pages, pageId, blocks, selected, hasVideo, editing }: {
  ctx: NotebookCtx;
  player: PlayerController;
  pages: Page[];
  pageId: number;
  blocks: Block[];
  selected: number | null;
  hasVideo: boolean;
  editing: number | null;
}) {
  useKeys((event, typing) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && event.code === 'Backslash') {
      pageUi.set((s) => ({ ...s, pagesOpen: !s.pagesOpen }));
      return true;
    }
    if (typing || mod || event.altKey) return false;
    const onControl = !!closestTo(event.target, 'button, a, [role="slider"], [role="separator"]');
    const block = selected ? blocks.find((b) => b.id === selected) : undefined;
    const mine = block ? canEditBlock(block, ctx) : false;
    const own = block ? isMine(block, ctx.myId, ctx.isOwner) : false;
    const tools = () => document.querySelector(`.blk[data-id="${selected}"] .b-tools`) ?? document.querySelector(`.blk[data-id="${selected}"]`);

    const step = (direction: 1 | -1) => {
      const ids = [...document.querySelectorAll<HTMLElement>('#blocks .blk[data-id]')].map((el) => Number(el.dataset.id));
      if (!ids.length) return;
      const at = selected ? ids.indexOf(selected) : -1;
      const next = ids[at < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, at + direction))];
      ctx.select(next, { scroll: true });
      document.querySelector<HTMLElement>(`.blk[data-id="${next}"]`)?.focus({ preventScroll: true });
    };
    const pageStep = (direction: 1 | -1) => {
      const at = pages.findIndex((p) => p.id === pageId);
      const next = pages[at + direction];
      if (at >= 0 && next) navigate(paths.page(next.id));
    };

    switch (event.code) {
      case 'KeyJ': step(1); return true;
      case 'KeyK': step(-1); return true;
      case 'KeyN': void (hasVideo ? ctx.ops.noteAt() : ctx.ops.writeAtEnd()); return true;
      case 'KeyF': void ctx.ops.capture(); return true;
      case 'KeyQ': void ctx.ops.quote(); return true;
      case 'Space':
        if (onControl || !hasVideo) return false;
        player.toggle();
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (onControl || !hasVideo) return false;
        player.seek(player.now() + (event.code === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 30 : 5));
        return true;
      case 'KeyM':
        if (!hasVideo) return false;
        player.toggleMute();
        return true;
      case 'Comma':
      case 'Period':
        // < and > (Shift with , and .) step the speed, as in most video players.
        if (!event.shiftKey || !hasVideo) return false;
        player.stepRate(event.code === 'Period' ? 1 : -1);
        return true;
      case 'BracketLeft': pageStep(-1); return true;
      case 'BracketRight': pageStep(1); return true;
      case 'Backslash': pageUi.set((s) => ({ ...s, focus: !s.focus })); return true;
      case 'KeyI': if (block && mine) insightMenu(tools()!, block, ctx); return !!block;
      case 'KeyT': if (block && mine) tagMenu(tools()!, block, ctx); return !!block;
      case 'KeyA': if (block && own) ctx.openAnnotation(block.id); return !!block;
      case 'KeyP': if (block && mine) void ctx.ops.update(block.id, { pinned: !block.pinned }); return !!block;
      case 'KeyO':
        if (block && mine && block.type === 'note' && block.kind === 'question') {
          void ctx.ops.update(block.id, { questionState: block.questionState === 'answered' ? 'open' : 'answered' });
        }
        return !!block;
      default:
        break;
    }
    if (event.key === 'Enter' && !onControl && block) {
      if (mine) ctx.edit(block.id);
      return true;
    }
    if (event.key === 'Delete' && block && mine && editing !== block.id) {
      ctx.ops.remove(block.id);
      return true;
    }
    if (event.key === 'Escape' && selected) {
      ctx.select(null);
      return true;
    }
    return false;
  });
}
