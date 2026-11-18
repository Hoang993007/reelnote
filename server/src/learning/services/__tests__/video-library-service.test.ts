import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setVideoLibraryRoot } from '../video-library-root.js';
import { videoLibraryService } from '../video-library-service.js';
import { cleanVideoDb, createTempLibrary, seedPage, seedPageVideo } from './video-library-test-fixtures.js';

describe('videoLibraryService.listFolder', () => {
  const lib = createTempLibrary('video-library-service-');
  const nested = 'Week 2/01 - Intro [abcdefghijk].mp4';

  beforeAll(() => {
    lib.add(['10 - Ten.mp4', '2 - Two.mp4', ['Big.mp4', 7], 'notes.txt', 'Original/', '.hidden/', 'Week 10/', nested]);
    lib.junction('jx', lib.outside);
  });
  beforeEach(() => cleanVideoDb());
  afterAll(() => {
    cleanVideoDb();
    lib.remove();
  });

  it('answers 409 library-root-missing while the root is unset', async () => {
    await expect(videoLibraryService.listFolder('')).rejects.toMatchObject({ code: 'library-root-missing', statusCode: 409 });
  });

  it('lists folders and .mp4 files in natural order, hiding Original, dot entries and links', async () => {
    await setVideoLibraryRoot(lib.root);
    const listing = await videoLibraryService.listFolder('');
    expect(listing).toMatchObject({ root: lib.rootReal, dir: '', parent: null });
    expect(listing.folders).toEqual([{ name: 'Week 2', relPath: 'Week 2' }, { name: 'Week 10', relPath: 'Week 10' }]);
    expect(listing.files.map((f) => [f.name, f.sizeBytes, f.parsed.order])).toEqual([
      ['2 - Two.mp4', 0, 2], ['10 - Ten.mp4', 0, 10], ['Big.mp4', 7, null],
    ]);
  });

  it('lists a sub-folder by its on-disk casing and marks files a page already has', async () => {
    await setVideoLibraryRoot(lib.root);
    const { sourceId, pageId } = seedPage('Intro page', 'Sample course');
    const pageVideoId = seedPageVideo(pageId, nested, 'Intro');

    const listing = await videoLibraryService.listFolder('week 2');
    expect(listing).toMatchObject({ dir: 'Week 2', parent: '', folders: [] });
    expect(listing.files).toEqual([{
      name: '01 - Intro [abcdefghijk].mp4',
      relPath: nested,
      sizeBytes: 0,
      parsed: { order: 1, date: null, title: 'Intro' },
      attachedTo: { pageVideoId, pageId, pageTitle: 'Intro page', sourceId, sourceName: 'Sample course' },
    }]);
  });

  it('still marks a file whose name changed only in case since it was attached', async () => {
    await setVideoLibraryRoot(lib.root);
    const { pageId } = seedPage();
    const pageVideoId = seedPageVideo(pageId, nested.toUpperCase());
    const listing = await videoLibraryService.listFolder('Week 2');
    expect(listing.files[0]).toMatchObject({ relPath: nested, attachedTo: { pageVideoId, pageId } });
  });

  it.each(['../outside', 'jx', '2 - Two.mp4', 'missing', 'Week 10/..'])('answers 400 path-outside-library for dir %j', async (dir) => {
    await setVideoLibraryRoot(lib.root);
    await expect(videoLibraryService.listFolder(dir)).rejects.toMatchObject({ code: 'path-outside-library', statusCode: 400 });
  });
});
