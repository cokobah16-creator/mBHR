import { supabase } from "../lib/supabase";
import { db, OutboundMessage } from "../db";
import { outboxDb } from "../db/outbox";
import type { OutboundMessage as DeviceOutboxMessage } from "../db/outbox";
import { markReminderSent, markReminderFailed } from "./sms";
import { composeSms } from "./messageTemplates";
import {
  MAX_SEND_ATTEMPTS,
  PROVIDER_ACCEPTED_AT_KEY,
  PROVIDER_MESSAGE_ID_KEY,
  isWorkerSendable,
  outboxTemplateFor,
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
 * not configured or the device is offline nothing is attempted, so queued
 * messages stay queued on this device.
 */

interface SMSResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  demo?: boolean;
}

export interface ProcessResult {
  /** Server reminders the provider accepted. */
  reminders: number;
  /** Device messages the provider accepted. */
  messages: number;
  /** Attempts that did not go through in this run. */
  failed?: number;
  /** Why nothing was attempted, if so. */
  skipped?: SendingBlocker | "busy";
}

const MAX_RETRIES = MAX_SEND_ATTEMPTS;
const RETRY_DELAYS = [60000, 300000, 900000];
const BATCH_SIZE = 10;

/** Stored error for a server running in SMS demo mode (logged, not sent). */
export const SMS_DEMO_MODE_ERROR =
  "sms_demo_mode: the server logged this message but did not send it";
const NOT_CONFIGURED_ERROR = "sms_not_configured";
const TEMPLATE_ERROR = "message text could not be prepared";

// OutboundMessage["status"] in db/index.ts and db/outbox.ts does not list
// "cancelled" yet. Dexie stores the value as-is and every sender only picks
// up "queued" messages, so a cancelled message is never sent.
const CANCELLED_STATUS = "cancelled" as unknown as OutboundMessage["status"];
const CANCELLED_OUTBOX_STATUS =
  "cancelled" as unknown as DeviceOutboxMessage["status"];

let isProcessing = false;
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

async function sendSMS(
  to: string,
  message: string,
  reminderId?: string,
): Promise<SMSResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Never report success when nothing could be sent.
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-sms-reminder`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to, message, reminderId }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      // The body can echo the phone number; log the status only.
      console.error("SMS API error: HTTP", response.status);
      let error = errorText;
      try {
        const parsed = JSON.parse(errorText) as { error?: string };
        if (parsed?.error) error = parsed.error;
      } catch {
        // plain-text body
      }
      if (response.status === 429) error = `rate limited (429): ${error}`;
      return { success: false, error };
    }

    return await response.json();
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
}

/** Only a real (non-demo) acceptance counts as sent. */
function outcome(result: SMSResult): SendOutcome {
  if (result.success && !result.demo) return { ok: true, messageId: result.messageId };
  if (result.success && result.demo) return { ok: false, error: SMS_DEMO_MODE_ERROR };
  return { ok: false, error: result.error || "Send failed" };
}

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

async function processOutboundMessage(msg: OutboundMessage): Promise<boolean> {
  const result = outcome(
    await sendSMS(msg.to, (msg.payload.message as string) || "", msg.id),
  );

  if (result.ok) {
    await db.outboundMessages.update(msg.id, {
      status: "sent",
      lastAttemptAt: new Date(),
      errorMessage: undefined,
      payload: acceptedPayload(msg.payload, result),
      _dirty: 1,
    });

    if (msg.payload.reminderId) {
      await markReminderSent(msg.payload.reminderId as string).catch((e) =>
        console.warn("Could not mark server reminder sent:", errorName(e)),
      );
    }

    return true;
  }

  const newAttempts = msg.attempts + 1;
  // Demo mode is not a passing fault; retrying would not send it either.
  const shouldRetry =
    newAttempts < MAX_RETRIES && result.error !== SMS_DEMO_MODE_ERROR;

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

  if (!shouldRetry && msg.payload.reminderId) {
    await markReminderFailed(
      msg.payload.reminderId as string,
      result.error || "Max retries exceeded",
    ).catch((e) =>
      console.warn("Could not mark server reminder failed:", errorName(e)),
    );
  }

  return false;
}

async function processMedicationReminders(): Promise<{
  sent: number;
  failed: number;
}> {
  const { data: reminders, error } = await supabase
    .from("medication_reminders")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .limit(BATCH_SIZE);

  if (error || !reminders?.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const reminder of reminders) {
    const result = outcome(
      await sendSMS(reminder.phone_number, reminder.message, reminder.id),
    );

    if (result.ok) {
      await supabase
        .from("medication_reminders")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("id", reminder.id);
      sent++;
    } else {
      await supabase
        .from("medication_reminders")
        .update({
          status: "failed",
          error_message: result.error,
        })
        .eq("id", reminder.id);
      failed++;
    }
  }

  return { sent, failed };
}

async function processOutboundQueue(): Promise<{
  sent: number;
  failed: number;
}> {
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
    const success = await processOutboundMessage(msg);
    if (success) sent++;
    else failed++;
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
async function processDeviceOutbox(): Promise<{ sent: number; failed: number }> {
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

    const text = await composeOutboxMessageText(msg).catch(() => null);
    const result: SendOutcome = text
      ? outcome(await sendSMS(msg.to, text, msg.id))
      : { ok: false, error: TEMPLATE_ERROR };

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

const EMPTY = { sent: 0, failed: 0 };

async function runProcessingCycle(): Promise<ProcessResult> {
  if (isProcessing) return { reminders: 0, messages: 0, failed: 0, skipped: "busy" };

  // Nothing is attempted without a server or a network: messages stay queued
  // on this device instead of burning retries or being marked sent.
  const blocker = getSmsSendingBlocker();
  if (blocker) return { reminders: 0, messages: 0, failed: 0, skipped: blocker };

  isProcessing = true;
  try {
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
 * reminder is only marked sent when the provider accepted it.
 * `recordUpdated` is false when the SMS outcome could not be written back to
 * the server record (so the list may still show the old state).
 */
export async function sendReminderNow(reminder: {
  id?: string;
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
    const result = outcome(
      await sendSMS(reminder.phoneNumber, reminder.message, reminder.id),
    );

    let recordUpdated = true;
    if (reminder.id) {
      try {
        if (result.ok) await markReminderSent(reminder.id);
        else await markReminderFailed(reminder.id, result.error || "Send failed");
      } catch (e) {
        console.warn("Could not update server reminder:", errorName(e));
        recordUpdated = false;
      }
    }

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
      .modify({ status: CANCELLED_OUTBOX_STATUS, _dirty: 1 });
    return changed > 0;
  }
  const changed = await db.outboundMessages
    .where("id")
    .equals(id)
    .and((m) => m.status === "queued")
    .modify({ status: CANCELLED_STATUS, _dirty: 1 });
  return changed > 0;
}
