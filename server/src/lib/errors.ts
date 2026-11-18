/** Custom error classes that map to HTTP status codes */

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(resource: string, id?: number | string) {
    super(id ? `${resource} with id ${id} not found` : `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** The user can see the thing but may not change it. */
export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** True when a SQLite write failed on a UNIQUE constraint. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || e?.message?.includes('UNIQUE constraint failed') === true;
}

/** Run a write; a UNIQUE violation becomes a 409 with `message` instead of a raw constraint failure (500). */
export function withUniqueConflict<T>(write: () => T, message: string): T {
  try {
    return write();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(message);
    throw error;
  }
}
