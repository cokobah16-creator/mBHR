/**
 * SMS outbox: delivery state, wording and validation.
 *
 * Pure helpers shared by the SMS reminders page, the dashboard outbox and the
 * notification worker. Every state shown to staff is derived from what is
 * actually stored; nothing here guesses that a message went out.
 *
 * Where messages live:
 * - "outbox": the device outbox (IndexedDB mbhr_outbox). Reminders queued at
 *   dispense are stored here.
 * - "queue": the device send queue in the main mBHR database (queueSMS).
 *   Reminders scheduled from the SMS reminders page are stored here.
 * - "server": the medication_reminders table on the mBHR server (Supabase).
 */
import type { Tone } from "@/components/ui/StatusBadge";
import type { SmsTemplateKey } from "@/services/messageTemplates";
import { formatNigerianDateTime } from "@/utils/dateFormat";

export type DeliveryState =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "cancelled";

export type OutboxStore = "outbox" | "queue" | "server";

/** Attempts the worker makes before a message is marked failed. */
export const MAX_SEND_ATTEMPTS = 3;

/** A message left in "sending" this long has no recorded result. */
export const STUCK_SENDING_MS = 10 * 60 * 1000;

/** Longest message the scheduling form accepts (three standard SMS parts). */
export const MAX_MESSAGE_LENGTH = 459;

/** How far ahead a reminder may be scheduled. */
export const MAX_SCHEDULE_DAYS = 90;

/** States a filter can pick, in display order (drafts are never stored). */
export const FILTERABLE_STATES: DeliveryState[] = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "cancelled",
];

export const DELIVERY_STATE_META: Record<
  DeliveryState,
  { label: string; filterLabel: string; tone: Tone }
