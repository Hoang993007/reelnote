import { parseArgs } from 'node:util';
import { pageVideoImportService } from '../learning/services/page-video-import-service.js';
import { findSource } from './find-source.js';

export const IMPORT_USAGE = [
  'import <source> <folder> [<file>...] [--one-page] [--dry-run]  add a library folder\'s videos to a source (id or name):',
  '                                                           one page per video, or the named files only; --one-page',
  '                                                           puts them all on one page. Folder and files are relative to',
  '                                                           the video library; videos a page already has are skipped',
];

/** The import dialog's folder import, from this PC: the same service, so the same rules (library root, skips). */
export async function runImportCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args, options: { 'one-page': { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, allowPositionals: true, strict: true,
  });
  const [sourceRef, relDir, ...fileNames] = positionals;
  if (!sourceRef || !relDir) throw new Error(`Usage:\n  ${IMPORT_USAGE.join('\n  ')}`);
  const source = findSource(sourceRef);
  const slashes = (p: string) => p.replace(/\\/g, '/');
  const dir = slashes(relDir).replace(/\/+$/, '');
  const files = fileNames.length ? fileNames.map((name) => ({ relPath: slashes(name).includes('/') ? slashes(name) : `${dir}/${name}` })) : undefined;
  if (values['dry-run']) {
    console.log(`${source.name}: would import ${files ? `${files.length} files` : 'every video'} of ${dir} (dry run)`);
    return;
  }
  const result = await pageVideoImportService.importFolder(source.id, { relDir: dir, onePagePerVideo: !values['one-page'], files });
  console.log(`${source.name}: ${result.attachedCount} videos on ${result.createdPageIds.length} new pages (ids ${result.createdPageIds.join(', ') || 'none'})`);
  for (const s of result.skipped) console.log(`  skipped ${s.relPath}: already on page ${s.pageId} "${s.pageTitle}"`);
}
