import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../../../db/client.js';
import { NotFoundError } from '../../../lib/errors.js';
import { pageVideoImportService } from '../page-video-import-service.js';
import { pageVideoService } from '../page-video-service.js';
import { setVideoLibraryRoot } from '../video-library-root.js';
import { cleanVideoDb, createTempLibrary, seedPage } from './video-library-test-fixtures.js';
import { testOwner } from './video-library-test-fixtures.js';

type PageRow = { id: number; title: string; date: string | null; position: number };
const pagesOf = (sourceId: number) =>
  sqlite.prepare('SELECT id, title, date, position FROM pages WHERE source_id = ? ORDER BY position').all(sourceId) as PageRow[];
const videosOf = (pageId: number) =>
  (sqlite.prepare('SELECT rel_path AS relPath FROM page_videos WHERE page_id = ? ORDER BY position').all(pageId) as Array<{ relPath: string }>)
    .map((row) => row.relPath);
const videoFolderOf = (sourceId: number) =>
  (sqlite.prepare('SELECT video_folder AS folder FROM sources WHERE id = ?').get(sourceId) as { folder: string | null }).folder;

describe('pageVideoImportService', () => {
  const lib = createTempLibrary('page-video-import-');

  beforeAll(() => lib.add([
    'Emma/10 - Close.mp4', 'Emma/02 - Delta.mp4', 'Emma/01 - Absorption [EN dub].mp4',
    'Emma/Original/01 - Absorption.mp4', 'Emma/.cache/clip.mp4', 'Emma/notes.txt',
    'Max/2024-03-05 Reel one (AbCdEfGhIjK).mp4', 'Max/2024-03-01 Reel zero.mp4',
  ]));
  beforeEach(async () => {
    cleanVideoDb();
    await setVideoLibraryRoot(lib.root);
  });
  afterAll(() => {
    cleanVideoDb();
    lib.remove();
  });

  it('adds one page per video after the existing pages, in file order, titles without numbers', async () => {
    const { sourceId, pageId: existing } = seedPage('Existing');
    const result = await pageVideoImportService.importFolder(sourceId, { relDir: 'Emma', onePagePerVideo: true });

    expect(result).toMatchObject({ attachedCount: 3, skipped: [] });
    const pages = pagesOf(sourceId);
    expect(pages.map((p) => [p.position, p.title])).toEqual([[0, 'Existing'], [1, 'Absorption'], [2, 'Delta'], [3, 'Close']]);
    expect(result.createdPageIds).toEqual(pages.slice(1).map((p) => p.id));
    expect(pages.slice(1).map((p) => videosOf(p.id))).toEqual([
      ['Emma/01 - Absorption [EN dub].mp4'], ['Emma/02 - Delta.mp4'], ['Emma/10 - Close.mp4'],
    ]);
    expect(videosOf(existing)).toEqual([]);
    expect(videoFolderOf(sourceId)).toBe('Emma');
  });

  it('takes page dates from dated file names', async () => {
    const { sourceId } = seedPage('Existing');
    await pageVideoImportService.importFolder(sourceId, { relDir: 'Max', onePagePerVideo: true });
    expect(pagesOf(sourceId).slice(1).map((p) => [p.title, p.date])).toEqual([['Reel zero', '2024-03-01'], ['Reel one', '2024-03-05']]);
    expect(videoFolderOf(sourceId)).toBe('Max');
  });

  it('puts every video on one page named after the folder when asked', async () => {
    const { sourceId } = seedPage('Existing');
    const { createdPageIds } = await pageVideoImportService.importFolder(sourceId, { relDir: 'Emma', onePagePerVideo: false });
    expect(createdPageIds).toHaveLength(1);
    expect(pagesOf(sourceId).map((p) => p.title)).toEqual(['Existing', 'Emma']);
    expect(videosOf(createdPageIds[0])).toEqual(['Emma/01 - Absorption [EN dub].mp4', 'Emma/02 - Delta.mp4', 'Emma/10 - Close.mp4']);
  });

  it('skips files a page already has, and a re-import adds nothing', async () => {
    const other = seedPage('Delta notes', 'Other source');
    await pageVideoService.attach(other.pageId, ['Emma/02 - Delta.mp4'], testOwner().id);
    const { sourceId } = seedPage('Existing');

    const first = await pageVideoImportService.importFolder(sourceId, { relDir: 'Emma', onePagePerVideo: true });
    expect(first.createdPageIds).toHaveLength(2);
    expect(first.skipped).toEqual([{ relPath: 'Emma/02 - Delta.mp4', pageId: other.pageId, pageTitle: 'Delta notes', sourceId: other.sourceId }]);

    const again = await pageVideoImportService.importFolder(sourceId, { relDir: 'Emma', onePagePerVideo: true });
    expect(again).toMatchObject({ createdPageIds: [], attachedCount: 0 });
    expect(again.skipped.map((s) => s.relPath)).toEqual(['Emma/01 - Absorption [EN dub].mp4', 'Emma/02 - Delta.mp4', 'Emma/10 - Close.mp4']);
    expect(pagesOf(sourceId)).toHaveLength(3);
  });

  it('keeps a video folder the source already has', async () => {
    const { sourceId } = seedPage();
    sqlite.prepare('UPDATE sources SET video_folder = ? WHERE id = ?').run('Max', sourceId);
    await pageVideoImportService.importFolder(sourceId, { relDir: 'Emma', onePagePerVideo: true });
    expect(videoFolderOf(sourceId)).toBe('Max');
  });

  it('refuses the library folder itself, a folder outside it, and an unknown source', async () => {
    const { sourceId } = seedPage();
    await expect(pageVideoImportService.importFolder(sourceId, { relDir: '', onePagePerVideo: true }))
      .rejects.toThrow('not the library folder itself');
    await expect(pageVideoImportService.importFolder(sourceId, { relDir: 'Emma/..', onePagePerVideo: true }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(pageVideoImportService.importFolder(sourceId, { relDir: '../outside', onePagePerVideo: true }))
      .rejects.toMatchObject({ code: 'path-outside-library', statusCode: 400 });
    await expect(pageVideoImportService.importFolder(sourceId + 1000, { relDir: 'Emma', onePagePerVideo: true }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(pagesOf(sourceId)).toHaveLength(1);
  });

  it('rolls back every page when one insert fails', async () => {
    const { sourceId } = seedPage('Existing');
    sqlite.exec(`CREATE TEMP TRIGGER fail_close BEFORE INSERT ON page_videos WHEN NEW.rel_path LIKE '%Close%'
      BEGIN SELECT RAISE(ABORT, 'insert failed'); END`);
    try {
      await expect(pageVideoImportService.importFolder(sourceId, { relDir: 'Emma', onePagePerVideo: true })).rejects.toThrow();
    } finally {
      sqlite.exec('DROP TRIGGER IF EXISTS temp.fail_close');
    }
    expect(pagesOf(sourceId).map((p) => p.title)).toEqual(['Existing']);
    expect(videoFolderOf(sourceId)).toBeNull();
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM page_videos').get() as { n: number }).n).toBe(0);
  });
});
