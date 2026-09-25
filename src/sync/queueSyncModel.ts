// Pure helpers for the queue-ticket sync participant (src/sync/queueSync.ts).
// No database or network access, so they can be unit tested directly.
import type { QueueRow } from "@/services/queueTickets";
import { serviceDateOf } from "@/services/queueTickets";

/** Ask the server for a new block when fewer numbers than this are left. */
export const LEASE_LOW_WATER = 5;
/** Numbers per block. */
export const LEASE_BLOCK_SIZE = 20;

/** One ticket this device issued and the server has not confirmed yet. */
export interface PendingTicket {
  ticketId: string;
  patientId: string;
  siteKey: string;
  serviceDate: string;
  ticketNumber: string;
  provisional: boolean;
  /** Local queue rows carrying this ticket. */
  rowIds: string[];
}

/** Pending tickets (one per ticket id), oldest first. */
export function pendingTicketGroups(rows: QueueRow[]): PendingTicket[] {
  const groups = new Map<string, PendingTicket>();
  const firstAt = new Map<string, number>();
  for (const r of rows) {
    if (r.ticketPending !== 1) continue;
    if (!r.ticketId || !r.siteKey || !r.serviceDate || !r.ticketNumber) continue;
    const at = new Date(r.queuedAt ?? r.updatedAt).getTime() || 0;
    const g = groups.get(r.ticketId);
    if (g) {
      g.rowIds.push(r.id);
      firstAt.set(r.ticketId, Math.min(firstAt.get(r.ticketId) ?? at, at));
      continue;
    }
    groups.set(r.ticketId, {
      ticketId: r.ticketId,
      patientId: r.patientId,
      siteKey: r.siteKey,
      serviceDate: r.serviceDate,
      ticketNumber: r.ticketNumber,
      provisional: r.ticketProvisional === 1,
      rowIds: [r.id],
    });
    firstAt.set(r.ticketId, at);
  }
  return [...groups.values()].sort(
    (a, b) => (firstAt.get(a.ticketId) ?? 0) - (firstAt.get(b.ticketId) ?? 0),
  );
}

/** The block number inside a "Q-021" label, or null. */
export function leasedSeqOf(label: string): number | null {
  const m = /^Q-(\d+)$/.exec(label.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Arguments for public.issue_queue_ticket. */
export function issueTicketArgs(ticket: PendingTicket, deviceId: string): Record<string, unknown> {
  const seq = ticket.provisional ? null : leasedSeqOf(ticket.ticketNumber);
  return {
    p_ticket_id: ticket.ticketId,
    p_site_key: ticket.siteKey,
    p_service_date: ticket.serviceDate,
    p_patient_id: ticket.patientId,
    p_leased_seq: seq,
    // A number the device made up (temporary, or from an older app
    // version): the server keeps it when it is free.
    p_provisional_label: seq === null ? ticket.ticketNumber : null,
    p_device_id: deviceId,
  };
}

export interface IssueResult {
  outcome: "applied" | "rejected";
  ticketId?: string;
  ticketNumber?: string;
  provisional?: boolean;
  reason?: string;
}

/** Reads the RPC's jsonb answer; null when it is not in the expected shape. */
export function parseIssueResult(data: unknown): IssueResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.outcome === "rejected") {
    return { outcome: "rejected", reason: typeof d.reason === "string" ? d.reason : undefined };
  }
  if (d.outcome !== "applied") return null;
  if (typeof d.ticket_id !== "string" || typeof d.ticket_number !== "string") return null;
  return {
    outcome: "applied",
    ticketId: d.ticket_id,
    ticketNumber: d.ticket_number,
    provisional: d.provisional === true,
  };
}

/**
 * What to write on a local row once the server confirmed its ticket. The
 * label a patient was given is remembered when the server's differs, so
 * staff can tell the patient.
 */
export function confirmedTicketChanges(
  row: Pick<QueueRow, "ticketNumber" | "ticketRelabelledFrom">,
  result: IssueResult,
): Partial<QueueRow> {
  const changed = !!result.ticketNumber && result.ticketNumber !== row.ticketNumber;
  return {
    ticketId: result.ticketId,
    ticketNumber: result.ticketNumber,
    ticketProvisional: result.provisional ? 1 : 0,
    ticketPending: 0,
    ...(changed ? { ticketRelabelledFrom: row.ticketRelabelledFrom ?? row.ticketNumber } : {}),
  };
}

/**
 * Rows whose status change has reached the server (no unsent transition
 * for them any more), so the download may set their status again.
 */
export function holdsToRelease(
  heldRows: Pick<QueueRow, "id" | "transitionPending">[],
  unsentTransitions: { queueItemId: string }[],
): string[] {
  const unsent = new Set(unsentTransitions.map((t) => t.queueItemId));
  return heldRows
    .filter((r) => r.transitionPending === 1 && !unsent.has(r.id))
    .map((r) => r.id);
}

/**
 * Rows saved by an older app version (no site or day). Every one gets its
 * Lagos service day. Today's rows with a ticket number also get a ticket id
 * (one per patient) and are marked pending, so the server issues the
 * patient a ticket for the day. Older versions numbered tickets per device
 * (every device had a Q-001), so the server may give a new number; staff
 * are told when it does. Pure: `newId` makes the ids.
 */
export function legacyRowUpdates(
  rows: QueueRow[],
  today: string,
  siteKey: string,
  newId: () => string,
): Array<{ id: string; changes: Partial<QueueRow> }> {
  const ticketByPatient = new Map<string, string>();
  const out: Array<{ id: string; changes: Partial<QueueRow> }> = [];
  for (const r of rows) {
    if (r.serviceDate || r.siteKey) continue;
    const day = serviceDateOf(r.queuedAt ?? r.updatedAt);
    const changes: Partial<QueueRow> = { serviceDate: day };
    if (day === today && r.ticketNumber && r.ticketNumber.trim() && !r.ticketId) {
      let ticketId = ticketByPatient.get(r.patientId);
      if (!ticketId) {
        ticketId = newId();
        ticketByPatient.set(r.patientId, ticketId);
      }
      Object.assign(changes, {
        siteKey,
        ticketId,
        ticketProvisional: 1,
        ticketPending: 1,
      });
    }
    out.push({ id: r.id, changes });
  }
  return out;
}

export interface LeaseBlock {
  leaseId: string;
  startSeq: number;
  endSeq: number;
}

/** Reads lease_ticket_block's answer (an object or a one-row array). */
export function parseLeaseResult(data: unknown): LeaseBlock | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const d = row as Record<string, unknown>;
  const start = Number(d.start_seq);
  const end = Number(d.end_seq);
  const id = d.lease_id;
  if (typeof id !== "string" || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 1 || end < start) return null;
  return { leaseId: id, startSeq: start, endSeq: end };
}
