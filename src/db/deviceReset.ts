import { db, type User } from "./index";
import { APP_DATABASES } from "./appDatabases";
import { verifyPin } from "@/utils/pin";
import { clearApiCaches } from "@/services/clearApiCaches";

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
 * Deletes a database this version of the app does not open (an earlier
 * version's, or a library's) by name. Resolves once it is gone, or once the
 * browser has queued the deletion behind a connection that is still open
 * elsewhere: it then completes as soon as that connection closes.
 */
function deleteDatabaseByName(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** The origin's other IndexedDB databases, where the browser can list them. */
async function otherDatabaseNames(): Promise<string[]> {
  if (
    typeof indexedDB === "undefined" ||
    typeof indexedDB.databases !== "function"
  ) {
    return [];
  }
  const own = new Set(APP_DATABASES.map((database) => database.name));
  const listed = await indexedDB.databases();
  return listed
    .map((info) => info.name)
    .filter((name): name is string => !!name && !own.has(name));
}

/**
 * Deletes everything this app stores on the device — every local database
 * (patients and visits, pharmacy records, the message and command outboxes,
 * and any left by earlier versions), cached server answers and the persisted
 * session — so the next load starts at first-run setup. The app's own files
 * stay cached, so it still starts offline.
 * Callers must have approved the reset with findAdminByPin() first.
 */
export async function wipeDevice(): Promise<void> {
  // Leftovers first: if one cannot be deleted, the reset fails while the
  // main database, and with it the administrator's PIN, is still there to
  // try again.
  await Promise.all((await otherDatabaseNames()).map(deleteDatabaseByName));
  await clearApiCaches();
  // Dexie keeps the connection open; delete() closes it before dropping the
  // database so the call does not block on our own handle.
  await Promise.all(APP_DATABASES.map((database) => database.delete()));
  localStorage.clear();
  sessionStorage.clear();
}
