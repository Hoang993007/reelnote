import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Data read from the API, cached by key and shared by every screen that shows it. A write updates the cached
 * copy (`mutate`) or marks it stale (`invalidate`), and every screen showing it re-renders.
 */
type Entry = { data?: unknown; error?: unknown; promise?: Promise<void>; fetcher?: () => Promise<unknown>; stale: boolean };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function load(key: string, fetcher: () => Promise<unknown>): Promise<void> {
  const entry = cache.get(key) ?? { stale: true };
  entry.fetcher = fetcher;
  cache.set(key, entry);
  const promise: Promise<void> = fetcher().then(
    (data) => {
      if (cache.get(key) !== entry || entry.promise !== promise) return;
      Object.assign(entry, { data, error: undefined, stale: false, promise: undefined });
      notify();
    },
    (error: unknown) => {
      if (cache.get(key) !== entry || entry.promise !== promise) return;
      Object.assign(entry, { error, stale: false, promise: undefined });
      notify();
    },
  );
  entry.promise = promise;
  return promise;
}

export type Resource<T> = { data: T | undefined; error: unknown; loading: boolean; reload: () => Promise<void> };

/** `key` null: nothing to load yet. A stale or missing entry loads; one already loading is shared. */
export function useResource<T>(key: string | null, fetcher: () => Promise<T>): Resource<T> {
  useSyncExternalStore(subscribe, () => version);
  const entry = key ? cache.get(key) : undefined;
  const stale = entry?.stale ?? true;
  useEffect(() => {
    if (!key) return;
    const existing = cache.get(key);
    if (!existing || (existing.stale && !existing.promise)) void load(key, fetcher);
    // The fetcher is keyed: a new closure for the same key fetches the same thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stale]);
  const reload = useCallback(() => (key ? load(key, fetcher) : Promise.resolve()), [key, fetcher]);
  return {
    data: entry?.data as T | undefined,
    error: entry?.data === undefined ? entry?.error : undefined,
    loading: !!key && (!entry || (entry.data === undefined && entry.error === undefined)),
    reload,
  };
}

/** The cached data of `key`, if loaded. */
export function peek<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

/** Changes the cached data of `key` in place (after a write the server confirmed, or optimistically). */
export function mutate<T>(key: string, update: (current: T) => T): void {
  const entry = cache.get(key);
  if (!entry || entry.data === undefined) return;
  entry.data = update(entry.data as T);
  notify();
}

/** Marks every key starting with one of `prefixes` stale: screens showing it load it again. */
export function invalidate(...prefixes: string[]): void {
  for (const [key, entry] of cache) {
    if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
    entry.stale = true;
    if (entry.fetcher && !entry.promise) void load(key, entry.fetcher);
  }
  notify();
}

/** Drops everything (sign-out: the next user must not see this one's data). */
export function clearCache(): void {
  cache.clear();
  notify();
}

/** True once `on` has stayed true for `ms`: loading states below 200 ms show nothing, to avoid flicker. */
export function useDelayed(on: boolean, ms = 200): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return shown;
}
