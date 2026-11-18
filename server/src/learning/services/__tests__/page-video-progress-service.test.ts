import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../../../db/client.js';
import { NotFoundError } from '../../../lib/errors.js';
import { pageVideoProgressService } from '../page-video-progress-service.js';
import { cleanVideoDb, seedPage, seedPageVideo, testOwner } from './video-library-test-fixtures.js';

type ProgressRow = { position: number; duration: number | null; completed: number; clientTs: number; watchedAt: string | null };
const rowOf = (id: number, userId = testOwner().id) => sqlite.prepare(`
  SELECT pr.last_position_sec AS position, v.duration_sec AS duration, pr.completed, pr.playback_client_ts AS clientTs, pr.last_watched_at AS watchedAt
  FROM page_videos v JOIN video_progress pr ON pr.page_video_id = v.id AND pr.user_id = ?
  WHERE v.id = ?`).get(userId, id) as ProgressRow;

describe('pageVideoProgressService', () => {
  let id: number;

  beforeEach(() => {
    cleanVideoDb();
    id = seedPageVideo(seedPage().pageId, 'course/clip.mp4');
  });
  afterAll(() => cleanVideoDb());

  it('saves position, duration, client clock and the watch time', () => {
    expect(pageVideoProgressService.saveProgress(id, testOwner().id, { positionSec: 30.5, durationSec: 100, completed: false, clientTs: 1000 })).toMatchObject({ applied: true });
    expect(rowOf(id)).toMatchObject({ position: 30.5, duration: 100, completed: 0, clientTs: 1000 });
    expect(rowOf(id).watchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    pageVideoProgressService.saveProgress(id, testOwner().id, { positionSec: 40, completed: false, clientTs: 2000 });
    expect(rowOf(id)).toMatchObject({ position: 40, duration: 100 });
  });

  it('keeps completed once set', () => {
    pageVideoProgressService.saveProgress(id, testOwner().id, { positionSec: 96, durationSec: 100, completed: true, clientTs: 1000 });
    pageVideoProgressService.saveProgress(id, testOwner().id, { positionSec: 3, completed: false, clientTs: 2000 });
    expect(rowOf(id)).toMatchObject({ position: 3, completed: 1 });
  });

  it('ignores a write older than the stored one and leaves the row unchanged', () => {
    pageVideoProgressService.saveProgress(id, testOwner().id, { positionSec: 50, completed: false, clientTs: 5000 });
    const before = rowOf(id);
    expect(pageVideoProgressService.saveProgress(id, testOwner().id, { positionSec: 10, completed: true, clientTs: 4000 })).toMatchObject({ applied: false });
    expect(rowOf(id)).toEqual(before);
  });

  it('keeps the furthest point and marks the video watched at 90% of it', () => {
    const save = (positionSec: number, clientTs: number) =>
      pageVideoProgressService.saveProgress(id, testOwner().id, { positionSec, durationSec: 100, completed: false, clientTs });
    expect(save(60, 1000)).toMatchObject({ furthestSec: 60, completed: false });
    expect(save(20, 2000)).toMatchObject({ furthestSec: 60, completed: false });
    expect(save(89, 3000)).toMatchObject({ completed: false });
    expect(save(90, 4000)).toMatchObject({ furthestSec: 90, completed: true });
    expect(save(5, 5000)).toMatchObject({ furthestSec: 90, completed: true });
    expect(rowOf(id)).toMatchObject({ position: 5, completed: 1 });
  });

  it('answers not found for an unknown video', () => {
    expect(() => pageVideoProgressService.saveProgress(id + 1000, testOwner().id, { positionSec: 1, completed: false, clientTs: 1 })).toThrow(NotFoundError);
  });
});
