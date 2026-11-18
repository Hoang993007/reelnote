import { initials } from '../lib/format';
import type { Source, WatchState } from '../lib/types';

/** A source's monogram on its colour (white text, 4.5:1 for every colour in the set), or its uploaded image. */
export function SourceAvatar({ source, size = 'md' }: { source: Pick<Source, 'name' | 'color'> & { avatarPath?: string | null }; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  if (source.avatarPath) return <img className={`av av-${size} av-img`} src={`/${source.avatarPath}`} alt="" />;
  return <span className={`av av-${size}`} data-color={source.color ?? '#2C47A0'} aria-hidden="true" ref={paint(source.color)}>{initials(source.name)}</span>;
}

/** Sets the monogram colour through the CSSOM (the CSP has no inline style attributes). */
function paint(color: string | null | undefined) {
  return (el: HTMLElement | null) => {
    if (el) el.style.setProperty('--av', color ?? '#2C47A0');
  };
}

export const WATCH_LABEL: Record<WatchState, string> = { full: 'Watched', half: 'In progress', none: 'Not started' };

/** ● watched, ◐ in progress, ○ not started: shape plus a label, never colour alone. */
export function ProgressMark({ state }: { state: WatchState }) {
  return <span className={`pmark pmark-${state}`} title={WATCH_LABEL[state]}><span className="sr">{WATCH_LABEL[state]}</span></span>;
}

export function PersonAvatar({ name, owner, large }: { name: string; owner: boolean; large?: boolean }) {
  return <span className={`ppl-av${owner ? ' is-owner' : ''}${large ? ' ppl-av-lg' : ''}`} aria-hidden="true">{initials(name)}</span>;
}

export function Kbd({ children }: { children: string }) {
  return <kbd>{children}</kbd>;
}
