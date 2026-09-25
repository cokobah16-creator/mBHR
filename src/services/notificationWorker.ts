import { supabase } from "../lib/supabase";
import { isSignedInStaffAccount } from "@/lib/cloudSession";
import { db, OutboundMessage } from "../db";
import { outboxDb } from "../db/outbox";
import { composeSms } from "./messageTemplates";
import { getPatientPreference } from "./preferences";
import {
  REMINDER_SKIP_MESSAGE,
  isReminderOptedOut,
  type ReminderKind,
} from "./reminderEligibility";
import {
  MAX_SEND_ATTEMPTS,
  PROVIDER_ACCEPTED_AT_KEY,
  PROVIDER_MESSAGE_ID_KEY,
  SERVER_REMINDER_KIND,
  isWorkerSendable,
  outboxTemplateFor,
  reminderKindForTemplateKey,
  type SendingBlocker,
} from "@/features/notifications/smsOutbox";

/**
 * Sends due SMS through the send-sms-reminder server function. It covers
 * three stores:
 * - medication_reminders on the server (Supabase),
 * - the device send queue in the main database (queueSMS),
 * - the device outbox where dispense reminders are queued.
 *
 * Honesty rules: a message is only marked "sent" when the provider accepted
 * it, never "delivered" (that needs a delivery receipt). When the server is
 * not configured, the device is offline or nobody is signed in online,
 * nothing is attempted, so queued messages stay queued on this device.
 *
 * Security: this device never holds SMS provider keys and never chooses the
 * phone number. It sends the signed-in staff member's access token plus a
 * reminder id or patient id; the server checks the staff role, looks up the
 * number and applies rate limits.
 *
 * Server reminders (medication_reminders): this device never writes their
 * status. Under RLS only 'dispense' holders may update that table, while
 * nurses and doctors may send too, so the send-sms-reminder function records
 * the outcome with the service role (sent + provider-accepted marker only
 * after the provider accepted it) and refuses a reminder already marked sent
 * (409 already_sent), so a patient is never texted twice for one reminder.
 *
 * Opt-outs: right before each reminder is sent, the patient's reminder
 * setting on this device is checked again (checkReminderOptOut). A reminder
 * the patient has since turned off is not sent. Device messages (the send
 * queue and the outbox) are marked "cancelled" with the opt-out reason.
 * Server reminders are only skipped on this device, run by run: this device
 * does not write their status (see above), so they stay pending on the
 * server. They are counted as not sent, and each run pages past them (oldest
 * first) so they do not hold back other patients' due reminders. A setting
 * that cannot be read holds the message; it is not sent.
 * One-time codes and televisit links are transactional and never held
 * back (reminderKindForTemplateKey).
 */

interface SMSResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  demo?: boolean;
  /**
   * For a stored reminder: whether the server recorded the outcome on it.
   * Undefined when no reminder id was sent (or an older server).
   */
  reminderRecorded?: boolean;
  /** The server refused because the reminder is already recorded as sent. */
  alreadySent?: boolean;
  /**
   * The server did not try to send it (signed out, role not allowed, or a
   * send limit was hit). The message keeps its attempts and stays queued.
   */
  hold?: SendHold;
}

interface SendHold {
  /** Stop this run: every further send would be refused the same way. */
  stopRun: boolean;
  /** Earliest time to try again, from the server's Retry-After. */
  retryAfterMs?: number;
  /** Sign-in or role problem that blocks every send from this device. */
  blocker?: SendingBlocker;
}

/** Who the server should send to. The server looks up the number. */
interface SendTarget {
  /** A medication_reminders row on the server. */
  reminderId?: string;
  /** A patient on the server; their registered phone number is used. */
  patientId?: string;
}

export interface ProcessResult {
  /** Server reminders the provider accepted. */
  reminders: number;
  /** Device messages the provider accepted. */
  messages: number;
  /**
   * Messages not sent in this run: failed or held attempts, device reminders
   * cancelled because the patient turned them off, and server reminders
   * skipped for the same reason (they stay pending on the server).
   */
  failed?: number;
  /** Why nothing was attempted, if so. */
  skipped?: SendingBlocker | "busy";
}

