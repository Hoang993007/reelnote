import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../../../db/client.js';
import { NotFoundError } from '../../../lib/errors.js';
import { pageVideoService } from '../page-video-service.js';
import { setVideoLibraryRoot } from '../video-library-root.js';
import { ROOT_SETTING_KEY, cleanVideoDb, createTempLibrary, seedBlock, seedPage, seedPageVideo } from './video-library-test-fixtures.js';
import { testOwner } from './video-library-test-fixtures.js';

const countRows = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('pageVideoService', () => {
  const lib = createTempLibrary('page-video-service-');

  beforeAll(() => lib.add(['course/10 - Close.mp4', 'course/2 - Open.mp4', 'course/1 - Intro.mp4', 'other.mp4', ['renamed.mp4', 3]]));
  beforeEach(async () => {
    cleanVideoDb();
    await setVideoLibraryRoot(lib.root);
  });
  afterAll(() => {
    cleanVideoDb();
    lib.remove();
  });

  it('appends attached files in natural file order with titles from their names', async () => {
    const { pageId } = seedPage();
    const first = await pageVideoService.attach(pageId, ['course/10 - Close.mp4', 'COURSE/2 - open.mp4'], testOwner().id);
    expect(first.libraryRootSet).toBe(true);
    expect(first.videos.map((v) => [v.position, v.relPath, v.title, v.completed])).toEqual([
      [0, 'course/2 - Open.mp4', 'Open', false],
      [1, 'course/10 - Close.mp4', 'Close', false],
    ]);
    expect(first.videos[0].revision).toMatch(/^0-\d+$/);

    const second = await pageVideoService.attach(pageId, ['course/1 - Intro.mp4'], testOwner().id);
    expect(second.videos.map((v) => v.position)).toEqual([0, 1, 2]);
  });

  it('refuses a file another row already has, naming the owner page', async () => {
    const pageA = seedPage('Page A', 'Source A');
    const pageB = seedPage('Page B', 'Source B');
    const [video] = (await pageVideoService.attach(pageA.pageId, ['other.mp4'], testOwner().id)).videos;
    const owner = { pageVideoId: video.id, pageId: pageA.pageId, pageTitle: 'Page A', sourceId: pageA.sourceId, sourceName: 'Source A' };

    for (const [pageId, rel] of [[pageA.pageId, 'other.mp4'], [pageB.pageId, 'OTHER.MP4']] as const) {
      await expect(pageVideoService.attach(pageId, [rel], testOwner().id)).rejects.toMatchObject({
        code: 'video-already-attached', statusCode: 409, details: owner,
      });
    }
  });

  it('refuses a file whose name changed only in case since another row took it', async () => {
    const { pageId } = seedPage();
    const pageVideoId = seedPageVideo(pageId, 'Other.mp4');
    await expect(pageVideoService.attach(seedPage().pageId, ['other.mp4'], testOwner().id)).rejects.toMatchObject({
      code: 'video-already-attached', statusCode: 409, details: { pageVideoId, pageId },
    });
  });

  it('writes nothing when the page or one of the files is missing', async () => {
    const { pageId } = seedPage();
    await expect(pageVideoService.attach(pageId + 1000, ['other.mp4'], testOwner().id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pageVideoService.attach(pageId, ['other.mp4', 'missing.mp4'], testOwner().id)).rejects.toMatchObject({ code: 'video-file-missing', statusCode: 404 });
    expect(countRows('page_videos')).toBe(0);
  });

  it('remove clears both stamp columns, keeps the block text and returns the cleared ids', async () => {
    const { pageId } = seedPage();
    const [video] = (await pageVideoService.attach(pageId, ['other.mp4'], testOwner().id)).videos;
    const stamped = seedBlock(pageId, 'Absorption at the low', { pageVideoId: video.id, timeSec: 75.5 });
    seedBlock(pageId, 'Plain note');

    expect(pageVideoService.remove(video.id)).toEqual({ clearedStamps: 1, clearedBlockIds: [stamped] });
    expect(sqlite.prepare('SELECT b.page_video_id, b.video_time_sec, t.body FROM blocks b JOIN block_text t ON t.block_id = b.id WHERE b.id = ?').get(stamped))
      .toEqual({ page_video_id: null, video_time_sec: null, body: 'Absorption at the low' });
    expect(countRows('page_videos')).toBe(0);
    expect(() => pageVideoService.remove(video.id)).toThrow(NotFoundError);
  });

  it('relink keeps the id, stamps and progress, clears the duration and changes the revision', async () => {
    const { pageId } = seedPage();
    const [taken, video] = (await pageVideoService.attach(pageId, ['other.mp4', 'course/1 - Intro.mp4'], testOwner().id)).videos;
    sqlite.prepare('UPDATE page_videos SET duration_sec = 120 WHERE id = ?').run(video.id);
    sqlite.prepare('INSERT INTO video_progress (page_video_id, user_id, last_position_sec, completed) VALUES (?, ?, 30, 1)').run(video.id, testOwner().id);
    const block = seedBlock(pageId, 'Stamped', { pageVideoId: video.id, timeSec: 12 });

    const relinked = await pageVideoService.relink(video.id, 'Renamed.MP4', testOwner().id);
    expect(relinked).toMatchObject({ id: video.id, relPath: 'renamed.mp4', durationSec: null, lastPositionSec: 30, completed: true });
    expect(relinked.revision).not.toBe(video.revision);
    expect(sqlite.prepare('SELECT page_video_id FROM blocks WHERE id = ?').get(block)).toEqual({ page_video_id: video.id });

    await expect(pageVideoService.relink(video.id, taken.relPath, testOwner().id)).rejects.toMatchObject({ code: 'video-already-attached', statusCode: 409 });
    expect((await pageVideoService.relink(video.id, 'renamed.mp4', testOwner().id)).relPath).toBe('renamed.mp4');
  });

  it('counts rows whose file no longer resolves', async () => {
    const { pageId } = seedPage();
    lib.add(['doomed/clip.mp4']);
    await pageVideoService.attach(pageId, ['doomed/clip.mp4', 'other.mp4'], testOwner().id);
    expect(await pageVideoService.countUnresolvedVideos(lib.rootReal)).toBe(0);
    unlinkSync(path.join(lib.root, 'doomed', 'clip.mp4'));
    expect(await pageVideoService.countUnresolvedVideos(lib.rootReal)).toBe(1);
  });

  it('resolves the stream path, and reads a null revision while the root is unset', async () => {
    const { pageId } = seedPage();
    const [video] = (await pageVideoService.attach(pageId, ['other.mp4'], testOwner().id)).videos;
    expect((await pageVideoService.resolveStreamPath(video.id)).absPath).toBe(path.join(lib.rootReal, 'other.mp4'));

    sqlite.prepare('DELETE FROM settings WHERE key = ?').run(ROOT_SETTING_KEY);
    const list = await pageVideoService.list(pageId, testOwner().id);
    expect(list.libraryRootSet).toBe(false);
    expect(list.videos[0].revision).toBeNull();
    await expect(pageVideoService.resolveStreamPath(video.id)).rejects.toMatchObject({ code: 'library-root-missing', statusCode: 409 });
  });

  it('reorders a page\'s videos and refuses an order that is not exactly its set', async () => {
    const { pageId } = seedPage();
    const [a, b, c] = (await pageVideoService.attach(pageId, ['course/1 - Intro.mp4', 'course/2 - Open.mp4', 'other.mp4'], testOwner().id)).videos;
    const reordered = await pageVideoService.reorder(pageId, [{ id: c.id, position: 0 }, { id: a.id, position: 1 }, { id: b.id, position: 2 }], testOwner().id);
    expect(reordered.videos.map((v) => v.id)).toEqual([c.id, a.id, b.id]);

    const foreign = (await pageVideoService.attach(seedPage().pageId, ['renamed.mp4'], testOwner().id)).videos[0];
    for (const positions of [
      [{ id: a.id, position: 0 }, { id: b.id, position: 1 }],
      [{ id: a.id, position: 0 }, { id: b.id, position: 1 }, { id: foreign.id, position: 2 }],
      [{ id: a.id, position: 0 }, { id: b.id, position: 0 }, { id: c.id, position: 1 }],
    ]) {
      await expect(pageVideoService.reorder(pageId, positions, testOwner().id)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect((await pageVideoService.list(pageId, testOwner().id)).videos.map((v) => v.id)).toEqual([c.id, a.id, b.id]);
  });

  it('drops a page\'s videos with the page', async () => {
    const { pageId } = seedPage();
    await pageVideoService.attach(pageId, ['other.mp4'], testOwner().id);
    sqlite.prepare('DELETE FROM pages WHERE id = ?').run(pageId);
    expect(countRows('page_videos')).toBe(0);
  });
});
