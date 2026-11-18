import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sqlite } from '../../db/client.js';
import { isMissingPathError, resolveInsideRoot } from '../../lib/resolve-inside-root.js';
import { compareVideoFiles, parseVideoFileName, type ParsedVideoFileName } from './video-file-name-parser.js';
import { isMp4Name, isVisibleLibraryEntry, libraryRelPathKey, toLibraryRelPath } from './video-library-entries.js';
import { pathOutsideLibrary, type AttachedVideoOwner } from './video-library-errors.js';
import { requireVideoLibraryRoot } from './video-library-root.js';

export type LibraryFolderEntry = { name: string; relPath: string };

export type LibraryFileEntry = {
  name: string;
  relPath: string;
  sizeBytes: number;
  parsed: ParsedVideoFileName;
  /** The page that already has this video; a file belongs to one page at most. */
  attachedTo: AttachedVideoOwner | null;
};

export type LibraryFolderListing = {
  root: string;
  /** `''` is the root itself. */
  dir: string;
  /** `null` at the root. */
  parent: string | null;
  folders: LibraryFolderEntry[];
  files: LibraryFileEntry[];
};

function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

async function resolveFolder(rootReal: string, relDir: string): Promise<string> {
  if (relDir === '') return rootReal;
  const absDir = await resolveInsideRoot(rootReal, relDir);
  if (!absDir || !(await fs.stat(absDir)).isDirectory()) throw pathOutsideLibrary();
  return absDir;
}

export const videoLibraryService = {
  /** One folder of the library: sub-folders and `.mp4` files in natural order, each file with its owner page. */
  async listFolder(relDir: string): Promise<LibraryFolderListing> {
    const root = await requireVideoLibraryRoot();
    const absDir = await resolveFolder(root, relDir);
    const dir = toLibraryRelPath(root, absDir);
    const entries = (await fs.readdir(absDir, { withFileTypes: true })).filter(isVisibleLibraryEntry);

    const folders = entries.filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, relPath: joinRel(dir, e.name) }))
      .sort((a, b) => compareVideoFiles(a.name, b.name));
    const videos = entries.filter((e) => e.isFile() && isMp4Name(e.name))
      .map((e) => ({ name: e.name, relPath: joinRel(dir, e.name) }))
      .sort((a, b) => compareVideoFiles(a.name, b.name));
    // A file renamed or removed since `readdir` (the translator pipeline at work) is left out.
    const sizes = await Promise.all(videos.map((v) => fs.stat(path.join(absDir, v.name)).then((s) => s.size, (error) => {
      if (isMissingPathError(error)) return null;
      throw error;
    })));
    const present = videos.flatMap((v, i) => (sizes[i] === null ? [] : [{ ...v, sizeBytes: sizes[i] }]));
    const owners = videoLibraryService.findOwners(present.map((v) => v.relPath));

    return {
      root,
      dir,
      parent: dir === '' ? null : dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '',
      folders,
      files: present.map((v) => ({
        ...v,
        parsed: parseVideoFileName(v.name),
        attachedTo: owners.get(libraryRelPathKey(v.relPath)) ?? null,
      })),
    };
  },

  /** The page (and source) that owns each attached file, in one query; keyed by `libraryRelPathKey`. */
  findOwners(relPaths: string[]): Map<string, AttachedVideoOwner> {
    if (relPaths.length === 0) return new Map();
    const keys = relPaths.map(libraryRelPathKey);
    const rows = sqlite.prepare(`
      SELECT pv.rel_path_key AS relPathKey, pv.id AS pageVideoId, p.id AS pageId, p.title AS pageTitle,
             s.id AS sourceId, s.name AS sourceName
      FROM page_videos pv
      JOIN pages p ON p.id = pv.page_id
      JOIN sources s ON s.id = p.source_id
      WHERE pv.rel_path_key IN (${keys.map(() => '?').join(', ')})
    `).all(...keys) as Array<AttachedVideoOwner & { relPathKey: string }>;
    return new Map(rows.map(({ relPathKey, ...owner }) => [relPathKey, owner]));
  },
};
