import { useEffect, useRef } from 'react';
import { dispatchKey, isTyping, overlayOpen } from '../lib/keys';
import { keys } from '../lib/data';
import { peek } from '../lib/resource';
import { navigate, paths, type Route } from '../lib/router';
import { flashNotice, overlay } from '../lib/shell-state';
import type { Source } from '../lib/types';

/**
 * Keys that work anywhere (design-spec §8): Ctrl K search, / search this source, G H/S/I/P, Alt 1–9 back to the
 * page last read in source N, ? keyboard sheet. Screen keys (lib/keys.ts) go first; single keys never fire
 * while typing.
 */
export function useGlobalKeys(route: Route, activeSourceId: number | null): void {
  const state = useRef({ route, activeSourceId });
  state.current = { route, activeSourceId };

  useEffect(() => {
    let chord: ReturnType<typeof setTimeout> | null = null;
    const endChord = () => {
      if (chord) clearTimeout(chord);
      chord = null;
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || overlayOpen()) return;
      const mod = event.ctrlKey || event.metaKey;
      const typing = isTyping(event.target);
      const { activeSourceId: sourceId } = state.current;
      if (mod && !event.altKey && event.code === 'KeyK') {
        event.preventDefault();
        overlay.set({ kind: 'search', mode: 'all', scope: null, query: '' });
        return;
      }
      if (chord && !typing && !mod && !event.altKey) {
        endChord();
        const go: Record<string, () => void> = {
          KeyH: () => navigate(paths.home()),
          KeyS: () => overlay.set({ kind: 'search', mode: 'sources', scope: null, query: '' }),
          KeyI: () => sourceId && navigate(paths.source(sourceId, 'insights')),
          KeyP: () => sourceId && navigate(paths.source(sourceId, 'pages')),
        };
        if (go[event.code]) {
          event.preventDefault();
          go[event.code]();
        }
        return;
      }
      if (dispatchKey(event)) return;
      if (typing) return;
      if (event.altKey && !mod && /^Digit[1-9]$/.test(event.code)) {
        event.preventDefault();
        const source = (peek<Source[]>(keys.sources) ?? [])[Number(event.code.slice(5)) - 1];
        if (!source) return;
        navigate(source.lastPageId ? paths.page(source.lastPageId) : paths.source(source.id));
        flashNotice(source.name);
        return;
      }
      if (mod || event.altKey) return;
      if (event.code === 'KeyG' && !event.shiftKey) {
        chord = setTimeout(endChord, 1200);
        flashNotice('G… then H home, S sources, I insights, P pages');
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        overlay.set({ kind: 'keys' });
        return;
      }
      if (event.code === 'Slash' && !event.shiftKey) {
        event.preventDefault();
        overlay.set({ kind: 'search', mode: 'all', scope: sourceId, query: '' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      endChord();
    };
  }, []);
}
