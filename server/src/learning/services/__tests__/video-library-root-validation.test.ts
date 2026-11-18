import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalizeRoot, checkRootSyntax } from '../video-library-root-validation.js';

describe('video library root validation', () => {
  let base: string;

  beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'video-library-root-'));
    mkdirSync(path.join(base, 'Videos'));
    writeFileSync(path.join(base, 'file.mp4'), '');
    symlinkSync(path.join(base, 'Videos'), path.join(base, 'linked'), 'junction');
    symlinkSync(path.parse(base).root, path.join(base, 'drive'), 'junction');
  });

  afterAll(() => {
    // Remove the links themselves first, so a recursive delete can never walk into the drive they point at.
    for (const link of ['drive', 'linked', 'share']) {
      try {
        unlinkSync(path.join(base, link));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    rmSync(base, { recursive: true, force: true });
  });

  it.each([
    ['\\\\server\\share', 'unc'],
    ['\\\\?\\C:\\x', 'device-path'],
    ['\\\\.\\C:\\x', 'device-path'],
    ['C:\\', 'drive-root'],
    ['videos', 'not-absolute'],
    ['C:videos', 'not-absolute'],
    ['D:\\Videos', null],
    ['//server/share', 'unc'],
    ['//?/C:/x', 'device-path'],
    ['C:/', 'drive-root'],
    ['D:/Videos', null],
  ])('reads %j as %j', (input, reason) => {
    expect(checkRootSyntax(input)).toBe(reason);
  });

  it('refuses a missing folder and a file', async () => {
    expect(await canonicalizeRoot(path.join(base, 'missing'))).toEqual({ reason: 'not-found' });
    expect(await canonicalizeRoot(path.join(base, 'file.mp4'))).toEqual({ reason: 'not-a-directory' });
  });

  it('follows a local junction to its folder but refuses one that leads to a drive root', async () => {
    expect(await canonicalizeRoot(path.join(base, 'linked'))).toEqual({ root: realpathSync.native(path.join(base, 'Videos')) });
    expect(await canonicalizeRoot(path.join(base, 'drive'))).toEqual({ reason: 'drive-root' });
  });

  it('refuses a symlink to a share without opening it', async (ctx) => {
    const link = path.join(base, 'share');
    try {
      symlinkSync('\\\\192.0.2.1\\videos', link, 'dir');
    } catch (error) {
      // Symlinks (unlike junctions) need Developer Mode or an elevated shell.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') ctx.skip();
      throw error;
    }
    expect(await canonicalizeRoot(link)).toEqual({ reason: 'unc' });
    expect(await canonicalizeRoot(path.join(link, 'lessons'))).toEqual({ reason: 'unc' });
  });

  it('returns the real path of a local folder, which validates again unchanged', async () => {
    const real = realpathSync.native(path.join(base, 'Videos'));
    const input = path.join(base, 'videos') + path.sep;
    expect(await canonicalizeRoot(input)).toEqual({ root: real });
    expect(await canonicalizeRoot(real)).toEqual({ root: real });
  });
});
