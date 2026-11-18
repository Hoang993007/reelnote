import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sqlite } from '../../db/client.js';
import { blockImages, blocks, pageVideos } from '../../db/schema.js';
import { saveLearningImage, deleteImageFile } from '../../lib/file-storage.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { storedImageMarkup, type ImageMarkupShape } from '../../lib/image-markup.js';
import { videoNotInPage } from './video-library-errors.js';

export type BlockImage = {
  id: number;
  filePath: string;
  position: number;
  caption: string | null;
  displaySize: string;
  displayWidth: number | null;
  cropX: number | null;
  cropY: number | null;
  cropW: number | null;
  cropH: number | null;
  markup: ImageMarkupShape[] | null;
  /** A captured frame: the page video and second it came from. */
  sourceVideoId: number | null;
  sourceSec: number | null;
};

export type ImageUpload = { buffer: Buffer; mimetype: string };

/** Where captured frames came from: a video of the block's own page and a second in it. */
export type ImageSource = { pageVideoId: number; sec: number };

/** Multipart fields → an image source; both or neither. */
export function parseImageSourceFields(videoField: string | undefined, secField: string | undefined): ImageSource | undefined {
  const blank = (value: string | undefined) => value === undefined || value.trim() === '';
  if (blank(videoField) && blank(secField)) return undefined;
  const pageVideoId = Number(videoField);
  const sec = Number(secField);
  if (!Number.isInteger(pageVideoId) || pageVideoId <= 0 || !Number.isFinite(sec) || sec < 0) {
    throw new ValidationError('A frame source needs a page video id and a second ≥ 0');
  }
  return { pageVideoId, sec };
}

/** 422 unless the video belongs to `pageId` (a standalone block has none). */
export function requireSourceOnPage(pageId: number | null, source: ImageSource | undefined): void {
  if (!source) return;
  const video = db.select({ pageId: pageVideos.pageId }).from(pageVideos).where(eq(pageVideos.id, source.pageVideoId)).get();
  if (pageId === null || !video || video.pageId !== pageId) throw videoNotInPage();
}

export function fetchBlockImages(blockIds: number[]): Array<BlockImage & { blockId: number }> {
  if (blockIds.length === 0) return [];
  return db.select({
    id: blockImages.id,
    blockId: blockImages.blockId,
    filePath: blockImages.filePath,
    position: blockImages.position,
    caption: blockImages.caption,
    displaySize: blockImages.displaySize,
    displayWidth: blockImages.displayWidth,
    cropX: blockImages.cropX,
    cropY: blockImages.cropY,
    cropW: blockImages.cropW,
    cropH: blockImages.cropH,
    markup: blockImages.markup,
    sourceVideoId: blockImages.sourceVideoId,
    sourceSec: blockImages.sourceSec,
  }).from(blockImages).where(inArray(blockImages.blockId, blockIds)).orderBy(blockImages.position).all() as Array<BlockImage & { blockId: number }>;
}

/** Stores the files and appends their rows after the block's last image. Joins the caller's transaction, if any. */
export function insertBlockImages(blockId: number, uploads: ImageUpload[], options: { notes?: string[]; source?: ImageSource } = {}): number[] {
  const last = db.select({ position: blockImages.position }).from(blockImages).where(eq(blockImages.blockId, blockId))
    .orderBy(sql`position DESC`).get();
  let position = (last?.position ?? -1) + 1;
  return uploads.map(({ buffer, mimetype }, index) => {
    const filePath = saveLearningImage(buffer, mimetype);
    return Number(db.insert(blockImages).values({
      blockId,
      filePath,
      position: position++,
      caption: options.notes?.[index] || null,
      sourceVideoId: options.source?.pageVideoId ?? null,
      sourceSec: options.source?.sec ?? null,
    }).run().lastInsertRowid);
  });
}

function requireImage(imageId: number): void {
  if (!db.select({ id: blockImages.id }).from(blockImages).where(eq(blockImages.id, imageId)).get()) throw new NotFoundError('BlockImage', imageId);
}

/** Learning block images: upload, display width, note, crop, markup, order, removal. */
export const blockImageService = {
  addImages(blockId: number, uploads: ImageUpload[], source?: ImageSource): void {
    const block = db.select({ pageId: blocks.pageId }).from(blocks).where(eq(blocks.id, blockId)).get();
    if (!block) throw new NotFoundError('Block', blockId);
    requireSourceOnPage(block.pageId, source);
    sqlite.transaction(() => insertBlockImages(blockId, uploads, { source }))();
  },

  updateDisplayWidth(imageId: number, displayWidth: number): void {
    requireImage(imageId);
    db.update(blockImages).set({ displayWidth }).where(eq(blockImages.id, imageId)).run();
  },

  updateCrop(imageId: number, crop: { x: number; y: number; w: number; h: number } | null): void {
    requireImage(imageId);
    if (crop === null) {
      db.update(blockImages).set({ cropX: null, cropY: null, cropW: null, cropH: null }).where(eq(blockImages.id, imageId)).run();
      return;
    }
    const { x, y, w, h } = crop;
    if ([x, y, w, h].some(v => v < 0 || v > 1) || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
      throw new ValidationError('Crop values must be in [0,1] with x+w≤1 and y+h≤1');
    }
    db.update(blockImages).set({ cropX: x, cropY: y, cropW: w, cropH: h }).where(eq(blockImages.id, imageId)).run();
  },

  /** Replaces the shapes drawn over the image; null or an empty list removes them. */
  updateMarkup(imageId: number, markup: ImageMarkupShape[] | null): void {
    const updated = db.update(blockImages).set({ markup: storedImageMarkup(markup) }).where(eq(blockImages.id, imageId))
      .returning({ id: blockImages.id }).get();
    if (!updated) throw new NotFoundError('BlockImage', imageId);
  },

  updateNote(imageId: number, note: string): void {
    requireImage(imageId);
    db.update(blockImages).set({ caption: note || null }).where(eq(blockImages.id, imageId)).run();
  },

  reorder(blockId: number, positions: Array<{ id: number; position: number }>): void {
    sqlite.transaction(() => {
      const ids = positions.map((p) => p.id);
      if (ids.length > 0) {
        const owned = db.select({ id: blockImages.id }).from(blockImages)
          .where(and(inArray(blockImages.id, ids), eq(blockImages.blockId, blockId)))
          .all();
        if (owned.length !== ids.length) throw new ValidationError('Some image IDs do not belong to this block');
      }
      for (const { id, position } of positions) {
        db.update(blockImages).set({ position }).where(eq(blockImages.id, id)).run();
      }
    })();
  },

  remove(blockImageId: number): void {
    const img = db.select().from(blockImages).where(eq(blockImages.id, blockImageId)).get();
    if (!img) throw new NotFoundError('BlockImage', blockImageId);
    deleteImageFile(img.filePath);
    db.delete(blockImages).where(eq(blockImages.id, blockImageId)).run();
  },
};
