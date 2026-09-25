import Dexie from "dexie";
import { db, DB_NAME } from "./index";
import { APP_DATABASES } from "./appDatabases";
import { wipeDevice } from "./deviceReset";
import { verifyPin } from "@/utils/pin";

/** Dexie's names for a stored database that could not be upgraded. */
const UPGRADE_FAILURES = new Set(["UpgradeError", "SchemaError"]);

/** Command states still waiting for the server (src/sync/commandOutbox.ts). */
const OPEN_COMMAND_STATUSES = new Set(["pending", "waiting_permission"]);

/** Command outboxes: the main database's and the pharmacy one (src/db/mbhr.ts). */
const COMMAND_TABLES = new Set(["serverCommands", "rx_commands"]);

function errorNames(e: unknown): string[] {
  const names: string[] = [];
  if (e && typeof e === "object") {
    const { name, inner } = e as { name?: unknown; inner?: { name?: unknown } };
    if (typeof name === "string") names.push(name);
    // Dexie can wrap the reason (OpenFailedError with the cause in inner).
    if (inner && typeof inner.name === "string") names.push(inner.name);
  }
  return names;
}

/**
 * Start-up could not open the local database. The database is left exactly
 * as it was: it can hold records that have not been synced yet.
 */
export class LocalDatabaseOpenError extends Error {
  /** The stored database could not be upgraded to this version of the app. */
  readonly upgradeFailed: boolean;

  constructor(cause: unknown) {
    super("The local database could not be opened");
    this.name = "LocalDatabaseOpenError";
    this.upgradeFailed = errorNames(cause).some((n) => UPGRADE_FAILURES.has(n));
  }
}

/**
 * Opens the local database. It is never deleted here, whatever goes wrong:
 * a failed upgrade used to erase it silently, losing every unsynced record.
 * Any failure throws LocalDatabaseOpenError, and start-up shows a recovery
 * screen (src/components/DatabaseRecovery.tsx) where the person can try
 * again, and an administrator can choose to erase the device after being
 * told how many unsynced records that loses.
 */
export async function safeOpenDb(): Promise<void> {
  try {
    await db.open();
  } catch (e) {
    throw new LocalDatabaseOpenError(e);
  }
}

/**
 * True for a stored row that has not reached the server yet: waiting to
 * upload, a command the server has not answered, or pharmacy stock and
 * records kept only on this device (localOnly, src/db/mbhr.ts). Pending
 * stock movements, dispenses and medicine registrations are not counted
 * again: each is carried by an open rx_commands row.
 */
export function isUnsyncedRow(tableName: string, row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as { _dirty?: unknown; localOnly?: unknown; status?: unknown };
  if (r._dirty === 1 || r.localOnly === 1) return true;
  return COMMAND_TABLES.has(tableName) && OPEN_COMMAND_STATUSES.has(String(r.status));
}

/**
 * Runs `read` on a database as it is stored on this device, opened without
 * upgrading it (Dexie's dynamic mode), then closes it. null when it cannot
 * be read; `ifMissing` when it was never created here. Never throws.
 */
async function readStoredDatabase<T>(
  name: string,
  read: (stored: Dexie) => Promise<T>,
  ifMissing: T | null = null,
): Promise<T | null> {
  const stored = new Dexie(name);
  try {
    await stored.open();
    return await read(stored);
  } catch (e) {
    const names = errorNames(e);
    if (names.includes("NoSuchDatabaseError")) return ifMissing;
    console.warn("[db] could not read a stored database:", names[0] ?? "unknown");
    return null;
  } finally {
    stored.close();
  }
}

/**
 * How many records on this device have not been synced, read from every
 * database the erase deletes (APP_DATABASES), not only the one that failed
 * to open. null when any of them cannot be read: callers must then assume
 * some records are unsynced.
 */
export async function countStoredUnsyncedRecords(): Promise<number | null> {
  let total = 0;
  for (const { name } of APP_DATABASES) {
    const count = await readStoredDatabase(
      name,
      async (stored) => {
        let unsynced = 0;
        for (const table of stored.tables) {
          unsynced += await table.filter((row) => isUnsyncedRow(table.name, row)).count();
        }
        return unsynced;
      },
      0,
    );
    if (count === null) return null;
    total += count;
  }
  return total;
}

/**
 * Whether this is an active administrator's PIN on this device (the rule of
 * findAdminByPin in src/db/deviceReset.ts), checked in the stored database.
 * null when the stored staff list cannot be read.
 */
export async function storedAdminPinMatches(pin: string): Promise<boolean | null> {
  if (!/^\d{6}$/.test(pin)) return false;
  return readStoredDatabase(DB_NAME, async (stored) => {
    const admins = await stored
      .table("users")
      .filter((u) => u?.isActive === 1 && u?.role === "admin")
      .toArray();
    for (const admin of admins) {
      if (!admin.pinHash || !admin.pinSalt) continue;
      if (await verifyPin(pin, admin.pinHash, admin.pinSalt)) return true;
    }
    return false;
  });
}

/**
 * Erases this device's local data after a failed start-up. Only for the
 * recovery screen, once an administrator's PIN was checked with
 * storedAdminPinMatches and they confirmed the loss of unsynced records.
 */
export async function eraseLocalDatabase(): Promise<void> {
  await wipeDevice();
}
