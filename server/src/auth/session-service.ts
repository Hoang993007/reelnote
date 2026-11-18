import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions, users, type User } from '../db/schema.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A session in use is extended at most this often, so most requests do not write. */
const RENEW_AFTER_MS = 60 * 60 * 1000;

export function sessionIdOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ResolvedSession {
  sessionId: string;
  user: User;
  /** Set when this request extended the session: the cookie is re-sent with the new expiry. */
  renewedUntil: Date | null;
  /** False when the cookie must end with the browser. */
  persistent: boolean;
}

export const sessionService = {
  /**
   * Starts a session for the user; returns the cookie token (shown once, stored only as its hash).
   * `persistent: false` ("keep me signed in" off): the cookie is a browser-session cookie, renewals included.
   */
  create(userId: number, now = new Date(), persistent = true): { token: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    db.insert(sessions).values({
      id: sessionIdOf(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastSeenAt: now.toISOString(),
      persistent: persistent ? 1 : 0,
    }).run();
    return { token, expiresAt };
  },

  /** The live session and enabled user a token belongs to, or null. Extends it when due. */
  resolve(token: string, now = new Date()): ResolvedSession | null {
    if (!token || token.length > 128) return null;
    const sessionId = sessionIdOf(token);
    const row = db.select().from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId)).get();
    if (!row) return null;
    if (new Date(row.sessions.expiresAt).getTime() <= now.getTime() || row.users.disabledAt !== null) {
      db.delete(sessions).where(eq(sessions.id, sessionId)).run();
      return null;
    }
    let renewedUntil: Date | null = null;
    if (now.getTime() - new Date(row.sessions.lastSeenAt).getTime() >= RENEW_AFTER_MS) {
      renewedUntil = new Date(now.getTime() + SESSION_TTL_MS);
      db.update(sessions).set({ lastSeenAt: now.toISOString(), expiresAt: renewedUntil.toISOString() })
        .where(eq(sessions.id, sessionId)).run();
    }
    return { sessionId, user: row.users, renewedUntil, persistent: row.sessions.persistent === 1 };
  },

  revoke(sessionId: string): void {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  },

  /** Drops expired sessions; run at start and daily. */
  purgeExpired(now = new Date()): number {
    return db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run().changes;
  },

  /** When each user was last seen, from their sessions (an hour's precision: renewals write it). */
  lastSeenByUser(): Map<number, string> {
    const rows = db.select({ userId: sessions.userId, lastSeenAt: sessions.lastSeenAt }).from(sessions).all();
    const last = new Map<number, string>();
    for (const { userId, lastSeenAt } of rows) if (!last.has(userId) || lastSeenAt > last.get(userId)!) last.set(userId, lastSeenAt);
    return last;
  },

  countForUser(userId: number): number {
    return db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all().length;
  },
};
