import type { TranscriptCue } from '../lib/types';

/**
 * The cue playing at `timeSec` (`startSec ≤ t < endSec`), or the last one before it in a gap (the line just
 * said stays current); -1 before the first. `cues` in time order. From the original app's transcript-cues.ts.
 */
export function cueAt(cues: readonly TranscriptCue[], timeSec: number): number {
  let low = 0;
  let last = -1;
  for (let high = cues.length - 1; low <= high;) {
    const middle = (low + high) >> 1;
    if (cues[middle].startSec <= timeSec) {
      last = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return last;
}
