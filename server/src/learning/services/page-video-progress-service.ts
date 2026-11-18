import { eq } from 'drizzle-orm';
import { db, sqlite } from '../../db/client.js';
import { pageVideos } from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';

/** Watched once the furthest point reaches this share of the duration. */
export const WATCHED_SHARE = 0.9;

export type VideoProgressInput = {
  positionSec: number;
  durationSec?: number;
  /** The client's own judgement; the server also marks watched from the furthest point. */
  completed: boolean;
  /** Client clock (ms); a write older than the last accepted one is ignored. */
  clientTs: number;
};

export const pageVideoProgressService = {
  /**
   * The user's playback of one video. Last writer by client clock wins for the position; the furthest point
   * only grows, and `completed` (watched: furthest at 90% of the duration) is sticky.
   * `applied: false` when a newer write is stored. The duration is the file's, shared by all users.
   */
  saveProgress(id: number, userId: number, input: VideoProgressInput): { applied: boolean; completed: boolean; furthestSec: number } {
    return sqlite.transaction(() => {
      const video = db.select({ durationSec: pageVideos.durationSec }).from(pageVideos).where(eq(pageVideos.id, id)).get();
      if (!video) throw new NotFoundError('Page video', id);
      if (input.durationSec !== undefined) {
        db.update(pageVideos).set({ durationSec: input.durationSec }).where(eq(pageVideos.id, id)).run();
      }
      const duration = input.durationSec ?? video.durationSec;
      const { changes } = sqlite.prepare(`
        INSERT INTO video_progress (page_video_id, user_id, last_position_sec, furthest_sec, completed, last_watched_at, playback_client_ts)
        VALUES (@id, @userId, @positionSec, @positionSec, @completed, @now, @clientTs)
        ON CONFLICT (page_video_id, user_id) DO UPDATE SET
          last_position_sec = excluded.last_position_sec,
          furthest_sec = MAX(furthest_sec, excluded.furthest_sec),
          completed = MAX(completed, excluded.completed),
          last_watched_at = excluded.last_watched_at,
          playback_client_ts = excluded.playback_client_ts
        WHERE playback_client_ts <= excluded.playback_client_ts
      `).run({
        id, userId, positionSec: input.positionSec, completed: input.completed ? 1 : 0,
        now: new Date().toISOString(), clientTs: input.clientTs,
      });
      if (duration) {
        sqlite.prepare('UPDATE video_progress SET completed = 1 WHERE page_video_id = ? AND user_id = ? AND furthest_sec >= ?')
          .run(id, userId, WATCHED_SHARE * duration);
      }
      const row = sqlite.prepare('SELECT completed, furthest_sec AS furthestSec FROM video_progress WHERE page_video_id = ? AND user_id = ?')
        .get(id, userId) as { completed: number; furthestSec: number };
      return { applied: changes > 0, completed: row.completed === 1, furthestSec: row.furthestSec };
    })();
  },
};
