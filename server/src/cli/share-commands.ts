import { parseArgs } from 'node:util';
import { shareService } from '../access/share-service.js';
import { userService } from '../auth/user-service.js';

export const SHARE_USAGE = [
  'share list                                                 every source and who opens it ("(write)": also changes it)',
  'share add <sourceId> --email <e> [--write]                 let a friend open a source (--write: and change it)',
  'share remove <sourceId> --email <e>                        stop sharing a source with a friend',
];

function friendId(email: string | undefined): number {
  if (!email) throw new Error('--email is required.');
  const user = userService.findByEmail(email);
  if (!user) throw new Error(`No account with ${email}.`);
  return user.id;
}

function sourceIdArg(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error('Give the source id (see: pnpm share list).');
  return id;
}

export function runShareCommand(args: string[]): void {
  const [action, ...rest] = args;
  const { values, positionals } = parseArgs({ args: rest, options: { email: { type: 'string' }, write: { type: 'boolean' } }, allowPositionals: true, strict: true });
  switch (action) {
    case 'list':
      for (const { sourceId, name, sharedWith } of shareService.overview()) {
        console.log(`${String(sourceId).padStart(3)}  ${name}${sharedWith.length ? `  →  ${sharedWith.join(', ')}` : ''}`);
      }
      return;
    case 'add': {
      const sourceId = sourceIdArg(positionals[0]);
      shareService.share(sourceId, friendId(values.email), values.write === true);
      console.log(`${values.email} can ${values.write ? 'open and change' : 'open'} source ${sourceId}.`);
      return;
    }
    case 'remove': {
      const sourceId = sourceIdArg(positionals[0]);
      shareService.unshare(sourceId, friendId(values.email));
      console.log(`Source ${sourceId} is no longer shared with ${values.email}.`);
      return;
    }
    default:
      throw new Error(`Usage:\n  ${SHARE_USAGE.join('\n  ')}`);
  }
}
