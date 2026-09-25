import { db, type User } from "./index";

/**
 * Two separate ideas about a staff member on this device:
 *
 * - known to the device: their record is in the local staff list (synced
 *   down from the server's staff directory, or created on this device);
 * - offline access on the device: they have enrolled a PIN here.
 *
 * The PIN (pinHash, pinSalt, pinEnrolledAt) is a device credential only. It
 * is never uploaded (the staff upload map in src/sync/adapter.ts has no PIN
 * columns) and never downloaded, so it only works in this browser on this
 * web address.
 */
export function hasDevicePin(
  user: Pick<User, "pinHash" | "pinSalt"> | null | undefined,
): boolean {
  return !!user?.pinHash && !!user?.pinSalt;
}

/** What the login page can offer on this device. */
export type OfflineSignInState =
  /** No staff data at all: the device has never been set up. */
  | { kind: "not-set-up" }
  /** Staff are known here, but nobody has enrolled a PIN yet. */
  | { kind: "no-pins"; knownStaff: number }
  /** At least one active person can sign in offline. */
  | { kind: "ready"; accounts: User[] };

/** Active staff with a PIN on this device, for the "Who's signing in?" list. */
export async function offlineSignInState(): Promise<OfflineSignInState> {
  const all = await db.users.toArray();
  if (all.length === 0) return { kind: "not-set-up" };

  const active = all.filter((u) => u.isActive === 1);
  const accounts = active
    .filter((u) => hasDevicePin(u))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  if (accounts.length === 0) {
    return { kind: "no-pins", knownStaff: active.length };
  }
  return { kind: "ready", accounts };
}

/** This device's current copy of one staff record (PIN state included). */
export async function deviceAccount(userId: string): Promise<User | undefined> {
  return db.users.get(userId);
}
