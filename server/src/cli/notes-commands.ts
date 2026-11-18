import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { addPageNotes, addSourceInsights, type PageNotes } from './notes-import.js';

export const NOTES_USAGE = [
  'notes add <notes.json>... [--dry-run]                      add stamped notes to video pages (one JSON per video)',
  'notes insights <source> <insights.md> [--dry-run]          add standalone insights to a source (id or name)',
  '                                                           JSON: {"key"|"video"|"pageId", "summary", "segments": [{"t", "body"}]}',
  '                                                           insights.md: sections starting "=== <category>"',
];

export function runNotesCommand(args: string[]): void {
  const [action, ...rest] = args;
  const { values, positionals } = parseArgs({ args: rest, options: { 'dry-run': { type: 'boolean' } }, allowPositionals: true, strict: true });
  const dryRun = values['dry-run'] ?? false;
  switch (action) {
    case 'add': {
      if (!positionals.length) throw new Error('Give one or more notes JSON files.');
      let failed = 0;
      for (const file of positionals) {
        try {
          console.log(addPageNotes(JSON.parse(readFileSync(file, 'utf8')) as PageNotes, dryRun));
        } catch (error) {
          failed += 1;
          console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (failed) throw new Error(`${failed} of ${positionals.length} files were not added.`);
      return;
    }
    case 'insights': {
      const [source, file] = positionals;
      if (!source || !file) throw new Error('Usage: notes insights <source> <insights.md>');
      console.log(addSourceInsights(source, readFileSync(file, 'utf8'), dryRun));
      return;
    }
    default:
      throw new Error(`Unknown notes action. Usage:\n  ${NOTES_USAGE.join('\n  ')}`);
  }
}
