import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db, sqlite } from '../../db/client.js';
import { sources } from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { pageService } from './page-service.js';
import { appendPageVideoRows } from './page-video-service.js';
import type { ParsedVideoFileName } from './video-file-name-parser.js';
import { resolveLibraryVideoFile } from './video-library-entries.js';
import { videoLibraryService } from './video-library-service.js';

/**
 * `files`: only these files of the folder, each with an optional page title (the import dialog's checkboxes and
 * edited titles); omitted = every file, titled from its name.
 */
export type VideoImportInput = { relDir: string; onePagePerVideo: boolean; files?: Array<{ relPath: string; title?: string }> };

/** A file left out because a page already has it. */
export type SkippedVideo = { relPath: string; pageId: number; pageTitle: string; sourceId: number };

export type VideoImportResult = { createdPageIds: number[]; attachedCount: number; skipped: SkippedVideo[] };

type FreshVideo = { relPath: string; parsed: ParsedVideoFileName };

function requireSource(sourceId: number): void {
  if (!db.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).get()) throw new NotFoundError('Source', sourceId);
}

export const pageVideoImportService = {
  /**
   * Adds a library folder's `.mp4` files to a source: by default one new page per file (title and date
   * from the name), else one page named after the folder holding them all. Files a page already has
   * are skipped, so a re-import adds only new files. Pages append after the source's existing ones in
   * file order. All file I/O happens first; the writes are one transaction.
   */
  async importFolder(sourceId: number, input: VideoImportInput): Promise<VideoImportResult> {
    requireSource(sourceId);
    const listing = await videoLibraryService.listFolder(input.relDir);
    if (listing.dir === '') throw new ValidationError('Choose a folder inside the video library, not the library folder itself');

    const skipped: SkippedVideo[] = [];
    const fresh: FreshVideo[] = [];
    const chosen = input.files ? new Map(input.files.map((f) => [f.relPath.toLowerCase(), f.title?.trim()])) : null;
    for (const file of listing.files) {
      if (chosen && !chosen.has(file.relPath.toLowerCase())) continue;
      if (file.attachedTo) {
        const { pageId, pageTitle, sourceId: ownerSourceId } = file.attachedTo;
        skipped.push({ relPath: file.relPath, pageId, pageTitle, sourceId: ownerSourceId });
        continue;
      }
      // The listing is only a hint: each file is resolved again before it is stored.
      const title = chosen?.get(file.relPath.toLowerCase()) || file.parsed.title;
      fresh.push({ relPath: (await resolveLibraryVideoFile(listing.root, file.relPath)).relPath, parsed: { ...file.parsed, title } });
    }

    const createdPageIds = sqlite.transaction(() => {
      requireSource(sourceId);
      db.update(sources).set({ videoFolder: listing.dir })
        .where(and(eq(sources.id, sourceId), isNull(sources.videoFolder))).run();
      if (fresh.length === 0) return [];
      if (!input.onePagePerVideo) {
        const pageId = pageService.insert(sourceId, { title: path.posix.basename(listing.dir) });
        appendPageVideoRows(pageId, fresh.map((video) => video.relPath));
        return [pageId];
      }
      return fresh.map(({ relPath, parsed }) => {
        const pageId = pageService.insert(sourceId, { title: parsed.title, ...(parsed.date ? { date: parsed.date } : {}) });
        appendPageVideoRows(pageId, [relPath]);
        return pageId;
      });
    })();

    return { createdPageIds, attachedCount: fresh.length, skipped };
  },
};
