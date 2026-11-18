import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { fmtTime } from '../lib/format';
import { toast } from '../lib/shell-state';
import { useStore } from '../lib/store';
import { Icon } from '../shell/icons';
import { RATES, usePlayer } from './player-controller';

export type Tick = { id: number; t: number; label: string };

/** Fullscreen takes the whole player (frame and bar), so the controls stay usable in it. */
export function toggleFullscreen(el: HTMLElement | null): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (!el?.requestFullscreen) {
    toast('Fullscreen is not available in this browser.');
    return;
  }
  void el.requestFullscreen().catch(() => toast('Fullscreen is not available in this browser.'));
}

function useIsFullscreen(container: RefObject<HTMLElement>): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(!!container.current && document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [container]);
  return full;
}

/**
 * The control bar: play, back and forward 10 s, time, the scrubber, sound, speed, the picture's resolution, the
 * page the video came from, picture in picture and fullscreen. On a narrow study pane the skip, resolution and
 * picture-in-picture items drop out (container query).
 */
export function PlayerControls({ duration, furthest, ticks, problem, container, sourceUrl }: {
  duration: number;
  furthest: number;
  ticks: Tick[];
  problem: boolean;
  container: RefObject<HTMLDivElement>;
  /** The link the file was downloaded from, from its metadata. */
  sourceUrl: string | null;
}) {
  const player = usePlayer();
  const state = useStore(player.state);
  const full = useIsFullscreen(container);
  const togglePip = () => {
    const el = player.element;
    if (!el || problem) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void el.requestPictureInPicture().catch(() => toast('Picture in picture is not available for this video.'));
  };

  return <div className="vbar">
    <button type="button" className="ibtn ibtn-dark" aria-label={state.playing ? 'Pause (Space)' : 'Play (Space)'} title={state.playing ? 'Pause (Space)' : 'Play (Space)'}
      onClick={() => { if (!player.toggle() || problem) toast('The video file is missing, so it cannot play.'); }}>
      <Icon name={state.playing ? 'pause' : 'play'} /></button>
    <button type="button" className="ibtn ibtn-dark vskip" aria-label="Back 10 seconds" title="Back 10 s (← 5 s, Shift ← 30 s)"
      onClick={() => player.seek(player.now() - 10)}><Icon name="back10" /></button>
    <button type="button" className="ibtn ibtn-dark vskip" aria-label="Forward 10 seconds" title="Forward 10 s (→ 5 s, Shift → 30 s)"
      onClick={() => player.seek(player.now() + 10)}><Icon name="fwd10" /></button>
    <span className="mono vtime">{fmtTime(state.t)} / {fmtTime(duration)}</span>
    <Scrubber t={state.t} duration={duration} furthest={furthest} ticks={ticks} />
    <Volume volume={state.volume} muted={state.muted} />
    <SpeedMenu rate={state.rate} />
    {state.size ? <span className="mono vres" title={`${state.size.width} × ${state.size.height}`}>{resolutionLabel(state.size)}</span> : null}
    {sourceUrl ? <a className="ibtn ibtn-dark" href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the page this video came from"
      title={sourceUrl}><Icon name="link" /></a> : null}
    {document.pictureInPictureEnabled ? <button type="button" className="ibtn ibtn-dark vpip" aria-label="Picture in picture" title="Picture in picture"
      onClick={togglePip}><Icon name="pip" /></button> : null}
    <button type="button" className="ibtn ibtn-dark" aria-label={full ? 'Exit fullscreen' : 'Fullscreen'} title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen (double-click the video)'}
      onClick={() => toggleFullscreen(container.current)}><Icon name={full ? 'shrink' : 'expand'} /></button>
  </div>;
}

/** The usual name of a resolution, from the short side so a portrait reel reads 1080p too. */
export function resolutionLabel({ width, height }: { width: number; height: number }): string {
  return `${Math.min(width, height)}p`;
}

/** Mute button plus a slider that opens on hover or focus (M mutes). */
function Volume({ volume, muted }: { volume: number; muted: boolean }) {
  const player = usePlayer();
  const shown = muted ? 0 : volume;
  return <div className="vvol">
    <button type="button" className="ibtn ibtn-dark" aria-label={muted ? 'Unmute (M)' : 'Mute (M)'} title={muted ? 'Unmute (M)' : 'Mute (M)'}
      onClick={() => player.toggleMute()}><Icon name={shown === 0 ? 'mute' : 'volume'} /></button>
    <input type="range" className="vvol-range" min={0} max={1} step={0.05} value={shown} aria-label="Volume"
      ref={(el) => el?.style.setProperty('--fill', `${shown * 100}%`)}
      onChange={(e) => player.setVolume(Number(e.currentTarget.value))} />
  </div>;
}

/** The speed button opens the list of speeds; < and > step through it from the keyboard. */
function SpeedMenu({ rate }: { rate: number }) {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    box.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setOpen(false);
    box.current?.querySelector<HTMLButtonElement>('.vrate-btn')?.focus();
  };
  return <div className="vrate" ref={box} onKeyDown={onKey}>
    <button type="button" className="vrate-btn mono" aria-haspopup="menu" aria-expanded={open} title="Playback speed (< >)"
      aria-label={`Playback speed ${rate}×`} onClick={() => setOpen((o) => !o)}>{rate}×</button>
    {open ? <div className="vrate-menu" role="menu" aria-label="Playback speed">
      {RATES.map((r) => <button key={r} type="button" role="menuitemradio" aria-checked={r === rate}
        className={`vrate-item mono${r === rate ? ' is-on' : ''}`} onClick={() => { player.setRate(r); setOpen(false); }}>
        {r === 1 ? 'Normal' : `${r}×`}</button>)}
    </div> : null}
  </div>;
}

/** 18 px hit area, 4 px track; watched range, position and note ticks. A keyboard slider (← → 5 s). */
function Scrubber({ t, duration, furthest, ticks }: { t: number; duration: number; furthest: number; ticks: Tick[] }) {
  const player = usePlayer();
  const pct = (value: number) => `${duration ? Math.min(100, (value / duration) * 100) : 0}%`;
  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    player.seek(((event.clientX - box.left) / box.width) * duration);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    player.seek(player.now() + (event.key === 'ArrowLeft' ? -5 : 5) * (event.shiftKey ? 6 : 1));
  };
  return <div className="scrub" role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.floor(duration)}
    aria-valuenow={Math.floor(t)} aria-valuetext={`${fmtTime(t)} of ${fmtTime(duration)}`} onKeyDown={onKey}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekAt(e); }}
    onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e); }}>
    <div className="scrub-max" ref={(el) => el?.style.setProperty('width', pct(furthest))} />
    <div className="scrub-fill" ref={(el) => el?.style.setProperty('width', pct(t))} />
    {duration ? ticks.filter((tick) => tick.t <= duration).map((tick) => <span key={tick.id} className="tick" title={`${fmtTime(tick.t)} · ${tick.label}`}
      ref={(el) => el?.style.setProperty('left', pct(tick.t))} />) : null}
  </div>;
}
