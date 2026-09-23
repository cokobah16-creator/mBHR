/**
 * Portal Background Sync Worker
 *
 * Handles queued portal invitations in the device outbox and syncs portal
 * activity between the local DB and Supabase.
 *
 * Honesty rules: the device outbox is shared with medication and appointment
 * reminders, so this worker only touches portal invitations. It has no SMS or
 * email provider of its own and never marks a message sent: an invitation
 * with stored text is left for the notification worker (which sends it
 * through the server), and any other invitation is recorded as not sent.
 */

import { db } from "@/db";
import { supabase } from "@/lib/supabase";
import { MessageQueue, type OutboundMessage } from "@/db/outbox";
import * as logger from "@/lib/logger";
import { getErrorMessage } from "@/utils/errors";
import { isWorkerSendable } from "@/features/notifications/smsOutbox";
import {
  PORTAL_PROVIDER_NOT_CONFIGURED_ERROR,
  isPortalInvitationMessage,
} from "./portalInvitationQueue";
import { safeErrorLabel } from "./logSafe";

let isProcessing = false;
let syncIntervalId: number | null = null;

/**
 * Portal invitations this worker must handle: due, queued, and not ones the
 * notification worker can send itself.
 */
function isForThisWorker(message: OutboundMessage): boolean {
  return isPortalInvitationMessage(message) && !isWorkerSendable(message);
}

/**
 * Process queued portal invitations from the device outbox.
 * `succeeded` counts invitations that were really sent; this worker has no
 * provider, so it stays 0 until one is wired in here.
 */
export async function processPortalInvitationQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  if (isProcessing) {
    logger.info("Portal sync already in progress, skipping...");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  isProcessing = true;
  let processed = 0;
  const succeeded = 0;
  let failed = 0;

  try {
    // Only portal invitations: reminders in the same outbox belong to the
    // notification worker and must not be touched here.
    const pendingMessages = await MessageQueue.getPendingMessages(
      20,
      isForThisWorker,
    );

    for (const message of pendingMessages) {
      try {
        processed++;

        // No SMS/email provider is wired up in this worker (in development
        // or production). Record the attempt as not sent; the message is
        // retried and ends as failed after the maximum attempts. It is never
        // marked sent without a real send.
        const status = await MessageQueue.markFailed(
          message.id,
          PORTAL_PROVIDER_NOT_CONFIGURED_ERROR,
        );
        failed++;

        // Once it has given up, the patient's invitation must not keep
        // showing "queued".
        if (status === "failed") {
          await db.patients
            .where("id")
            .equals(message.patientId)
            .modify((patient) => {
              if (patient.portalInvitation?.lastStatus === "queued") {
                patient.portalInvitation.lastStatus = "failed";
                patient.portalInvitation.failureReason =
                  PORTAL_PROVIDER_NOT_CONFIGURED_ERROR;
                patient._dirty = 1;
              }
            })
            .catch((error: unknown) =>
              logger.error(
                "Could not record a failed portal invitation:",
                safeErrorLabel(error),
              ),
            );
        }
      } catch (error: unknown) {
        failed++;
        logger.error(
          "Failed to process a portal invitation:",
          safeErrorLabel(error),
        );
        await MessageQueue.markFailed(message.id, getErrorMessage(error));

        // Update patient invitation status
        await db.patients
          .where("id")
          .equals(message.patientId)
          .modify((patient) => {
            if (patient.portalInvitation) {
              patient.portalInvitation.lastStatus = "failed";
              patient.portalInvitation.failureReason = getErrorMessage(error);
              patient._dirty = 1;
            }
          });
      }
    }

    if (processed > 0) {
      logger.warn(
        `[portal-sync] No SMS/Email provider configured: ${failed} portal invitation(s) not sent (retried, then marked failed)`,
      );
    }
  } catch (error) {
    logger.error(
      "Error processing portal invitation queue:",
      safeErrorLabel(error),
    );
  } finally {
    isProcessing = false;
  }

  return { processed, succeeded, failed };
}

/**
 * Sync portal activity from Supabase to local DB
 * Updates lastPortalActivity and contactVerified status
 */
