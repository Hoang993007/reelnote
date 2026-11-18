import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';
import { foldText } from '../lib/fold-text.js';
import { stripMarkdownImages } from '../lib/markdown-images.js';

export const DB_PATH = path.join(config.dataDir, 'reelnote.db');

function openConnection(dbPath: string): BetterSqlite3.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new Database(dbPath);
  conn.pragma('busy_timeout = 30000');
  conn.pragma('foreign_keys = ON');
  conn.pragma('journal_mode = WAL');
  // SQLite's lower() and LIKE fold ASCII only; text search over non-English notes (Đ/đ) needs full Unicode.
  conn.function('unicode_lower', { deterministic: true }, (value: unknown) => typeof value === 'string' ? value.toLowerCase() : value);
  // Search ignores case and accents ("hap thu" finds "hấp thụ"): lib/fold-text.ts.
  conn.function('fold_text', { deterministic: true }, (value: unknown) => typeof value === 'string' ? foldText(value) : value);
  // Search matches a block's text, not its image refs (`![](block-image:ID)`).
  conn.function('strip_markdown_images', { deterministic: true }, (value: unknown) => typeof value === 'string' ? stripMarkdownImages(value) : value);
  return conn;
}

export const sqlite: BetterSqlite3.Database = openConnection(DB_PATH);
export const db = drizzle(sqlite, { schema });

/** Close the DB connection. */
export function closeConnection(): void {
  if (sqlite.open) sqlite.close();
}
