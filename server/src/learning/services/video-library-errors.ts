import type { TranscriptUnsupportedReason } from './mp4-transcript-limits.js';
import type { RootInvalidReason } from './video-library-root-validation.js';

/** Every code the Learning video routes answer with; the renderer reads it as `CoreApiError.code`. */
export type VideoLibraryErrorCode =
  | 'library-root-missing'
  | 'library-root-invalid'
  | 'path-outside-library'
  | 'video-outside-root'
  | 'video-file-missing'
  | 'video-not-mp4'
  | 'video-already-attached'
  | 'video-not-in-page'
  | 'transcript-unsupported'
  | 'transcript-busy';

/** Why a stored root cannot be used: never set, or no longer valid. */
export type RootMissingReason = 'unset' | RootInvalidReason;

/** A public error: `lib/http-error-handler.ts` sends its status, code, message and details. */
export class VideoLibraryError extends Error {
  public readonly publicError = true;

  public constructor(
    message: string,
    public readonly code: VideoLibraryErrorCode,
    public readonly statusCode: number,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'VideoLibraryError';
  }
}

export function libraryRootMissing(reason: RootMissingReason): VideoLibraryError {
  return new VideoLibraryError('The video library folder is not set or not available', 'library-root-missing', 409, { reason });
}

const ROOT_INVALID_MESSAGES: Partial<Record<RootInvalidReason, string>> = {
  'not-found': 'The folder was not found',
  'not-a-directory': 'The path is a file, not a folder',
  unreadable: 'The folder cannot be read',
};

export function libraryRootInvalid(reason: RootInvalidReason): VideoLibraryError {
  const message = ROOT_INVALID_MESSAGES[reason] ?? 'The video library folder must be a local folder such as D:\\Videos';
  return new VideoLibraryError(message, 'library-root-invalid', 422, { reason });
}

export function pathOutsideLibrary(): VideoLibraryError {
  return new VideoLibraryError('The path is not inside the video library folder', 'path-outside-library', 400);
}

export function videoOutsideRoot(relPath: string): VideoLibraryError {
  return new VideoLibraryError('The video is no longer inside the video library folder', 'video-outside-root', 409, { relPath });
}

export function videoFileMissing(relPath: string): VideoLibraryError {
  return new VideoLibraryError('The video file was not found', 'video-file-missing', 404, { relPath });
}

export function videoNotMp4(relPath: string): VideoLibraryError {
  return new VideoLibraryError('Only .mp4 videos can be played', 'video-not-mp4', 422, { relPath });
}

export interface AttachedVideoOwner {
  pageVideoId: number;
  pageId: number;
  pageTitle: string;
  sourceId: number;
  sourceName: string;
}

export function videoAlreadyAttached(owner: AttachedVideoOwner): VideoLibraryError {
  return new VideoLibraryError(
    `The video is already on the page "${owner.pageTitle}"`, 'video-already-attached', 409, { ...owner },
  );
}

export function videoNotInPage(): VideoLibraryError {
  return new VideoLibraryError('The video does not belong to this block\'s page', 'video-not-in-page', 422);
}

export function transcriptUnsupported(reason: TranscriptUnsupportedReason): VideoLibraryError {
  return new VideoLibraryError('The video has no transcript that can be read', 'transcript-unsupported', 422, { reason });
}

export function transcriptBusy(): VideoLibraryError {
  return new VideoLibraryError('Too many transcripts are being read; try again', 'transcript-busy', 503);
}
