/** Notes made on this PC added as the owner's, on the real test DB (APP_ENV=test). */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../../db/client.js';
import { blockService } from '../../learning/services/block-service.js';
import { cleanVideoDb, seedBlock, seedPage, seedPageVideo, testOwner } from '../../learning/services/__tests__/video-library-test-fixtures.js';
import { addPageNotes, addSourceInsights, parseInsightSections } from '../notes-import.js';

function videoPage(relPath = 'Course/Absorption [Au20OwdAG5s].mp4', durationSec: number | null = 600) {
  const { sourceId, pageId } = seedPage();
  const pageVideoId = seedPageVideo(pageId, relPath);
  sqlite.prepare('UPDATE page_videos SET duration_sec = ? WHERE id = ?').run(durationSec, pageVideoId);
  return { sourceId, pageId, pageVideoId };
}

const notes = { summary: '### Tóm tắt video\n- Absorption', segments: [{ t: 12, body: '### Intro' }, { t: 95, body: '### Exhaustion' }] };

describe('addPageNotes', () => {
  beforeEach(() => { cleanVideoDb(); testOwner(); });
  afterAll(() => { cleanVideoDb(); });

  it('adds the summary and stamped notes as the owner, found by the key in the file name', () => {
    const { pageId, pageVideoId } = videoPage();
    expect(addPageNotes({ key: 'Au20OwdAG5s', ...notes })).toContain('summary + 2 stamped notes added');
    const blocks = blockService.listByPage(pageId, testOwner());
    expect(blocks.map((b) => [b.kind, b.pageVideoId, b.videoTimeSec, b.authorId])).toEqual([
      ['summary', null, null, testOwner().id],
      ['text', pageVideoId, 12, testOwner().id],
      ['text', pageVideoId, 95, testOwner().id],
    ]);
  });

  it('finds the page by file name or page id, and never adds twice', () => {
    const { pageId } = videoPage();
    expect(addPageNotes({ video: 'absorption [Au20OwdAG5s].mp4', segments: notes.segments })).toContain('added');
    expect(addPageNotes({ pageId, segments: notes.segments })).toContain('already has 2 of your blocks');
    expect(blockService.listByPage(pageId, testOwner())).toHaveLength(2);
  });

  it('writes nothing on a dry run or when a segment is wrong', () => {
    const { pageId } = videoPage();
    expect(addPageNotes({ key: 'Au20OwdAG5s', ...notes }, true)).toContain('(dry run)');
    expect(() => addPageNotes({ pageId, segments: [{ t: 30, body: 'a' }, { t: 30, body: 'b' }] })).toThrow('must increase');
    expect(() => addPageNotes({ pageId, segments: [{ t: 700, body: 'late' }] })).toThrow("past the video's end");
    expect(() => addPageNotes({ pageId, segments: [{ t: 5, body: ' ' }] })).toThrow('no body');
    expect(blockService.listByPage(pageId, testOwner())).toEqual([]);
  });

  it('refuses a page it cannot find or that is ambiguous', () => {
    videoPage('A/one.mp4');
    videoPage('B/one.mp4');
    expect(() => addPageNotes({ key: 'missing', segments: [] })).toThrow('No video page');
    expect(() => addPageNotes({ video: 'one.mp4', segments: [] })).toThrow('matches 2 videos');
    expect(addPageNotes({ video: 'B/one.mp4', segments: [{ t: 1, body: 'x' }] })).toContain('B/one.mp4');
  });

  it("does not count a friend's notes as the owner's", () => {
    const { pageId } = videoPage();
    const friend = Number(sqlite.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('f@example.test', 'F', 'scrypt$x', 'friend')").run().lastInsertRowid);
    const block = seedBlock(pageId, 'friend note');
    sqlite.prepare('UPDATE blocks SET author_id = ? WHERE id = ?').run(friend, block);
    expect(addPageNotes({ pageId, segments: notes.segments })).toContain('added');
    sqlite.prepare('DELETE FROM users WHERE id = ?').run(friend);
  });
});

describe('addSourceInsights', () => {
  beforeEach(() => { cleanVideoDb(); testOwner(); sqlite.prepare('DELETE FROM source_insight_categories').run(); });
  afterAll(() => { cleanVideoDb(); });

  const md = '=== Absorption\nHeld at the low.\r\n\r\n=== Exhaustion\nNo more sellers.\n';

  it('parses sections and adds them in file order with their categories', () => {
    expect(parseInsightSections(md)).toEqual([
      { label: 'Absorption', body: 'Held at the low.' },
      { label: 'Exhaustion', body: 'No more sellers.' },
    ]);
    const { sourceId } = videoPage();
    expect(addSourceInsights('Course', md)).toBe('Course: 2 insights added');
    const { standaloneBlocks } = blockService.listInsightsBySource(sourceId, testOwner());
    expect(standaloneBlocks.map((b) => [b.insightCategory, b.body, b.isInsight])).toEqual([
      ['Absorption', 'Held at the low.', 1],
      ['Exhaustion', 'No more sellers.', 1],
    ]);
    expect(addSourceInsights(String(sourceId), md)).toContain('already has 2');
  });

  it('refuses an unknown source or a file without sections', () => {
    videoPage();
    expect(() => addSourceInsights('Nobody', md)).toThrow('No source');
    expect(() => addSourceInsights('Course', 'no sections here')).toThrow('No sections');
  });
});
