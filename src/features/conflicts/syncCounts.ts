// Counts of unsynced rows in tables that only the enhanced sync engine
// (services/enhancedSync, the dashboard's "Sync now") uploads. The shared
// sync adapter's own tables (patients and queue included) are counted by
// countUnsyncedRecords(), which also counts queued server commands.

import { db } from "@/db";

/** Keep in step with the dirty-flag tables in services/enhancedSync. */
export const ENHANCED_ONLY_TABLES = [
  "gameSessions",
  "gamificationWallets",
  "stockBatches",
  "careTasks",
  "triageRecords",
];

interface DirtyCountable {
  where(index: string): {
    equals(value: number): {
      count(): Promise<number>;
      filter?(fn: (row: Record<string, unknown>) => boolean): { count(): Promise<number> };
    };
  };
}

function tableNamed(name: string): DirtyCountable | undefined {
  const table = (db as unknown as Record<string, unknown>)[name] as
    | DirtyCountable
    | undefined;
  return table && typeof table.where === "function" ? table : undefined;
}

/** Rows with _dirty = 1 across the named tables. Safe inside a liveQuery. */
export async function countDirtyIn(tables: string[]): Promise<number> {
  let total = 0;
  for (const name of tables) {
    const table = tableNamed(name);
    if (!table) continue;
    try {
      total += await table.where("_dirty").equals(1).count();
    } catch {
      // Table without a _dirty index: nothing of it is queued for upload.
    }
  }
  return total;
}

/** The server refused this unsent row for permission (see SyncBlock in @/db). */
export function isBlockedForPermission(row: Record<string, unknown>): boolean {
  const block = row._syncBlock as { reason?: unknown } | undefined;
  return !!block && block.reason === "permission";
}

/**
 * Unsent rows (across the named tables) that the server refused for the
 * person signed in online: "waiting for an authorised person to sync".
 * These are also included in countDirtyIn. Safe inside a liveQuery.
 */
export async function countBlockedIn(tables: string[]): Promise<number> {
  let total = 0;
  for (const name of tables) {
    const table = tableNamed(name);
    if (!table) continue;
    try {
      const unsent = table.where("_dirty").equals(1);
      if (typeof unsent.filter !== "function") continue;
      total += await unsent.filter(isBlockedForPermission).count();
    } catch {
      // Table without a _dirty index: nothing of it is queued for upload.
    }
  }
  return total;
}
