import { outboxDb, MessageQueue, OutboundMessage } from "@/db/outbox";
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

// Termii SMS Gateway (popular in Nigeria).
// SECURITY: this sends the Termii API key from the browser, so anyone using
// the app can read it. The server function send-sms-reminder (used by
// services/notificationWorker) keeps the key in server secrets instead.
export class TermiiGateway implements SMSGateway {
  constructor(
    private apiKey: string,
    private senderId: string = "MBHR",
  ) {}

  async send(
    message: OutboundMessage,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Get template and render message
      const template = await outboxDb.messageTemplates
        .where("[key+locale]")
        .equals([message.templateKey, message.locale])
        .first();

      if (!template) {
        return { success: false, error: "Template not found" };
      }

      const renderedMessage = MessageQueue.renderTemplate(
        template.body,
        message.payload,
      );

      const response = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: message.to,
          from: this.senderId,
          sms: renderedMessage,
          type: "plain",
          api_key: this.apiKey,
          channel: "generic",
        }),
      });

      const result = await response.json();

      if (response.ok && result.message_id) {
        return { success: true, messageId: result.message_id };
      } else {
        return { success: false, error: result.message || "SMS send failed" };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }
}

// Stand-in used when no SMS provider is set up. It never sends anything, so
// it never reports success: a message it is given stays unsent.
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

export function selectGateway(
  termiiKey?: string,
  termiiSender?: string,
): SMSGateway {
  if (termiiKey) {
    return new TermiiGateway(termiiKey, termiiSender);
  }
  logger.warn(
    "[MessageService] VITE_TERMII_API_KEY not set — this service will not send SMS itself. Queued reminders stay queued for the notification worker, which sends them through the send-sms-reminder server function when it is set up.",
  );
  return new MockGateway();
}

export function getMessageService(): MessageService {
  if (!messageService) {
    messageService = new MessageService(
      selectGateway(
        import.meta.env.VITE_TERMII_API_KEY as string | undefined,
        import.meta.env.VITE_TERMII_SENDER_ID as string | undefined,
      ),
    );
  }
  return messageService;
}

export function configureMessageService(gateway: SMSGateway) {
  messageService = new MessageService(gateway);
}
