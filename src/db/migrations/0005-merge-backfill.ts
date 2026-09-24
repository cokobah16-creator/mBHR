import { db } from "../index";
import { log } from "@/lib/logger";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { enqueueCommand, type CommandStore } from "@/sync/commandOutbox";
import type { Migration } from "./types";
import { planMergeBackfill } from "./backfillPlans";

const CHUNK = 100;

/**
 * Patient merges are now applied by the server. Merges made on this device
 * before that (recorded in patientMerges with no command) are queued as
 * merge commands, sent later by any signed-in staff member allowed to merge
 * patients. The merged-away record is marked pending so a download keeps its
 * local merge link until the server answers. Devices without cloud sync keep
 * their local merges as they are.
 */
export const migration0005: Migration = {
  version: 5,
  name: "merge-backfill",

  async up() {
    if (!isSupabaseEnabled) {
      log("Merge backfill skipped: cloud sync is not set up on this device");
      return;
    }
    const merges = await db.patientMerges.toArray();
    const plans = planMergeBackfill(merges);
    const store = db.serverCommands as unknown as CommandStore;

    for (let i = 0; i < plans.length; i += CHUNK) {
      const chunk = plans.slice(i, i + CHUNK);
      await db.transaction(
        "rw",
        db.patients,
        db.patientMerges,
        db.serverCommands,
        async () => {
          for (const plan of chunk) {
            await enqueueCommand(store, plan.command);
            const requestedAt = plan.command.args.p_requested_at;
            await db.patientMerges.update(plan.mergeId, {
              commandId: plan.command.id,
              status: "pending",
              requestedAt: typeof requestedAt === "string" ? requestedAt : undefined,
            });
            const loser = await db.patients.get(plan.loserId);
            if (loser?.mergeInto) {
              await db.patients.update(plan.loserId, { mergePending: 1 });
            }
          }
        },
      );
    }
    log(`Merge backfill: queued ${plans.length} merge(s) for the server`);
  },
};
