import { MessageQueue, OutboundMessage } from "@/db/outbox";
import { db } from "@/db";
import { getPatientPreference } from "./preferences";
import { ReminderSkippedError, reminderSkipReason } from "./reminderEligibility";
import * as logger from "@/lib/logger";

export { ReminderSkippedError } from "./reminderEligibility";

/** Stored on a message that could not go out because no gateway is set up. */
export const SMS_PROVIDER_NOT_CONFIGURED_ERROR = "SMS provider not configured";

export interface SMSGateway {
  /**
   * False when the gateway cannot send anything (no provider set up).
   * Gateways that leave it out are treated as configured.
   */
  readonly configured?: boolean;
  send(
    message: OutboundMessage,
  ): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

// There is deliberately no browser gateway that talks to an SMS provider.
// Provider keys (TERMII_API_KEY, TERMII_SENDER_ID) live only in Supabase
// function secrets. SMS is sent by the send-sms-reminder server function,
// which checks that the caller is signed-in staff allowed to send SMS; the
// notification worker (services/notificationWorker) calls it for queued
// messages.

// The browser's gateway. It never sends anything, so it never reports
// success: a message it is given stays unsent, and MessageService leaves
// queued messages for the notification worker to send through the server.
export class MockGateway implements SMSGateway {
  readonly configured = false;

  async send(
    message: OutboundMessage,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    // Template and channel only: the number and payload identify the patient.
    logger.info("[MockGateway] SMS not sent, no provider configured:", {
      template: message.templateKey,
      channel: message.channel,
    });

    return { success: false, error: SMS_PROVIDER_NOT_CONFIGURED_ERROR };
  }
}

// Message service for the app
export class MessageService {
  private gateway: SMSGateway;

  constructor(gateway: SMSGateway) {
    this.gateway = gateway;
  }

  /**
   * Queues a medication reminder in the device outbox and returns its id.
   * Throws ReminderSkippedError (nothing is queued) when the patient turned
   * medication reminders off or has no phone number.
   */
  async queueMedicationReminder(
    patientId: string,
    medicationName: string,
    dosage: string,
    frequency: string,
    scheduledFor?: Date,
  ): Promise<string> {
    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error("Patient not found");

    const preferences = await getPatientPreference(patientId);
    const skip = reminderSkipReason("medication", patient, preferences);
    if (skip) throw new ReminderSkippedError("medication", skip);
    const locale = preferences?.preferredLanguage || "en";

    return MessageQueue.queueMessage(
      patientId,
      patient.phone,
      "followup.medication",
      {
        patientName: `${patient.givenName} ${patient.familyName}`,
        medicationName,
        dosage,
        frequency,
        clinicName: "MBHR Clinic",
      },
      {
        channel: "sms",
        locale,
        scheduledFor,
      },
    );
  }

  /**
   * Queues an appointment reminder in the device outbox and returns its id.
   * Throws ReminderSkippedError (nothing is queued) when the patient turned
   * appointment reminders off or has no phone number.
   */
  async queueAppointmentReminder(
    patientId: string,
    appointmentDate: Date,
    scheduledFor?: Date,
  ): Promise<string> {
    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error("Patient not found");

    const preferences = await getPatientPreference(patientId);
    const skip = reminderSkipReason("appointment", patient, preferences);
    if (skip) throw new ReminderSkippedError("appointment", skip);

    return MessageQueue.queueMessage(
      patientId,
      patient.phone,
      "appointment.reminder",
      {
        patientName: `${patient.givenName} ${patient.familyName}`,
        date: appointmentDate.toLocaleDateString("en-NG", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        time: appointmentDate.toLocaleTimeString("en-NG", {
          hour: "numeric",
          minute: "2-digit",
        }),
        clinicName: "MBHR Clinic",
      },
      {
        channel: "sms",
        locale: "en",
        scheduledFor,
      },
    );
  }

  /**
   * Sends due messages through the gateway. A message is marked sent only
   * when the gateway reports success. With no provider set up nothing is
   * attempted: messages stay queued on this device (the notification worker
   * can still send them through the server) and `skipped` says why.
   */
  async processOutbox(): Promise<{
    sent: number;
    failed: number;
    skipped?: "not_configured";
  }> {
    if (this.gateway.configured === false) {
      return { sent: 0, failed: 0, skipped: "not_configured" };
    }

    const pending = await MessageQueue.getPendingMessages(50);
    let sent = 0;
    let failed = 0;

    for (const message of pending) {
      try {
        const result = await this.gateway.send(message);

        if (result.success) {
          await MessageQueue.markSent(message.id);
          sent++;
        } else {
          await MessageQueue.markFailed(
            message.id,
            result.error || "Unknown error",
          );
          failed++;
        }
      } catch (error) {
        await MessageQueue.markFailed(
          message.id,
          error instanceof Error ? error.message : "Send failed",
        );
        failed++;
      }
    }

    return { sent, failed };
  }

  // Get outbox statistics
  async getStats() {
    return MessageQueue.getStats();
  }
}

// Default service instance
let messageService: MessageService | null = null;

/**
 * Gateway used by the app's MessageService. Always the non-sending
 * MockGateway: the browser never holds SMS provider keys.
 */
export function selectGateway(): SMSGateway {
  logger.info(
    "[MessageService] SMS is sent by the send-sms-reminder server function; reminders queued here wait for the notification worker.",
  );
  return new MockGateway();
}

export function getMessageService(): MessageService {
  if (!messageService) {
    messageService = new MessageService(selectGateway());
  }
  return messageService;
}

export function configureMessageService(gateway: SMSGateway) {
  messageService = new MessageService(gateway);
}
