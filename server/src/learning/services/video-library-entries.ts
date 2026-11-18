import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectInsideRoot } from '../../lib/resolve-inside-root.js';
import { pathOutsideLibrary, videoFileMissing, videoNotMp4, videoOutsideRoot } from './video-library-errors.js';

/** A library `.mp4` resolved to its real path, with the `/`-separated relative path the DB keeps. */
export type LibraryVideoFile = { absPath: string; relPath: string; sizeBytes: number; mtimeMs: number };

/** The pipeline keeps untranslated originals here; they are never offered. */
const ORIGINALS_FOLDER = 'original';

export function isMp4Name(name: string): boolean {
  return /\.mp4$/i.test(name);
}

/** Browse shows plain folders and files only: no dot entries, no `Original`, no symlinks or junctions. */
export function isVisibleLibraryEntry(entry: Dirent): boolean {
  return !entry.name.startsWith('.')
    && entry.name.toLowerCase() !== ORIGINALS_FOLDER
    && !entry.isSymbolicLink()
    && (entry.isDirectory() || entry.isFile());
}

/** A file's identity in the DB: Windows names ignore case, so a case-only rename is still the same file. */
export function libraryRelPathKey(relPath: string): string {
  return relPath.toLowerCase();
}

/** The DB form of a contained real path. */
export function toLibraryRelPath(rootReal: string, absPath: string): string {
  return path.relative(rootReal, absPath).split(path.sep).join('/');
}

/** Cache-busting and change token for a file: size and whole-millisecond mtime. */
export function videoRevision(file: Pick<LibraryVideoFile, 'sizeBytes' | 'mtimeMs'>): string {
  return `${file.sizeBytes}-${Math.trunc(file.mtimeMs)}`;
}

async function statMp4(absPath: string, relPath: string): Promise<LibraryVideoFile> {
  const stat = await fs.stat(absPath);
  if (!stat.isFile() || !isMp4Name(absPath)) throw videoNotMp4(relPath);
  return { absPath, relPath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
}

/**
 * A path from a request. Unsafe, through a link or outside the root → 400; missing → 404;
 * a folder or another file type → 422. The returned `relPath` is built from the real path.
 */
export async function resolveLibraryVideoFile(rootReal: string, rel: string): Promise<LibraryVideoFile> {
  const found = await inspectInsideRoot(rootReal, rel);
  if (found.status === 'refused') throw pathOutsideLibrary();
  if (found.status === 'missing') throw videoFileMissing(rel.replace(/\\/g, '/'));
  return statMp4(found.path, toLibraryRelPath(rootReal, found.path));
}

/** A path from a DB row, re-checked on every use: missing → 404, now behind a link → 409, not `.mp4` → 422. */
export async function resolveStoredVideo(rootReal: string, relPath: string): Promise<LibraryVideoFile> {
  const found = await inspectInsideRoot(rootReal, relPath);
  if (found.status === 'missing') throw videoFileMissing(relPath);
  if (found.status === 'refused') throw videoOutsideRoot(relPath);
  return statMp4(found.path, relPath);
}
