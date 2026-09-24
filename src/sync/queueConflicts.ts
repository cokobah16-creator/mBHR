// Put sync conflicts found by the sync adapter into the shared review queue
// (Admin > Sync conflicts), so they are seen even when nobody resolves them
// on the device that found them.

import type { ConflictData } from "@/components/ConflictResolutionModal";
import type { Role } from "@/auth/roles";
import { conflictQueueService } from "@/services/conflictQueue";
import { getFieldPHISensitivity } from "@/features/conflicts/sensitivity";
import logger from "@/lib/logger";
import { syncErrorCode } from "./errorCode";

export interface QueueConflictsOutcome {
  /** New entries created in the review queue. */
  queued: number;
  /** Records that already had an open sync conflict in the queue. */
  alreadyQueued: number;
  /** Not queued: no cloud sign-in, cloud sync not set up, or the request failed. */
  notQueued: number;
}

/**
 * A record in conflict stays unsent on this device and is found again on
 * every sync until someone resolves it, so records that already have an
 * open sync conflict are not queued twice.
 */
export async function queueSyncConflicts(
  conflicts: ConflictData[],
  reporter?: { id: string; role: Role },
): Promise<QueueConflictsOutcome> {
  const outcome: QueueConflictsOutcome = { queued: 0, alreadyQueued: 0, notQueued: 0 };
  if (conflicts.length === 0) return outcome;

  // Conflict tables need a signed-in cloud session; without one the insert
  // is refused, so do not try.
  if (!conflictQueueService.isAvailable() || !(await conflictQueueService.hasCloudSession())) {
    outcome.notQueued = conflicts.length;
    return outcome;
  }

  for (const conflict of conflicts) {
    try {
      if (await conflictQueueService.hasOpenConflict(conflict.entityId, "sync_conflict")) {
        outcome.alreadyQueued += 1;
        continue;
      }
      const id = await conflictQueueService.createConflict({
        conflictType: "sync_conflict",
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        conflictDetails: {
          fields: conflict.conflicts.map((c) => ({
            ...c,
            phiSensitivity: getFieldPHISensitivity(c.field),
          })),
          localTimestamp: conflict.localTimestamp,
          remoteTimestamp: conflict.remoteTimestamp,
        },
        reportedBy: reporter?.id,
        reporterRole: reporter?.role,
      });
      if (id) outcome.queued += 1;
      else outcome.notQueued += 1;
    } catch (error) {
      logger.warn(
        `[sync] could not queue a conflict for ${conflict.entityType}`,
        syncErrorCode(error),
      );
      outcome.notQueued += 1;
    }
  }
  return outcome;
}
