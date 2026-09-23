// Pure helpers shared by the Palaver Room (staff messages) and the clinician
// inbox for patient portal messages: thread grouping and ordering, en-NG
// timestamps, priority display, connection wording, permissions and
// staff-facing error text.
//
// Everything is derived from fields the Supabase tables actually store.
// Nothing here infers clinical urgency from message text.

import { can, type Permission, type Role } from "@/auth/roles";
import { formatNigerianDate } from "@/utils/dateFormat";
import type { Tone } from "@/components/ui/StatusBadge";
import type {
  MessagePriority,
  PalaverMessage,
  TargetRole,
} from "@/services/palaverRoom";
import type { PatientSecureMessage } from "@/services/patientSecureMessaging";

/** Seconds between background checks for new messages. */
export const POLL_SECONDS = 30;

// ── Time ─────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 24-hour clock time, e.g. "14:05". */
export function formatClock(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
}

/**
 * Compact message time: "14:05" today, "Yesterday 14:05", otherwise
 * "dd/mm/yyyy 14:05".
 */
export function formatMessageTime(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return "";
  if (sameDay(d, now)) return formatClock(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday ${formatClock(d)}`;
  return `${formatNigerianDate(d)} ${formatClock(d)}`;
}

/** Full timestamp for tooltips and screen readers: "dd/mm/yyyy at 14:05". */
export function formatFullTimestamp(
  value: string | Date | null | undefined,
): string {
  const d = toDate(value);
  return d ? `${formatNigerianDate(d)} at ${formatClock(d)}` : "";
}

function timeOf(value: string | null | undefined): number {
  const d = toDate(value);
  return d ? d.getTime() : 0;
}

// ── Priority ─────────────────────────────────────────────────────────────────

export const PRIORITY_LABEL: Record<MessagePriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
  critical: "Critical",
};

const PRIORITY_RANK: Record<MessagePriority, number> = {
  normal: 0,
  urgent: 1,
  critical: 2,
};

export function priorityRank(p: MessagePriority | null | undefined): number {
  return (p && PRIORITY_RANK[p]) || 0;
}

/** Badge tone for a message priority; normal priority shows no badge. */
export function priorityTone(p: MessagePriority | null | undefined): Tone | null {
  if (p === "critical") return "critical";
  if (p === "urgent") return "warning";
  return null;
}

export const TARGET_ROLE_LABEL: Record<TargetRole, string> = {
  all_clinical: "All clinical staff",
  doctor: "Doctors",
  nurse: "Nurses",
  pharmacist: "Pharmacists",
  all_staff: "All staff",
};

export function isTargetRole(value: string): value is TargetRole {
  return Object.prototype.hasOwnProperty.call(TARGET_ROLE_LABEL, value);
}

export function isMessagePriority(value: string): value is MessagePriority {
  return Object.prototype.hasOwnProperty.call(PRIORITY_LABEL, value);
}

/** "Re: " prefix for replies, without stacking "Re: Re:". */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: Message";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

// ── Palaver Room threads ─────────────────────────────────────────────────────

export interface PalaverThread {
  /** The other staff member in the conversation. */
  otherId: string;
  otherName: string;
  /** Oldest first. */
  messages: PalaverMessage[];
  latest: PalaverMessage;
  /** Messages received by the current user and not yet opened. */
  unreadCount: number;
  /** Highest priority among unread received messages, if any. */
  topUnreadPriority: MessagePriority | null;
}

/**
 * Group inbox messages (sent and received) into one thread per colleague.
 * Threads with unread messages come first (critical, then urgent, then
 * normal), then everything else by latest activity.
 */
export function buildPalaverThreads(
  messages: readonly PalaverMessage[],
  userId: string,
): PalaverThread[] {
  const byOther = new Map<string, PalaverMessage[]>();
  for (const m of messages) {
    const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
    const list = byOther.get(otherId);
    if (list) list.push(m);
    else byOther.set(otherId, [m]);
  }

  const threads: PalaverThread[] = [];
  for (const [otherId, list] of byOther) {
    const sorted = [...list].sort(
      (a, b) => timeOf(a.created_at) - timeOf(b.created_at),
    );
    const latest = sorted[sorted.length - 1];
    const unread = sorted.filter(
      (m) => m.recipient_id === userId && m.sender_id !== userId && !m.is_read,
    );
    const top = unread.reduce<MessagePriority | null>(
      (best, m) =>
        best === null || priorityRank(m.priority) > priorityRank(best)
          ? m.priority || "normal"
          : best,
      null,
    );
    threads.push({
      otherId,
      otherName:
        (latest.sender_id === userId
          ? latest.recipient_name
          : latest.sender_name) || "Unknown colleague",
      messages: sorted,
      latest,
      unreadCount: unread.length,
      topUnreadPriority: top,
    });
  }

  return threads.sort((a, b) => {
    const ua = a.unreadCount > 0 ? 1 : 0;
    const ub = b.unreadCount > 0 ? 1 : 0;
    if (ua !== ub) return ub - ua;
    if (ua === 1) {
      const pr = priorityRank(b.topUnreadPriority) - priorityRank(a.topUnreadPriority);
      if (pr !== 0) return pr;
    }
    return timeOf(b.latest.created_at) - timeOf(a.latest.created_at);
  });
}

// ── Patient message threads ──────────────────────────────────────────────────

export interface PatientThread {
  patient_id: string;
  /** Display name; `nameKnown` is false when only a placeholder is shown. */
  patient_name: string;
  nameKnown: boolean;
  latest_message: PatientSecureMessage;
  /** Messages from the patient that no staff member has opened yet. */
  unread_count: number;
  /** Oldest first. */
  messages: PatientSecureMessage[];
  /** The latest message is from the patient, so the thread needs a reply. */
  awaitingReply: boolean;
}

export const UNKNOWN_PATIENT_NAME = "Patient name not available";

/**
 * Group patient portal messages into one thread per patient. The name comes
 * from the patient's most recent message; `fallbackNames` (e.g. from the
 * records on this device) covers threads that only contain staff messages.
 *
 * Order: unread first, then threads waiting for a staff reply, then the
 * rest; newest activity first within each group. There is no urgency field
 * on patient messages, so none is inferred.
 */
export function buildPatientThreads(
  messages: readonly PatientSecureMessage[],
  fallbackNames: ReadonlyMap<string, string> = new Map(),
): PatientThread[] {
  const byPatient = new Map<string, PatientSecureMessage[]>();
  for (const m of messages) {
    const list = byPatient.get(m.patient_id);
    if (list) list.push(m);
    else byPatient.set(m.patient_id, [m]);
  }

  const threads: PatientThread[] = [];
  for (const [patient_id, list] of byPatient) {
    const sorted = [...list].sort(
      (a, b) => timeOf(a.created_at) - timeOf(b.created_at),
    );
    const latest = sorted[sorted.length - 1];
    const lastFromPatient = [...sorted].reverse().find((m) => m.from_patient);
    const name =
      lastFromPatient?.from_name?.trim() ||
      fallbackNames.get(patient_id)?.trim() ||
      "";
    threads.push({
      patient_id,
      patient_name: name || UNKNOWN_PATIENT_NAME,
      nameKnown: !!name,
      latest_message: latest,
      unread_count: sorted.filter((m) => m.from_patient && !m.read).length,
      messages: sorted,
      awaitingReply: !!latest.from_patient,
    });
  }

  const group = (t: PatientThread) =>
    t.unread_count > 0 ? 0 : t.awaitingReply ? 1 : 2;
  return threads.sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    return (
      timeOf(b.latest_message.created_at) - timeOf(a.latest_message.created_at)
    );
  });
}

// ── Connection wording ───────────────────────────────────────────────────────

export type LiveStatus = "off" | "connecting" | "live";

export type ConnectionKind =
  | "not_configured"
  | "offline"
  | "live"
  | "connecting"
  | "polling";

export interface ConnectionSummary {
  kind: ConnectionKind;
  tone: Tone;
  label: string;
  detail: string;
  /** Whether a send can be attempted right now. */
  canSend: boolean;
}

/**
 * What the connection line at the top of a messaging panel says. Messaging
 * is stored online only, so every state says plainly what works.
 */
export function summariseConnection(input: {
  configured: boolean;
  online: boolean;
  live: LiveStatus;
  pollSeconds?: number;
  /** Whether any messages were loaded from the online service yet. */
  loaded?: boolean;
}): ConnectionSummary {
  const every = input.pollSeconds ?? POLL_SECONDS;
  if (!input.configured) {
    return {
      kind: "not_configured",
      tone: "warning",
      label: "Not set up on this device",
      detail:
        "Messages are kept on the online service, which is not configured here. Nothing can be sent or received.",
      canSend: false,
    };
  }
  if (!input.online) {
    return {
      kind: "offline",
      tone: "warning",
      label: "Offline",
      detail: `${
        input.loaded === false
          ? "No messages have been loaded on this device yet."
          : "Showing messages loaded before the connection dropped."
      } Messages you write wait on this screen until the connection returns.`,
      canSend: false,
    };
  }
  if (input.live === "live") {
    // A subscribed channel does not prove every table is published for
    // realtime, so the polling backstop is stated too.
    return {
      kind: "live",
      tone: "success",
      label: "Live updates on",
      detail: `New messages should appear as they arrive. The list is also checked every ${every} seconds.`,
      canSend: true,
    };
  }
  if (input.live === "connecting") {
    return {
      kind: "connecting",
      tone: "neutral",
      label: "Connecting to live updates",
      detail: `Checking for new messages every ${every} seconds meanwhile.`,
      canSend: true,
    };
  }
  return {
    kind: "polling",
    tone: "neutral",
    label: "Live updates off",
    detail: `This device is not receiving live updates, so it checks for new messages every ${every} seconds.`,
    canSend: true,
  };
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** A log-safe tag for an error: its name or code, never its message. */
export function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === "string" && e.code) return e.code;
    if (typeof e.name === "string" && e.name) return e.name;
  }
  return "unknown";
}

/**
 * Staff-facing text for a failed messaging request. Never includes the
 * server's message (it can echo row contents) and never blames the user.
 *
 * @param action what was attempted, e.g. "send the message".
 */
export function describeMessagingError(
  err: unknown,
  action: string,
  online: boolean,
): string {
  if (!online) {
    return `Could not ${action} because this device is offline. Try again when the connection is back.`;
  }
  const e = (err && typeof err === "object" ? err : {}) as {
    code?: unknown;
    reason?: unknown;
    name?: unknown;
    message?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  if (e.reason === "not_configured") {
    return "Messaging is not set up on this device, so nothing was sent or changed.";
  }
  if (e.reason === "no_rows") {
    return `Nothing was changed. The online service did not let this account ${action}.`;
  }
  if (
    code === "42501" ||
    code === "PGRST301" ||
    /row-level security|permission denied/i.test(message)
  ) {
    return `The online service did not allow this account to ${action}. Ask an administrator to check your access.`;
  }
  if (code === "23503") {
    // Foreign-key violation: on delete, other rows still point at this one;
    // on insert, the row it points at (e.g. the patient) is not online yet.
    return /^delete/i.test(action)
      ? `Could not ${action} because other messages refer to it. Archive it instead.`
      : `Could not ${action}: the linked record is not on the online service yet. Sync this device, then try again.`;
  }
  if (e.name === "TypeError" || /failed to fetch|network/i.test(message)) {
    return `Could not reach the online service to ${action}. Check the connection and try again.`;
  }
  return `Could not ${action}. Try again in a moment.`;
}

// ── Permissions ──────────────────────────────────────────────────────────────

// Any role that works in the clinic (not guests or read-only auditors).
const STAFF_WORK_PERMISSIONS: Permission[] = [
  "register",
  "vitals",
  "consult",
  "dispense",
  "inventory",
  "users",
];

/** Send, archive or delete Palaver Room messages. */
export function canMessageStaff(role: Role | null | undefined): boolean {
  return !!role && STAFF_WORK_PERMISSIONS.some((p) => can(role, p));
}

/**
 * Post or remove announcements. Mirrors the server policy, which allows
 * doctors, lead clinicians and admins.
 */
export function canPostAnnouncements(role: Role | null | undefined): boolean {
  return !!role && (can(role, "consult") || can(role, "users"));
}

/** Reply to, mark read, archive or delete patient portal messages. */
export function canMessagePatients(role: Role | null | undefined): boolean {
  return !!role && can(role, "consult");
}
