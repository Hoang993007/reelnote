import { config } from '../config.js';
import { closeConnection, sqlite } from '../db/client.js';
import { applyMigrations } from '../db/migrate.js';
import { backupIfDue } from '../ops/backup.js';
import { runUserCommand, USER_USAGE } from './user-commands.js';
import { runShareCommand, SHARE_USAGE } from './share-commands.js';
import { NOTES_USAGE, runNotesCommand } from './notes-commands.js';
import { IMPORT_USAGE, runImportCommand } from './import-commands.js';

type Command = (args: string[]) => Promise<void> | void;

const COMMANDS: Record<string, { usage: string[]; run: Command }> = {
  migrate: {
    usage: ['migrate                                                    apply pending DB migrations'],
    run: () => {
      const applied = applyMigrations(sqlite);
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Up to date.');
    },
  },
  backup: {
    usage: ["backup                                                     write today's backup now (the server does it daily)"],
    run: async () => {
      const result = await backupIfDue(sqlite, config.dataDir);
      console.log(result ? `Backup written to ${result.dir} (${result.newImages} new images).` : "Today's backup already exists.");
    },
  },
  user: { usage: USER_USAGE, run: runUserCommand },
  share: { usage: SHARE_USAGE, run: runShareCommand },
  notes: { usage: NOTES_USAGE, run: runNotesCommand },
  import: { usage: IMPORT_USAGE, run: runImportCommand },
};

function printUsage(): void {
  console.log('Usage: pnpm cli <command> [...args]   (from the repo root: pnpm user …, pnpm share …)\n');
  for (const { usage } of Object.values(COMMANDS)) for (const line of usage) console.log(`  ${line}`);
}

async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv;
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    printUsage();
    return name ? 1 : 0;
  }
  applyMigrations(sqlite);
  await command.run(args);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeConnection());
