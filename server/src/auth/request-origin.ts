import type { FastifyRequest } from 'fastify';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The TCP peer is this machine: the only case where `X-Forwarded-*` (Tailscale Serve) is believed. */
export function isLoopbackPeer(request: FastifyRequest): boolean {
  return LOOPBACK.has(request.raw.socket.remoteAddress ?? '');
}

function forwarded(request: FastifyRequest, name: string): string | undefined {
  if (!isLoopbackPeer(request)) return undefined;
  const value = request.headers[name];
  const first = (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  return first || undefined;
}

/** True when the browser reached us over HTTPS: directly, or through a TLS proxy on this machine. */
export function isHttpsRequest(request: FastifyRequest): boolean {
  if ((request.raw.socket as { encrypted?: boolean }).encrypted) return true;
  return forwarded(request, 'x-forwarded-proto')?.toLowerCase() === 'https';
}

/** The origin the browser used for this request (`scheme://host[:port]`), derived per request. */
export function requestOrigin(request: FastifyRequest): string | null {
  const host = forwarded(request, 'x-forwarded-host') ?? request.headers.host;
  if (!host) return null;
  return `${isHttpsRequest(request) ? 'https' : 'http'}://${host.toLowerCase()}`;
}
