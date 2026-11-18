import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/**
 * Reads a password from the terminal without echoing it. Passwords never come from argv or the
 * environment, where shell history and process listings would keep them.
 */
export function promptPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('A password prompt needs an interactive terminal.');
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

/** Asks twice; throws when the two do not match. */
export async function promptNewPassword(): Promise<string> {
  const first = await promptPassword('New password: ');
  const second = await promptPassword('Repeat it: ');
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}
