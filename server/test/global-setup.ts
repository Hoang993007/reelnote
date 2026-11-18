import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../src/db/migrate.js';

/** Fresh data dir with the schema applied before any test imports the DB client. */
export function setup(): () => void {
  const dataDir = process.env.REELNOTE_TEST_DATA_DIR;
  if (!dataDir) throw new Error('REELNOTE_TEST_DATA_DIR is not set (vitest.config.ts sets it)');
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const conn = new Database(path.join(dataDir, 'reelnote.db'));
  try {
    applyMigrations(conn);
  } finally {
    conn.close();
  }
  return () => rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
