import { api, ApiError, NetworkError, type ApiOptions } from './api';
import { createStore } from './store';

/**
 * Every write goes through here, so the status bar can say Saving… / Saved / Offline. Edits (JSON writes) wait
 * in an ordered queue: while the server cannot be reached they stay queued in this browser (localStorage, per
 * user) and replay in order when it is back. Writes with the same key (a block's text) coalesce: only the
 * newest is sent. Creates and uploads are not queued; they fail with a message instead.
 */

export type SaveState = { saving: number; offline: boolean; waiting: number };
export const saveState = createStore<SaveState>({ saving: 0, offline: false, waiting: 0 });

type Method = NonNullable<ApiOptions['method']>;
type QueuedWrite = { key: string | null; method: Method; path: string; body?: unknown };
type Pending = QueuedWrite & { settle: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> };

const queue: Pending[] = [];
let running = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryMs = 0;
let storageKey: string | null = null;
let savedWhileOffline = 0;
const backOnlineListeners = new Set<(saved: number) => void>();

export function onBackOnline(listener: (saved: number) => void): () => void {
  backOnlineListeners.add(listener);
  return () => backOnlineListeners.delete(listener);
}

function publish(): void {
  saveState.set((s) => ({ ...s, waiting: s.offline ? queue.length : 0 }));
  if (!storageKey) return;
  try {
    if (queue.length) localStorage.setItem(storageKey, JSON.stringify(queue.map(({ key, method, path, body }) => ({ key, method, path, body }))));
    else localStorage.removeItem(storageKey);
  } catch {
    // Storage full or blocked: the queue still lives in memory.
  }
}

function setOffline(offline: boolean): void {
  if (saveState.get().offline === offline) return;
  saveState.set((s) => ({ ...s, offline, waiting: offline ? queue.length : 0 }));
  if (!offline) {
    const saved = savedWhileOffline;
    savedWhileOffline = 0;
    backOnlineListeners.forEach((l) => l(saved));
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const head = queue[0];
      saveState.set((s) => ({ ...s, saving: s.saving + 1 }));
      try {
        const result = await api(head.path, { method: head.method, body: head.body });
        queue.shift();
        if (saveState.get().offline) savedWhileOffline += 1;
        head.settle.forEach((s) => s.resolve(result));
        retryMs = 0;
        setOffline(false);
      } catch (error) {
        if (error instanceof NetworkError) {
          setOffline(true);
          scheduleRetry();
          return;
        }
        queue.shift();
        head.settle.forEach((s) => s.reject(error));
      } finally {
        saveState.set((s) => ({ ...s, saving: Math.max(0, s.saving - 1) }));
        publish();
      }
    }
  } finally {
    running = false;
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryMs = retryMs ? Math.min(retryMs * 2, 30_000) : 3_000;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void pump();
  }, retryMs);
}

/** Try again now (the banner's button, or the browser saying it is online). */
export function retryNow(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryMs = 0;
  if (queue.length) void pump();
  else void api('/health').then(() => setOffline(false), () => undefined);
}
window.addEventListener('online', retryNow);

/** Queues a JSON write. Same `key` while still waiting: the newer body replaces the older. */
export function save<T = unknown>(method: Method, path: string, body?: unknown, key: string | null = null): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const waiting = key ? queue.find((w, i) => w.key === key && (i > 0 || !running)) : undefined;
    const settle = { resolve: resolve as (value: unknown) => void, reject };
    if (waiting) {
      waiting.body = body;
      waiting.settle.push(settle);
    } else {
      queue.push({ key, method, path, body, settle: [settle] });
    }
    publish();
    void pump();
  });
}

/** A write that cannot wait in the queue (a create, an upload): counted in the status bar, offline noticed. */
export async function send<T>(path: string, options: ApiOptions): Promise<T> {
  saveState.set((s) => ({ ...s, saving: s.saving + 1 }));
  try {
    const result = await api<T>(path, options);
    setOffline(false);
    return result;
  } catch (error) {
    if (error instanceof NetworkError) {
      setOffline(true);
      scheduleRetry();
    }
    throw error;
  } finally {
    saveState.set((s) => ({ ...s, saving: Math.max(0, s.saving - 1) }));
  }
}

/** After sign-in: this user's edits left waiting in this browser go out first. */
export function startSaves(userId: number): void {
  storageKey = `reelnote.pending.${userId}`;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as QueuedWrite[];
    for (const write of stored) queue.push({ ...write, settle: [] });
  } catch {
    // Nothing usable stored.
  }
  if (queue.length) void pump();
}

/** Sign-out: stop saving for this user (their waiting edits stay stored for their next sign-in). */
export function stopSaves(): void {
  queue.length = 0;
  storageKey = null;
  saveState.set({ saving: 0, offline: false, waiting: 0 });
}

/** A failure the user should read: the server's message, or a plain one. */
export function failureText(error: unknown, ownerName: string | null): string {
  if (error instanceof NetworkError) return `Can’t reach ${ownerName ? `${ownerName}’s` : 'the'} PC. Try again when it is back.`;
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong.';
}
