import { createContext, useContext } from 'react';
import { createStore, type Store } from '../lib/store';

/**
 * The page's player, shared by the study pane (video, scrubber, transcript) and the notebook (note at this
 * second, stamps that seek, the "now" stamp). The <video> element registers itself; everything else asks here.
 */
export type PlayerState = {
  videoId: number | null;
  t: number;
  duration: number;
  playing: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  /** The picture's size once the file's metadata is in; `null` before. */
  size: { width: number; height: number } | null;
  /** Set when the file cannot play: why, and its library path. */
  problem: { code: string; relPath: string | null; message: string } | null;
};

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** Speed and sound carry over to the next video and the next visit (this browser only). */
const PREFS_KEY = 'reelnote.player';
type Prefs = Pick<PlayerState, 'rate' | 'volume' | 'muted'>;

function loadPrefs(): Prefs {
  const prefs: Prefs = { rate: 1, volume: 1, muted: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    if (typeof saved.rate === 'number' && RATES.includes(saved.rate)) prefs.rate = saved.rate;
    if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) prefs.volume = saved.volume;
    if (typeof saved.muted === 'boolean') prefs.muted = saved.muted;
  } catch {
    // No storage (private window, blocked site data): the defaults stand.
  }
  return prefs;
}

export class PlayerController {
  readonly state: Store<PlayerState> = createStore<PlayerState>({ videoId: null, t: 0, duration: 0, playing: false, ...loadPrefs(), size: null, problem: null });
  private el: HTMLVideoElement | null = null;
  /** Where to go once the selected video's metadata is in (resume point, deep link). */
  pendingSeek: { t: number; play: boolean } | null = null;
  /** Called when a video is chosen (tab, stamp on another video). */
  onSelect: (videoId: number, at: number | null, play: boolean) => void = () => undefined;

  attach(el: HTMLVideoElement | null): void {
    this.el = el;
  }

  get element(): HTMLVideoElement | null {
    return this.el;
  }

  /** The current second, read from the element when it is there (state lags by a timeupdate). */
  now(): number {
    return this.el && Number.isFinite(this.el.currentTime) ? this.el.currentTime : this.state.get().t;
  }

  update(patch: Partial<PlayerState>): void {
    this.state.set((s) => ({ ...s, ...patch }));
  }

  play(): boolean {
    const el = this.el;
    if (!el || this.state.get().problem) return false;
    void el.play().catch(() => undefined);
    return true;
  }

  pause(): void {
    this.el?.pause();
  }

  toggle(): boolean {
    if (!this.el) return false;
    if (this.el.paused) return this.play();
    this.pause();
    return true;
  }

  seek(t: number, play = false): void {
    const el = this.el;
    const duration = this.state.get().duration || el?.duration || 0;
    const target = Math.max(0, duration ? Math.min(duration - 0.05, t) : t);
    if (!el || el.readyState < HTMLMediaElement.HAVE_METADATA) {
      this.pendingSeek = { t: target, play };
      this.update({ t: target });
      return;
    }
    el.currentTime = target;
    this.update({ t: target });
    if (play) this.play();
  }

  /** Seek on a given video: switches to it first when it is not the one shown. */
  seekOn(videoId: number, t: number, play: boolean): void {
    if (this.state.get().videoId !== videoId) {
      this.onSelect(videoId, t, play);
      return;
    }
    this.seek(t, play);
  }

  setRate(rate: number): void {
    if (this.el) this.el.playbackRate = rate;
    this.update({ rate });
    this.savePrefs();
  }

  /** One step along RATES (the < and > keys); stays at either end. */
  stepRate(direction: 1 | -1): number {
    const { rate } = this.state.get();
    const at = RATES.indexOf(rate);
    const next = RATES[Math.max(0, Math.min(RATES.length - 1, (at < 0 ? RATES.indexOf(1) : at) + direction))];
    this.setRate(next);
    return next;
  }

  /** Dragging the volume to 0 mutes; raising it unmutes. */
  setVolume(volume: number): void {
    const muted = volume === 0;
    if (this.el) {
      this.el.volume = volume;
      this.el.muted = muted;
    }
    this.update(muted ? { muted } : { volume, muted });
    this.savePrefs();
  }

  toggleMute(): void {
    const { muted, volume } = this.state.get();
    const next = !muted;
    if (this.el) {
      this.el.muted = next;
      if (!next && volume === 0) this.el.volume = 1;
    }
    this.update(!next && volume === 0 ? { muted: next, volume: 1 } : { muted: next });
    this.savePrefs();
  }

  /** Applies the remembered speed and sound to a newly attached element. */
  applyPrefs(el: HTMLVideoElement): void {
    const { rate, volume, muted } = this.state.get();
    el.playbackRate = rate;
    el.volume = volume;
    el.muted = muted;
  }

  private savePrefs(): void {
    const { rate, volume, muted } = this.state.get();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ rate, volume, muted }));
    } catch {
      // Not saved: it still applies for this visit.
    }
  }
}

export const PlayerContext = createContext<PlayerController | null>(null);

export function usePlayer(): PlayerController {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer outside a page');
  return player;
}
