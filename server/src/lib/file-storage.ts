import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from './errors.js';
import { db } from '../db/client.js';
import { managedFiles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';

/** Absolute path to the configured data directory. */
export function getDataDir(): string {
  return config.dataDir;
}

/**
 * All image saves MUST go through saveLearningImage().
 * It registers the file path in managed_files automatically.
 */

type FileSource = 'learning-image' | 'source-avatar';

/** Insert path into managed_files registry. Idempotent — safe if called twice. */
function registerFile(filePath: string, source: FileSource): void {
  db.insert(managedFiles).values({ filePath, source }).onConflictDoNothing().run();
}

/** Remove path from managed_files registry after successful disk unlink. */
function unregisterFile(filePath: string): void {
  db.delete(managedFiles).where(eq(managedFiles.filePath, filePath)).run();
}

const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Validate that the MIME type is an accepted image type */
export function validateImageMimeType(mimetype: string): string {
  if (!ACCEPTED_MIME_TYPES.has(mimetype)) {
    throw new ValidationError(
      `Invalid file type: ${mimetype}. Accepted types: PNG, JPEG, WEBP`
    );
  }
  return MIME_TO_EXT[mimetype];
}

/** Stored image names: `images/learning/<uuid>.<ext>`, as saveLearningImage() writes them. */
export const LEARNING_IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

/**
 * Save a learning image under <data-root>/images/learning/ (flat directory, no date hierarchy).
 * Used for block images and source avatars.
 * @returns relative path from the data root, e.g. "images/learning/<uuid>.jpg"
 */
export function saveLearningImage(
  buffer: Buffer,
  mimetype: string,
  source: FileSource = 'learning-image'
): string {
  const ext = validateImageMimeType(mimetype);
  const dirRelative = 'images/learning';
  const dirAbsolute = path.join(getDataDir(), dirRelative);
  mkdirSync(dirAbsolute, { recursive: true });

  const filename = `${uuidv4()}.${ext}`;
  const fileRelative = `${dirRelative}/${filename}`;
  writeFileSync(path.join(getDataDir(), fileRelative), buffer);
  registerFile(fileRelative, source);
  return fileRelative;
}

/**
 * Delete an image file from disk.
 * Returns true if the file was deleted, false if it was already gone (ENOENT).
 * Throws if the resolved path escapes the configured data directory (path traversal guard).
 * @param filePath relative path from the data root (as stored in DB)
 */
export function deleteImageFile(filePath: string): boolean {
  const dataDir = getDataDir();
  const absolute = path.resolve(dataDir, filePath);

  // Guard: restrict to images/ subdirectory only — prevents deleting DB, backups, etc.
  const imagesDir = path.join(dataDir, 'images');
  if (!absolute.startsWith(imagesDir + path.sep)) {
    throw new Error(`Path outside images directory: ${filePath}`);
  }

  let deleted = false;
  try {
    unlinkSync(absolute);
    deleted = true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // File already gone — still remove stale registry entry
  }

  // Unregister after disk operation so a failed unlink doesn't silently orphan the file
  unregisterFile(filePath);
  return deleted;
}
