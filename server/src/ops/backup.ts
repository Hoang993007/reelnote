import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';

export const KEEP_DAILY_BACKUPS = 14;
const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;

export interface BackupResult {
  dir: string;
  newImages: number;
}

/** Local calendar day, `YYYY-MM-DD`. */
export function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Today's backup under `<dataDir>/backups`: the DB as `<day>/reelnote.db` (SQLite online backup, safe
 * while the server writes), and new images added to one `images/` mirror (stored images never
 * change, so every DB backup finds its images there). Keeps the newest 14 days. Skips a day that
 * already has one.
 */
export async function backupIfDue(sqlite: BetterSqlite3.Database, dataDir: string, now = new Date()): Promise<BackupResult | null> {
  const root = path.join(dataDir, 'backups');
  const dir = path.join(root, dayOf(now));
  if (existsSync(path.join(dir, 'reelnote.db'))) return null;
  mkdirSync(dir, { recursive: true });
  const partial = path.join(dir, 'reelnote.db.partial');
  await sqlite.backup(partial);
  copyFileSync(partial, path.join(dir, 'reelnote.db'));
  rmSync(partial, { force: true });

  const newImages = mirrorImages(path.join(dataDir, 'images'), path.join(root, 'images'));
  const days = readdirSync(root).filter(name => DAY_DIR.test(name)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAILY_BACKUPS))) {
    rmSync(path.join(root, old), { recursive: true, force: true });
  }
  return { dir, newImages };
}

/** Copies files that the mirror does not have yet; never deletes from it. */
function mirrorImages(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  let copied = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copied += mirrorImages(source, target);
    } else if (entry.isFile() && !existsSync(target)) {
      mkdirSync(to, { recursive: true });
      copyFileSync(source, target);
      copied += 1;
    }
  }
  return copied;
}
