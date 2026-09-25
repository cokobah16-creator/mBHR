// Pure logic behind the waiting-room display (PublicDisplay).
//
// The display is a public screen. It may show ticket numbers and where to go
// next, and nothing that identifies a person: no names, phone numbers,
// patient ids or notes. `toDisplayRow` strips a queue row down to the fields
// the screen needs before anything else touches it.
import type { QueueItem } from "@/db";
import { serviceDateOf } from "@/services/queueTickets";
import {
  FLOW_STAGES,
  FLOW_STAGE_LABELS,
  type FlowStage,
} from "@/services/patientFlow";

/** The only queue fields the public display is allowed to hold. */
export interface DisplayQueueRow {
  id: string;
  stage: string;
  status: string;
  position: number;
  ticketNumber?: string;
  updatedAt?: Date | string | number;
  queuedAt?: Date | string | number;
  /** Site and Africa/Lagos service day of the ticket (not identifying). */
  siteKey?: string;
  serviceDate?: string;
}

export interface DisplayCall {
  id: string;
  ticket: string;
  stage: FlowStage;
  destination: string;
  /** When the ticket was called (queue row's last update), ms since epoch. */
  calledAt: number;
}

export interface DisplayNextGroup {
  stage: FlowStage;
  destination: string;
  tickets: string[];
  /** Waiting tickets at this stage that are not listed. */
  more: number;
}

export interface DisplayBoard {
  /** Tickets being served now, most recently called first. */
  serving: DisplayCall[];
  /** Tickets being served that did not fit on the screen. */
  servingMore: number;
  /**
   * Every ticket being served, including ones that did not fit. New-call
   * announcements diff against this list, so a ticket that scrolls back
   * into view is not read out again as a new call.
   */
  servingAll: DisplayCall[];
  /** Next tickets for every stage, in flow order. */
  next: DisplayNextGroup[];
  /**
   * Active queue rows that have no ticket number on this device (for
   * example rows uploaded by an older app version on another device).
   */
  withoutTicket: number;
  /** Waiting + in-service rows (all stages). */
  activeCount: number;
  /** Most recent change to any queue row, ms since epoch. */
  lastChangeAt: number | null;
}

export const MAX_SERVING = 8;
export const MAX_NEXT_PER_STAGE = 4;
/** A call stays marked "Just called" for this long. */
export const JUST_CALLED_MS = 2 * 60_000;
/** With people in the queue, no change for this long means "may be out of date". */
export const STALE_AFTER_MINUTES = 15;

export function toDisplayRow(item: QueueItem): DisplayQueueRow {
  return {
    id: item.id,
    stage: item.stage,
    status: item.status,
    position: item.position,
    ticketNumber: item.ticketNumber,
    updatedAt: item.updatedAt,
    queuedAt: item.queuedAt,
    siteKey: item.siteKey,
    serviceDate: item.serviceDate,
  };
}

/**
 * Rows for this screen: this site's tickets for today (Africa/Lagos).
 * Rows from older app versions carry no site or day; they count when they
 * were queued today (their site is unknown, so they are shown).
 */
export function rowsForSiteToday(
  rows: DisplayQueueRow[],
  siteKey: string,
  serviceDate: string,
): DisplayQueueRow[] {
  return rows.filter((r) => {
    if (r.siteKey && r.siteKey !== siteKey) return false;
    if (r.serviceDate) return r.serviceDate === serviceDate;
    const when = r.queuedAt ?? r.updatedAt;
    return when !== undefined && serviceDateOf(when) === serviceDate;
  });
}

