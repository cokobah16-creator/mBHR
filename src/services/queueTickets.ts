// Queue ticket numbers: pure rules (no database, no network), so they can be
// unit tested directly. The Dexie side lives in queueTicketStore.ts and the
// server side in src/sync/queueSync.ts.
//
// How numbers stay unique across devices (owner decision: tickets sync so a
// second queue screen and the waiting-room display on another device show
// the same numbers):
//
// 1. The server hands each device a block of numbers for one site and one
//    service day ("lease", public.lease_ticket_block). A number from the
//    device's own block is a real "Q-021" that no other device can issue,
//    even offline.
// 2. When the block is used up and the device is offline, it issues a
//    temporary number with its own two-character prefix ("K7-003"). The
//    patient may already have been called by it, so it is kept when the
//    server confirms it; it changes only if that label is already taken or
//    another desk already gave the patient a ticket for the day.
// 3. The server confirms every ticket (public.issue_queue_ticket). One
//    ticket per patient, site and day: if two desks issued one each, both
//    devices end up with the server's ticket.
//
// Days are Africa/Lagos days (WAT, UTC+1, no daylight saving), not UTC days:
// a ticket issued at 00:30 in Lagos belongs to the new day.

import type { QueueItem, TicketLease } from "@/db";

export const LAGOS_TIME_ZONE = "Africa/Lagos";

/** WAT is UTC+1 all year (Nigeria has no daylight saving). */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/**
 * Queue row with the device-only ticket markers this module uses. They are
 * never uploaded (not in the sync column map) and a download never clears
 * them (downloads lay the server row over the local one).
 */
export type QueueRow = QueueItem & {
  /** 1 while the server has not confirmed this row's ticket yet. */
  ticketPending?: 0 | 1;
  /**
   * 1 while a status change (or a priority downgrade) made on this device
   * has not reached the server's transition log yet. A download keeps the
   * local status and priority until then (see src/sync/queueSync.ts).
   */
  transitionPending?: 0 | 1;
  /** The label the patient was given before the server changed it. */
  ticketRelabelledFrom?: string;
};

/** The ticket fields a queue row carries. */
export interface TicketAssignment {
  ticketId: string;
  ticketNumber: string;
  ticketProvisional: 0 | 1;
  /** 1: issued on this device and waiting for the server. */
  ticketPending: 0 | 1;
  siteKey: string;
  serviceDate: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The Africa/Lagos calendar day of `at`, as "YYYY-MM-DD" (the service day a
 * ticket belongs to).
 */
export function serviceDateOf(at: Date | number | string = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return serviceDateOf(new Date());
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: LAGOS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const y = get("year");
    const m = get("month");
    const day = get("day");
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // Fall through: some runtimes ship without time zone data.
  }
  const lagos = new Date(ms + LAGOS_OFFSET_MS);
  return `${lagos.getUTCFullYear()}-${pad2(lagos.getUTCMonth() + 1)}-${pad2(lagos.getUTCDate())}`;
}

/**
 * Site key for tickets: the normalised site name ("Mobile Clinic" ->
 * "mobile-clinic"). Site records are not synced between devices (each
 * device has its own ids), so the name is what two devices at the same
 * camp have in common.
 */
export function siteKeyFromName(name: string | null | undefined, fallbackName: string): string {
  const slug = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  const key = slug(name ?? "");
  if (key) return key;
  return slug(fallbackName) || "site";
}

/** Server ticket label for a sequence number: 7 -> "Q-007", 1204 -> "Q-1204". */
export function formatTicketNumber(seq: number): string {
  return `Q-${String(seq).padStart(3, "0")}`;
}

/**
 * Characters for the device prefix of temporary numbers. No Q (server
 * numbers start with Q), and no I, O, 0 or 1 (easy to mishear or misread).
 */
const PREFIX_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ23456789";

/** Two-character code for this device's temporary numbers, derived from its id. */
export function devicePrefixFrom(deviceId: string): string {
  // FNV-1a: stable across app versions and runtimes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < deviceId.length; i++) {
    hash ^= deviceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const n = PREFIX_ALPHABET.length;
  return PREFIX_ALPHABET[hash % n] + PREFIX_ALPHABET[Math.floor(hash / n) % n];
}

