// Queue-ticket sync participant (Wave B, item 2).
//
// Hooks into every sync run (src/sync/adapter.ts registerSyncParticipant):
//
// beforePush
//   Refresh the server-owned fields and row version of queue rows with
//   unsent changes, so uploading them is not mistaken for an edit conflict.
//   Priority and position are last-writer-wins by design; the server keeps
//   status, stage and ticket to itself and never lets an upload lower an
//   urgent priority (supabase/migrations/20260925100200_queue_tickets_authoritative.sql).
//
// (the adapter then uploads queue rows, then queue_transitions: the server
//  applies each transition's status change with a compare-and-set)
//
// afterPull
//   1. Rows saved by older app versions get their Lagos service day; today's
//      numbered ones are sent for confirmation.
//   2. Tickets issued on this device are confirmed by the server
//      (issue_queue_ticket). If the server's number differs (another desk
//      already gave the patient a ticket today, or the temporary number was
//      taken), every local row is relabelled and staff are told.
//   3. Status holds are released for rows whose transitions reached the
//      server, and those rows are downloaded again so the server's status
//      shows (a change refused as stale is corrected here).
//   4. The device's block of ticket numbers is topped up.
//
// Nothing here logs patient data: only error names and codes.
import { can, type Role } from "@/auth/roles";
import { db, generateId, type TicketLease } from "@/db";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/services/queueAudit";
import type { QueueRow } from "@/services/queueTickets";
import {
  currentTicketContext,
  remainingTicketNumbers,
  setLeaseRequester,
} from "@/services/queueTicketStore";
import { expiredLeaseIds, serviceDateOf } from "@/services/queueTickets";
import { useToast } from "@/stores/toast";
import {
  currentCommandSender,
  isOnlineSyncEnabled,
  refetchRows,
  registerSyncParticipant,
} from "./adapter";
import { syncErrorCode } from "./errorCode";
import {
  confirmedTicketChanges,
  holdsToRelease,
  issueTicketArgs,
  LEASE_BLOCK_SIZE,
  LEASE_LOW_WATER,
  legacyRowUpdates,
  parseIssueResult,
  parseLeaseResult,
  pendingTicketGroups,
} from "./queueSyncModel";

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** The person signed in online may change the queue (server rule "queue"). */
async function mayUseQueueRpc(): Promise<boolean> {
  if (!supabase || !isOnlineSyncEnabled() || !online()) return false;
  const sender = await currentCommandSender();
  return !!sender && can(sender.role as Role, "queue");
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return syncErrorCode(error);
}

async function queueRows(filter: (r: QueueRow) => boolean): Promise<QueueRow[]> {
  return (await db.queue.filter((r) => filter(r as QueueRow)).toArray()) as QueueRow[];
}

// ---------------------------------------------------------------------------
// Before upload: refresh versions of rows with unsent changes
// ---------------------------------------------------------------------------

async function refreshDirtyQueueRows(): Promise<void> {
  if (!(await mayUseQueueRpc())) return;
  const dirty = (await db.queue.where("_dirty").equals(1).primaryKeys()) as string[];
  if (dirty.length === 0) return;
  await refetchRows("queue", "id", dirty);
}

// ---------------------------------------------------------------------------
// Legacy rows (older app versions)
// ---------------------------------------------------------------------------

async function backfillLegacyRows(): Promise<void> {
  const legacy = await queueRows((r) => !r.serviceDate && !r.siteKey);
  if (legacy.length === 0) return;
  const ctx = await currentTicketContext();
  const updates = legacyRowUpdates(legacy, serviceDateOf(), ctx.siteKey, generateId);
  if (updates.length === 0) return;
  await db.transaction("rw", db.queue, async () => {
    for (const u of updates) {
      const current = (await db.queue.get(u.id)) as QueueRow | undefined;
      if (!current || current.serviceDate || current.siteKey) continue;
      await db.queue.update(u.id, u.changes);
    }
  });
}

// ---------------------------------------------------------------------------
// Confirming tickets issued on this device
// ---------------------------------------------------------------------------

function tellStaffAboutNewNumber(from: string, to: string): void {
  try {
    useToast.getState().push({
      id: generateId(),
      tone: "warning",
      title: `Ticket ${from} is now ${to}`,
      body: "The server gave this patient a different number (another desk had already given them a ticket today, or the number was taken). Tell the patient their new number.",
    });
  } catch {
    // No toast host (for example in a background tab): the queue screens
    // still show "Changed from" on the ticket.
  }
}

/** Server reasons that will not change on a retry: stop asking for this ticket. */
const FINAL_REJECTIONS = new Set(["invalid_input"]);

