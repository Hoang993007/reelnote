import { createStore } from '../lib/store';
import type { Page } from '../lib/types';

/** The Delete page dialog: the page to delete, and where to go after (the page list, when it was open). */
export const deletePageDialog = createStore<{ page: Page; leave: boolean } | null>(null);

export function openDeletePage(page: Page, { leave = false } = {}): void {
  deletePageDialog.set({ page, leave });
}
