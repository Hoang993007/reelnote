import type { TranscriptUnsupportedReason } from './mp4-transcript-limits.js';

/** One subtitle line, in seconds from the start of the video. */
export type TranscriptCue = { startSec: number; endSec: number; text: string };

/**
 * The subtitle cues a video is read in (English, else Vietnamese: `mp4-transcript-track.ts`); `reason` says why
 * there are none when the file has no such track.
 * `sourceUrl` is the link the file was downloaded from (its comment tag), read from the same `moov`.
 */
export type VideoTranscript = { cues: TranscriptCue[]; reason: null | 'no-transcript-track'; sourceUrl: string | null };

export type VideoTranscriptWorkerRequest = { requestId: number; absPath: string };

export type VideoTranscriptWorkerControl = { type: 'shutdown' };

/** A failure crossing the thread boundary: `code`/`reason` rebuild a public error, anything else is internal. */
export type VideoTranscriptWorkerError = {
  code: 'transcript-unsupported' | null;
  reason: TranscriptUnsupportedReason | null;
  message: string;
  /** The worker-side stack of an internal failure, so the the server log shows where it broke. */
  stack?: string;
};

export type VideoTranscriptWorkerResponse =
  | { requestId: number; ok: true; transcript: VideoTranscript }
  | { requestId: number; ok: false; error: VideoTranscriptWorkerError };
