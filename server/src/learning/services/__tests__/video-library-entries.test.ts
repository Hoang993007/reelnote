import { readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isVisibleLibraryEntry, resolveLibraryVideoFile, resolveStoredVideo, videoRevision,
} from '../video-library-entries.js';
import { createTempLibrary } from './video-library-test-fixtures.js';

describe('video library entries', () => {
  const lib = createTempLibrary('video-library-entries-');

  beforeAll(() => {
    lib.add(['a.mp4', ['B.MP4', 5], 'notes.txt', 'Original/', 'original-cut/', '.hidden/', 'dir.mp4/', 'sub/c.mp4', 'swap/clip.mp4']);
    lib.addOutside(['clip.mp4', 'secret.mp4']);
    lib.junction('jx', lib.outside);
  });

  afterAll(() => lib.remove());

  it('shows plain folders and files only', () => {
    const visible = readdirSync(lib.root, { withFileTypes: true }).filter(isVisibleLibraryEntry).map((e) => e.name).sort();
    expect(visible).toEqual(['B.MP4', 'a.mp4', 'dir.mp4', 'notes.txt', 'original-cut', 'sub', 'swap']);
  });

  it('resolves a request path to its canonical `/` path and on-disk casing', async () => {
    expect(await resolveLibraryVideoFile(lib.rootReal, 'b.mp4')).toMatchObject({
      absPath: path.join(lib.rootReal, 'B.MP4'), relPath: 'B.MP4', sizeBytes: 5,
    });
    expect((await resolveLibraryVideoFile(lib.rootReal, 'sub\\c.mp4')).relPath).toBe('sub/c.mp4');
  });

  it.each([
    ['../outside/clip.mp4', 'path-outside-library', 400],
    ['jx/secret.mp4', 'path-outside-library', 400],
    ['missing.mp4', 'video-file-missing', 404],
    ['sub\\missing.mp4', 'video-file-missing', 404],
    ['dir.mp4', 'video-not-mp4', 422],
    ['notes.txt', 'video-not-mp4', 422],
  ])('answers a request for %j with %s', async (rel, code, statusCode) => {
    await expect(resolveLibraryVideoFile(lib.rootReal, rel)).rejects.toMatchObject({ code, statusCode });
  });

  it('re-checks a stored path: missing, not a video, then moved behind a junction', async () => {
    await expect(resolveStoredVideo(lib.rootReal, 'gone.mp4')).rejects.toMatchObject({ code: 'video-file-missing', statusCode: 404 });
    await expect(resolveStoredVideo(lib.rootReal, 'dir.mp4')).rejects.toMatchObject({ code: 'video-not-mp4', statusCode: 422 });
    expect((await resolveStoredVideo(lib.rootReal, 'swap/clip.mp4')).relPath).toBe('swap/clip.mp4');

    rmSync(path.join(lib.root, 'swap'), { recursive: true });
    symlinkSync(lib.outside, path.join(lib.root, 'swap'), 'junction');
    try {
      await expect(resolveStoredVideo(lib.rootReal, 'swap/clip.mp4')).rejects.toMatchObject({
        code: 'video-outside-root', statusCode: 409, details: { relPath: 'swap/clip.mp4' },
      });
    } finally {
      unlinkSync(path.join(lib.root, 'swap'));
    }
  });

  it('builds the revision from size and whole milliseconds', () => {
    expect(videoRevision({ sizeBytes: 42, mtimeMs: 1700000000123.75 })).toBe('42-1700000000123');
  });
});
