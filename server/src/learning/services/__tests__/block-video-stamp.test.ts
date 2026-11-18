import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../../lib/errors.js';
import { parseBlockVideoStampFields, resolveBlockVideoStamp } from '../block-video-stamp.js';
import { cleanVideoDb, seedPage, seedPageVideo } from './video-library-test-fixtures.js';

const NOT_IN_PAGE = expect.objectContaining({ code: 'video-not-in-page', statusCode: 422 });

describe('parseBlockVideoStampFields', () => {
  it('turns present fields into numbers and leaves absent or blank ones out', () => {
    expect(parseBlockVideoStampFields({ pageVideoId: '12', videoTimeSec: '83.5' })).toEqual({ pageVideoId: 12, videoTimeSec: 83.5 });
    expect(parseBlockVideoStampFields({ pageVideoId: '', videoTimeSec: ' ' })).toEqual({});
    expect(parseBlockVideoStampFields({ body: 'text' })).toEqual({});
  });

  it('refuses a field that is not a number', () => {
    expect(() => parseBlockVideoStampFields({ pageVideoId: 'x', videoTimeSec: '1' })).toThrow(ValidationError);
  });
});

describe('resolveBlockVideoStamp', () => {
  beforeEach(() => { cleanVideoDb(); });
  afterAll(() => { cleanVideoDb(); });

  it('gives nothing to store without a stamp', () => {
    expect(resolveBlockVideoStamp(null, {})).toEqual({});
  });

  it('stores a stamp on a video of the same page', () => {
    const { pageId } = seedPage();
    const pageVideoId = seedPageVideo(pageId, 'a.mp4');
    expect(resolveBlockVideoStamp(pageId, { pageVideoId, videoTimeSec: 0 })).toEqual({ pageVideoId, videoTimeSec: 0 });
  });

  it('refuses half a stamp and numbers out of range with 400', () => {
    const { pageId } = seedPage();
    const pageVideoId = seedPageVideo(pageId, 'a.mp4');
    for (const input of [
      { pageVideoId }, { videoTimeSec: 3 },
      { pageVideoId: 0, videoTimeSec: 3 }, { pageVideoId: 1.5, videoTimeSec: 3 },
      { pageVideoId, videoTimeSec: -1 }, { pageVideoId, videoTimeSec: Infinity }, { pageVideoId, videoTimeSec: NaN },
    ]) {
      expect(() => resolveBlockVideoStamp(pageId, input)).toThrow(ValidationError);
    }
  });

  it('refuses a video of another page, a missing video and a block without a page with 422', () => {
    const own = seedPage('Own');
    const other = seedPage('Other');
    const foreignVideoId = seedPageVideo(other.pageId, 'b.mp4');
    expect(() => resolveBlockVideoStamp(own.pageId, { pageVideoId: foreignVideoId, videoTimeSec: 5 })).toThrow(NOT_IN_PAGE);
    expect(() => resolveBlockVideoStamp(own.pageId, { pageVideoId: foreignVideoId + 100, videoTimeSec: 5 })).toThrow(NOT_IN_PAGE);
    expect(() => resolveBlockVideoStamp(null, { pageVideoId: foreignVideoId, videoTimeSec: 5 })).toThrow(NOT_IN_PAGE);
  });
});
