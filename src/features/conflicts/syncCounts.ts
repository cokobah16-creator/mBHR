// Counts of unsynced rows in tables that only the enhanced sync engine
// (services/enhancedSync, the dashboard's "Sync now") uploads. The shared
// sync adapter's own tables are counted by countUnsyncedRecords().

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
  where(index: string): { equals(value: number): { count(): Promise<number> } };
}

/** Rows with _dirty = 1 across the named tables. Safe inside a liveQuery. */
export async function countDirtyIn(tables: string[]): Promise<number> {
  let total = 0;
  for (const name of tables) {
    const table = (db as unknown as Record<string, unknown>)[name] as
      | DirtyCountable
      | undefined;
    if (!table || typeof table.where !== "function") continue;
    try {
      total += await table.where("_dirty").equals(1).count();
    } catch {
      // Table without a _dirty index: nothing of it is queued for upload.
    }
  }
  return total;
}
