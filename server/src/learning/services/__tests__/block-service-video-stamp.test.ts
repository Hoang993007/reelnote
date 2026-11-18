/** Video stamps through blockService on the real test DB (APP_ENV=test): set at create only, kept, cleared on removal. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { blockService, type UpdateBlockData } from '../block-service.js';
import { pageVideoService } from '../page-video-service.js';
import { cleanVideoDb, seedPage, seedPageVideo } from './video-library-test-fixtures.js';
import { testOwner } from './video-library-test-fixtures.js';

const noImages: Array<{ buffer: Buffer; mimetype: string }> = [];

function pageWithVideo() {
  const { sourceId, pageId } = seedPage();
  return { sourceId, pageId, pageVideoId: seedPageVideo(pageId, 'lesson.mp4') };
}

describe('blockService video stamps', () => {
  beforeEach(() => { cleanVideoDb(); });
  afterAll(() => { cleanVideoDb(); });

  it('creates stamped notes and returns the stamp from every read', () => {
    const { pageId, pageVideoId } = pageWithVideo();
    const note = blockService.create(pageId, testOwner().id, { type: 'note', body: 'Absorption', pageVideoId, videoTimeSec: 83 }, noImages);
    const quote = blockService.create(pageId, testOwner().id, { type: 'note', kind: 'quote', pageVideoId, videoTimeSec: 120.5 }, noImages);

    expect(note).toMatchObject({ pageVideoId, videoTimeSec: 83, body: 'Absorption' });
    expect(quote).toMatchObject({ type: 'note', kind: 'quote', pageVideoId, videoTimeSec: 120.5 });
    expect(blockService.listByPage(pageId, testOwner()).map((b) => [b.id, b.pageVideoId, b.videoTimeSec])).toEqual([
      [note.id, pageVideoId, 83],
      [quote.id, pageVideoId, 120.5],
    ]);
  });

  it('leaves both fields empty without a stamp', () => {
    const { pageId } = pageWithVideo();
    expect(blockService.create(pageId, testOwner().id, { type: 'note', body: 'Plain' }, noImages)).toMatchObject({ pageVideoId: null, videoTimeSec: null });
  });

  it('refuses a stamp on a standalone insight block and writes nothing', () => {
    const { sourceId, pageVideoId } = pageWithVideo();
    expect(() => blockService.createStandaloneBlock(sourceId, testOwner().id, { type: 'note', body: 'Insight', pageVideoId, videoTimeSec: 5 }, noImages))
      .toThrow(expect.objectContaining({ code: 'video-not-in-page', statusCode: 422 }));
    expect(blockService.listInsightsBySource(sourceId, testOwner()).standaloneBlocks).toEqual([]);
  });

  it('keeps the stamp on a kind change and ignores stamp fields on update', () => {
    const { pageId, pageVideoId } = pageWithVideo();
    const other = seedPageVideo(pageId, 'other.mp4');
    const note = blockService.create(pageId, testOwner().id, { type: 'note', body: 'Reclaim', pageVideoId, videoTimeSec: 42 }, noImages);

    expect(blockService.update(note.id, { kind: 'heading' })).toMatchObject({ kind: 'heading', pageVideoId, videoTimeSec: 42 });
    const update = { body: 'Reclaim held', pageVideoId: other, videoTimeSec: 7 } as UpdateBlockData;
    expect(blockService.update(note.id, update)).toMatchObject({ body: 'Reclaim held', pageVideoId, videoTimeSec: 42 });
  });

  it('loses the stamp but keeps the text when the video is removed from the page', () => {
    const { pageId, pageVideoId } = pageWithVideo();
    const note = blockService.create(pageId, testOwner().id, { type: 'note', body: 'Keep me', pageVideoId, videoTimeSec: 9 }, noImages);

    expect(pageVideoService.remove(pageVideoId).clearedBlockIds).toEqual([note.id]);
    expect(blockService.getById(note.id)).toMatchObject({ body: 'Keep me', pageVideoId: null, videoTimeSec: null });
  });
});
