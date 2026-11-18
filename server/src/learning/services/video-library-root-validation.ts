import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isMissingPathError } from '../../lib/resolve-inside-root.js';

/** Why a folder cannot be the video library root. */
export type RootInvalidReason =
  | 'not-absolute' | 'unc' | 'device-path' | 'drive-root' | 'not-found' | 'not-a-directory' | 'unreadable';

export type CanonicalRootResult = { root: string } | { reason: RootInvalidReason };

const DEVICE_PATH = /^[\\/]{2}[?.][\\/]/;
const UNC_PATH = /^[\\/]{2}/;
const LOCAL_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const DRIVE_ROOT = /^[A-Za-z]:[\\/]$/;
/** A link target Windows would open over SMB (`readlink` strips `\??\` from local targets only). */
const REMOTE_LINK_TARGET = /^(?:[\\/]{2}|\\\?\?\\UNC\\)/i;
/** Link chains deeper than this are refused rather than followed. */
const MAX_LINK_DEPTH = 8;

/**
 * The text rules for a root: a local `X:\folder` only. A UNC share would make the server authenticate to a
 * remote host, a device path skips Win32 path handling, and a whole drive is too wide to serve.
 */
export function checkRootSyntax(input: string): RootInvalidReason | null {
  if (DEVICE_PATH.test(input)) return 'device-path';
  if (UNC_PATH.test(input)) return 'unc';
  if (!LOCAL_ABSOLUTE.test(input)) return 'not-absolute';
  if (DRIVE_ROOT.test(input)) return 'drive-root';
  return null;
}

/**
 * Whether a symlink on the way to `absPath` (or in a chain behind one) targets a share. Checked with
 * `lstat`/`readlink` before `realpath`, which would otherwise open the share and send credentials.
 */
async function leadsToRemoteHost(absPath: string, depth = 0): Promise<boolean> {
  if (depth > MAX_LINK_DEPTH) return true;
  const { root } = path.parse(absPath);
  let current = root;
  for (const segment of absPath.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = path.join(current, segment);
    if (!(await fs.lstat(current)).isSymbolicLink()) continue;
    const target = await fs.readlink(current);
    if (REMOTE_LINK_TARGET.test(target)) return true;
    if (await leadsToRemoteHost(path.resolve(path.dirname(current), target), depth + 1)) return true;
  }
  return false;
}

/** A filesystem failure as a reason; anything that is not a filesystem error is a bug and rethrown. */
function fsFailureReason(error: unknown): RootInvalidReason {
  if (isMissingPathError(error)) return 'not-found';
  if (typeof (error as NodeJS.ErrnoException | null)?.code === 'string') return 'unreadable';
  throw error;
}

/**
 * The canonical form of a root (its real path, on-disk casing), or why it is refused. The text rules
 * run again on the real path, so a junction that leads to a drive root is refused too.
 */
export async function canonicalizeRoot(input: string): Promise<CanonicalRootResult> {
  const syntax = checkRootSyntax(input);
  if (syntax) return { reason: syntax };
  try {
    if (await leadsToRemoteHost(input)) return { reason: 'unc' };
    const real = await fs.realpath(input);
    if (!(await fs.stat(real)).isDirectory()) return { reason: 'not-a-directory' };
    const resolved = checkRootSyntax(real);
    return resolved ? { reason: resolved } : { root: real };
  } catch (error) {
    return { reason: fsFailureReason(error) };
  }
}
