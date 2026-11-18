import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

/** scrypt cost; stored in each hash, so raising it later keeps old hashes verifiable. */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scrypt(password: string, salt: Buffer, options: { N: number; r: number; p: number }): Promise<Buffer> {
  const scryptOptions: ScryptOptions = { ...options, maxmem: 256 * options.N * options.r };
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, KEY_LENGTH, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Why a new password is refused, or null when it is acceptable. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

/** `scrypt$N$r$p$<salt base64>$<key base64>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger)) return false;
  const expected = Buffer.from(parts[5], 'base64');
  const actual = await scrypt(password, Buffer.from(parts[4], 'base64'), { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash no password matches; verifying against it costs what a real check does (unknown emails). */
let dummyHash: Promise<string> | null = null;
export function timingDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64'));
  return dummyHash;
}
