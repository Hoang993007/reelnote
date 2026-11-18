import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Windows device names, which open a device instead of a file whatever the extension (`nul.mp4`,
 * `nul .mp4`); the superscript digits are devices too.
 */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])\s*(\..*)?$/i;

/** Whether a filesystem error means the path does not exist (or a parent is not a directory). */
export function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Whether `error` came from the filesystem: it names the failed call (`EPERM`, `EBUSY` from `lstat`, …). */
export function isFsError(error: unknown): error is NodeJS.ErrnoException {
  const errno = error as NodeJS.ErrnoException | null;
  return error instanceof Error && typeof errno?.code === 'string' && typeof errno.syscall === 'string';
}

function isSafeSegment(segment: string): boolean {
  // Node refuses a NUL in a path with a non-filesystem error.
  if (segment === '' || segment === '.' || segment === '..' || segment.includes('\0')) return false;
  // Windows drops a trailing dot or space when it opens the file, so `bad.` names another file.
  if (segment.endsWith('.') || segment.endsWith(' ')) return false;
  return !RESERVED_DEVICE_NAME.test(segment);
}

/**
 * Whether `rel` is a plain relative path, judged on its text alone: not absolute, no `:` (alternate
 * data streams, drive-relative `C:foo`), and no empty, `.`, `..`, trailing-dot/space or device
 * segment, whichever of `/` or `\` separates them.
 */
export function isSafeRelativePath(rel: string): boolean {
  if (rel === '' || path.isAbsolute(rel) || path.win32.isAbsolute(rel) || rel.includes(':')) return false;
  return rel.split(/[\\/]/).every(isSafeSegment);
}

/**
 * - `ok`: the real path, with on-disk casing.
 * - `missing`: a segment does not exist, and every segment before it is a plain folder inside the root.
 * - `refused`: unsafe text, a link on the way, or not inside the root.
 */
export type InsideRootResult = { status: 'ok'; path: string } | { status: 'missing' } | { status: 'refused' };

const MISSING: InsideRootResult = { status: 'missing' };
const REFUSED: InsideRootResult = { status: 'refused' };

/**
 * Looks up `rel` under `root` without following any link. Each segment is `lstat`ed first and a
 * symlink or junction refuses the path: a symlink may point at a share, and opening anything
 * through it would make the server authenticate to that host. Only then does `realpath` (async, so a
 * request never blocks the event loop) give the on-disk casing.
 */
export async function inspectInsideRoot(root: string, rel: string): Promise<InsideRootResult> {
  if (!isSafeRelativePath(rel)) return REFUSED;
  try {
    const rootReal = await fs.realpath(root);
    let current = rootReal;
    for (const segment of rel.split(/[\\/]/)) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink()) return REFUSED;
    }
    const targetReal = await fs.realpath(current);
    const relative = path.relative(rootReal, targetReal);
    if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return REFUSED;
    }
    return { status: 'ok', path: targetReal };
  } catch (error) {
    if (isMissingPathError(error)) return MISSING;
    throw error;
  }
}

/** The real path of `rel` under `root`, or `null` when `inspectInsideRoot` finds it missing or refuses it. */
export async function resolveInsideRoot(root: string, rel: string): Promise<string | null> {
  const found = await inspectInsideRoot(root, rel);
  return found.status === 'ok' ? found.path : null;
}