function toMs(d: Date | string | number | undefined | null): number | null {
  if (d === undefined || d === null) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

function isFlowStage(s: string): s is FlowStage {
  return (FLOW_STAGES as string[]).includes(s);
}

function ticketOf(row: DisplayQueueRow): string | null {
  const t = typeof row.ticketNumber === "string" ? row.ticketNumber.trim() : "";
  return t === "" ? null : t;
}

export function buildDisplayBoard(rows: DisplayQueueRow[]): DisplayBoard {
  let lastChangeAt: number | null = null;
  for (const r of rows) {
    const t = toMs(r.updatedAt);
    if (t !== null && (lastChangeAt === null || t > lastChangeAt)) {
      lastChangeAt = t;
    }
  }

  const active = rows.filter(
    (r) =>
      (r.status === "waiting" || r.status === "in_progress") &&
      isFlowStage(r.stage),
  );

  let withoutTicket = 0;
  const serving: DisplayCall[] = [];
  const waitingByStage = new Map<FlowStage, DisplayQueueRow[]>();

  for (const r of active) {
    const ticket = ticketOf(r);
    if (!ticket) {
      withoutTicket += 1;
      continue;
    }
    const stage = r.stage as FlowStage;
    if (r.status === "in_progress") {
      serving.push({
        id: r.id,
        ticket,
        stage,
        destination: FLOW_STAGE_LABELS[stage],
        calledAt: toMs(r.updatedAt) ?? 0,
      });
    } else {
      const list = waitingByStage.get(stage) ?? [];
      list.push(r);
      waitingByStage.set(stage, list);
    }
  }

  serving.sort((a, b) => b.calledAt - a.calledAt || a.ticket.localeCompare(b.ticket));

  const next: DisplayNextGroup[] = FLOW_STAGES.map((stage) => {
    const waiting = (waitingByStage.get(stage) ?? []).sort(
      (a, b) =>
        a.position - b.position ||
        (toMs(a.queuedAt) ?? 0) - (toMs(b.queuedAt) ?? 0),
    );
    const tickets = waiting
      .slice(0, MAX_NEXT_PER_STAGE)
      .map((r) => ticketOf(r) as string);
    return {
      stage,
      destination: FLOW_STAGE_LABELS[stage],
      tickets,
      more: Math.max(0, waiting.length - tickets.length),
    };
  });

  return {
    serving: serving.slice(0, MAX_SERVING),
    servingMore: Math.max(0, serving.length - MAX_SERVING),
    servingAll: serving,
    next,
    withoutTicket,
    activeCount: active.length,
    lastChangeAt,
  };
}

/**
 * Calls that appeared since the previous render. On first load nothing is
 * "new": the screen should not read out every ticket already being served.
 */
export function diffNewCalls(
  previousIds: ReadonlySet<string> | null,
  serving: DisplayCall[],
): { fresh: DisplayCall[]; ids: Set<string> } {
  const ids = new Set(serving.map((c) => c.id));
  if (previousIds === null) return { fresh: [], ids };
  return { fresh: serving.filter((c) => !previousIds.has(c.id)), ids };
}

/** Text for the polite live region, e.g. "Ticket Q-014, please go to Vitals." */
export function announcementFor(calls: DisplayCall[]): string {
  return calls
    .map((c) => `Ticket ${c.ticket}, please go to ${c.destination}.`)
    .join(" ");
}

export function isJustCalled(call: DisplayCall, now: number): boolean {
  if (call.calledAt <= 0) return false;
  const age = now - call.calledAt;
  // A device with a fast clock can stamp a call in the future; do not keep
  // it marked "Just called" for longer than the normal window.
  return age > -JUST_CALLED_MS && age < JUST_CALLED_MS;
}

export type FreshnessKind = "offline" | "signed_out" | "stale" | "local" | "online";

export interface Freshness {
  kind: FreshnessKind;
  /** Connectivity alone is not "synced", so "online" stays neutral. */
  tone: "neutral" | "warning";
  label: string;
  detail: string;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/**
 * How far the screen can be trusted. Offline wins (it explains everything
 * else), then a missing online sign-in (nothing from other devices can
 * arrive), then "no changes for a while" while people are still queued,
 * then whether this device shares data at all.
 */
export function displayFreshness(input: {
  online: boolean;
  syncEnabled: boolean;
  lastChangeAt: number | null;
  activeCount: number;
  now: number;
  /** false when this screen has no online sign-in (it cannot sync). */
  cloudSignedIn?: boolean;
}): Freshness {
  const { online, syncEnabled, lastChangeAt, activeCount, now } = input;

  if (syncEnabled && !online) {
    return {
      kind: "offline",
      tone: "warning",
      label: "Offline",
      detail:
        "Tickets called on other devices will not appear until the connection returns.",
    };
  }

  if (syncEnabled && input.cloudSignedIn === false) {
    return {
      kind: "signed_out",
      tone: "warning",
      label: "Not signed in online",
      detail:
        "Tickets from other devices cannot appear. Staff: sign in online on this screen.",
    };
  }

  if (activeCount > 0 && lastChangeAt !== null) {
    const idleMin = Math.floor(Math.max(0, now - lastChangeAt) / 60_000);
    if (idleMin >= STALE_AFTER_MINUTES) {
      return {
        kind: "stale",
        tone: "warning",
        label: `No changes for ${formatMinutes(idleMin)}`,
        detail: "This screen may be out of date. Staff: check the queue.",
      };
    }
  }

  if (!syncEnabled) {
    return {
      kind: "local",
      tone: "neutral",
      label: "This device only",
      detail: "Shows tickets called on this device.",
    };
  }

  return { kind: "online", tone: "neutral", label: "Online", detail: "" };
}
