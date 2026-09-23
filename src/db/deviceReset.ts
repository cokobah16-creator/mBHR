import { db, type User } from "./index";
import { verifyPin } from "@/utils/pin";

/**
 * Finds the active administrator whose PIN this is, or null.
 *
 * Wiping a device destroys every unsynced record on it, so it needs the same
 * authority as managing staff: only the "admin" role grants the `users`
 * permission (src/auth/roles.ts). Accounts created by online sign-in have no
 * PIN and so can never approve a reset this way.
 */
export async function findAdminByPin(pin: string): Promise<User | null> {
  if (!/^\d{6}$/.test(pin)) return null;

  const admins = await db.users
    .where("isActive")
    .equals(1)
    .filter((user) => user.role === "admin")
    .toArray();

  for (const admin of admins) {
    if (!admin.pinHash || !admin.pinSalt) continue;
    if (await verifyPin(pin, admin.pinHash, admin.pinSalt)) return admin;
  }
  return null;
}

/**
 * Deletes everything this app stores on the device — the local database and
 * the persisted session — so the next load starts at first-run setup.
 * Callers must have approved the reset with findAdminByPin() first.
 */
export async function wipeDevice(): Promise<void> {
  // Dexie keeps the connection open; delete() closes it before dropping the
  // database so the call does not block on our own handle.
  await db.delete();
  localStorage.clear();
  sessionStorage.clear();
}
