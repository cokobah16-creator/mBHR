import { db } from "../index";
import { log } from "@/lib/logger";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { enqueueCommand, type CommandStore } from "@/sync/commandOutbox";
import type { Migration } from "./types";
import { PORTAL_ACCESS_RPC, planPortalAccessBackfill } from "./backfillPlans";

const CHUNK = 200;

/**
 * Portal access is now decided by the server. Patients this device already
 * shows as portal-enabled get an "enable" command queued (sent later by any
 * signed-in staff member allowed to manage portal access) and are marked
 * pending, so a download does not switch them off before the server has
 * recorded the decision. Devices without cloud sync keep their local value:
 * there is no server to ask.
 */
export const migration0004: Migration = {
  version: 4,
  name: "portal-access-backfill",

  async up() {
    if (!isSupabaseEnabled) {
      log("Portal access backfill skipped: cloud sync is not set up on this device");
      return;
    }
    const patients = await db.patients
      .filter((p) => p.portalEnabled === 1 && !p.mergeInto)
      .toArray();
    const queued = await db.serverCommands.where("rpc").equals(PORTAL_ACCESS_RPC).toArray();
    const plans = planPortalAccessBackfill(patients, queued);
    const store = db.serverCommands as unknown as CommandStore;

    for (let i = 0; i < plans.length; i += CHUNK) {
      const chunk = plans.slice(i, i + CHUNK);
      await db.transaction("rw", db.patients, db.serverCommands, async () => {
        for (const plan of chunk) {
          await enqueueCommand(store, plan.command);
          await db.patients.update(plan.patientId, { portalPending: 1 });
        }
      });
    }
    log(`Portal access backfill: queued ${plans.length} confirmation(s) for the server`);
  },
};
