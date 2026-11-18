import { sqlite } from '../db/client.js';

/** A live source by id or by name (case ignored), for the CLI commands that take a source. */
export function findSource(sourceRef: string): { id: number; name: string } {
  const sources = sqlite.prepare('SELECT id, name FROM sources WHERE deleted_at IS NULL').all() as Array<{ id: number; name: string }>;
  const source = sources.find((s) => String(s.id) === sourceRef) ?? sources.find((s) => s.name.toLowerCase() === sourceRef.trim().toLowerCase());
  if (!source) throw new Error(`No source ${sourceRef}.`);
  return source;
}
