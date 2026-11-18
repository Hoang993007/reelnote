import { parentPort } from 'node:worker_threads';
import { extractTranscriptCues } from './mp4-text-track-extractor.js';
import type { TranscriptUnsupportedReason } from './mp4-transcript-limits.js';
import { VideoLibraryError } from './video-library-errors.js';
import type {
  VideoTranscriptWorkerControl,
  VideoTranscriptWorkerError,
  VideoTranscriptWorkerRequest,
  VideoTranscriptWorkerResponse,
} from './video-transcript-worker-types.js';

if (!parentPort) throw new Error('Video transcript worker requires a parent port');
const port = parentPort;

port.on('message', (message: VideoTranscriptWorkerRequest | VideoTranscriptWorkerControl) => {
  if ('type' in message) {
    port.postMessage({ type: 'stopped' });
    port.close();
    return;
  }
  void answer(message);
});

/** The coordinator sends one request at a time, so reads never overlap. */
async function answer({ requestId, absPath }: VideoTranscriptWorkerRequest): Promise<void> {
  let response: VideoTranscriptWorkerResponse;
  try {
    response = { requestId, ok: true, transcript: await extractTranscriptCues(absPath) };
  } catch (error) {
    response = { requestId, ok: false, error: toWorkerError(error) };
  }
  port.postMessage(response);
}

function toWorkerError(error: unknown): VideoTranscriptWorkerError {
  if (error instanceof VideoLibraryError && error.code === 'transcript-unsupported') {
    return { code: error.code, reason: error.details?.reason as TranscriptUnsupportedReason, message: error.message };
  }
  if (error instanceof Error) return { code: null, reason: null, message: error.message, stack: error.stack };
  return { code: null, reason: null, message: String(error) };
}
