import type { FastifyError, FastifyInstance } from 'fastify';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors.js';

interface PublicError extends Error {
  publicError?: boolean;
  code?: string;
  details?: unknown;
  statusCode?: number;
}

function isSafeFastifyClientError(
  error: FastifyError,
): error is FastifyError & { code: string; statusCode: number } {
  return error.name === 'FastifyError'
    && typeof error.code === 'string'
    && error.code.startsWith('FST_ERR_')
    && typeof error.statusCode === 'number'
    && error.statusCode >= 400
    && error.statusCode < 500;
}

/** Registers the single HTTP boundary that decides which failures are safe to expose. */
export function registerHttpErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((error, request, reply) => {
    if (error.name === 'AbortError' && (request.raw.aborted || reply.raw.destroyed)) return;
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof ForbiddenError) {
      return reply.code(403).send({ error: error.message, code: 'forbidden' });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: error.message });
    }

    const publicError = error as PublicError;
    if (publicError.publicError === true && typeof publicError.code === 'string') {
      return reply.code(publicError.statusCode ?? 422).send({
        error: publicError.message,
        code: publicError.code,
        details: publicError.details ?? null,
      });
    }

    // Fastify JSON schema validation errors include a validation array.
    if (error.statusCode === 400) {
      const message = (error as { validation?: Array<{ message?: string }> }).validation?.[0]?.message
        ?? error.message ?? 'Validation error';
      return reply.code(400).send({ error: message });
    }
    if (error.statusCode === 413 || error.message?.includes('Request file too large')) {
      return reply.code(413).send({ error: 'File too large.' });
    }
    if (isSafeFastifyClientError(error)) {
      return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    }

    server.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
}
