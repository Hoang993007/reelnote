import { utimesSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { transcriptUnsupported } from '../video-library-errors.js';
import { setVideoLibraryRoot } from '../video-library-root.js';
import { createVideoTranscriptService } from '../video-transcript-service.js';
import type { VideoTranscript } from '../video-transcript-worker-types.js';
import { cleanVideoDb, createTempLibrary, seedPage, seedPageVideo } from './video-library-test-fixtures.js';

const transcriptOf = (absPath: string): VideoTranscript => ({ cues: [{ startSec: 0, endSec: 1, text: path.basename(absPath) }], reason: null, sourceUrl: null });

describe('video transcript service', () => {
  const lib = createTempLibrary('video-transcript-service-');
  const names = Array.from({ length: 9 }, (_, index) => `lesson-${index + 1}.mp4`);
  let ids: number[];

  beforeAll(() => lib.add(names.map(name => [name, 16] as [string, number])));
  beforeEach(async () => {
    cleanVideoDb();
    await setVideoLibraryRoot(lib.root);
    const { pageId } = seedPage();
    ids = names.map(name => seedPageVideo(pageId, name));
  });
  afterAll(() => {
    cleanVideoDb();
    lib.remove();
  });

  function counting() {
    const extract = vi.fn(async (absPath: string) => transcriptOf(absPath));
    return { extract, service: createVideoTranscriptService({ extract }) };
  }

  it('reads a file once and serves the cached transcript after', async () => {
    const { extract, service } = counting();
    const first = await service.read(ids[0]);
    expect(first.cues[0].text).toBe('lesson-1.mp4');
    expect(await service.read(ids[0])).toBe(first);
    expect(extract).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledWith(path.join(lib.rootReal, 'lesson-1.mp4'));
  });

  it('reads again once the file changed (mtime is part of the key)', async () => {
    const { extract, service } = counting();
    await service.read(ids[0]);
    const later = new Date(Date.now() + 60_000);
    utimesSync(path.join(lib.root, 'lesson-1.mp4'), later, later);
    await service.read(ids[0]);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('keeps 8 transcripts: a 9th evicts the least recently read', async () => {
    const { extract, service } = counting();
    for (const id of ids.slice(0, 8)) await service.read(id);
    await service.read(ids[0]);
    await service.read(ids[8]);
    expect(extract).toHaveBeenCalledTimes(9);
    await service.read(ids[0]);
    expect(extract).toHaveBeenCalledTimes(9);
    await service.read(ids[1]);
    expect(extract).toHaveBeenCalledTimes(10);
  });

  it('starts one read for concurrent opens of a video', async () => {
    const { extract, service } = counting();
    const [a, b] = await Promise.all([service.read(ids[0]), service.read(ids[0])]);
    expect(a).toBe(b);
    expect(extract).toHaveBeenCalledOnce();
  });

  it('reads again after a timeout or an internal failure', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(transcriptUnsupported('timeout'))
      .mockRejectedValueOnce(new Error('worker crashed'))
      .mockImplementation(async (absPath: string) => transcriptOf(absPath));
    const service = createVideoTranscriptService({ extract });
    await expect(service.read(ids[0])).rejects.toMatchObject({ code: 'transcript-unsupported' });
    await expect(service.read(ids[0])).rejects.toThrow('worker crashed');
    await expect(service.read(ids[0])).resolves.toMatchObject({ reason: null });
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it('keeps an unreadable layout for the file revision: the next open fails without a read', async () => {
    const extract = vi.fn().mockRejectedValue(transcriptUnsupported('moov-not-at-start'));
    const service = createVideoTranscriptService({ extract });
    for (let open = 0; open < 2; open += 1) {
      await expect(service.read(ids[0])).rejects.toMatchObject({ details: { reason: 'moov-not-at-start' } });
    }
    expect(extract).toHaveBeenCalledOnce();
  });

  it('answers the path codes of the stream route before any read', async () => {
    const { extract, service } = counting();
    const { pageId } = seedPage('Other page');
    await expect(service.read(seedPageVideo(pageId, 'gone.mp4'))).rejects.toMatchObject({ code: 'video-file-missing' });
    expect(extract).not.toHaveBeenCalled();
  });
});