const MAX_RETRIES = MAX_SEND_ATTEMPTS;
const RETRY_DELAYS = [60000, 300000, 900000];
const BATCH_SIZE = 10;
/** Due server reminders read per request. */
const REMINDER_PAGE_SIZE = 50;
/**
 * Requests for due server reminders in one run. Rows this device skips
 * (patient opted out, for example) are paged past, up to
 * REMINDER_PAGE_SIZE * MAX_REMINDER_PAGES rows a run.
 */
const MAX_REMINDER_PAGES = 10;

/** Stored error for a server running in SMS demo mode (logged, not sent). */
export const SMS_DEMO_MODE_ERROR =
  "sms_demo_mode: the server logged this message but did not send it";
const NOT_CONFIGURED_ERROR = "sms_not_configured";
/** Stored when nobody is signed in online on this device. */
export const SMS_NOT_SIGNED_IN_ERROR =
  "not_authenticated: sign in online with a staff account to send SMS";
const TEMPLATE_ERROR = "message text could not be prepared";
/** Wait after the server could not check the account or send limit. */
const SERVER_BUSY_RETRY_MS = 60_000;
/** Wait for a sync when the patient is not on the server yet. */
const NOT_SYNCED_RETRY_MS = 5 * 60_000;
/** Stored on a device reminder that was not sent because the patient opted out. */
const OPTED_OUT_ERROR = REMINDER_SKIP_MESSAGE.opted_out;
/** Stored when the patient's reminder setting could not be read here. */
export const PREFERENCE_CHECK_ERROR =
  "preference_check_failed: the patient's reminder settings could not be read on this device";

let isProcessing = false;
/**
 * Server reminders the provider accepted from this device while the server
 * could not record it (reminderRecorded false). They still read as pending,
 * so they are skipped here to avoid texting the patient twice.
 */
const acceptedUnrecorded = new Set<string>();
/**
 * Returned for a reminder skipped because of acceptedUnrecorded. Its own code
 * (not already_sent): the server does not record this reminder as sent.
 */
export const SMS_ACCEPTED_NOT_RECORDED_ERROR =
  "accepted_not_recorded: the SMS provider accepted this reminder from this device, but the server record could not be updated";
let processingInterval: ReturnType<typeof setInterval> | null = null;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : String(error);
}

function serverConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return !!url && !!key && url !== "your_supabase_project_url_here";
}

/**
 * Why this device cannot send SMS right now, or null when it can try.
 * "not_configured": no mBHR server connection in this build.
 * "offline": the device reports no network.
 */
export function getSmsSendingBlocker(): SendingBlocker | null {
  if (!serverConfigured()) return "not_configured";
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  return null;
}

/**
 * Access token of the staff member signed in online, or null. A PIN unlock
 * of an offline workspace has no online session, so it cannot send SMS.
 */
async function staffAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    // Only the signed-in staff member's own online sign-in, never another
    // account's left in this browser.
    if (!isSignedInStaffAccount(data?.session?.user?.id)) return null;
    return data?.session?.access_token ?? null;
  } catch (error) {
    console.warn("Could not read the online session:", errorName(error));
    return null;
  }
}

function retryAfterMs(response: Response, body: { retry_after_seconds?: unknown }): number {
  const fromBody = Number(body?.retry_after_seconds);
  const fromHeader = Number(response.headers?.get?.("Retry-After"));
  const seconds =
    Number.isFinite(fromBody) && fromBody > 0
      ? fromBody
      : Number.isFinite(fromHeader) && fromHeader > 0
        ? fromHeader
        : 60;
  return seconds * 1000;
}

