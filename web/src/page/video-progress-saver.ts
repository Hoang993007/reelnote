/**
 * One video's playback saves: throttled to one per 5 s while playing, at once on pause, end, hidden window and
 * video switch; newest-only, retried with backoff on network failures. From the original app's renderer
 * (learning/videos/video-progress-saver.ts), with the watched threshold the server applies (90%).
 */
export type VideoProgressInput = { positionSec: number; durationSec?: number; completed: boolean; clientTs: number };
export type VideoProgressResult = { applied: boolean; completed: boolean; furthestSec: number };

export interface VideoProgressSaverDeps {
  send: (payload: VideoProgressInput) => Promise<VideoProgressResult>;
  now: () => number;
  setTimer: (run: () => void, ms: number) => () => void;
  /** A refused save (4xx): dropped, never retried. */
  isPermanentFailure: (error: unknown) => boolean;
  onSaved: (result: VideoProgressResult) => void;
}

export interface VideoProgressSaver {
  arm: (positionSec: number) => void;
  tick: (positionSec: number, durationSec: number) => void;
  flush: (positionSec: number, durationSec: number) => void;
  dispose: () => void;
}

export const SAVE_INTERVAL_MS = 5_000;
export const WATCHED_SHARE = 0.9;
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** A save that moved less than this since the last one is skipped: opening a video is not watching it. */
const MIN_MOVE_SEC = 1;

const seconds = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

export function createVideoProgressSaver(deps: VideoProgressSaverDeps): VideoProgressSaver {
  let armed = false;
  let disposed = false;
  let lastSaveAt = Number.NEGATIVE_INFINITY;
  let lastClientTs = 0;
  let lastPositionSec = 0;
  let pending: VideoProgressInput | null = null;
  let inFlight = false;
  let retryMs = 0;
  let cancelRetry: (() => void) | null = null;

  const payload = (positionSec: number, durationSec: number): VideoProgressInput => {
    lastClientTs = Math.max(lastClientTs + 1, deps.now());
    const position = seconds(positionSec);
    const duration = seconds(durationSec);
    return {
      positionSec: position,
      ...(duration ? { durationSec: duration } : {}),
      completed: duration > 0 && position >= WATCHED_SHARE * duration,
      clientTs: lastClientTs,
    };
  };

  const sendLastOnce = () => {
    if (!pending) return;
    const last = pending;
    pending = null;
    deps.send(last).then(deps.onSaved, () => undefined);
  };
  const next = () => (disposed ? sendLastOnce() : pump());

  const pump = () => {
    if (inFlight || cancelRetry || !pending) return;
    const sending = pending;
    pending = null;
    inFlight = true;
    deps.send(sending).then((result) => {
      inFlight = false;
      retryMs = 0;
      deps.onSaved(result);
      next();
    }, (error: unknown) => {
      inFlight = false;
      if (deps.isPermanentFailure(error)) {
        next();
        return;
      }
      pending ??= sending;
      if (disposed) {
        sendLastOnce();
        return;
      }
      retryMs = retryMs ? Math.min(retryMs * 2, RETRY_MAX_MS) : RETRY_FIRST_MS;
      cancelRetry = deps.setTimer(() => {
        cancelRetry = null;
        pump();
      }, retryMs);
    });
  };

  const save = (positionSec: number, durationSec: number) => {
    if (!armed || disposed || Math.abs(seconds(positionSec) - lastPositionSec) < MIN_MOVE_SEC) return;
    lastPositionSec = seconds(positionSec);
    pending = payload(positionSec, durationSec);
    lastSaveAt = deps.now();
    pump();
  };

  return {
    arm: (positionSec) => {
      armed = true;
      lastPositionSec = seconds(positionSec);
    },
    tick: (positionSec, durationSec) => {
      if (deps.now() - lastSaveAt >= SAVE_INTERVAL_MS) save(positionSec, durationSec);
    },
    flush: save,
    dispose: () => {
      cancelRetry?.();
      cancelRetry = null;
      disposed = true;
      if (!inFlight) sendLastOnce();
    },
  };
}
