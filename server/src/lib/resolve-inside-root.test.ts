import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectInsideRoot, isSafeRelativePath, resolveInsideRoot } from './resolve-inside-root.js';

describe('resolveInsideRoot', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'resolve-inside-root-'));
  const root = path.join(base, 'root');

  beforeAll(() => {
    for (const dir of ['root/sub', 'root-evil', 'outside']) mkdirSync(path.join(base, dir), { recursive: true });
    for (const file of ['root/lesson.mp4', 'root/sub/clip.mp4', 'root/..foo.mp4', 'root/Mixed-Case.mp4',
      'root-evil/x.mp4', 'outside/x.mp4', 'outside/secret.mp4']) {
      writeFileSync(path.join(base, file), '');
    }
    symlinkSync(path.join(base, 'outside'), path.join(root, 'jx'), 'junction');
    symlinkSync(path.join(root, 'sub'), path.join(root, 'jin'), 'junction');
  });

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('resolves files inside the root to their real path', async () => {
    expect(await resolveInsideRoot(root, 'lesson.mp4')).toBe(path.join(root, 'lesson.mp4'));
    expect(await resolveInsideRoot(root, 'sub/clip.mp4')).toBe(path.join(root, 'sub', 'clip.mp4'));
    expect(await resolveInsideRoot(root, 'sub\\clip.mp4')).toBe(path.join(root, 'sub', 'clip.mp4'));
    expect(await resolveInsideRoot(root, '..foo.mp4')).toBe(path.join(root, '..foo.mp4'));
  });

  it('returns the on-disk casing for a differently cased request', async () => {
    expect(await resolveInsideRoot(root, 'MIXED-CASE.MP4')).toBe(path.join(root, 'Mixed-Case.mp4'));
  });

  it.each([
    '../outside/x.mp4', '../root-evil/x.mp4', path.join(base, 'outside', 'x.mp4'), '/x.mp4', '', '.',
    'missing.mp4', 'jx/secret.mp4', 'a:b.mp4', 'lesson.mp4:stream', 'C:lesson.mp4', 'CON', 'nul.mp4',
    'sub/COM1.txt', 'bad./x.mp4', 'bad /x.mp4', 'a//b.mp4', 'sub/../lesson.mp4', 'jin/clip.mp4', 'jx',
    'lesson.mp4\0.txt',
  ])('refuses %j', async (rel) => {
    expect(await resolveInsideRoot(root, rel)).toBeNull();
  });

  it('tells a missing file from a refused path without following links', async () => {
    expect(await inspectInsideRoot(root, 'missing.mp4')).toEqual({ status: 'missing' });
    expect(await inspectInsideRoot(root, 'sub/missing/x.mp4')).toEqual({ status: 'missing' });
    expect(await inspectInsideRoot(root, 'lesson.mp4/x.mp4')).toEqual({ status: 'missing' });
    expect(await inspectInsideRoot(root, 'jx/secret.mp4')).toEqual({ status: 'refused' });
    expect(await inspectInsideRoot(root, 'jx/nope.mp4')).toEqual({ status: 'refused' });
    expect(await inspectInsideRoot(root, 'jin/clip.mp4')).toEqual({ status: 'refused' });
    expect(await inspectInsideRoot(root, '../outside/x.mp4')).toEqual({ status: 'refused' });
  });

  it('judges the text before touching the disk', () => {
    expect(isSafeRelativePath('sub/clip.mp4')).toBe(true);
    expect(isSafeRelativePath('\\\\server\\share\\x.mp4')).toBe(false);
    expect(isSafeRelativePath('LPT9.log')).toBe(false);
  });
});
