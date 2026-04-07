import { supabase } from "../lib/supabase";
import { db, OutboundMessage } from "../db";
import { markReminderSent, markReminderFailed } from "./sms";

interface SMSResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  demo?: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [60000, 300000, 900000];
const BATCH_SIZE = 10;

let isProcessing = false;
let processingInterval: ReturnType<typeof setInterval> | null = null;

async function sendSMS(
  to: string,
  message: string,
  reminderId?: string,
): Promise<SMSResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase not configured, running in demo mode");
    return { success: true, demo: true, provider: "demo" };
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
      console.error("SMS API error:", errorText);
      return { success: false, error: errorText };
    }

    return await response.json();
  } catch (error) {
    console.error("SMS send error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

async function processOutboundMessage(msg: OutboundMessage): Promise<boolean> {
  const result = await sendSMS(
    msg.to,
    (msg.payload.message as string) || "",
    msg.id,
  );

  if (result.success) {
    await db.outboundMessages.update(msg.id, {
      status: result.demo ? "sent" : "delivered",
      lastAttemptAt: new Date(),
      _dirty: 1,
    });

    if (msg.payload.reminderId) {
      await markReminderSent(msg.payload.reminderId as string).catch(
        console.warn,
      );
    }

    return true;
  }

  const newAttempts = msg.attempts + 1;
  const shouldRetry = newAttempts < MAX_RETRIES;

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
    ).catch(console.warn);
  }

  return false;
}

async function processMedicationReminders(): Promise<number> {
  const { data: reminders, error } = await supabase
    .from("medication_reminders")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .limit(BATCH_SIZE);

  if (error || !reminders?.length) return 0;

  let processed = 0;

  for (const reminder of reminders) {
    const result = await sendSMS(
      reminder.phone_number,
      reminder.message,
      reminder.id,
    );

    if (result.success) {
      await supabase
        .from("medication_reminders")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("id", reminder.id);
      processed++;
    } else {
      await supabase
        .from("medication_reminders")
        .update({
          status: "failed",
          error_message: result.error,
        })
        .eq("id", reminder.id);
    }
  }

  return processed;
}

async function processOutboundQueue(): Promise<number> {
  const now = new Date();
  const messages = await db.outboundMessages
    .where("status")
    .equals("queued")
    .filter((msg) => !msg.scheduledFor || new Date(msg.scheduledFor) <= now)
    .limit(BATCH_SIZE)
    .toArray();

  if (!messages.length) return 0;

  let processed = 0;
  for (const msg of messages) {
    await db.outboundMessages.update(msg.id, { status: "sending" });
    const success = await processOutboundMessage(msg);
    if (success) processed++;
  }

  return processed;
}

async function runProcessingCycle(): Promise<{
  reminders: number;
  messages: number;
}> {
  if (isProcessing) return { reminders: 0, messages: 0 };

  isProcessing = true;
  try {
    const [reminders, messages] = await Promise.all([
      processMedicationReminders(),
      processOutboundQueue(),
    ]);

    if (reminders > 0 || messages > 0) {
      console.log(
        `Notification worker: processed ${reminders} reminders, ${messages} messages`,
      );
    }

    return { reminders, messages };
  } catch (error) {
    console.error("Notification worker error:", error);
    return { reminders: 0, messages: 0 };
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

export async function processNow(): Promise<{
  reminders: number;
  messages: number;
}> {
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

export async function queueSMS(
  patientId: string,
  to: string,
  message: string,
  scheduledFor?: Date,
  templateKey = "custom",
  locale = "en",
): Promise<string> {
  const msg: OutboundMessage = {
    id: crypto.randomUUID(),
    patientId,
    channel: "sms",
    to,
    locale,
    templateKey,
    payload: { message },
    status: "queued",
    createdAt: new Date(),
    scheduledFor,
    attempts: 0,
    _dirty: 1,
  };

  await db.outboundMessages.add(msg);
  return msg.id;
}
