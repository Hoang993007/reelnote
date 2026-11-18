import { createStore } from './store';

const PAGES_OPEN_KEY = 'reelnote.pagesOpen';
const isWide = () => typeof window !== 'undefined' && window.innerWidth > 1180;

/** On a wide window the page list stays as the reader left it; below 1180 px it is a drawer that starts closed. */
function initialPagesOpen(): boolean {
  if (!isWide()) return false;
  try {
    return localStorage.getItem(PAGES_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** The page screen's layout toggles, shared with the top bar: page list open, focus writing. */
export const pageUi = createStore<{ pagesOpen: boolean; focus: boolean }>({
  pagesOpen: initialPagesOpen(),
  focus: false,
});

pageUi.subscribe(() => {
  if (!isWide()) return;
  try {
    localStorage.setItem(PAGES_OPEN_KEY, String(pageUi.get().pagesOpen));
  } catch {
    // Not remembered; it still applies for this visit.
  }
});

export function setPagesOpen(open: boolean): void {
  pageUi.set((s) => ({ ...s, pagesOpen: open }));
}