/** Temporary label: "K7" and 3 -> "K7-003". */
export function provisionalLabel(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** A label this device issued as temporary (device prefix, not "Q-"). */
export function isProvisionalLabel(label: string | null | undefined): boolean {
  return !!label && !/^Q-\d+$/.test(label.trim());
}

function leaseMatches(
  lease: TicketLease,
  siteKey: string,
  serviceDate: string,
  deviceId: string,
): boolean {
  return (
    lease.siteKey === siteKey &&
    lease.serviceDate === serviceDate &&
    lease.deviceId === deviceId &&
    lease.nextSeq <= lease.endSeq
  );
}

/** Numbers still unused in this device's blocks for one site and day. */
export function remainingInLeases(
  leases: TicketLease[],
  siteKey: string,
  serviceDate: string,
  deviceId: string,
): number {
  return leases
    .filter((l) => leaseMatches(l, siteKey, serviceDate, deviceId))
    .reduce((sum, l) => sum + (l.endSeq - l.nextSeq + 1), 0);
}

/**
 * The next number to use from this device's blocks (lowest first), or null
 * when they are used up. Pure: the caller stores `lease` with nextSeq + 1.
 */
export function takeFromLeases(
  leases: TicketLease[],
  siteKey: string,
  serviceDate: string,
  deviceId: string,
): { lease: TicketLease; seq: number } | null {
  const usable = leases
    .filter((l) => leaseMatches(l, siteKey, serviceDate, deviceId))
    .sort((a, b) => a.nextSeq - b.nextSeq);
  const lease = usable[0];
  if (!lease) return null;
  return { lease: { ...lease, nextSeq: lease.nextSeq + 1 }, seq: lease.nextSeq };
}

/** Leases for days before `serviceDate` (safe to delete). */
export function expiredLeaseIds(leases: TicketLease[], serviceDate: string): string[] {
  return leases.filter((l) => l.serviceDate < serviceDate).map((l) => l.id);
}

function timeOf(d: Date | string | number | undefined): number {
  if (d === undefined || d === null) return 0;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The ticket the patient already holds for this site and day, if any, so a
 * move to the next stage keeps the same number. Rows saved before tickets
 * had a site and day (older app versions) count when they were queued on
 * the same Lagos day; they come back without a ticketId, and the caller
 * gives them one.
 */
export function findTodaysTicket(
  rows: QueueRow[],
  patientId: string,
  siteKey: string,
  serviceDate: string,
): (Partial<TicketAssignment> & { ticketNumber: string }) | null {
  const candidates = rows.filter((r) => {
    if (r.patientId !== patientId) return false;
    if (!r.ticketNumber || !r.ticketNumber.trim()) return false;
    if (r.serviceDate || r.siteKey) {
      return r.serviceDate === serviceDate && (r.siteKey ?? siteKey) === siteKey;
    }
    return !!r.queuedAt && serviceDateOf(r.queuedAt) === serviceDate;
  });
  if (candidates.length === 0) return null;
  // Newest first: the patient may have been re-queued later in the day.
  candidates.sort(
    (a, b) => timeOf(b.queuedAt ?? b.updatedAt) - timeOf(a.queuedAt ?? a.updatedAt),
  );
  const r = candidates[0];
  return {
    ticketId: r.ticketId,
    ticketNumber: r.ticketNumber!.trim(),
    ticketProvisional: r.ticketProvisional === 1 ? 1 : 0,
    ticketPending: r.ticketPending === 1 ? 1 : 0,
    siteKey,
    serviceDate,
  };
}

/** How a queue row's ticket stands with the server (for staff screens). */
export type TicketSyncState =
  | "device_only" // cloud sync is not set up: numbers are per device
  | "confirmed" // the server issued or confirmed this number
  | "pending" // a number from this device's block, not confirmed yet
  | "provisional" // a temporary number, not confirmed yet
  | "changed"; // the server gave the patient a different number

export function ticketSyncState(
  row: Pick<QueueRow, "ticketPending" | "ticketProvisional" | "ticketRelabelledFrom" | "ticketNumber">,
  syncEnabled: boolean,
): TicketSyncState {
  if (!syncEnabled) return "device_only";
  if (row.ticketPending === 1) {
    return row.ticketProvisional === 1 ? "provisional" : "pending";
  }
  if (row.ticketRelabelledFrom && row.ticketRelabelledFrom !== row.ticketNumber) {
    return "changed";
  }
  return "confirmed";
}
