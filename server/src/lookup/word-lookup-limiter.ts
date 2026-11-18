/**
 * Caps the lookups sent to the model (stored answers are free). On the shared key: per user, so one account cannot
 * spend the free quota for everyone, and in all, under the provider's free-tier rate. On a user's own key the
 * quota is theirs: only a loose per-user cap against a runaway client. In memory, like the sign-in limiter.
 */
export const LIMITS = {
  perUserPer10Min: 30,
  perUserPerDay: 300,
  allPerMinute: 8,
  ownKeyPer10Min: 100,
} as const;

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;
const DAY = 24 * 60 * MINUTE;

export function createWordLookupLimiter(now: () => number = Date.now) {
  const byUser = new Map<number, number[]>();
  let all: number[] = [];

  return {
    /** Ms to wait before this user may send another lookup (0 = allowed); an allowed one is counted. */
    take(userId: number, ownKey = false): number {
      const t = now();
      all = all.filter(at => t - at < MINUTE);
      const mine = (byUser.get(userId) ?? []).filter(at => t - at < DAY);
      byUser.set(userId, mine);
      const recent = mine.filter(at => t - at < TEN_MINUTES);
      if (ownKey) {
        if (recent.length >= LIMITS.ownKeyPer10Min) return recent[0] + TEN_MINUTES - t;
        mine.push(t);
        return 0;
      }
      if (mine.length >= LIMITS.perUserPerDay) return mine[0] + DAY - t;
      if (recent.length >= LIMITS.perUserPer10Min) return recent[0] + TEN_MINUTES - t;
      if (all.length >= LIMITS.allPerMinute) return all[0] + MINUTE - t;
      mine.push(t);
      all.push(t);
      return 0;
    },
  };
}

export type WordLookupLimiter = ReturnType<typeof createWordLookupLimiter>;
