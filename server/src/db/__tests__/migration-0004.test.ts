import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, expect, it } from 'vitest';
import { applyMigrations } from '../migrate.js';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'reelnote-migration-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('orders existing sources by name, gives them colours and keeps watched videos watched', () => {
  for (const name of ['0001_init.sql', '0002_accounts.sql', '0003_sharing.sql']) copyFileSync(path.join(MIGRATIONS, name), path.join(dir, name));
  const db = new Database(':memory:');
  applyMigrations(db, dir);
  const now = new Date().toISOString();
  for (const name of ['rosa', 'Bea', 'emma']) db.prepare('INSERT INTO sources (name, updated_at) VALUES (?, ?)').run(name, now);
  db.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('o@x.test', 'O', 'x', 'owner')").run();
  db.prepare('INSERT INTO pages (source_id, title, updated_at) VALUES (1, ?, ?)').run('P', now);
  db.prepare("INSERT INTO page_videos (page_id, rel_path, rel_path_key, title, duration_sec, updated_at) VALUES (1, 'a.mp4', 'a.mp4', 'a', 100, ?)").run(now);
  db.prepare("INSERT INTO page_videos (page_id, rel_path, rel_path_key, title, updated_at) VALUES (1, 'b.mp4', 'b.mp4', 'b', ?)").run(now);
  db.prepare('INSERT INTO video_progress (page_video_id, user_id, last_position_sec, completed) VALUES (1, 1, 3, 1), (2, 1, 40, 0)').run();

  copyFileSync(path.join(MIGRATIONS, '0004_study_desk.sql'), path.join(dir, '0004_study_desk.sql'));
  expect(applyMigrations(db, dir)).toEqual(['0004_study_desk.sql']);
  expect(db.prepare('SELECT name, position, color FROM sources ORDER BY position').all()).toEqual([
    { name: 'Bea', position: 0, color: '#2C47A0' },
    { name: 'emma', position: 1, color: '#6B4E9B' },
    { name: 'rosa', position: 2, color: '#2F7366' },
  ]);
  expect(db.prepare('SELECT furthest_sec AS f FROM video_progress ORDER BY page_video_id').all()).toEqual([{ f: 100 }, { f: 40 }]);
  expect(db.prepare("SELECT kind FROM blocks").all()).toEqual([]);
  db.close();
});
