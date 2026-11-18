/**
 * The stored video library root: one writer that validates, and a reader that re-validates.
 * Uses real test DB (APP_ENV=test) — no mocks.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../../../db/client.js';
import { settingsService } from '../../../settings/settings-service.js';
import { getVideoLibraryRoot, requireVideoLibraryRoot, setVideoLibraryRoot } from '../video-library-root.js';

const KEY = 'video_library_root';
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'video-library-root-'));

beforeEach(() => { sqlite.prepare('DELETE FROM settings WHERE key = ?').run(KEY); });
afterAll(() => {
  sqlite.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('video library root', () => {
  it('answers 409 library-root-missing while unset', async () => {
    expect(getVideoLibraryRoot()).toBeNull();
    await expect(requireVideoLibraryRoot()).rejects.toMatchObject({
      code: 'library-root-missing', statusCode: 409, details: { reason: 'unset' },
    });
  });

  it('stores the canonical root and reads it back', async () => {
    const real = realpathSync.native(tmpRoot);
    expect(await setVideoLibraryRoot(tmpRoot + path.sep)).toBe(real);
    expect(getVideoLibraryRoot()).toBe(real);
    expect(await requireVideoLibraryRoot()).toBe(real);
  });

  it('refuses a share on write with 422 library-root-invalid', async () => {
    await expect(setVideoLibraryRoot('\\\\server\\x')).rejects.toMatchObject({
      code: 'library-root-invalid', statusCode: 422, details: { reason: 'unc' },
    });
    expect(getVideoLibraryRoot()).toBeNull();
  });

  it('re-validates on read a value written around the validator', async () => {
    settingsService.set(KEY, '\\\\server\\x');
    await expect(requireVideoLibraryRoot()).rejects.toMatchObject({
      code: 'library-root-missing', statusCode: 409, details: { reason: 'unc' },
    });
  });
});
