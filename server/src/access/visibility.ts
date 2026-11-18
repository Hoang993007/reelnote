import type { UserRole } from '../db/schema.js';

/** Who is asking: the signed-in user, as the auth hook resolved them. */
export interface Viewer {
  id: number;
  role: UserRole;
}

/**
 * SQL: the source aliased `alias` is readable by the viewer whose id is bound to `param` (one `?` by
 * default, or a named parameter such as `@viewerId`).
 * The owner reads every source; a friend reads the sources shared with them. The role is read
 * from the DB, so a role or share change applies on the next request. Never user input in `alias`.
 * Every note on a readable source is visible: the sources are the team's (private annotations excepted).
 */
export function readableSourceSql(alias: string, param = '?'): string {
  return `EXISTS (SELECT 1 FROM users vu WHERE vu.id = ${param} AND vu.disabled_at IS NULL
    AND (vu.role = 'owner' OR EXISTS (SELECT 1 FROM source_shares vs WHERE vs.source_id = ${alias}.id AND vs.user_id = vu.id)))`;
}

/** SQL twin of `readableSourceSql` for changing the source: the owner, or a friend whose share has `can_write`. */
export function writableSourceSql(alias: string, param = '?'): string {
  return `EXISTS (SELECT 1 FROM users wu WHERE wu.id = ${param} AND wu.disabled_at IS NULL
    AND (wu.role = 'owner' OR EXISTS (SELECT 1 FROM source_shares ws WHERE ws.source_id = ${alias}.id AND ws.user_id = wu.id AND ws.can_write = 1)))`;
}

/** The viewer wrote this block (the owner also holds blocks from before accounts, `authorId` null). */
export function isOwnBlock(viewer: Viewer, authorId: number | null): boolean {
  return authorId === viewer.id || (authorId === null && viewer.role === 'owner');
}

/** SQL twin of `isOwnBlock` for the block aliased `alias`; the viewer's id is bound to `param`. */
export function ownBlockSql(alias: string, param = '?'): string {
  return `(${alias}.author_id = ${param} OR (${alias}.author_id IS NULL
    AND EXISTS (SELECT 1 FROM users ow WHERE ow.id = ${param} AND ow.role = 'owner')))`;
}
