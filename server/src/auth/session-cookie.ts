import type { FastifyReply, FastifyRequest } from 'fastify';
import { isHttpsRequest } from './request-origin.js';

export const SESSION_COOKIE = 'reelnote_session';

/** The session token from the request's Cookie header, or null. */
export function readSessionCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim()) || null;
  }
  return null;
}

/**
 * HttpOnly, SameSite=Lax, whole site. `Secure` only over HTTPS: a Secure cookie set over the LAN's
 * plain HTTP would be dropped by the browser.
 */
function cookie(request: FastifyRequest, value: string, maxAgeSec: number | null): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec !== null) parts.push(`Max-Age=${maxAgeSec}`);
  if (isHttpsRequest(request)) parts.push('Secure');
  return parts.join('; ');
}

/** `persistent: false`: no Max-Age, so the browser drops the cookie when it closes ("keep me signed in" off). */
export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, expiresAt: Date, persistent = true): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  reply.header('Set-Cookie', cookie(request, token, persistent ? maxAge : null));
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply): void {
  reply.header('Set-Cookie', cookie(request, '', 0));
}
