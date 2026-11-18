import { and, asc, eq } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { sources, sourceShares, users } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

export interface ShareEntry {
  userId: number;
  email: string;
  displayName: string;
  /** The friend may change the source, not only open it. */
  canWrite: boolean;
}

/** What one friend can open and change. `writeSourceIds` is a subset of `sourceIds`. */
export interface FriendAccess {
  sourceIds: number[];
  writeSourceIds: number[];
}

function requireSource(sourceId: number): void {
  if (!db.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).get()) throw new NotFoundError('Source', sourceId);
}

/** Only friends get access rows: the owner reads and writes everything already. */
function requireFriend(userId: number): void {
  const user = db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
  if (!user) throw new NotFoundError('User', userId);
  if (user.role !== 'friend') throw new ValidationError('Access is set for friend accounts only.');
}

/** Which friends can open (read) and change (write) which source. Write implies read. */
export const shareService = {
  listForSource(sourceId: number): ShareEntry[] {
    requireSource(sourceId);
    return db.select({ userId: users.id, email: users.email, displayName: users.displayName, canWrite: sourceShares.canWrite })
      .from(sourceShares).innerJoin(users, eq(users.id, sourceShares.userId))
      .where(eq(sourceShares.sourceId, sourceId)).orderBy(asc(users.email)).all()
      .map((row) => ({ ...row, canWrite: row.canWrite === 1 }));
  },

  /** Replaces the source's access list: `userIds` open it, `writeUserIds` (added to the readers) also change it. */
  setForSource(sourceId: number, userIds: number[], writeUserIds: number[] = []): ShareEntry[] {
    requireSource(sourceId);
    const writers = new Set(writeUserIds);
    const unique = [...new Set([...userIds, ...writeUserIds])];
    for (const userId of unique) requireFriend(userId);
    sqlite.transaction(() => {
      db.delete(sourceShares).where(eq(sourceShares.sourceId, sourceId)).run();
      for (const userId of unique) db.insert(sourceShares).values({ sourceId, userId, canWrite: writers.has(userId) ? 1 : 0 }).run();
    })();
    return shareService.listForSource(sourceId);
  },

  /** Lets a friend open the source, and change it when `canWrite`. */
  share(sourceId: number, userId: number, canWrite = false): void {
    requireSource(sourceId);
    requireFriend(userId);
    db.insert(sourceShares).values({ sourceId, userId, canWrite: canWrite ? 1 : 0 })
      .onConflictDoUpdate({ target: [sourceShares.sourceId, sourceShares.userId], set: { canWrite: canWrite ? 1 : 0 } }).run();
  },

  unshare(sourceId: number, userId: number): void {
    db.delete(sourceShares).where(and(eq(sourceShares.sourceId, sourceId), eq(sourceShares.userId, userId))).run();
  },

  /** A new friend opens every source (read only) until the owner unticks some. */
  shareAllWith(userId: number): void {
    requireFriend(userId);
    sqlite.prepare('INSERT OR IGNORE INTO source_shares (source_id, user_id) SELECT id, ? FROM sources WHERE deleted_at IS NULL').run(userId);
  },

  /** What each friend can open and change. */
  accessByUser(): Map<number, FriendAccess> {
    const rows = db.select({ userId: sourceShares.userId, sourceId: sourceShares.sourceId, canWrite: sourceShares.canWrite }).from(sourceShares).all();
    const byUser = new Map<number, FriendAccess>();
    for (const { userId, sourceId, canWrite } of rows) {
      const access = byUser.get(userId) ?? { sourceIds: [], writeSourceIds: [] };
      access.sourceIds.push(sourceId);
      if (canWrite === 1) access.writeSourceIds.push(sourceId);
      byUser.set(userId, access);
    }
    return byUser;
  },

  /** Replaces the friend's access: they open `sourceIds` and change `writeSourceIds` (which they also open). */
  setForUser(userId: number, sourceIds: number[], writeSourceIds: number[] = []): FriendAccess {
    requireFriend(userId);
    const writers = new Set(writeSourceIds);
    const unique = [...new Set([...sourceIds, ...writeSourceIds])];
    for (const sourceId of unique) requireSource(sourceId);
    sqlite.transaction(() => {
      db.delete(sourceShares).where(eq(sourceShares.userId, userId)).run();
      for (const sourceId of unique) db.insert(sourceShares).values({ sourceId, userId, canWrite: writers.has(sourceId) ? 1 : 0 }).run();
    })();
    return shareService.accessByUser().get(userId) ?? { sourceIds: [], writeSourceIds: [] };
  },

  /** Every source with the friends who open it, `(write)` after those who also change it (CLI overview). */
  overview(): Array<{ sourceId: number; name: string; sharedWith: string[] }> {
    const rows = sqlite.prepare(`
      SELECT s.id AS sourceId, s.name, u.email, ss.can_write AS canWrite
      FROM sources s
      LEFT JOIN source_shares ss ON ss.source_id = s.id
      LEFT JOIN users u ON u.id = ss.user_id
      WHERE s.deleted_at IS NULL
      ORDER BY s.name, u.email
    `).all() as Array<{ sourceId: number; name: string; email: string | null; canWrite: number | null }>;
    const bySource = new Map<number, { sourceId: number; name: string; sharedWith: string[] }>();
    for (const row of rows) {
      const entry = bySource.get(row.sourceId) ?? { sourceId: row.sourceId, name: row.name, sharedWith: [] };
      if (row.email) entry.sharedWith.push(row.canWrite === 1 ? `${row.email} (write)` : row.email);
      bySource.set(row.sourceId, entry);
    }
    return [...bySource.values()];
  },
};
