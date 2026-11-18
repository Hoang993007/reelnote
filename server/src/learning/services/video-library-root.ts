import { settingsService } from '../../settings/settings-service.js';
import { libraryRootInvalid, libraryRootMissing } from './video-library-errors.js';
import { canonicalizeRoot } from './video-library-root-validation.js';

const ROOT_KEY = 'video_library_root';

/** The stored root as written, or `null` when unset. Not validated: use `requireVideoLibraryRoot` to read files. */
export function getVideoLibraryRoot(): string | null {
  return settingsService.get(ROOT_KEY) || null;
}

/**
 * The root, re-validated on every read: a restore or a manual edit can put any value in the
 * settings row, so nothing under it is opened unless it still passes the write rules.
 */
export async function requireVideoLibraryRoot(): Promise<string> {
  const stored = getVideoLibraryRoot();
  if (!stored) throw libraryRootMissing('unset');
  const result = await canonicalizeRoot(stored);
  if ('reason' in result) throw libraryRootMissing(result.reason);
  return result.root;
}

/** Validates, canonicalizes and stores the root. The only writer of the setting. */
export async function setVideoLibraryRoot(input: string): Promise<string> {
  const result = await canonicalizeRoot(input);
  if ('reason' in result) throw libraryRootInvalid(result.reason);
  settingsService.set(ROOT_KEY, result.root);
  return result.root;
}
