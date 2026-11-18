import { createStore } from './store';

/** App-wide UI state the shell draws: toasts, status-bar notices and key hints, open overlays, theme. */

export type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
export const toasts = createStore<Toast[]>([]);
let toastId = 0;

/** 3.2 s, or 6 s with an action (Undo). */
export function toast(text: string, action?: Toast['action']): void {
  const id = ++toastId;
  toasts.set((list) => [...list.slice(-2), { id, text, action }]);
  setTimeout(() => dismissToast(id), action ? 6000 : 3200);
}

export function dismissToast(id: number): void {
  toasts.set((list) => list.filter((t) => t.id !== id));
}

/** A short message on the status bar's right side (2.2 s). */
export const notice = createStore<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
export function flashNotice(text: string): void {
  notice.set(text);
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.set(null), 2200);
}

/** Key hints for the current mode, as [keys, what] pairs (the status bar's left side). */
export type Hint = [string, string];
export const hints = createStore<Hint[]>([]);

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'reelnote.theme';
function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}
export const theme = createStore<Theme>(readTheme());
export function applyTheme(next: Theme): void {
  theme.set(next);
  if (next === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Not remembered; fine.
  }
}

/** The one overlay open at a time (search, keyboard sheet, a dialog): Esc closes it first. */
export type Overlay =
  | { kind: 'search'; mode: 'all' | 'sources'; scope: number | null; query: string }
  | { kind: 'keys' }
  | null;
export const overlay = createStore<Overlay>(null);

/** Per-person preferences kept in this browser (study pane width, page list open). */
export function readPref<T>(userId: number, name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`reelnote.${userId}.${name}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function writePref(userId: number, name: string, value: unknown): void {
  try {
    localStorage.setItem(`reelnote.${userId}.${name}`, JSON.stringify(value));
  } catch {
    // Not remembered; fine.
  }
}
