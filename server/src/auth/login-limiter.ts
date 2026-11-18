/**
 * Sign-in throttling, keyed on the account (email), never on the client IP: behind Tailscale Serve
 * every request comes from 127.0.0.1. In memory: a restart clears it, which an attacker cannot cause.
 */
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
/** All sign-in attempts together, per minute: caps spraying many emails. */
export const GLOBAL_ATTEMPTS_PER_MINUTE = 30;

interface Failures {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

export function createLoginLimiter(now: () => number = Date.now) {
  const failures = new Map<string, Failures>();
  let windowStart = 0;
  let attemptsInWindow = 0;

  return {
    /** Ms to wait before trying again (0 = allowed). Counts the attempt toward the global cap. */
    check(email: string): number {
      const t = now();
      if (t - windowStart >= 60_000) {
        windowStart = t;
        attemptsInWindow = 0;
      }
      if (++attemptsInWindow > GLOBAL_ATTEMPTS_PER_MINUTE) return windowStart + 60_000 - t;
      const entry = failures.get(email);
      return entry && entry.lockedUntil > t ? entry.lockedUntil - t : 0;
    },

    recordFailure(email: string): void {
      const t = now();
      const entry = failures.get(email);
      if (!entry || t - entry.firstAt > FAILURE_WINDOW_MS) {
        failures.set(email, { count: 1, firstAt: t, lockedUntil: 0 });
        return;
      }
      entry.count += 1;
      if (entry.count >= MAX_FAILURES) entry.lockedUntil = t + LOCK_MS;
    },

    recordSuccess(email: string): void {
      failures.delete(email);
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
