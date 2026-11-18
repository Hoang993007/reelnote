import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pageVideos } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { videoNotInPage } from './video-library-errors.js';

/** A block's place in one of its page's videos. Set only when the block is created; video removal clears it. */
export type BlockVideoStampInput = { pageVideoId?: number; videoTimeSec?: number };
export type BlockVideoStamp = { pageVideoId: number; videoTimeSec: number };

const STAMP_FIELDS = ['pageVideoId', 'videoTimeSec'] as const;

/** Multipart fields → numbers. An absent or blank field is left out; anything else must be a number. */
export function parseBlockVideoStampFields(fields: Record<string, string | undefined>): BlockVideoStampInput {
  const parsed: BlockVideoStampInput = {};
  for (const key of STAMP_FIELDS) {
    const raw = fields[key];
    if (raw === undefined || raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isNaN(value)) throw new ValidationError(`${key} must be a number`);
    parsed[key] = value;
  }
  return parsed;
}

/**
 * The stamp to store with a new block, `{}` when none is given. Both fields come together, and the video must
 * belong to the block's own page; a standalone insight block (`pageId` null) has no page, so it takes none.
 */
export function resolveBlockVideoStamp(
  pageId: number | null,
  { pageVideoId, videoTimeSec }: BlockVideoStampInput,
): BlockVideoStamp | Record<string, never> {
  if (pageVideoId === undefined && videoTimeSec === undefined) return {};
  if (pageVideoId === undefined || videoTimeSec === undefined) {
    throw new ValidationError('pageVideoId and videoTimeSec are set together');
  }
  if (!Number.isInteger(pageVideoId) || pageVideoId <= 0) throw new ValidationError('pageVideoId must be a positive integer');
  if (!Number.isFinite(videoTimeSec) || videoTimeSec < 0) throw new ValidationError('videoTimeSec must be a number of seconds ≥ 0');
  if (pageId === null) throw videoNotInPage();
  const video = db.select({ pageId: pageVideos.pageId }).from(pageVideos).where(eq(pageVideos.id, pageVideoId)).get();
  if (!video || video.pageId !== pageId) throw videoNotInPage();
  return { pageVideoId, videoTimeSec };
}