export async function syncPortalActivityFromSupabase(): Promise<{
  synced: number;
  errors: number;
}> {
  let synced = 0;
  let errors = 0;

  try {
    // Check if online
    if (!navigator.onLine) {
      logger.info("Offline, skipping portal activity sync");
      return { synced: 0, errors: 0 };
    }

    // No server connection in this build: there is nothing to sync from.
    if (!supabase) {
      return { synced: 0, errors: 0 };
    }

    // Get all patients with portal enabled
    const patientsWithPortal = await db.patients
      .where("portalEnabled")
      .equals(1)
      .toArray();

    if (patientsWithPortal.length === 0) {
      return { synced: 0, errors: 0 };
    }

    // Query Supabase for portal activity updates
    const patientIds = patientsWithPortal.map((p) => p.id);

    try {
      const { data: supabasePatients, error } = await supabase
        .from("patients")
        .select("id, auth_uid, contact_verified, last_portal_activity")
        .in("id", patientIds);

      if (error) {
        logger.error(
          "Error fetching portal activity from Supabase:",
          safeErrorLabel(error),
        );
        return { synced: 0, errors: patientIds.length };
      }

      // Update local records with Supabase data
      const localById = new Map(patientsWithPortal.map((p) => [p.id, p]));
      for (const supabasePatient of supabasePatients || []) {
        try {
          const localPatient = localById.get(supabasePatient.id);
          if (!localPatient) continue;

          // Check if there are updates
          const hasUpdates =
            supabasePatient.auth_uid !== localPatient.authUid ||
            (supabasePatient.contact_verified &&
              localPatient.contactVerified === 0) ||
            (supabasePatient.last_portal_activity &&
              supabasePatient.last_portal_activity !==
                localPatient.lastPortalActivity);

          if (hasUpdates) {
            await db.patients.update(supabasePatient.id, {
              authUid: supabasePatient.auth_uid || undefined,
              contactVerified: supabasePatient.contact_verified ? 1 : 0,
              lastPortalActivity:
                supabasePatient.last_portal_activity || undefined,
              updatedAt: new Date(),
            });

            synced++;
          }
        } catch (error) {
          errors++;
          logger.error(
            "Error syncing portal activity for a patient:",
            safeErrorLabel(error),
          );
        }
      }

      if (synced > 0) {
        logger.info(
          `Portal activity sync complete: ${synced} patients updated`,
        );
      }
    } catch (error) {
      logger.error("Error in Supabase query:", safeErrorLabel(error));
      errors = patientIds.length;
    }
  } catch (error) {
    logger.error("Error syncing portal activity:", safeErrorLabel(error));
  }

  return { synced, errors };
}

/**
 * Run full portal sync cycle
 * 1. Process invitation queue
 * 2. Sync activity from Supabase
 */
export async function runPortalSync(): Promise<void> {
  logger.info("Starting portal sync cycle...");

  const queueResult = await processPortalInvitationQueue();
  const activityResult = await syncPortalActivityFromSupabase();

  logger.info("Portal sync cycle complete:", {
    invitations: queueResult,
    activity: activityResult,
  });
}

/**
 * Start automatic background sync
 * Runs every 30 seconds while app is active
 */
export function startPortalSyncWorker(intervalSeconds: number = 30): void {
  if (syncIntervalId !== null) {
    logger.warn("Portal sync worker already running");
    return;
  }

  logger.info(`Starting portal sync worker (every ${intervalSeconds}s)`);

  // Run initial sync
  runPortalSync().catch((e) =>
    logger.error("Portal sync failed:", safeErrorLabel(e)),
  );

  // Set up periodic sync
  syncIntervalId = window.setInterval(() => {
    if (navigator.onLine) {
      runPortalSync().catch((e) =>
        logger.error("Portal sync failed:", safeErrorLabel(e)),
      );
    } else {
      logger.info("Offline, skipping scheduled portal sync");
    }
  }, intervalSeconds * 1000);

  // Sync when going back online
  window.addEventListener("online", handleOnline);
}

/**
 * Stop automatic background sync
 */
export function stopPortalSyncWorker(): void {
  if (syncIntervalId !== null) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    logger.info("Portal sync worker stopped");
  }

  window.removeEventListener("online", handleOnline);
}

/**
 * Handle online event
 */
function handleOnline() {
  logger.info("Connection restored, running portal sync...");
  runPortalSync().catch((e) =>
    logger.error("Portal sync failed:", safeErrorLabel(e)),
  );
}

/**
 * Get sync worker status
 */
export function getPortalSyncStatus(): {
  isRunning: boolean;
  isProcessing: boolean;
} {
  return {
    isRunning: syncIntervalId !== null,
    isProcessing,
  };
}

// Initialize sync worker when module loads (if in browser context)
if (typeof window !== "undefined") {
  // Wait for app to be ready
  window.addEventListener("load", () => {
    // Start sync worker 5 seconds after page load
    setTimeout(() => {
      startPortalSyncWorker(30);
    }, 5000);
  });
}
