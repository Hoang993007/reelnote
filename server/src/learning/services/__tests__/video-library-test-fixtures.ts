import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sqlite } from '../../../db/client.js';
import { libraryRelPathKey } from '../video-library-entries.js';
import type { Viewer } from '../../../access/visibility.js';

/** Test-DB and temp-folder fixtures for the Learning video tests. Uses the real test DB (APP_ENV=test). */

export const ROOT_SETTING_KEY = 'video_library_root';

const TABLES = ['block_images', 'block_text', 'blocks', 'video_progress', 'page_videos', 'page_reading_state', 'source_shares', 'pages', 'sources'];

/** The owner account the service tests act as; created on first use (the auth tests clear users). */
export function testOwner(): Viewer {
  const row = sqlite.prepare("SELECT id FROM users WHERE role = 'owner'").get() as { id: number } | undefined;
  if (row) return { id: row.id, role: 'owner' };
  const id = Number(sqlite.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('owner@example.test', 'Owner', 'scrypt$x', 'owner')").run().lastInsertRowid);
  return { id, role: 'owner' };
}

export function cleanVideoDb(): void {
  sqlite.pragma('foreign_keys = OFF');
  for (const table of TABLES) sqlite.prepare(`DELETE FROM ${table}`).run();
  sqlite.prepare('DELETE FROM settings WHERE key = ?').run(ROOT_SETTING_KEY);
  sqlite.pragma('foreign_keys = ON');
}

const now = () => new Date().toISOString();
const insertId = (sql: string, ...params: unknown[]) => Number(sqlite.prepare(sql).run(...params).lastInsertRowid);

export function seedPage(title = 'Lesson page', sourceName = 'Course'): { sourceId: number; pageId: number } {
  const sourceId = insertId('INSERT INTO sources (name, updated_at) VALUES (?, ?)', sourceName, now());
  const pageId = insertId('INSERT INTO pages (source_id, title, position, updated_at) VALUES (?, ?, 0, ?)', sourceId, title, now());
  return { sourceId, pageId };
}

export function seedBlock(pageId: number, body: string, stamp?: { pageVideoId: number; timeSec: number }): number {
  const id = insertId(
    `INSERT INTO blocks (page_id, type, position, page_video_id, video_time_sec, updated_at) VALUES (?, 'note', 0, ?, ?, ?)`,
    pageId, stamp?.pageVideoId ?? null, stamp?.timeSec ?? null, now(),
  );
  sqlite.prepare('INSERT INTO block_text (block_id, body) VALUES (?, ?)').run(id, body);
  return id;
}

/** A `page_videos` row written directly, without resolving the file: for files that are missing or moved. */
export function seedPageVideo(pageId: number, relPath: string, title = relPath): number {
  return insertId(
    'INSERT INTO page_videos (page_id, rel_path, rel_path_key, title, updated_at) VALUES (?, ?, ?, ?, ?)',
    pageId, relPath, libraryRelPathKey(relPath), title, now(),
  );
}

/** Stores a root as-is, without validation: for roots that later stop being valid. */
export function storeRootSetting(root: string): void {
  sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(ROOT_SETTING_KEY, root);
}

/**
 * A temp folder with a `library` root and an `outside` sibling. Paths ending in `/` are folders, the
 * rest are files (empty unless a size is given). Links are removed before the recursive delete.
 */
export function createTempLibrary(prefix: string) {
  const base = mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(base, 'library');
  const outside = path.join(base, 'outside');
  const links: string[] = [];
  mkdirSync(root);
  mkdirSync(outside);

  function add(dir: string, entries: Array<string | [string, number]>): void {
    for (const entry of entries) {
      const [rel, size] = typeof entry === 'string' ? [entry, 0] : entry;
      const abs = path.join(dir, rel);
      if (rel.endsWith('/')) {
        mkdirSync(abs, { recursive: true });
        continue;
      }
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.alloc(size));
    }
  }

  return {
    base,
    root,
    rootReal: realpathSync.native(root),
    outside,
    add: (entries: Array<string | [string, number]>) => add(root, entries),
    addOutside: (entries: Array<string | [string, number]>) => add(outside, entries),
    /** A junction at `rel` inside the root, pointing at `target`. */
    junction(rel: string, target: string): void {
      const link = path.join(root, rel);
      symlinkSync(target, link, 'junction');
      links.push(link);
    },
    remove(): void {
      for (const link of links) {
        try {
          unlinkSync(link);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export type TempLibrary = ReturnType<typeof createTempLibrary>;
