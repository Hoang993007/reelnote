import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions, users, type User, type UserRole } from '../db/schema.js';
import { ConflictError, NotFoundError, ValidationError, withUniqueConflict } from '../lib/errors.js';
import { hashPassword, passwordProblem } from './password.js';

/** What the API and the CLI show of a user: never the password hash. */
export interface PublicUser {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  disabled: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    disabled: user.disabledAt !== null,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') throw new ValidationError('Email is required.');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL.test(normalized)) throw new ValidationError('Email is not valid.');
  return normalized;
}

function requirePassword(password: unknown): string {
  const problem = passwordProblem(password);
  if (problem) throw new ValidationError(problem);
  return password as string;
}

export const userService = {
  async create(input: { email: string; displayName: string; password: string; role: UserRole }): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 100) throw new ValidationError('Name must be 1 to 100 characters.');
    const passwordHash = await hashPassword(requirePassword(input.password));
    if (input.role === 'owner' && db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).get()) {
      throw new ConflictError('An owner account already exists.');
    }
    const user = withUniqueConflict(
      () => db.insert(users).values({ email, displayName, passwordHash, role: input.role }).returning().get(),
      `An account with ${email} already exists.`,
    );
    return toPublicUser(user);
  },

  findByEmail(email: string): User | undefined {
    return db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  },

  getById(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  },

  require(id: number): User {
    const user = this.getById(id);
    if (!user) throw new NotFoundError('User', id);
    return user;
  },

  list(): PublicUser[] {
    return db.select().from(users).orderBy(asc(users.id)).all().map(toPublicUser);
  },

  owner(): User | undefined {
    return db.select().from(users).where(eq(users.role, 'owner')).get();
  },

  /** Sets a new password and signs the user out everywhere except `keepSessionId`. */
  async setPassword(id: number, password: string, keepSessionId?: string): Promise<void> {
    this.require(id);
    const passwordHash = await hashPassword(requirePassword(password));
    db.transaction((tx) => {
      tx.update(users).set({ passwordHash }).where(eq(users.id, id)).run();
      const all = tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, id)).all();
      for (const session of all) {
        if (session.id !== keepSessionId) tx.delete(sessions).where(eq(sessions.id, session.id)).run();
      }
    });
  },

  /** Disabling signs the user out everywhere; the owner cannot be disabled. */
  setDisabled(id: number, disabled: boolean): PublicUser {
    const user = this.require(id);
    if (disabled && user.role === 'owner') throw new ValidationError('The owner account cannot be disabled.');
    const updated = db.transaction((tx) => {
      const row = tx.update(users).set({ disabledAt: disabled ? new Date().toISOString() : null })
        .where(eq(users.id, id)).returning().get();
      if (disabled) tx.delete(sessions).where(eq(sessions.userId, id)).run();
      return row;
    });
    return toPublicUser(updated);
  },
};
