import { useEffect, useRef } from 'react';
import { api, ApiError } from '../lib/api';
import { keys } from '../lib/data';
import { invalidate, mutate } from '../lib/resource';
import { useSession } from '../lib/session';
import { toast } from '../lib/shell-state';
import { useStore } from '../lib/store';
import type { PageVideo, PageVideoList } from '../lib/types';
import { useNotebook } from './notebook-context';
import { usePlayer } from './player-controller';
import { useTranscript } from './transcript';
import { PlayerControls, toggleFullscreen, type Tick } from './player-controls';
import { createVideoProgressSaver, type VideoProgressResult } from './video-progress-saver';

export type { Tick } from './player-controls';

/** Where a video opens: a watched one that ended starts over, any other resumes where it stopped. */
export function resumeAt(video: PageVideo): number {
  const { completed, durationSec, lastPositionSec } = video;
  if (completed && durationSec && lastPositionSec >= 0.95 * durationSec) return 0;
  return lastPositionSec;
}

const PROBLEM_TEXT: Record<string, string> = {
  'video-file-missing': 'Video file not found',
  'video-outside-root': 'The video is no longer inside the video library folder',
  'library-root-missing': 'The video library folder is not set or not reachable',
  'video-not-mp4': 'Only .mp4 videos can be played',
};

/**
 * The player (design-spec §6.2): always on the dark video surface, 16:9; a click on the frame toggles play, a
 * double-click toggles fullscreen; the control bar is player-controls.tsx. Saves the viewer's position
 * (video-progress-saver.ts).
 */
export function Player({ video, ticks, onLocate }: { video: PageVideo; ticks: Tick[]; onLocate: () => void }) {
  const player = usePlayer();
  const { ownerName } = useSession();
  const { canWrite } = useNotebook();
  const state = useStore(player.state);
  const sourceUrl = useTranscript(video.id).data?.sourceUrl ?? null;
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const watched = useRef(video.completed);
  const furthest = useRef(video.furthestSec);

  useEffect(() => {
    const el = ref.current;
    player.attach(el);
    watched.current = video.completed;
    furthest.current = video.furthestSec;
    player.update({ videoId: video.id, problem: null, size: null, playing: false, duration: video.durationSec ?? 0, t: player.pendingSeek?.t ?? resumeAt(video) });
    if (!player.pendingSeek) player.pendingSeek = { t: resumeAt(video), play: false };

    const saver = createVideoProgressSaver({
      send: (payload) => api<VideoProgressResult>(`/page-videos/${video.id}/progress`, { method: 'PUT', body: payload }),
      now: () => Date.now(),
      setTimer: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      isPermanentFailure: (error) => error instanceof ApiError && error.status < 500,
      onSaved: (result) => {
        furthest.current = Math.max(furthest.current, result.furthestSec);
        if (result.completed && !watched.current) {
          watched.current = true;
          toast(`${video.title} marked as watched`);
          // Progress marks on the page list, Home and the source change with it.
          invalidate('pages:', keys.page(video.pageId), keys.sources, keys.recent);
        }
        mutate<PageVideoList>(keys.videos(video.pageId), (list) => ({
          ...list,
          videos: list.videos.map((v) => v.id === video.id ? { ...v, completed: v.completed || result.completed, furthestSec: Math.max(v.furthestSec, result.furthestSec), lastPositionSec: el?.currentTime ?? v.lastPositionSec } : v),
        }));
      },
    });
    if (!el) return;
    const duration = () => (Number.isFinite(el.duration) ? el.duration : 0);
    const onMeta = () => {
      player.update({ duration: duration(), size: el.videoWidth ? { width: el.videoWidth, height: el.videoHeight } : null });
      const pending = player.pendingSeek;
      player.pendingSeek = null;
      if (pending) el.currentTime = Math.min(pending.t, Math.max(0, duration() - 0.05));
      saver.arm(el.currentTime);
      player.update({ t: el.currentTime });
      if (pending?.play) void el.play().catch(() => undefined);
    };
    const onTime = () => {
      player.update({ t: el.currentTime });
      if (!el.paused) saver.tick(el.currentTime, duration());
    };
    const onPlay = () => player.update({ playing: true });
    const onPause = () => {
      player.update({ playing: false });
      saver.flush(el.currentTime, duration());
    };
    const onRate = () => player.update({ rate: el.playbackRate });
    // The picture-in-picture window has its own sound controls.
    const onVolume = () => player.update({ volume: el.volume, muted: el.muted });
    const onError = () => void explain(video.id).then((problem) => player.update({ problem, playing: false }));
    const onHide = () => {
      if (document.visibilityState === 'hidden') saver.flush(el.currentTime, duration());
    };
    player.applyPrefs(el);
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) onMeta();
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    el.addEventListener('ratechange', onRate);
    el.addEventListener('volumechange', onVolume);
    el.addEventListener('error', onError);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      saver.flush(el.currentTime, duration());
      saver.dispose();
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.removeEventListener('ratechange', onRate);
      el.removeEventListener('volumechange', onVolume);
      el.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onHide);
      player.attach(null);
    };
    // One set-up per video; the video row's progress fields change as it saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id, player]);

  const duration = state.duration || video.durationSec || 0;
  const problem = state.problem;
  const src = `/api/page-videos/${video.id}/stream${video.revision ? `?v=${encodeURIComponent(video.revision)}` : ''}`;

  return <div ref={box} className={`player${problem ? ' is-missing' : ''}`}>
    <div className="frame" onClick={() => { if (!problem) player.toggle(); }} onDoubleClick={() => { if (!problem) toggleFullscreen(box.current); }}>
      <video ref={ref} src={src} preload="metadata" playsInline aria-label={`Video: ${video.title}`} hidden={!!problem} />
      {problem ? <div className="vmissing" role="alert">
        <strong>{PROBLEM_TEXT[problem.code] ?? problem.message}</strong>
        {problem.relPath ? <p className="mono">{problem.relPath}</p> : null}
        <p>{problem.code === 'library-root-missing' ? 'The drive may not be connected.' : 'It was moved or renamed, or the drive is not connected.'} Your notes on this page still work.</p>
        {canWrite ? <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); onLocate(); }}>Locate the file</button>
          : <p>{ownerName} needs to fix this on the PC that holds the videos.</p>}
      </div> : null}
    </div>
    <PlayerControls duration={duration} furthest={Math.max(video.furthestSec, furthest.current)} ticks={ticks} problem={!!problem} container={box} sourceUrl={sourceUrl} />
  </div>;
}

async function explain(videoId: number): Promise<{ code: string; relPath: string | null; message: string }> {
  try {
    await api(`/page-videos/${videoId}/file-status`);
    return { code: 'unplayable', relPath: null, message: 'This video cannot be played in this browser' };
  } catch (error) {
    if (error instanceof ApiError) {
      return { code: error.code ?? 'error', relPath: typeof error.details?.relPath === 'string' ? error.details.relPath : null, message: error.message };
    }
    return { code: 'offline', relPath: null, message: 'The video cannot be reached right now' };
  }
}