export async function confirmPendingTickets(): Promise<{ confirmed: number; changed: number }> {
  const summary = { confirmed: 0, changed: 0 };
  if (!(await mayUseQueueRpc())) return summary;
  const pending = pendingTicketGroups(await queueRows((r) => r.ticketPending === 1));
  if (pending.length === 0) return summary;
  const deviceId = await getDeviceId();

  for (const ticket of pending) {
    const { data, error } = await supabase!.rpc(
      "issue_queue_ticket",
      issueTicketArgs(ticket, deviceId),
    );
    if (error) {
      // Not authorised, server not migrated yet, offline: stop and retry on
      // the next sync. The tickets stay "waiting to confirm".
      console.warn("[queue] ticket confirmation failed", errorCodeOf(error));
      return summary;
    }
    const result = parseIssueResult(data);
    if (!result) {
      console.warn("[queue] ticket confirmation: unexpected answer");
      return summary;
    }
    if (result.outcome === "rejected") {
      // For example the patient record has not reached the server yet:
      // try again on the next sync.
      console.warn("[queue] ticket not confirmed yet", result.reason ?? "rejected");
      if (result.reason && FINAL_REJECTIONS.has(result.reason)) {
        await db.queue
          .where("ticketId")
          .equals(ticket.ticketId)
          .modify({ ticketPending: 0 });
      }
      continue;
    }

    let relabelledFrom: string | null = null;
    await db.transaction("rw", db.queue, async () => {
      const rows = (await db.queue
        .where("ticketId")
        .equals(ticket.ticketId)
        .toArray()) as QueueRow[];
      for (const row of rows) {
        const changes = confirmedTicketChanges(row, result);
        if (changes.ticketRelabelledFrom && row.ticketNumber) relabelledFrom = row.ticketNumber;
        await db.queue.update(row.id, changes);
      }
    });
    summary.confirmed += 1;
    if (relabelledFrom && result.ticketNumber) {
      summary.changed += 1;
      tellStaffAboutNewNumber(relabelledFrom, result.ticketNumber);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Status holds
// ---------------------------------------------------------------------------

async function releaseStatusHolds(): Promise<void> {
  const held = await queueRows((r) => r.transitionPending === 1);
  if (held.length === 0) return;
  const unsent = await db.queueTransitions.where("_dirty").equals(1).toArray();
  const ids = holdsToRelease(held, unsent);
  if (ids.length === 0) return;

  await db.transaction("rw", db.queue, async () => {
    for (const id of ids) await db.queue.update(id, { transitionPending: 0 });
  });
  try {
    // Download them again so the server's status (the result of the
    // transitions, or another device's change) shows on this device.
    await refetchRows("queue", "id", ids);
  } catch (error) {
    // Keep holding: try again after the next sync.
    console.warn("[queue] could not refresh queue status", syncErrorCode(error));
    await db.transaction("rw", db.queue, async () => {
      for (const id of ids) {
        const row = (await db.queue.get(id)) as QueueRow | undefined;
        if (row && row.transitionPending !== 1) {
          await db.queue.update(id, { transitionPending: 1 });
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Number blocks (leases)
// ---------------------------------------------------------------------------

const leaseInFlight = new Map<string, Promise<void>>();

async function requestLease(siteKey: string, serviceDate: string): Promise<void> {
  if (!(await mayUseQueueRpc())) return;
  const deviceId = await getDeviceId();
  const left = await remainingTicketNumbers(siteKey, serviceDate, deviceId);
  if (left >= LEASE_LOW_WATER) return;

  const { data, error } = await supabase!.rpc("lease_ticket_block", {
    p_site_key: siteKey,
    p_service_date: serviceDate,
    p_device_id: deviceId,
    p_size: LEASE_BLOCK_SIZE,
  });
  if (error) {
    console.warn("[queue] could not reserve ticket numbers", errorCodeOf(error));
    return;
  }
  const block = parseLeaseResult(data);
  if (!block) {
    console.warn("[queue] ticket number block: unexpected answer");
    return;
  }
  const lease: TicketLease = {
    id: block.leaseId,
    siteKey,
    serviceDate,
    deviceId,
    startSeq: block.startSeq,
    endSeq: block.endSeq,
    nextSeq: block.startSeq,
    createdAt: Date.now(),
  };
  await db.ticketLeases.put(lease);
}

/**
 * Make sure this device holds enough ticket numbers for the site and day.
 * One request at a time per site and day. Never throws.
 */
export function topUpTicketNumbers(siteKey: string, serviceDate: string): Promise<void> {
  const key = `${siteKey}|${serviceDate}`;
  const running = leaseInFlight.get(key);
  if (running) return running;
  const run = requestLease(siteKey, serviceDate)
    .catch((error: unknown) => {
      console.warn("[queue] could not reserve ticket numbers", syncErrorCode(error));
    })
    .finally(() => {
      leaseInFlight.delete(key);
    });
  leaseInFlight.set(key, run);
  return run;
}

async function pruneOldLeases(today: string): Promise<void> {
  const all = await db.ticketLeases.toArray();
  const old = expiredLeaseIds(all, today);
  if (old.length > 0) await db.ticketLeases.bulkDelete(old);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function afterPull(): Promise<void> {
  await backfillLegacyRows();
  await confirmPendingTickets();
  await releaseStatusHolds();
  const ctx = await currentTicketContext();
  if (ctx.syncEnabled) {
    await pruneOldLeases(ctx.serviceDate);
    await topUpTicketNumbers(ctx.siteKey, ctx.serviceDate);
  }
}

registerSyncParticipant({
  name: "queue-tickets",
  beforePush: refreshDirtyQueueRows,
  afterPull,
  // Only the server changes these: status and stage through the transition
  // log, the ticket through issue_queue_ticket. _serverVersion is refreshed
  // with them so an upload after another device's change is not reported as
  // an edit conflict (priority and position are last-writer-wins; the
  // server refuses an upload that lowers an urgent priority).
  serverOwned: {
    queue: ["status", "stage", "ticketId", "ticketNumber", "_serverVersion"],
  },
  // While a local change is waiting for the server, a download keeps it.
  holds: {
    queue: [
      { marker: "transitionPending", fields: ["status", "stage", "priority"] },
      { marker: "ticketPending", fields: ["ticketId", "ticketNumber"] },
    ],
  },
});

setLeaseRequester(topUpTicketNumbers);
