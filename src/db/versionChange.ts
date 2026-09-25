import type Dexie from "dexie";
import { useAppUpdateStore } from "@/stores/appUpdate";

/**
 * A window that opens a newer version of the app upgrades the local
 * databases, and a device reset deletes them. Either has to wait until every
 * other window has closed its connection. This closes ours at once, so the
 * other window is not held up, and flags it (AppUpdateBanner): this window's
 * code no longer matches the database, so it cannot save until it reloads.
 */
export function closeOnVersionChange(databases: readonly Dexie[]): void {
  for (const database of databases) {
    database.on("versionchange", (event) => {
      database.close();
      useAppUpdateStore
        .getState()
        .setDatabaseClosed(event.newVersion ? "upgraded" : "erased");
    });
  }
}
