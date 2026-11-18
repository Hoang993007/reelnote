import { config } from '../config.js';
import { sqlite } from '../db/client.js';
import { ValidationError } from '../lib/errors.js';
import { settingsService } from '../settings/settings-service.js';

const SHARED_KEY_SETTING = 'gemini_api_key_shared';
/** What a Gemini API key looks like; anything else is a paste mistake. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

/** The key a lookup uses, and whether it is the user's own (own keys get looser app limits). */
export type LookupKey = { key: string; own: boolean };

/** What the account dialog shows: never a key, only its last four characters. */
export type LookupKeyStatus = {
  own: string | null;
  shared: { set: boolean; last4: string | null; from: 'app' | 'env' | null };
};

const last4 = (key: string) => key.slice(-4);

function normalized(key: string | null): string | null {
  const value = key?.trim() ?? '';
  if (!value) return null;
  if (!KEY_PATTERN.test(value)) throw new ValidationError('That does not look like a Gemini API key');
  return value;
}

function sharedKey(): { key: string; from: 'app' | 'env' } | null {
  const inApp = settingsService.get(SHARED_KEY_SETTING);
  if (inApp) return { key: inApp, from: 'app' };
  return config.geminiApiKey ? { key: config.geminiApiKey, from: 'env' } : null;
}

function ownKey(userId: number): string | null {
  const row = sqlite.prepare('SELECT gemini_api_key AS key FROM users WHERE id = ?').get(userId) as { key: string | null } | undefined;
  return row?.key ?? null;
}

export const lookupKeyService = {
  /** The user's own key, else the owner's shared key, else the one in the environment; null = lookup off. */
  keyFor(userId: number): LookupKey | null {
    const own = ownKey(userId);
    if (own) return { key: own, own: true };
    const shared = sharedKey();
    return shared ? { key: shared.key, own: false } : null;
  },

  /** `isOwner` also shows the shared key's last four characters. */
  status(userId: number, isOwner: boolean): LookupKeyStatus {
    const own = ownKey(userId);
    const shared = sharedKey();
    return {
      own: own ? last4(own) : null,
      shared: { set: !!shared, last4: shared && isOwner ? last4(shared.key) : null, from: shared?.from ?? null },
    };
  },

  /** Sets or (null, empty) clears the user's own key. */
  setOwn(userId: number, key: string | null): void {
    sqlite.prepare('UPDATE users SET gemini_api_key = ? WHERE id = ?').run(normalized(key), userId);
  },

  /** Sets or clears the shared key (the owner's; the route checks). Cleared falls back to the environment's. */
  setShared(key: string | null): void {
    const value = normalized(key);
    if (value) settingsService.set(SHARED_KEY_SETTING, value);
    else sqlite.prepare('DELETE FROM settings WHERE key = ?').run(SHARED_KEY_SETTING);
  },
};
