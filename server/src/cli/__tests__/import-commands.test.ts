/** Folder import from the CLI, on the test DB (APP_ENV=test) and a temp video library. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlite } from '../../db/client.js';
import { cleanVideoDb, createTempLibrary, seedPage, storeRootSetting, testOwner } from '../../learning/services/__tests__/video-library-test-fixtures.js';
import { runImportCommand } from '../import-commands.js';

const library = createTempLibrary('cli-import-');
library.add(['Speaker/Talk one [aaaaaaaaaaa].mp4', 'Speaker/Talk two [bbbbbbbbbbb].mp4', 'Speaker/Old talk [ccccccccccc].mp4']);

function pagesOf(sourceId: number): string[] {
  return (sqlite.prepare('SELECT title FROM pages WHERE source_id = ? AND deleted_at IS NULL ORDER BY position').all(sourceId) as Array<{ title: string }>)
    .map((p) => p.title);
}

async function run(...args: string[]): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await runImportCommand(args);
    return log.mock.calls.map((c) => String(c[0])).join('\n');
  } finally {
    log.mockRestore();
  }
}

describe('import command', () => {
  beforeEach(() => { cleanVideoDb(); testOwner(); storeRootSetting(library.root); });
  afterAll(() => { cleanVideoDb(); library.remove(); });

  it('adds only the named files, one page each, to the source found by name, and skips them the second time', async () => {
    const { sourceId } = seedPage('Intro', 'Speaker');
    expect(await run('speaker', 'Speaker', 'Talk one [aaaaaaaaaaa].mp4', 'Talk two [bbbbbbbbbbb].mp4')).toContain('2 videos on 2 new pages');
    expect(pagesOf(sourceId)).toEqual(['Intro', 'Talk one', 'Talk two']);
    expect(await run(String(sourceId), 'Speaker', 'Talk one [aaaaaaaaaaa].mp4')).toContain('skipped Speaker/Talk one [aaaaaaaaaaa].mp4');
    expect(pagesOf(sourceId)).toHaveLength(3);
  });

  it('writes nothing on a dry run, and refuses an unknown source', async () => {
    const { sourceId } = seedPage('Intro', 'Speaker');
    expect(await run('Speaker', 'Speaker', '--dry-run')).toContain('dry run');
    expect(pagesOf(sourceId)).toEqual(['Intro']);
    await expect(run('Nobody', 'Speaker')).rejects.toThrow('No source Nobody');
  });
});
