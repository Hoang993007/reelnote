import path from 'node:path';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { db, sqlite } from '../../db/client.js';
import { blocks, pages, pageVideos, videoProgress, type PageVideo } from '../../db/schema.js';
import { NotFoundError, ValidationError, withUniqueConflict } from '../../lib/errors.js';
import { assertCompleteOrder } from '../../lib/ordered-ids.js';
import { isFsError, resolveInsideRoot } from '../../lib/resolve-inside-root.js';
import { compareVideoFiles, parseVideoFileName } from './video-file-name-parser.js';
import {
  libraryRelPathKey, resolveLibraryVideoFile, resolveStoredVideo, videoRevision, type LibraryVideoFile,
} from './video-library-entries.js';
import { VideoLibraryError, videoAlreadyAttached } from './video-library-errors.js';
import { getVideoLibraryRoot, requireVideoLibraryRoot } from './video-library-root.js';
import { videoLibraryService } from './video-library-service.js';

export type PageVideoView = {
  id: number;
  pageId: number;
  position: number;
  relPath: string;
  title: string;
  durationSec: number | null;
  /** The viewer's playback: where they stopped, watched or not, when. */
  lastPositionSec: number;
  /** The furthest second the viewer reached. */
  furthestSec: number;
  /** Watched: the furthest point reached 90% of the duration. */
  completed: boolean;
  lastWatchedAt: string | null;
  /** `size-mtimeMs` of the file now; `null` when the root is unusable or the file cannot be resolved. */
  revision: string | null;
};

export type PageVideoList = { libraryRootSet: boolean; videos: PageVideoView[] };

export type RemovedPageVideo = { clearedStamps: number; clearedBlockIds: number[] };

const ALREADY_ATTACHED = 'The video is already on a page';

function requirePage(pageId: number): void {
  if (!db.select({ id: pages.id }).from(pages).where(eq(pages.id, pageId)).get()) throw new NotFoundError('Page', pageId);
}

function requireRow(id: number): PageVideo {
  const row = db.select().from(pageVideos).where(eq(pageVideos.id, id)).get();
  if (!row) throw new NotFoundError('Page video', id);
  return row;
}

/** The usable root, or `null` when it is unset or no longer valid (only for best-effort reads). */
async function usableRoot(): Promise<string | null> {
  try {
    return await requireVideoLibraryRoot();
  } catch (error) {
    if (error instanceof VideoLibraryError) return null;
    throw error;
  }
}

/** A file that cannot be read now (missing, behind a link, locked, no access) has no revision. */
async function revisionOf(rootReal: string | null, relPath: string): Promise<string | null> {
  if (!rootReal) return null;
  try {
    return videoRevision(await resolveStoredVideo(rootReal, relPath));
  } catch (error) {
    if (error instanceof VideoLibraryError || isFsError(error)) return null;
    throw error;
  }
}

type Progress = { lastPositionSec: number; furthestSec: number; completed: number; lastWatchedAt: string | null };

/** The user's progress on each of these videos (none yet: absent). */
function progressOf(userId: number, ids: number[]): Map<number, Progress> {
  if (ids.length === 0) return new Map();
  const rows = db.select({
    pageVideoId: videoProgress.pageVideoId,
    lastPositionSec: videoProgress.lastPositionSec,
    furthestSec: videoProgress.furthestSec,
    completed: videoProgress.completed,
    lastWatchedAt: videoProgress.lastWatchedAt,
  }).from(videoProgress).where(and(eq(videoProgress.userId, userId), inArray(videoProgress.pageVideoId, ids))).all();
  return new Map(rows.map(({ pageVideoId, ...progress }) => [pageVideoId, progress]));
}

async function toView(row: PageVideo, rootReal: string | null, progress: Progress | undefined): Promise<PageVideoView> {
  return {
    id: row.id,
    pageId: row.pageId,
    position: row.position,
    relPath: row.relPath,
    title: row.title,
    durationSec: row.durationSec,
    lastPositionSec: progress?.lastPositionSec ?? 0,
    furthestSec: progress?.furthestSec ?? 0,
    completed: progress?.completed === 1,
    lastWatchedAt: progress?.lastWatchedAt ?? null,
    revision: await revisionOf(rootReal, row.relPath),
  };
}

/** 409 with the owner when another row already has this file. */
function assertUnowned(relPaths: string[], exceptId?: number): void {
  for (const owner of videoLibraryService.findOwners(relPaths).values()) {
    if (owner.pageVideoId !== exceptId) throw videoAlreadyAttached(owner);
  }
}

/**
 * Appends rows for resolved library paths after the page's last video, in the given order, titled from
 * the file name. Runs inside the caller's transaction; a file another row took meanwhile → 409.
 */