> = {
  draft: { label: "Draft, not saved", filterLabel: "Draft", tone: "neutral" },
  queued: { label: "Queued", filterLabel: "Queued", tone: "info" },
  sending: { label: "Sending", filterLabel: "Sending", tone: "info" },
  sent: {
    label: "Sent to provider",
    // The filter also holds messages staff marked sent and older records
    // with no provider acceptance stored; their badges say so.
    filterLabel: "Sent",
    tone: "success",
  },
  delivered: { label: "Delivered", filterLabel: "Delivered", tone: "success" },
  failed: { label: "Failed", filterLabel: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", filterLabel: "Cancelled", tone: "neutral" },
};

export const STORE_LABEL: Record<OutboxStore, string> = {
  outbox: "This device",
  queue: "This device",
  server: "Server",
};

/**
 * Payload keys the notification worker writes on a device message when the
 * SMS provider accepted it. A device message marked "sent" without them was
 * not sent by this worker (older app versions and test gateways marked
 * messages sent without sending them), so it is shown as unconfirmed.
 */
export const PROVIDER_ACCEPTED_AT_KEY = "providerAcceptedAt";
export const PROVIDER_MESSAGE_ID_KEY = "providerMessageId";

/** Device outbox templates the notification worker knows how to compose. */
export const WORKER_TEMPLATE_KEYS = [
  "followup.medication",
  "medication_reminder",
  "appointment.reminder",
];

/**
 * Stored in error_message when staff record that a server reminder reached
 * the patient another way (the table has no other column for it).
 */
export const STAFF_SENT_NOTE =
  "Marked sent by staff: the patient got this message another way.";
const STAFF_SENT_MARKER = "marked sent by staff";

/**
 * Who says a "sent" message went out:
 * - "provider": the SMS provider accepted it (recorded by mBHR),
 * - "staff": staff recorded that the patient got it another way,
 * - "unconfirmed": marked sent, but no provider acceptance is stored.
 */
export type SentConfirmation = "provider" | "staff" | "unconfirmed";

// ---------------------------------------------------------------------------
// Stored shapes (structural, so this module does not load the databases)
// ---------------------------------------------------------------------------

type DateLike = Date | string | number | null | undefined;

export interface StoredDeviceMessage {
  id: string;
  patientId: string;
  channel?: string;
  to: string;
  locale?: string;
  templateKey: string;
  payload: Record<string, string | number>;
  status: string;
  createdAt?: DateLike;
  scheduledFor?: DateLike;
  attempts?: number;
  lastAttemptAt?: DateLike;
  errorMessage?: string;
  deliveryReceiptAt?: DateLike;
}

export interface StoredServerReminder {
  id?: string;
  patientId: string;
  medicationName: string;
  dosage: string;
  scheduledAt: DateLike;
  phoneNumber: string;
  message: string;
  status?: string;
  sentAt?: DateLike;
  errorMessage?: string;
}

export interface OutboxItem {
  /** Unique across stores: `${store}:${id}`. */
  key: string;
  id: string;
  store: OutboxStore;
  state: DeliveryState;
  patientId: string;
  /** Name carried in the message payload, when there is one. */
  payloadPatientName?: string;
  phone: string;
  /** Short description for lists, e.g. "Amoxicillin · 500 mg". */
  title: string;
  /** Exact text when it is stored; template messages are composed at send time. */
  text?: string;
  templateKey?: string;
  locale?: string;
  payload?: Record<string, string | number>;
  scheduledFor?: Date;
  createdAt?: Date;
  lastAttemptAt?: Date;
  /** When it was recorded as sent (see sentConfirmation for by whom). */
  sentAt?: Date;
  /** Set for "sent" and "delivered" items. */
  sentConfirmation?: SentConfirmation;
  /** Only set when a delivery receipt is stored. */
  deliveredAt?: Date;
  attempts: number;
  errorMessage?: string;
}

function toDate(value: DateLike): Date | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

function payloadText(
  payload: Record<string, string | number> | undefined,
  key: string,
): string {
  const v = payload?.[key];
  return v === undefined || v === null ? "" : String(v).trim();
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

/**
 * State of a message stored on this device. "delivered" is only reported when
 * a delivery receipt time is stored; a provider accepting the message is
 * "sent".
 */
export function stateFromDeviceStatus(
  status: string | undefined,
  deliveryReceiptAt?: DateLike,
): DeliveryState {
  switch (status) {
    case "draft":
      return "draft";
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return toDate(deliveryReceiptAt) ? "delivered" : "sent";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "queued":
    default:
      // Unknown values are treated as not sent.
      return "queued";
  }
}

/** State of a medication_reminders row on the server. */
export function stateFromServerStatus(status: string | undefined): DeliveryState {
  switch (status) {
    case "sent":
    case "delivered": // no receipt column on the server table
      return "sent";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
    default:
      return "queued";
  }
}

export function deviceMessageTitle(msg: {
  templateKey: string;
  payload: Record<string, string | number>;
}): string {
  const medication = payloadText(msg.payload, "medicationName");
  const dosage = payloadText(msg.payload, "dosage");
  if (medication) return dosage ? `${medication} · ${dosage}` : medication;
  if (msg.templateKey === "appointment.reminder") return "Appointment reminder";
  return "SMS message";
}

export function fromDeviceMessage(
  msg: StoredDeviceMessage,
  store: "outbox" | "queue",
): OutboxItem {
  const text = payloadText(msg.payload, "message");
  const state = stateFromDeviceStatus(msg.status, msg.deliveryReceiptAt);
  const lastAttemptAt = toDate(msg.lastAttemptAt);
  const isSent = state === "sent" || state === "delivered";
  const acceptedAt = toDate(payloadText(msg.payload, PROVIDER_ACCEPTED_AT_KEY));
  // Earlier worker versions stored a real provider acceptance as "delivered".
  const sentConfirmation: SentConfirmation | undefined = !isSent
    ? undefined
    : acceptedAt || msg.status === "delivered"
      ? "provider"
      : "unconfirmed";
  return {
    key: `${store}:${msg.id}`,
    id: msg.id,
    store,
    state,
    patientId: msg.patientId,
    payloadPatientName: payloadText(msg.payload, "patientName") || undefined,
    phone: msg.to || "",
    title: deviceMessageTitle(msg),
    text: text || undefined,
    templateKey: msg.templateKey,
    locale: msg.locale,
    payload: msg.payload,
    scheduledFor: toDate(msg.scheduledFor),
    createdAt: toDate(msg.createdAt),
    lastAttemptAt,
    // The worker stores the acceptance time; older records only have the
    // last attempt, which is when they were marked sent.
    sentAt: isSent ? acceptedAt ?? lastAttemptAt : undefined,
    sentConfirmation,
    deliveredAt: toDate(msg.deliveryReceiptAt),
    attempts: msg.attempts ?? 0,
    errorMessage: msg.errorMessage || undefined,
  };
}

/** A server reminder staff marked sent (the patient got it another way). */
export function isStaffMarkedSent(errorMessage: string | undefined): boolean {
  return (errorMessage || "").trim().toLowerCase().startsWith(STAFF_SENT_MARKER);
}

/**
 * Stored by the notification worker when the SMS provider accepted a server
 * reminder. Rows marked sent before this marker existed (demo mode, the old
 * "Mark sent" button) carry no evidence and are shown as not confirmed.
 */
export const PROVIDER_ACCEPTED_MARKER = "accepted by sms provider";

export function isProviderAccepted(errorMessage: string | undefined): boolean {
  return (errorMessage || "").trim().toLowerCase().startsWith(PROVIDER_ACCEPTED_MARKER);
}

export function fromServerReminder(r: StoredServerReminder): OutboxItem {
  const id = r.id ?? "";
  const state = stateFromServerStatus(r.status);
  return {
    key: `server:${id}`,
    id,
    store: "server",
    state,
    sentConfirmation:
      state === "sent"
        ? isStaffMarkedSent(r.errorMessage)
          ? "staff"
          : isProviderAccepted(r.errorMessage)
            ? "provider"
            : "unconfirmed"
        : undefined,
    patientId: r.patientId,
    phone: r.phoneNumber || "",
    title: r.dosage ? `${r.medicationName} · ${r.dosage}` : r.medicationName,
    text: r.message || undefined,
    scheduledFor: toDate(r.scheduledAt),
    sentAt: toDate(r.sentAt),
    attempts: 0,
    errorMessage: r.errorMessage || undefined,
  };
}

export function isDue(item: Pick<OutboxItem, "scheduledFor">, now: Date): boolean {
  return !item.scheduledFor || item.scheduledFor.getTime() <= now.getTime();
}

/** "Sending" with no result recorded for a long time (app closed mid-send). */
export function isStuckSending(
  item: Pick<OutboxItem, "state" | "lastAttemptAt" | "createdAt">,
  now: Date,
): boolean {
  if (item.state !== "sending") return false;
  const started = item.lastAttemptAt ?? item.createdAt;
  if (!started) return true;
  return now.getTime() - started.getTime() > STUCK_SENDING_MS;
}

export function canRetry(item: OutboxItem, now: Date): boolean {
  if (item.store === "server") return false; // server rows use "Send now"
  return item.state === "failed" || isStuckSending(item, now);
}

export function canCancel(item: OutboxItem): boolean {
  return item.store !== "server" && item.state === "queued";
}

/** Server reminders can be sent straight away when due or after a failure. */
export function canSendServerNow(item: OutboxItem, now: Date): boolean {
  if (item.store !== "server" || !item.id) return false;
  return item.state === "failed" || (item.state === "queued" && isDue(item, now));
}

/** Manual "sent myself" / "mark failed" apply to due server reminders. */
export function canMarkServerManually(item: OutboxItem, now: Date): boolean {
  return (
    item.store === "server" && !!item.id && item.state === "queued" && isDue(item, now)
  );
}

export type StateCounts = Record<DeliveryState, number> & { all: number };

export function countByState(items: Pick<OutboxItem, "state">[]): StateCounts {
  const counts: StateCounts = {
    all: 0,
    draft: 0,
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const item of items) {
    counts.all++;
    counts[item.state]++;
  }
  return counts;
}

const STATE_RANK: Record<DeliveryState, number> = {
  failed: 0,
  sending: 1,
  queued: 2,
  draft: 3,
  sent: 4,
  delivered: 4,
  cancelled: 5,
};

function activityTime(item: OutboxItem): number {
  return (
    item.deliveredAt ??
    item.sentAt ??
    item.lastAttemptAt ??
    item.scheduledFor ??
    item.createdAt ??
    new Date(0)
  ).getTime();
}

/**
 * Problems first, then what is still to be sent (soonest first), then
 * finished messages (most recent first).
 */
export function sortOutbox(items: OutboxItem[]): OutboxItem[] {
  return [...items].sort((a, b) => {
    const rank = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rank !== 0) return rank;
    if (a.state === "queued") {
      const at = a.scheduledFor?.getTime() ?? 0;
      const bt = b.scheduledFor?.getTime() ?? 0;
      return at - bt;
    }
    return activityTime(b) - activityTime(a);
  });
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export type SendingBlocker = "not_configured" | "offline";

export interface SendingContext {
  now: Date;
  /** Why this device cannot send right now, or null when it can. */
  blocker: SendingBlocker | null;
  /** Automatic sending (notification worker) is running on this device. */
  autoSending: boolean;
}

export function formatWhen(date: Date | undefined): string {
  return date ? formatNigerianDateTime(date) : "";
}

/**
 * Badge tone for one item. Queued items that are due but cannot go out (or
 * already had a failed attempt), and sends with no recorded result, are
 * raised to warning.
 */
export function stateTone(
  item: Pick<
    OutboxItem,
    "state" | "scheduledFor" | "attempts" | "lastAttemptAt" | "createdAt" | "store" | "sentConfirmation"
  >,
  now: Date,
  blocker: SendingBlocker | null,
): Tone {
  if (item.state === "queued" && isDue(item, now)) {
    if (item.attempts > 0) return "warning";
    if (blocker && item.store !== "server") return "warning";
  }
  if (isStuckSending(item, now)) return "warning";
  if (item.state === "sent" && item.sentConfirmation === "unconfirmed") return "warning";
  if (item.state === "sent" && item.sentConfirmation === "staff") return "neutral";
  return DELIVERY_STATE_META[item.state].tone;
}

/**
 * Badge text for one item: adds where it waits for queued messages and who
 * recorded a sent message as sent.
 */
export function stateLabel(
  item: Pick<OutboxItem, "state" | "store" | "sentConfirmation">,
): string {
  if (item.state === "queued") {
    return item.store === "server" ? "Waiting on server" : "Queued on this device";
  }
  if (item.state === "sent" && item.sentConfirmation === "staff") return "Marked sent by staff";
  if (item.state === "sent" && item.sentConfirmation === "unconfirmed") {
    return "Marked sent, not confirmed";
  }
  return DELIVERY_STATE_META[item.state].label;
}

/** Label for the time a sent message was recorded, by who recorded it. */
export function sentAtLabel(confirmation: SentConfirmation | undefined): string {
  if (confirmation === "staff") return "Marked sent";
  if (confirmation === "unconfirmed") return "Marked sent";
  return "Accepted by provider";
}

/** Stored before a reason typed by staff when they mark a reminder failed. */
export const STAFF_FAILURE_PREFIX = "Marked failed by staff:";

/**
 * Plain-language reason for a stored error. Stored errors come from the SMS
 * provider, the server function or this device; staff see this sentence and
 * can open the technical detail if they need it.
 */
export function describeFailure(error: string | undefined): string {
  const e = (error || "").toLowerCase();
  if (!e) return "No reason was recorded.";
  if (e.startsWith(STAFF_FAILURE_PREFIX.toLowerCase())) {
    const reason = (error || "").slice(STAFF_FAILURE_PREFIX.length).trim();
    return reason ? `Marked as failed by staff: ${reason}` : "Marked as failed by staff.";
  }
  if (/demo/.test(e))
    return "SMS demo mode is on. The server logged the message but did not send it to the patient.";
  if (/mock/.test(e))
    return "A test gateway was used, so the message was not sent to the patient.";
  // The portal invitation worker on this device stores this one.
  if (/sms\/email provider not configured/.test(e))
    return "Not sent: the background sender on this device has no SMS provider connected.";
  if (/not_configured|not configured|no sms provider/.test(e))
    return "No SMS provider is set up on the server. An administrator needs to set one up before messages can go out.";
  if (/invalid phone|phone number and message are required/.test(e))
    return "The phone number is not valid. Check the number, then schedule the reminder again.";
  if (/rate.?limit|too many|\b429\b/.test(e))
    return "Too many messages were sent at once. Try again in a few minutes.";
  if (/template|message text could not/.test(e))
    return "The message text could not be prepared on this device.";
  if (/failed to fetch|network|load failed|offline|timed? ?out/.test(e))
    return "The device could not reach the SMS service. Check the internet connection and try again.";
  if (/max retries|maximum attempts/.test(e))
    return `Tried ${MAX_SEND_ATTEMPTS} times without success.`;
  return "The SMS service did not accept the message.";
}

/** One sentence saying what happens next for a queued or sending item. */
export function explainState(item: OutboxItem, ctx: SendingContext): string {
  const { now, blocker, autoSending } = ctx;

  if (item.state === "sending") {
    return isStuckSending(item, now)
      ? "No result was recorded for this send. It may or may not have reached the patient. Check with the patient before you retry."
      : "Being sent now.";
  }

  if (item.state === "failed") return describeFailure(item.errorMessage);

  if (item.state === "cancelled") return "Cancelled. It will not be sent.";

  if (item.state === "sent") {
    const on = item.sentAt ? ` on ${formatWhen(item.sentAt)}` : "";
    if (item.sentConfirmation === "staff") {
      return `Staff recorded${on} that the patient got this message another way. mBHR did not send it.`;
    }
    if (item.sentConfirmation === "unconfirmed") {
      return `Marked as sent${on}, but no SMS provider acceptance is stored for it. Older versions of mBHR and test gateways marked messages sent without sending them, so it may not have reached the patient. No delivery receipt is stored.`;
    }
    return item.store === "server"
      ? `Recorded on the server as accepted by the SMS provider${on}. No delivery receipt is stored.`
      : `Accepted by the SMS provider${on}. No delivery receipt is stored.`;
  }

  if (item.state === "delivered") {
    return item.deliveredAt
      ? `Delivery receipt recorded on ${formatWhen(item.deliveredAt)}.`
      : "Delivery receipt recorded.";
  }

  if (item.state === "draft") return "Not saved yet. Nothing will be sent.";

  // queued
  const due = isDue(item, now);
  const retryNote =
    item.attempts > 0 && item.errorMessage
      ? `Attempt ${item.attempts} of ${MAX_SEND_ATTEMPTS} did not go through: ${describeFailure(item.errorMessage)} `
      : "";

  if (item.store === "server") {
    if (!due) return `${retryNote}Stored on the server for ${formatWhen(item.scheduledFor)}.`;
    return `${retryNote}Due. Sent when someone presses Send due messages now or while automatic sending is on.`;
  }

  if (blocker === "not_configured") {
    return `${retryNote}Saved on this device only. This device is not connected to the mBHR server, so it will not be sent until that is set up.`;
  }
  if (!due) {
    return `${retryNote}Scheduled. It will be tried from ${formatWhen(item.scheduledFor)} when this device is online and sending runs.`;
  }
  if (blocker === "offline") {
    return `${retryNote}Due, but this device is offline. It waits here and is tried when the device is back online and sending runs.`;
  }
  if (autoSending) return `${retryNote}Due. Automatic sending will try it shortly.`;
  return `${retryNote}Due. Press Send due messages now to send it.`;
}

/** Result of one send run (services/notificationWorker processNow). */
export interface RunResult {
  reminders: number;
  messages: number;
  failed?: number;
  skipped?: SendingBlocker | "busy";
}

/** Plain summary of a send run. Accepted is never called delivered. */
export function describeRun(result: RunResult): string {
  if (result.skipped === "offline") {
    return "Nothing was sent: this device is offline. Queued reminders stay on this device.";
  }
  if (result.skipped === "not_configured") {
    return "Nothing was sent: SMS sending is not set up on this device.";
  }
  if (result.skipped === "busy") {
    return "A send run was already in progress. Check the list again in a moment.";
  }
  const accepted = result.reminders + result.messages;
  const failed = result.failed ?? 0;
  if (accepted === 0 && failed === 0) return "Nothing was due.";
  const parts: string[] = [];
  if (accepted > 0) {
    parts.push(
      `${accepted} ${accepted === 1 ? "message" : "messages"} accepted by the SMS provider`,
    );
  }
  if (failed > 0) parts.push(`${failed} not sent`);
  return `${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * Same rules as the send-sms-reminder server function: Nigerian local
 * numbers (0803 123 4567) or international numbers. Returns digits without
 * "+", e.g. "2348031234567", or null if it cannot be a phone number.
 */
export function normalizeMsisdn(raw: string): string | null {
  const cleaned = (raw || "").replace(/[\s\-().]/g, "");
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned.slice(1);
  if (/^0\d{10}$/.test(cleaned)) return `234${cleaned.slice(1)}`;
  if (/^\d{8,15}$/.test(cleaned)) return cleaned;
  return null;
}

/**
 * Stricter rule for numbers typed into the scheduling form. The server's
 * rule accepts any 8-15 digits, so "803 123 4567" (leading 0 dropped) would
 * be sent to "+8031234567", a different country. Here bare digits are only
 * accepted as a Nigerian number: 0803..., 234803..., or a 10-digit mobile
 * starting 7, 8 or 9. Other international numbers need a leading "+".
 * Returns digits without "+" (e.g. "2348031234567") or null.
 */
export function normalizeReminderPhone(raw: string): string | null {
  const cleaned = (raw || "").replace(/[\s\-().]/g, "");
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned.slice(1);
  if (/^0\d{10}$/.test(cleaned)) return `234${cleaned.slice(1)}`;
  if (/^234\d{10}$/.test(cleaned)) return cleaned;
  if (/^[789]\d{9}$/.test(cleaned)) return `234${cleaned}`;
  return null;
}

/** Local Nigerian digits ("08031234567") when possible, else all digits. */
function localDigits(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) return `0${digits.slice(3)}`;
  return digits;
}

/** Full number for detail views and dialling: "0803 123 4567". */
export function formatPhone(phone: string): string {
  const d = localDigits(phone);
  if (d.length === 11 && d.startsWith("0")) {
    return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  }
  return (phone || "").trim();
}

/** Masked number for dense lists: "0803 *** 4567". */
export function maskPhone(phone: string): string {
  const d = localDigits(phone);
  if (!d) return "";
  if (d.length < 8) return "***";
  if (d.length === 11 && d.startsWith("0")) return `${d.slice(0, 4)} *** ${d.slice(7)}`;
  return `${d.slice(0, 3)} *** ${d.slice(-4)}`;
}

export function telHref(phone: string): string {
  const n = normalizeMsisdn(phone);
  return n ? `tel:+${n}` : `tel:${(phone || "").replace(/[^\d+]/g, "")}`;
}

// ---------------------------------------------------------------------------
// Message text
// ---------------------------------------------------------------------------

export type SmsLocale = "en" | "ha" | "yo" | "ig" | "pcm";

export const SMS_LOCALES: { value: SmsLocale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ha", label: "Hausa" },
  { value: "yo", label: "Yorùbá" },
  { value: "ig", label: "Igbo" },
  { value: "pcm", label: "Nigerian Pidgin" },
];

/** Patient preferences store the language as free text ("Hausa", "yo"). */
export function localeFromPreference(pref: string | undefined | null): SmsLocale {
  const p = (pref || "").trim().toLowerCase();
  if (!p) return "en";
  if (p === "ha" || p.startsWith("hausa")) return "ha";
  if (p === "yo" || p.startsWith("yoruba") || p.startsWith("yorùbá")) return "yo";
  if (p === "ig" || p.startsWith("igbo")) return "ig";
  if (p === "pcm" || p.includes("pidgin")) return "pcm";
  return "en";
}

/**
 * Whether the notification worker should send this device outbox message:
 * SMS with stored text, or a template it knows. Anything else (for example a
 * future portal invitation) is left queued for the code that queued it.
 */
export function isWorkerSendable(msg: {
  channel?: string;
  templateKey: string;
  payload: Record<string, string | number>;
}): boolean {
  if (msg.channel !== undefined && msg.channel !== "sms") return false;
  if (payloadText(msg.payload, "message")) return true;
  return WORKER_TEMPLATE_KEYS.includes(msg.templateKey);
}

/**
 * How the text of a stored device message is produced at send time: stored
 * text is sent as-is; dispense reminders are composed from the SMS templates.
 */
export function outboxTemplateFor(msg: {
  templateKey: string;
  locale?: string;
  payload: Record<string, string | number>;
}):
  | { kind: "text"; text: string }
  | { kind: "template"; key: SmsTemplateKey; locale: SmsLocale; vars: Record<string, string> }
  | null {
  const text = payloadText(msg.payload, "message");
  if (text) return { kind: "text", text };

  const locale = localeFromPreference(msg.locale);
  const patientName = payloadText(msg.payload, "patientName") || "Patient";

  if (msg.templateKey === "followup.medication" || msg.templateKey === "medication_reminder") {
    const medication = payloadText(msg.payload, "medicationName");
    if (!medication) return null;
    return {
      kind: "template",
      key: "medication_reminder",
      locale,
      vars: {
        patient_name: patientName,
        medication,
        dosage: payloadText(msg.payload, "dosage"),
      },
    };
  }

  if (msg.templateKey === "appointment.reminder") {
    const date = [payloadText(msg.payload, "date"), payloadText(msg.payload, "time")]
      .filter(Boolean)
      .join(" ");
    if (!date) return null;
    return {
      kind: "template",
      key: "follow_up_reminder",
      locale,
      vars: {
        patient_name: patientName,
        date,
        site_name: payloadText(msg.payload, "clinicName") || "the clinic",
      },
    };
  }

  return null;
}

/**
 * Rough SMS part count. Characters outside plain ASCII switch the message to
 * Unicode (70 per part), which is common with Yorùbá and Igbo tone marks.
 */
export function estimateSmsParts(text: string): {
  chars: number;
  parts: number;
  unicode: boolean;
} {
  const chars = Array.from(text || "").length;
  const unicode = /[^\n\r\x20-\x7E]/.test(text || "");
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const parts = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi);
  return { chars, parts, unicode };
}

// ---------------------------------------------------------------------------
// Scheduling form
// ---------------------------------------------------------------------------

export interface ReminderDraft {
  patientId: string;
  phone: string;
  medicationName: string;
  dosage: string;
  message: string;
  /** yyyy-mm-dd from <input type="date"> */
  sendDate: string;
  /** HH:mm from <input type="time"> */
  sendTime: string;
}

export type ReminderDraftErrors = Partial<Record<keyof ReminderDraft, string>>;

/** Local date and time from the form inputs, or null if incomplete. */
export function parseSendAt(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^\d{2}:\d{2}$/.test(time || "")) {
    return null;
  }
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const result = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (
    isNaN(result.getTime()) ||
    result.getFullYear() !== y ||
    result.getMonth() !== m - 1 ||
    result.getDate() !== d
  ) {
    return null;
  }
  return result;
}

export function validateReminderDraft(
  draft: ReminderDraft,
  now: Date,
): ReminderDraftErrors {
  const errors: ReminderDraftErrors = {};

  if (!draft.patientId) errors.patientId = "Choose the patient this reminder is for.";

  if (!draft.phone.trim()) {
    errors.phone = "Enter the patient's phone number.";
  } else if (!normalizeReminderPhone(draft.phone)) {
    errors.phone =
      "Enter a Nigerian mobile number such as 0803 123 4567, or an international number starting with +.";
  }

  if (!draft.medicationName.trim()) errors.medicationName = "Enter the medicine name.";
  if (!draft.dosage.trim()) errors.dosage = "Enter the dose, for example 500 mg or 1 tablet.";

  const message = draft.message.trim();
  if (!message) {
    errors.message = "Enter the message text.";
  } else if (Array.from(message).length > MAX_MESSAGE_LENGTH) {
    errors.message = `Shorten the message to ${MAX_MESSAGE_LENGTH} characters or fewer.`;
  }

  const sendAt = parseSendAt(draft.sendDate, draft.sendTime);
  if (!sendAt) {
    errors.sendDate = "Choose the date and time to send.";
  } else if (sendAt.getTime() < now.getTime() - 60_000) {
    errors.sendDate = "That time has passed. Choose a time from now onwards.";
  } else if (sendAt.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
    errors.sendDate = `Choose a date within the next ${MAX_SCHEDULE_DAYS} days.`;
  }

  return errors;
}

/** yyyy-mm-dd and HH:mm for the form's default: tomorrow at 09:00. */
export function defaultSendSlot(now: Date): { date: string; time: string } {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: "09:00",
  };
}

/** Today's date for the date input's min attribute. */
export function todayInputValue(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