async function sendSMS(
  target: SendTarget,
  message: string,
): Promise<SMSResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Never report success when nothing could be sent.
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  const token = await staffAccessToken();
  if (!token) {
    return {
      success: false,
      error: SMS_NOT_SIGNED_IN_ERROR,
      hold: { stopRun: true, blocker: "signed_out" },
    };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-sms-reminder`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseKey,
          "Content-Type": "application/json",
        },
        // No phone number: the server uses the one on the reminder or the
        // patient record.
        body: JSON.stringify({
          purpose: target.reminderId ? "medication_reminder" : "patient_message",
          message,
          reminderId: target.reminderId,
          patientId: target.patientId,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      // Log the status only; bodies never carry the number, but keep logs lean.
      console.error("SMS API error: HTTP", response.status);
      let parsed: {
        error?: string;
        message?: string;
        scope?: string;
        retry_after_seconds?: unknown;
        reminderRecorded?: unknown;
      } = {};
      try {
        parsed = JSON.parse(errorText) ?? {};
      } catch {
        // plain-text body
      }
      const code = parsed.error || `HTTP ${response.status}`;
      const error = parsed.message ? `${code}: ${parsed.message}` : parsed.error || errorText.slice(0, 200) || code;

      if (response.status === 401) {
        return { success: false, error, hold: { stopRun: true, blocker: "signed_out" } };
      }
      if (response.status === 403) {
        return { success: false, error, hold: { stopRun: true, blocker: "not_permitted" } };
      }
      // The reminder is already recorded as sent: the server did not text
      // the patient again. Nothing to retry.
      if (response.status === 409 && parsed.error === "already_sent") {
        return { success: false, error, alreadySent: true };
      }
      // The server refused before trying the provider because it could not
      // check the account, the record or the send limit: nothing was sent,
      // so keep the attempts and try again shortly.
      if (
        response.status === 503 &&
        (parsed.error === "rate_limit_unavailable" ||
          parsed.error === "staff_lookup_failed" ||
          parsed.error === "lookup_failed")
      ) {
        return {
          success: false,
          error,
          hold: { stopRun: true, retryAfterMs: SERVER_BUSY_RETRY_MS },
        };
      }
      // Patient not on the server yet (device not synced): not attempted.
      // Wait for a sync instead of using up retries.
      if (response.status === 404 && parsed.error === "patient_not_found") {
        return {
          success: false,
          error,
          hold: { stopRun: false, retryAfterMs: NOT_SYNCED_RETRY_MS },
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          error: `rate limited (429): ${error}`,
          hold: {
            // A per-user limit applies to every message; a per-recipient
            // limit only to this patient.
            stopRun: parsed.scope !== "recipient",
            retryAfterMs: retryAfterMs(response, parsed),
          },
        };
      }
      // The server may have recorded the refusal on a stored reminder
      // (no_phone, invalid_recipient, provider rejected).
      return {
        success: false,
        error,
        reminderRecorded:
          typeof parsed.reminderRecorded === "boolean" ? parsed.reminderRecorded : undefined,
      };
    }

    return (await response.json()) as SMSResult;
  } catch (error) {
    console.error("SMS send error:", errorName(error));
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

interface SendOutcome {
  ok: boolean;
  error?: string;
  messageId?: string;
  /** See SMSResult.reminderRecorded. */
  reminderRecorded?: boolean;
  /** See SMSResult.alreadySent. */
  alreadySent?: boolean;
  /** Not attempted by the server; keep the message queued as it was. */
  hold?: SendHold;
}

/** Only a real (non-demo) acceptance counts as sent. */
function outcome(result: SMSResult): SendOutcome {
  const recorded = { reminderRecorded: result.reminderRecorded };
  if (result.success && !result.demo) {
    return { ok: true, messageId: result.messageId, ...recorded };
  }
  if (result.success && result.demo) {
    return { ok: false, error: SMS_DEMO_MODE_ERROR, ...recorded };
  }
  return {
    ok: false,
    error: result.error || "Send failed",
    hold: result.hold,
    alreadySent: result.alreadySent,
    ...recorded,
  };
}

/** When a held message may be tried again (ISO), or undefined for "now". */
function heldUntil(hold: SendHold): Date | undefined {
  return hold.retryAfterMs ? new Date(Date.now() + hold.retryAfterMs) : undefined;
}

/**
 * Result of the send-time opt-out check:
 * - "send": no opt-out, or the message is not a reminder the patient can
 *   turn off,
 * - "opted_out": the patient turned this type of reminder off; do not send,
 * - "unknown": the setting could not be read; hold the message, do not send.
 */
type OptOutCheck = "send" | "opted_out" | "unknown";

/**
 * Checks the patient's reminder setting right before a send, so a patient
 * who turned a reminder type off after it was queued does not get it. It
 * reads the preference stored on this device (the same lookup as when the
 * reminder was queued), so it works offline. It applies the opt-out rule of
 * reminderSkipReason only: the server looks up the phone number, so a
 * number missing on this device is no reason to hold a message back.
 *
 * `kind` null means the message is not a reminder. That covers
 * transactional messages (one-time codes, televisit links), which are never
 * suppressed; see reminderKindForTemplateKey.
 */
async function checkReminderOptOut(
  kind: ReminderKind | null,
  patientId: string | null | undefined,
): Promise<OptOutCheck> {
  if (!kind || !patientId) return "send";
  try {
    const preference = await getPatientPreference(patientId);
    return isReminderOptedOut(kind, preference) ? "opted_out" : "send";
  } catch (error) {
    console.warn("Could not read the patient's reminder settings:", errorName(error));
    return "unknown";
  }
}

/** Not sent: the reminder setting could not be read. Try again shortly. */
const PREFERENCE_HOLD: SendHold = { stopRun: true, retryAfterMs: SERVER_BUSY_RETRY_MS };

/**
 * Payload of a device message the provider accepted. The acceptance time is
 * what lets the outbox say "sent to provider" (older records marked sent
 * without sending carry no such time).
 */
function acceptedPayload(
  payload: Record<string, string | number>,
  result: SendOutcome,
): Record<string, string | number> {
  const next: Record<string, string | number> = {
    ...payload,
    [PROVIDER_ACCEPTED_AT_KEY]: new Date().toISOString(),
  };
  if (result.messageId) next[PROVIDER_MESSAGE_ID_KEY] = String(result.messageId);
  return next;
}

/** Result of one device message: sent, and whether to stop this run. */
interface MessageRun {
  sent: boolean;
  stopRun?: boolean;
  blocker?: SendingBlocker;
}

/** Sent and not-sent counts of one store, and a blocker that stopped it. */
interface StoreRun {
  sent: number;
  failed: number;
  blocker?: SendingBlocker;
}

async function processOutboundMessage(msg: OutboundMessage): Promise<MessageRun> {
  const optOut = await checkReminderOptOut(
    reminderKindForTemplateKey(msg.templateKey),
    msg.patientId,
  );
  if (optOut === "opted_out") {
    // Never sent. The last attempt time claimed for this run is put back.
    // A linked server reminder is not written from here: it is skipped by
    // processMedicationReminders' own check.
    await db.outboundMessages.update(msg.id, {
      status: "cancelled",
      lastAttemptAt: msg.lastAttemptAt,
      errorMessage: OPTED_OUT_ERROR,
      _dirty: 1,
    });
    return { sent: false };
  }
  if (optOut === "unknown") {
    // Back to the queue, attempts kept, tried again shortly.
    await db.outboundMessages.update(msg.id, {
      status: "queued",
      lastAttemptAt: msg.lastAttemptAt,
      errorMessage: PREFERENCE_CHECK_ERROR,
      scheduledFor: heldUntil(PREFERENCE_HOLD),
      _dirty: 1,
    });
    return { sent: false, stopRun: PREFERENCE_HOLD.stopRun };
  }

  // Older queue entries may point at a server reminder; sending with its id
  // lets the server record the outcome and refuse a second text.
  const reminderId =
    typeof msg.payload.reminderId === "string" && msg.payload.reminderId
      ? msg.payload.reminderId
      : undefined;
  const result = outcome(
    await sendSMS(
      { patientId: msg.patientId, reminderId },
      (msg.payload.message as string) || "",
    ),
  );

  if (result.ok) {
    await db.outboundMessages.update(msg.id, {
      status: "sent",
      lastAttemptAt: new Date(),
      errorMessage: undefined,
      payload: acceptedPayload(msg.payload, result),
      _dirty: 1,
    });
    // The server records a linked reminder as sent itself. If it could not,
    // the reminder still reads as pending: do not send it again from here.
    if (reminderId && result.reminderRecorded === false) acceptedUnrecorded.add(reminderId);
    return { sent: true };
  }

  if (result.hold) {
    // The server did not try to send it: back to the queue, attempts kept.
    await db.outboundMessages.update(msg.id, {
      status: "queued",
      lastAttemptAt: new Date(),
      errorMessage: result.error,
      scheduledFor: heldUntil(result.hold) ?? msg.scheduledFor,
      _dirty: 1,
    });
    return { sent: false, stopRun: result.hold.stopRun, blocker: result.hold.blocker };
  }

  const newAttempts = msg.attempts + 1;
  // Demo mode is not a passing fault, and a reminder the server already
  // records as sent must not be texted again: retrying would not help.
  const shouldRetry =
    newAttempts < MAX_RETRIES &&
    result.error !== SMS_DEMO_MODE_ERROR &&
    !result.alreadySent;

  await db.outboundMessages.update(msg.id, {
    status: shouldRetry ? "queued" : "failed",
    attempts: newAttempts,
    lastAttemptAt: new Date(),
    errorMessage: result.error,
    scheduledFor: shouldRetry
      ? new Date(Date.now() + RETRY_DELAYS[newAttempts - 1])
      : undefined,
    _dirty: 1,
  });

  return { sent: false };
}

async function processMedicationReminders(): Promise<StoreRun> {
  const nowIso = new Date().toISOString();
  let sent = 0;
  let failed = 0;
  // Reminders handed to the server this run (at most BATCH_SIZE).
  let attempts = 0;
  // Last row read, for the next page (keyset paging on scheduled_at, id).
  let cursor: { at: string; id: string } | null = null;

  // Due reminders are read oldest first, a page at a time. Rows this device
  // leaves pending (opted out, accepted but not recorded, held) keep their
  // place at the front, so without paging past them they would fill every
  // run's batch and hold back other patients' reminders.
  for (
    let page = 0;
    page < MAX_REMINDER_PAGES && attempts < BATCH_SIZE;
    page++
  ) {
    let query = supabase
      .from("medication_reminders")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", nowIso);
    if (cursor) {
      query = query.or(
        `scheduled_at.gt."${cursor.at}",and(scheduled_at.eq."${cursor.at}",id.gt."${cursor.id}")`,
      );
    }
    const { data: reminders, error } = await query
      .order("scheduled_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(REMINDER_PAGE_SIZE);

    if (error || !reminders?.length) break;

    for (const reminder of reminders) {
      if (attempts >= BATCH_SIZE) break;
      if (acceptedUnrecorded.has(reminder.id)) continue;

      // The patient may have turned medication reminders off since this was
      // scheduled. RLS does not let this device change the reminder's
      // status, so an opted-out reminder is only skipped here, in this run;
      // it stays pending on the server and is checked again next run. It is
      // counted as not sent, so the run summary does not say nothing was due.
      const optOut = await checkReminderOptOut(SERVER_REMINDER_KIND, reminder.patient_id);
      if (optOut === "opted_out") {
        failed++;
        continue;
      }
      if (optOut === "unknown") {
        // Not attempted: the reminder stays pending on the server.
        failed++;
        return { sent, failed };
      }
      // The server sends to the number stored on the reminder.
      attempts++;
      const result = outcome(
        await sendSMS(
          { reminderId: reminder.id, patientId: reminder.patient_id },
          reminder.message,
        ),
      );

      if (result.hold) {
        // Not attempted (signed out, not permitted or a send limit): the
        // reminder stays pending on the server.
        failed++;
        if (result.hold.stopRun) return { sent, failed, blocker: result.hold.blocker };
        continue;
      }

      // Another device or person sent it since the list was read; the server
      // did not text the patient again.
      if (result.alreadySent) continue;

      // The server records the outcome on the reminder (sent with the
      // provider-accepted marker, or failed); this device does not write it.
      if (result.ok) {
        if (result.reminderRecorded === false) acceptedUnrecorded.add(reminder.id);
        sent++;
      } else {
        failed++;
        // No SMS provider on the server: every other reminder would get the
        // same answer. They stay pending (nothing was sent) for a later run.
        if (result.error?.startsWith(NOT_CONFIGURED_ERROR)) return { sent, failed };
      }
    }

    if (reminders.length < REMINDER_PAGE_SIZE) break;
    const last = reminders[reminders.length - 1];
    cursor = { at: last.scheduled_at, id: last.id };
  }

  return { sent, failed };
}

async function processOutboundQueue(): Promise<StoreRun> {
  const now = new Date();
  const messages = await db.outboundMessages
    .where("status")
    .equals("queued")
    .filter((msg) => !msg.scheduledFor || new Date(msg.scheduledFor) <= now)
    .limit(BATCH_SIZE)
    .toArray();

  if (!messages.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const msg of messages) {
    // Claim it only if it is still queued (it may have been cancelled since
    // the list was read); the check and the change are one write.
    const claimed = await db.outboundMessages
      .where("id")
      .equals(msg.id)
      .and((m) => m.status === "queued")
      .modify({ status: "sending", lastAttemptAt: new Date() });
    if (!claimed) continue;
    const run = await processOutboundMessage(msg);
    if (run.sent) sent++;
    else failed++;
    if (run.stopRun) return { sent, failed, blocker: run.blocker };
  }

  return { sent, failed };
}

/**
 * Text that will be sent for a device outbox message: stored text as-is, or
 * the SMS template for dispense reminders. Null if it cannot be prepared.
 */
export async function composeOutboxMessageText(msg: {
  templateKey: string;
  locale?: string;
  payload: Record<string, string | number>;
}): Promise<string | null> {
  const plan = outboxTemplateFor(msg);
  if (!plan) return null;
  if (plan.kind === "text") return plan.text;
  return composeSms(plan.key, plan.locale, plan.vars);
}

/** Dispense reminders queued in the device outbox (db/outbox). */
async function processDeviceOutbox(): Promise<StoreRun> {
  const nowIso = new Date().toISOString();
  const messages = await outboxDb.outboundMessages
    .where("status")
    .equals("queued")
    .filter(
      (msg) =>
        isWorkerSendable(msg) && (!msg.scheduledFor || msg.scheduledFor <= nowIso),
    )
    .limit(BATCH_SIZE)
    .toArray();

  let sent = 0;
  let failed = 0;

  for (const msg of messages) {
    // Claim it only if it is still queued (cancelled or picked up elsewhere
    // since the list was read); the check and the change are one write.
    const claimed = await outboxDb.outboundMessages
      .where("id")
      .equals(msg.id)
      .and((m) => m.status === "queued")
      .modify({ status: "sending", lastAttemptAt: new Date().toISOString() });
    if (!claimed) continue;

    const optOut = await checkReminderOptOut(
      reminderKindForTemplateKey(msg.templateKey),
      msg.patientId,
    );
    if (optOut === "opted_out") {
      // Never sent. The last attempt time claimed for this run is put back.
      await outboxDb.outboundMessages.update(msg.id, {
        status: "cancelled",
        lastAttemptAt: msg.lastAttemptAt,
        errorMessage: OPTED_OUT_ERROR,
        _dirty: 1,
      });
      failed++;
      continue;
    }
    if (optOut === "unknown") {
      // Back to the queue, attempts kept, tried again shortly.
      const until = heldUntil(PREFERENCE_HOLD);
      await outboxDb.outboundMessages.update(msg.id, {
        status: "queued",
        lastAttemptAt: msg.lastAttemptAt,
        errorMessage: PREFERENCE_CHECK_ERROR,
        scheduledFor: until ? until.toISOString() : msg.scheduledFor,
        _dirty: 1,
      });
      failed++;
      break;
    }

    const text = await composeOutboxMessageText(msg).catch(() => null);
    const result: SendOutcome = text
      ? outcome(await sendSMS({ patientId: msg.patientId }, text))
      : { ok: false, error: TEMPLATE_ERROR };

    if (result.hold) {
      // The server did not try to send it: back to the queue, attempts kept.
      const until = heldUntil(result.hold);
      await outboxDb.outboundMessages.update(msg.id, {
        status: "queued",
        lastAttemptAt: new Date().toISOString(),
        errorMessage: result.error,
        scheduledFor: until ? until.toISOString() : msg.scheduledFor,
        _dirty: 1,
      });
      failed++;
      if (result.hold.stopRun) return { sent, failed, blocker: result.hold.blocker };
      continue;
    }

    if (result.ok) {
      await outboxDb.outboundMessages.update(msg.id, {
        status: "sent",
        lastAttemptAt: new Date().toISOString(),
        errorMessage: undefined,
        payload: acceptedPayload(msg.payload, result),
        _dirty: 1,
      });
      sent++;
      continue;
    }

    const attempts = (msg.attempts ?? 0) + 1;
    const shouldRetry =
      attempts < MAX_RETRIES &&
      result.error !== SMS_DEMO_MODE_ERROR &&
      result.error !== TEMPLATE_ERROR;

    await outboxDb.outboundMessages.update(msg.id, {
      status: shouldRetry ? "queued" : "failed",
      attempts,
      lastAttemptAt: new Date().toISOString(),
      errorMessage: result.error,
      scheduledFor: shouldRetry
        ? new Date(Date.now() + RETRY_DELAYS[attempts - 1]).toISOString()
        : msg.scheduledFor,
      _dirty: 1,
    });
    failed++;
  }

  return { sent, failed };
}

const EMPTY: StoreRun = { sent: 0, failed: 0 };

async function runProcessingCycle(): Promise<ProcessResult> {
  if (isProcessing) return { reminders: 0, messages: 0, failed: 0, skipped: "busy" };

  // Nothing is attempted without a server or a network: messages stay queued
  // on this device instead of burning retries or being marked sent.
  const blocker = getSmsSendingBlocker();
  if (blocker) return { reminders: 0, messages: 0, failed: 0, skipped: blocker };

  isProcessing = true;
  try {
    // The server only sends for a staff member signed in online. Without an
    // online session nothing is attempted, so queued messages keep their
    // attempts and wait on this device.
    if (!(await staffAccessToken())) {
      return { reminders: 0, messages: 0, failed: 0, skipped: "signed_out" };
    }

    const [reminders, queue, outbox] = await Promise.all([
      processMedicationReminders().catch((e) => {
        console.error("Notification worker (server reminders):", errorName(e));
        return EMPTY;
      }),
      processOutboundQueue().catch((e) => {
        console.error("Notification worker (device queue):", errorName(e));
        return EMPTY;
      }),
      processDeviceOutbox().catch((e) => {
        console.error("Notification worker (device outbox):", errorName(e));
        return EMPTY;
      }),
    ]);

    const result: ProcessResult = {
      reminders: reminders.sent,
      messages: queue.sent + outbox.sent,
      failed: reminders.failed + queue.failed + outbox.failed,
    };
    // Nothing went out because the server refused the account (signed out
    // meanwhile, or a role that cannot send SMS): say so instead of "not
    // sent". Held messages kept their attempts.
    const runBlocker = reminders.blocker ?? queue.blocker ?? outbox.blocker;
    if (runBlocker && result.reminders === 0 && result.messages === 0) {
      result.skipped = runBlocker;
    }

    if (result.reminders > 0 || result.messages > 0 || result.failed > 0) {
      console.log(
        `Notification worker: ${result.reminders} reminders and ${result.messages} messages accepted, ${result.failed} not sent`,
      );
    }

    return result;
  } catch (error) {
    console.error("Notification worker error:", errorName(error));
    return { reminders: 0, messages: 0, failed: 0 };
  } finally {
    isProcessing = false;
  }
}

export function startNotificationWorker(intervalMs = 60000): void {
  if (processingInterval) return;

  console.log("Starting notification worker...");

  runProcessingCycle();

  processingInterval = setInterval(runProcessingCycle, intervalMs);
}

export function stopNotificationWorker(): void {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    console.log("Notification worker stopped");
  }
}

/** Whether automatic sending is running on this device (this app session). */
export function isNotificationWorkerRunning(): boolean {
  return processingInterval !== null;
}

export async function processNow(): Promise<ProcessResult> {
  return runProcessingCycle();
}

export async function getQueueStats(): Promise<{
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  scheduled: number;
}> {
  const [pending, sending, sent, failed] = await Promise.all([
    db.outboundMessages.where("status").equals("queued").count(),
    db.outboundMessages.where("status").equals("sending").count(),
    db.outboundMessages.where("status").equals("sent").count(),
    db.outboundMessages.where("status").equals("failed").count(),
  ]);

  const now = new Date();
  const scheduled = await db.outboundMessages
    .where("status")
    .equals("queued")
    .filter((msg) => msg.scheduledFor && new Date(msg.scheduledFor) > now)
    .count();

  return { pending: pending - scheduled, sending, sent, failed, scheduled };
}

/**
 * Saves an SMS on this device. It is sent by the worker from `scheduledFor`
 * (or straight away) when the device is online and the server is set up.
 * `details` are stored alongside the text (e.g. medicationName, dosage) so
 * the outbox can describe the message; the text sent is `message`.
 */
export async function queueSMS(
  patientId: string,
  to: string,
  message: string,
  scheduledFor?: Date,
  templateKey = "custom",
  locale = "en",
  details: Record<string, string | number> = {},
): Promise<string> {
  const msg: OutboundMessage = {
    id: crypto.randomUUID(),
    patientId,
    channel: "sms",
    to,
    locale,
    templateKey,
    payload: { ...details, message },
    status: "queued",
    createdAt: new Date(),
    scheduledFor,
    attempts: 0,
    _dirty: 1,
  };

  await db.outboundMessages.add(msg);
  return msg.id;
}

/**
 * Sends one server reminder straight away (the "Send now" action). The
 * server marks the reminder sent only when the provider accepted it, and
 * refuses one already marked sent (no second text).
 * `recordUpdated` is false when the SMS outcome could not be written back to
 * the server record (so the list may still show the old state).
 *
 * The server sends to the number stored on the reminder (or, without an id,
 * the patient's registered number); `phoneNumber` is not sent. When the
 * server refuses without trying (signed out, role not allowed, send limit)
 * the reminder is left as it was, not marked failed.
 *
 * A patient who turned medication reminders off is not sent anything, and
 * neither is one whose setting cannot be read here. The reminder is left as
 * it was on the server (this device does not write its status).
 */
export async function sendReminderNow(reminder: {
  id?: string;
  patientId?: string;
  phoneNumber: string;
  message: string;
}): Promise<{
  ok: boolean;
  error?: string;
  /** "busy": a send run is in progress and may be sending this reminder. */
  skipped?: SendingBlocker | "busy";
  recordUpdated?: boolean;
}> {
  const blocker = getSmsSendingBlocker();
  if (blocker) return { ok: false, skipped: blocker };
  // A send run reads the same pending reminders; sending now as well could
  // send the patient the same SMS twice.
  if (isProcessing) return { ok: false, skipped: "busy" };

  isProcessing = true;
  try {
    if (reminder.id && acceptedUnrecorded.has(reminder.id)) {
      return { ok: false, error: SMS_ACCEPTED_NOT_RECORDED_ERROR, recordUpdated: false };
    }
    if (!reminder.id && !reminder.patientId) {
      return {
        ok: false,
        error: "recipient_required: this reminder has no server record or patient to send to",
      };
    }

    const optOut = await checkReminderOptOut(SERVER_REMINDER_KIND, reminder.patientId);
    if (optOut === "unknown") return { ok: false, error: PREFERENCE_CHECK_ERROR };
    if (optOut === "opted_out") return { ok: false, error: OPTED_OUT_ERROR };

    const result = outcome(
      await sendSMS(
        { reminderId: reminder.id, patientId: reminder.patientId },
        reminder.message,
      ),
    );

    if (result.hold) return { ok: false, error: result.error };
    if (result.alreadySent) {
      // Recorded as sent already; the server did not text the patient again.
      return { ok: false, error: result.error, recordUpdated: true };
    }

    // The server records the outcome on the reminder itself (this device
    // may not have the 'dispense' permission the table needs). It reports
    // whether that write worked; no report means it cannot be relied on.
    const recordUpdated = reminder.id ? result.reminderRecorded === true : true;
    if (result.ok && reminder.id && !recordUpdated) acceptedUnrecorded.add(reminder.id);

    return { ok: result.ok, error: result.error, recordUpdated };
  } finally {
    isProcessing = false;
  }
}

type DeviceStore = "outbox" | "queue";

/**
 * Puts a failed (or stuck "sending") device message back in the queue with a
 * fresh set of attempts. It is due immediately. Returns false (and changes
 * nothing) if the message is no longer failed or sending, for example it was
 * sent in the meantime.
 */
export async function retryDeviceMessage(
  store: DeviceStore,
  id: string,
): Promise<boolean> {
  const retryable = (status: string) => status === "failed" || status === "sending";
  if (store === "outbox") {
    const changed = await outboxDb.outboundMessages
      .where("id")
      .equals(id)
      .and((m) => retryable(m.status))
      .modify({
        status: "queued",
        attempts: 0,
        errorMessage: undefined,
        scheduledFor: undefined,
        _dirty: 1,
      });
    return changed > 0;
  }
  const changed = await db.outboundMessages
    .where("id")
    .equals(id)
    .and((m) => retryable(m.status))
    .modify({
      status: "queued",
      attempts: 0,
      errorMessage: undefined,
      scheduledFor: undefined,
      _dirty: 1,
    });
  return changed > 0;
}

/**
 * Cancels a queued device message. The record is kept with status
 * "cancelled" and is never picked up by a sender. Returns false if the
 * message was no longer queued (for example it is being sent).
 */
export async function cancelDeviceMessage(
  store: DeviceStore,
  id: string,
): Promise<boolean> {
  // Check and change in one write, so a sender cannot claim it in between.
  if (store === "outbox") {
    const changed = await outboxDb.outboundMessages
      .where("id")
      .equals(id)
      .and((m) => m.status === "queued")
      .modify({ status: "cancelled", _dirty: 1 });
    return changed > 0;
  }
  const changed = await db.outboundMessages
    .where("id")
    .equals(id)
    .and((m) => m.status === "queued")
    .modify({ status: "cancelled", _dirty: 1 });
  return changed > 0;
}
