import { forwardRef, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/**
 * The UI's routes (design-spec §3): deep links matter for search results and resuming a spot.
 * `/` · `/login` · `/s/:id` · `/s/:id/insights` · `/s/:id/questions` · `/p/:id?b=&t=&v=` · `/people`
 */
export type SourceTab = 'pages' | 'insights' | 'questions';
export type Route =
  | { name: 'home' }
  | { name: 'login'; next: string | null }
  | { name: 'source'; id: number; tab: SourceTab }
  | { name: 'page'; id: number; block: number | null; t: number | null; v: number | null }
  | { name: 'people' }
  | { name: 'missing' };

const num = (value: string | null) => (value && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null);

export function parseRoute(url: string): Route {
  const [pathname, search = ''] = url.split('?');
  const query = new URLSearchParams(search);
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname === '/login') return { name: 'login', next: query.get('next') };
  if (pathname === '/people') return { name: 'people' };
  const source = /^\/s\/(\d+)(?:\/(insights|questions|pages))?\/?$/.exec(pathname);
  if (source) return { name: 'source', id: Number(source[1]), tab: (source[2] as SourceTab | undefined) ?? 'pages' };
  const page = /^\/p\/(\d+)\/?$/.exec(pathname);
  if (page) return { name: 'page', id: Number(page[1]), block: num(query.get('b')), t: num(query.get('t')), v: num(query.get('v')) };
  return { name: 'missing' };
}

export const paths = {
  home: () => '/',
  source: (id: number, tab: SourceTab = 'pages') => (tab === 'pages' ? `/s/${id}` : `/s/${id}/${tab}`),
  page: (id: number, at: { block?: number | null; t?: number | null; v?: number | null } = {}) => {
    const query = new URLSearchParams();
    if (at.block) query.set('b', String(at.block));
    if (at.t != null) query.set('t', String(Math.floor(at.t)));
    if (at.v) query.set('v', String(at.v));
    const text = query.toString();
    return `/p/${id}${text ? `?${text}` : ''}`;
  },
  people: () => '/people',
  login: (next?: string) => (next && next !== '/' && !next.startsWith('/login') ? `/login?next=${encodeURIComponent(next)}` : '/login'),
};

const listeners = new Set<() => void>();
let current = location.pathname + location.search;
/** Counts navigations, so navigating to the URL already shown still reaches the view (a search result here). */
let visit = 0;
window.addEventListener('popstate', () => {
  current = location.pathname + location.search;
  visit += 1;
  listeners.forEach((listener) => listener());
});

export function navigate(to: string, { replace = false } = {}): void {
  if (to !== current) {
    if (replace) history.replaceState(null, '', to);
    else history.pushState(null, '', to);
    current = to;
  }
  visit += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current URL (path and query) and a navigation counter; re-renders on navigation. */
export function useLocation(): { url: string; visit: number } {
  const url = useSyncExternalStore(subscribe, () => current);
  const count = useSyncExternalStore(subscribe, () => visit);
  return { url, visit: count };
}

export function currentUrl(): string {
  return current;
}

/** An in-app link: a plain click navigates without a reload; modified clicks open a tab as usual. */
export const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }>(function Link({ to, onClick, ...rest }, ref) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a ref={ref} href={to} onClick={click} {...rest} />;
});
