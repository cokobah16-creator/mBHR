// Idle lock for staff sessions on shared tablets.

/**
 * A signed-in staff session locks after this long without a touch, click or
 * key press (src/components/IdleLock.tsx). The same person unlocks it with
 * their device PIN; anyone else signs out. An online sign-in left at the
 * "Choose a PIN" step is ended after the same time.
 */
export const STAFF_IDLE_LOCK_MS = 10 * 60 * 1000; // 10 minutes

/**
 * How often an idle deadline is checked. Timers stop while a tablet sleeps,
 * so screens also check when the page becomes visible again.
 */
export const IDLE_CHECK_MS = 15_000;

/**
 * True when a session last used at `lastActivityAt` has been idle for
 * STAFF_IDLE_LOCK_MS by `now`. No recorded activity counts as idle, and so
 * does a time far in the future (a device clock that was wrong), so a lock
 * is never skipped for want of a usable time.
 */
export function isIdleExpired(
  lastActivityAt: number | null | undefined,
  now: number,
): boolean {
  if (typeof lastActivityAt !== "number" || !Number.isFinite(lastActivityAt)) {
    return true;
  }
  const idleFor = now - lastActivityAt;
  return idleFor >= STAFF_IDLE_LOCK_MS || idleFor < -STAFF_IDLE_LOCK_MS;
}
