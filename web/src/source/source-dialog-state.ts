import { createStore } from '../lib/store';
import type { Source } from '../lib/types';

/** The Add / Edit source dialog: null closed, 'new' to add, a source to edit. */
export const sourceDialog = createStore<Source | 'new' | null>(null);

export function openSourceDialog(source: Source | null): void {
  sourceDialog.set(source ?? 'new');
}
