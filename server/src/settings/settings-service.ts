import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { settings } from '../db/schema.js';

/** Key/value settings stored in the `settings` table. */
export const settingsService = {
  get(key: string): string | undefined {
    return db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value;
  },

  set(key: string, value: string): void {
    db.insert(settings).values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  },
};
