/**
 * Hard caps on what one transcript read may touch, so a large or hostile mp4 can neither block the server nor
 * exhaust memory. Every size and offset is checked against these (and the file size) before it is read.
 */
export type Mp4TranscriptLimits = {
  /** Largest `moov` box read into memory (an 81-minute lecture carries 4.4 MB). */
  maxMoovBytes: number;
  /** Most text samples in the English track. */
  maxTextSamples: number;
  /** Most bytes summed over those samples. */
  maxTextBytes: number;
};

export const MP4_TRANSCRIPT_LIMITS: Mp4TranscriptLimits = {
  maxMoovBytes: 16 * 1024 * 1024,
  maxTextSamples: 20_000,
  maxTextBytes: 2 * 1024 * 1024,
};

/** Longest one read may keep the worker busy before it is terminated and replaced. */
export const TRANSCRIPT_WORKER_TIMEOUT_MS = 10_000;

/** Why a file's transcript cannot be read; the route answers 422 `transcript-unsupported` with it. */
export type TranscriptUnsupportedReason =
  | 'moov-too-large'
  | 'moov-not-at-start'
  | 'box-out-of-bounds'
  | 'invalid-header'
  | 'too-many-samples'
  | 'text-too-large'
  | 'timeout';
