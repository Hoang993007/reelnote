import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Migrations live in `db/migrations` from source and in `dist/migrations` beside the built entry;
 * both are `./migrations/` relative to this module once bundled.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Applies every migration not yet recorded in `_schema_migrations`, in name order, each in one transaction. */
export function applyMigrations(conn: BetterSqlite3.Database, dir = MIGRATIONS_DIR): string[] {
  conn.exec('CREATE TABLE IF NOT EXISTS `_schema_migrations` (`name` TEXT PRIMARY KEY, `applied_at` TEXT NOT NULL)');
  const applied = new Set(
    (conn.prepare('SELECT name FROM _schema_migrations').all() as Array<{ name: string }>).map(r => r.name),
  );
  const pending = readdirSync(dir).filter(name => NAME.test(name) && !applied.has(name)).sort();
  for (const name of pending) {
    const sql = readFileSync(`${dir}/${name}`, 'utf8');
    conn.transaction(() => {
      conn.exec(sql);
      conn.prepare('INSERT INTO _schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    })();
  }
  return pending;
}
