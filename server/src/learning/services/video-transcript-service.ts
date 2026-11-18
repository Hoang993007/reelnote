import { logger } from '../../lib/logger.js';
import { pageVideoService } from './page-video-service.js';
import type { LibraryVideoFile } from './video-library-entries.js';
import { VideoLibraryError } from './video-library-errors.js';
import type { VideoTranscript } from './video-transcript-worker-types.js';

const log = logger.child({ module: 'video-transcript' });

export type VideoTranscriptServiceOptions = {
  /** Reads one file's cues off the server loop (the transcript coordinator). */
  extract: (absPath: string) => Promise<VideoTranscript>;
  /** Page video id → its file, with the path codes of the stream route. */
  resolve?: (id: number) => Promise<LibraryVideoFile>;
  /** Transcripts kept, least recently read evicted first. */
  capacity?: number;
};

export type VideoTranscriptService = { read(id: number): Promise<VideoTranscript> };

/**
 * Caches transcripts by file revision (`realpath|size|mtime`), so a replaced file is read again.
 * The in-flight read is cached too: concurrent opens of one video start a single read. A failed read
 * is logged and rethrown; it stays cached only when the file's layout cannot be read (the same revision
 * would fail the same way), else it is dropped so the next open reads again.
 */
export function createVideoTranscriptService({
  extract,
  resolve = id => pageVideoService.resolveStreamPath(id),
  capacity = 8,
}: VideoTranscriptServiceOptions): VideoTranscriptService {
  const cache = new Map<string, Promise<VideoTranscript>>();

  function remember(key: string, transcript: Promise<VideoTranscript>): void {
    cache.delete(key);
    cache.set(key, transcript);
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
  }

  function load(key: string, file: LibraryVideoFile): Promise<VideoTranscript> {
    const transcript: Promise<VideoTranscript> = extract(file.absPath).catch((error: unknown) => {
      if (!isUnreadableLayout(error) && cache.get(key) === transcript) cache.delete(key);
      if (error instanceof VideoLibraryError) log.warn({ path: file.relPath, code: error.code, details: error.details }, 'Transcript not read');
      else log.error({ err: error, path: file.relPath }, 'Transcript read failed');
      throw error;
    });
    return transcript;
  }

  return {
    async read(id) {
      const file = await resolve(id);
      const key = `${file.absPath}|${file.sizeBytes}|${file.mtimeMs}`;
      const transcript = cache.get(key) ?? load(key, file);
      remember(key, transcript);
      return transcript;
    },
  };
}

/** `transcript-unsupported` for the file itself; a timeout depends on the machine's load, not the file. */
function isUnreadableLayout(error: unknown): boolean {
  return error instanceof VideoLibraryError && error.code === 'transcript-unsupported' && error.details?.reason !== 'timeout';
}
