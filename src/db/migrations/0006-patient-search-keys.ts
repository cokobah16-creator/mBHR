import { db, patientKeyChanges } from "../index";
import { log } from "@/lib/logger";
import type { Migration } from "./types";

/**
 * Patients registered, edited or downloaded before the patients table kept
 * its duplicate-check keys up to date may lack phoneN, nameKey and dobDay,
 * or carry stale ones. Recompute them on every row so the duplicate check
 * and the admin duplicate scan can find those records. The keys stay on
 * this device: nothing is marked for upload.
 */
export const migration0006: Migration = {
  version: 6,
  name: "patient-search-keys",

  async up() {
    let changed = 0;
    await db.patients.toCollection().modify((patient) => {
      const row = patient as unknown as Record<string, unknown>;
      const changes = patientKeyChanges({}, row);
      if (Object.keys(changes).length > 0) {
        Object.assign(row, changes);
        changed += 1;
      }
    });
    log(`Patient search keys: updated ${changed} record(s)`);
  },
};
