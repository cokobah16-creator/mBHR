// Queue tickets on this device (Dexie). Pure rules are in queueTickets.ts;
// the server side (confirming tickets, leasing number blocks) is in
// src/sync/queueSync.ts.
import { db, generateId } from "@/db";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { DEFAULT_SITE_NAME, getActiveSiteName } from "@/services/activeSite";
import {
  devicePrefixFrom,
  formatTicketNumber,
  provisionalLabel,
  remainingInLeases,
  serviceDateOf,
  siteKeyFromName,
  takeFromLeases,
  type TicketAssignment,
} from "./queueTickets";

const LOCAL_SEQ_KEY = (serviceDate: string) => `queue:ticketSeq:${serviceDate}`;
const PROVISIONAL_SEQ_KEY = (siteKey: string, serviceDate: string) =>
  `queue:provisionalSeq:${siteKey}:${serviceDate}`;
const DEVICE_PREFIX_KEY = "queue:devicePrefix";

/** Where and when tickets issued now belong. Call outside a Dexie transaction. */
export interface TicketContext {
  siteKey: string;
  serviceDate: string;
  /** Cloud sync is set up, so numbers must be unique across devices. */
  syncEnabled: boolean;
}

export async function currentTicketContext(now: Date = new Date()): Promise<TicketContext> {
  const name = await getActiveSiteName();
  return {
    siteKey: siteKeyFromName(name, DEFAULT_SITE_NAME),
    serviceDate: serviceDateOf(now),
    syncEnabled: isSupabaseEnabled,
  };
}

async function nextCounter(key: string): Promise<number> {
  const row = await db.settings.get(key);
  const current = row ? parseInt(String(row.value), 10) : 0;
  const next = (Number.isFinite(current) ? current : 0) + 1;
  await db.settings.put({ key, value: String(next) });
  return next;
}

/** This device's two-character prefix for temporary numbers (stored once). */
export async function devicePrefix(deviceId: string): Promise<string> {
  const row = await db.settings.get(DEVICE_PREFIX_KEY);
  if (row?.value && typeof row.value === "string") return row.value;
  const prefix = devicePrefixFrom(deviceId);
  await db.settings.put({ key: DEVICE_PREFIX_KEY, value: prefix });
  return prefix;
}

/**
 * Issue a new ticket number on this device. Must run inside a Dexie
 * transaction that includes db.settings and db.ticketLeases.
 *
 * - Cloud sync not set up: a per-device daily number (Q-001, Q-002, ...),
 *   as before; nothing is sent anywhere.
 * - Cloud sync set up: the next number from this device's leased block, or a
 *   temporary "<prefix>-NNN" number when the block is used up. Either way
 *   the ticket is marked pending until the server confirms it.
 */
export async function issueTicketLocal(
  ctx: TicketContext,
  deviceId: string,
): Promise<TicketAssignment> {
  const ticketId = generateId();
  if (!ctx.syncEnabled) {
    const seq = await nextCounter(LOCAL_SEQ_KEY(ctx.serviceDate));
    return {
      ticketId,
      ticketNumber: formatTicketNumber(seq),
      ticketProvisional: 0,
      ticketPending: 0,
      siteKey: ctx.siteKey,
      serviceDate: ctx.serviceDate,
    };
  }

  const leases = await db.ticketLeases
    .where("serviceDate")
    .equals(ctx.serviceDate)
    .toArray();
  const taken = takeFromLeases(leases, ctx.siteKey, ctx.serviceDate, deviceId);
  if (taken) {
    await db.ticketLeases.put(taken.lease);
    return {
      ticketId,
      ticketNumber: formatTicketNumber(taken.seq),
      ticketProvisional: 0,
      ticketPending: 1,
      siteKey: ctx.siteKey,
      serviceDate: ctx.serviceDate,
    };
  }

  const prefix = await devicePrefix(deviceId);
  const n = await nextCounter(PROVISIONAL_SEQ_KEY(ctx.siteKey, ctx.serviceDate));
  return {
    ticketId,
    ticketNumber: provisionalLabel(prefix, n),
    ticketProvisional: 1,
    ticketPending: 1,
    siteKey: ctx.siteKey,
    serviceDate: ctx.serviceDate,
  };
}

/** Unused numbers in this device's blocks for a site and day. */
export async function remainingTicketNumbers(
  siteKey: string,
  serviceDate: string,
  deviceId: string,
): Promise<number> {
  const leases = await db.ticketLeases.where("serviceDate").equals(serviceDate).toArray();
  return remainingInLeases(leases, siteKey, serviceDate, deviceId);
}

// ---------------------------------------------------------------------------
// Getting a number block before issuing (best effort)
// ---------------------------------------------------------------------------

type LeaseRequester = (siteKey: string, serviceDate: string) => Promise<void>;
let leaseRequester: LeaseRequester | null = null;

/** Set by src/sync/queueSync.ts, which knows how to ask the server. */
export function setLeaseRequester(fn: LeaseRequester | null): void {
  leaseRequester = fn;
}

const PREPARE_TIMEOUT_MS = 4000;

/**
 * Before issuing a ticket: when this device has no numbers left for the
 * day and is online, ask the server for a block, waiting at most a few
 * seconds. Never throws; offline (or on a slow link) the ticket simply gets
 * a temporary number.
 */
export async function prepareTicketNumbers(
  ctx: TicketContext,
  deviceId: string,
): Promise<void> {
  if (!ctx.syncEnabled || !leaseRequester) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    const left = await remainingTicketNumbers(ctx.siteKey, ctx.serviceDate, deviceId);
    if (left > 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PREPARE_TIMEOUT_MS);
    });
    await Promise.race([leaseRequester(ctx.siteKey, ctx.serviceDate), timeout]);
    if (timer) clearTimeout(timer);
  } catch (error) {
    console.warn(
      "[queue] could not reserve ticket numbers:",
      error instanceof Error ? error.name : "unknown",
    );
  }
}
