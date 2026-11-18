import type { FastifyInstance } from 'fastify';

/**
 * Same-origin everything: scripts, styles, media and connections only from this server; images
 * also as `data:`/`blob:` (pasted and captured frames). No framing, no plugins.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });
}
