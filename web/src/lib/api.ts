/**
 * The server's API, same origin, relative URLs only. Every write carries `X-Reelnote-Request: 1` (the server
 * refuses cross-site writes without it). A 401 means the session ended: listeners send the user to sign-in.
 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly details: Record<string, unknown> | null) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The server could not be reached (offline, PC asleep): the request may be retried. */
export class NetworkError extends Error {
  constructor() {
    super('Can’t reach the server.');
    this.name = 'NetworkError';
  }
}

type Listener = () => void;
const unauthenticated = new Set<Listener>();

/** Called when any request answers 401. */
export function onUnauthenticated(listener: Listener): () => void {
  unauthenticated.add(listener);
  return () => unauthenticated.delete(listener);
}

export type ApiOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal };

export async function api<T>(path: string, { method = 'GET', body, signal }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Reelnote-Request'] = '1';
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, signal, credentials: 'same-origin' });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new NetworkError();
  }
  if (res.status === 401 && path !== '/auth/login') unauthenticated.forEach((listener) => listener());
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const info = (data ?? {}) as { error?: string; code?: string; details?: Record<string, unknown> };
    // A proxy in front (Tailscale Serve) answers 502/504 when the PC's server is down.
    if (res.status === 502 || res.status === 503 && !info.code || res.status === 504) throw new NetworkError();
    throw new ApiError(info.error ?? `Request failed (${res.status})`, res.status, info.code ?? null, info.details ?? null);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/** A multipart body from fields (undefined ones left out) and files. */
export function formData(fields: Record<string, string | number | boolean | undefined | null>, files: Array<{ name: string; blob: Blob; filename: string }> = []): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    form.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  for (const file of files) form.append(file.name, file.blob, file.filename);
  return form;
}