export function appendPageVideoRows(pageId: number, relPaths: string[]): void {
  const [last] = db.select({ m: max(pageVideos.position) }).from(pageVideos).where(eq(pageVideos.pageId, pageId)).all();
  const start = (last?.m ?? -1) + 1;
  withUniqueConflict(() => db.insert(pageVideos).values(relPaths.map((relPath, i) => ({
    pageId,
    relPath,
    relPathKey: libraryRelPathKey(relPath),
    position: start + i,
    title: parseVideoFileName(path.posix.basename(relPath)).title,
  }))).run(), ALREADY_ATTACHED);
}

export const pageVideoService = {
  /** The page's videos, with the viewer's (`userId`) playback progress. */
  async list(pageId: number, userId: number): Promise<PageVideoList> {
    requirePage(pageId);
    const rows = db.select().from(pageVideos).where(eq(pageVideos.pageId, pageId))
      .orderBy(asc(pageVideos.position), asc(pageVideos.id)).all();
    const root = await usableRoot();
    const progress = progressOf(userId, rows.map((row) => row.id));
    const videos: PageVideoView[] = [];
    for (const row of rows) videos.push(await toView(row, root, progress.get(row.id)));
    return { libraryRootSet: getVideoLibraryRoot() !== null, videos };
  },

  async getById(id: number, userId: number): Promise<PageVideoView> {
    return toView(requireRow(id), await usableRoot(), progressOf(userId, [id]).get(id));
  },

  /** Appends the files in natural file order. Every path is resolved before anything is written. */
  async attach(pageId: number, relPaths: string[], userId: number): Promise<PageVideoList> {
    requirePage(pageId);
    const root = await requireVideoLibraryRoot();
    const files = new Map<string, LibraryVideoFile>();
    for (const rel of relPaths) {
      const file = await resolveLibraryVideoFile(root, rel);
      files.set(file.relPath, file);
    }
    const ordered = [...files.keys()].sort(compareVideoFiles);
    assertUnowned(ordered);

    sqlite.transaction(() => {
      requirePage(pageId);
      appendPageVideoRows(pageId, ordered);
    })();
    return pageVideoService.list(pageId, userId);
  },

  /** The whole new order: each of the page's videos exactly once, each at its own position. */
  async reorder(pageId: number, positions: Array<{ id: number; position: number }>, userId: number): Promise<PageVideoList> {
    sqlite.transaction(() => {
      requirePage(pageId);
      const owned = db.select({ id: pageVideos.id }).from(pageVideos).where(eq(pageVideos.pageId, pageId)).all().map((row) => row.id);
      assertCompleteOrder(positions.map((p) => p.id), owned, 'video of this page', 'positions');
      if (new Set(positions.map((p) => p.position)).size !== positions.length) {
        throw new ValidationError('Video positions must be distinct');
      }
      for (const { id, position } of positions) {
        db.update(pageVideos).set({ position }).where(eq(pageVideos.id, id)).run();
      }
    })();
    return pageVideoService.list(pageId, userId);
  },

  /** Hard delete; stamps on the page's blocks lose both columns, the blocks keep their text. */
  remove(id: number): RemovedPageVideo {
    return sqlite.transaction(() => {
      requireRow(id);
      const clearedBlockIds = db.select({ id: blocks.id }).from(blocks).where(eq(blocks.pageVideoId, id)).all().map((b) => b.id);
      db.update(blocks).set({ pageVideoId: null, videoTimeSec: null }).where(eq(blocks.pageVideoId, id)).run();
      db.delete(pageVideos).where(eq(pageVideos.id, id)).run();
      return { clearedStamps: clearedBlockIds.length, clearedBlockIds };
    })();
  },

  /** Points the row at another file; id, stamps and progress stay, the duration is re-read on play. */
  async relink(id: number, relPath: string, userId: number): Promise<PageVideoView> {
    requireRow(id);
    const file = await resolveLibraryVideoFile(await requireVideoLibraryRoot(), relPath);
    assertUnowned([file.relPath], id);
    const target = { relPath: file.relPath, relPathKey: libraryRelPathKey(file.relPath), durationSec: null };
    withUniqueConflict(() => db.update(pageVideos).set(target).where(eq(pageVideos.id, id)).run(), ALREADY_ATTACHED);
    return pageVideoService.getById(id, userId);
  },

  /** The file behind a row, contained and checked; used by file-status, stream and transcript. */
  async resolveStreamPath(id: number): Promise<LibraryVideoFile> {
    const row = requireRow(id);
    return resolveStoredVideo(await requireVideoLibraryRoot(), row.relPath);
  },

  /** Rows whose path does not resolve inside `rootReal` (missing, escaped, or unreadable now). */
  async countUnresolvedVideos(rootReal: string): Promise<number> {
    let unresolved = 0;
    for (const { relPath } of db.select({ relPath: pageVideos.relPath }).from(pageVideos).all()) {
      const resolved = await resolveInsideRoot(rootReal, relPath).catch((error: unknown) => {
        if (isFsError(error)) return null;
        throw error;
      });
      if (!resolved) unresolved += 1;
    }
    return unresolved;
  },
};
