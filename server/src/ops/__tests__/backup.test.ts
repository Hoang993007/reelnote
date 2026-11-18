import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { backupIfDue, dayOf, KEEP_DAILY_BACKUPS } from '../backup.js';

let dataDir: string;
let db: Database.Database;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'reelnote-backup-'));
  db = new Database(path.join(dataDir, 'reelnote.db'));
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('kept')");
  mkdirSync(path.join(dataDir, 'images/learning'), { recursive: true });
  writeFileSync(path.join(dataDir, 'images/learning/a.png'), 'a');
});
afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it('writes a readable copy of the DB and mirrors the images, once a day', async () => {
  const day = new Date(2026, 10, 2, 9);
  const first = await backupIfDue(db, dataDir, day);
  expect(first).toEqual({ dir: path.join(dataDir, 'backups', '2026-11-02'), newImages: 1 });
  const copy = new Database(path.join(first!.dir, 'reelnote.db'), { readonly: true });
  expect(copy.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'kept' }]);
  copy.close();
  expect(existsSync(path.join(dataDir, 'backups/images/learning/a.png'))).toBe(true);
  expect(await backupIfDue(db, dataDir, new Date(2026, 10, 2, 23))).toBeNull();

  writeFileSync(path.join(dataDir, 'images/learning/b.png'), 'b');
  const next = await backupIfDue(db, dataDir, new Date(2026, 10, 3, 1));
  expect(next?.newImages).toBe(1);
});

it(`keeps the newest ${KEEP_DAILY_BACKUPS} days and every image`, async () => {
  for (let d = 1; d <= KEEP_DAILY_BACKUPS + 3; d++) await backupIfDue(db, dataDir, new Date(2026, 9, d, 12));
  const days = readdirSync(path.join(dataDir, 'backups')).filter(n => /^\d{4}-/.test(n)).sort();
  expect(days).toHaveLength(KEEP_DAILY_BACKUPS);
  expect(days[0]).toBe(dayOf(new Date(2026, 9, 4)));
  expect(existsSync(path.join(dataDir, 'backups/images/learning/a.png'))).toBe(true);
});
