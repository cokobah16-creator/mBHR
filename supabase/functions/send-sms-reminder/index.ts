import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import {
  getServiceClient,
  requireStaff,
  SMS_SENDER_ROLES,
} from "../_shared/security/staffAuth.ts";
import {
  checkSmsLimits,
  hashKey,
  PER_RECIPIENT_LIMIT,
  PER_USER_LIMIT,
} from "../_shared/security/smsRateLimit.ts";
import {
  maskMsisdn,
  normalizeNigerianMsisdn,
  redactNumbers,
  validId,
  validMessageText,
} from "../_shared/security/recipient.ts";
import {
  demoModeEnabled,
  resolveSmsConfig,
  sendSms,
} from "../_shared/sms/provider.ts";

// Sends one SMS to a patient on behalf of a signed-in staff member.
//
// Security model (release blocker, owner decision):
// - Caller must send a Supabase user access token; the anon key gets 401.
// - Caller must be an app_users row whose role is in SMS_SENDER_ROLES
//   (pharmacist, doctor, nurse, lead_clinician, admin), else 403.
// - The recipient is never taken from the client:
//     { reminderId }  -> medication_reminders.phone_number (and its message)
//     { patientId }   -> patients.phone
//   A "to" field in the body is ignored. Only Nigerian mobile numbers are
//   sent to.
// - Rate limits: 30/min per staff user, 5/hour per recipient number
//   (429 + Retry-After). If the limit cannot be checked, nothing is sent.
// - Logs and error bodies never carry the full number or the message text.
// - Stored reminders ({ reminderId }): a reminder already marked sent gets
//   409 already_sent and no second text. This function records the outcome
//   on medication_reminders with the service role (RLS lets only 'dispense'
//   holders update that table, and nurses/doctors may send too): after the
//   provider accepts it, status 'sent' + sent_at + the provider-accepted
//   marker; when the provider rejects it, demo mode only logged it, or the
//   stored number or text cannot be used, status 'failed' + the error code.
//   The response's `reminderRecorded` says whether that write worked.

/**
 * Stored in medication_reminders.error_message when the SMS provider
 * accepted a reminder. Must match PROVIDER_ACCEPTED_MARKER in
 * src/features/notifications/smsOutbox.ts (the outbox shows 'sent' rows
 * without it as "not confirmed").
 */
const PROVIDER_ACCEPTED_MARKER = "accepted by sms provider";

interface SMSRequest {
  message?: unknown;
  reminderId?: unknown;
  patientId?: unknown;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

type ServiceClient = ReturnType<typeof getServiceClient>;

/**
 * Records a stored reminder's outcome with the service role. Never throws;
 * returns false when the row could not be updated. A reminder already marked
 * sent is never changed back to failed.
 */
async function recordReminderOutcome(
  service: ServiceClient,
  reminderId: string,
  outcome:
    | { status: "sent"; messageId?: string | null }
    | { status: "failed"; error: string },
): Promise<boolean> {
  try {
    const update =
      outcome.status === "sent"
        ? {
            status: "sent",
            sent_at: new Date().toISOString(),
            error_message: outcome.messageId
              ? `${PROVIDER_ACCEPTED_MARKER} (${outcome.messageId})`
              : PROVIDER_ACCEPTED_MARKER,
          }
        : { status: "failed", error_message: outcome.error };
    const { error } = await service
      .from("medication_reminders")
      .update(update)
      .eq("id", reminderId)
      .neq("status", "sent");
    if (error) {
      console.error(
        "send-sms-reminder: could not record the reminder outcome:",
        error.code ?? "error",
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      "send-sms-reminder: could not record the reminder outcome:",
      errorName(error),
    );
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const reply = (
    status: number,
    body: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...jsonHeaders, ...extra },
    });

  if (req.method !== "POST") {
    return reply(405, { success: false, error: "method_not_allowed" });
  }

  // Coarse per-IP flood guard before any auth work. A whole outreach site
  // can share one IP, so it is set well above the per-user limit below.
  const ipLimit = await enforceRateLimit(req, {
    bucket: "edge_sms_reminder",
    keyStrategy: "ip",
    max: 120,
    windowSeconds: 60,
  });
  if (!ipLimit.allowed) {
    const retryAfter = ipLimit.retryAfter ?? 60;
    return reply(
      429,
      {
        success: false,
        error: "rate_limited",
        scope: "ip",
        retry_after_seconds: retryAfter,
      },
      { "Retry-After": String(retryAfter) },
    );
  }

  try {
    const service = getServiceClient();

    // 1. Who is calling?
    const auth = await requireStaff(req, service, SMS_SENDER_ROLES);
    if (!auth.ok) {
      return reply(auth.status, {
        success: false,
        error: auth.error,
        message: auth.message,
      });
    }

    // 2. What are they asking for?
    let body: SMSRequest;
    try {
      body = (await req.json()) as SMSRequest;
    } catch {
      return reply(400, {
        success: false,
        error: "invalid_request",
        message: "The request body must be JSON.",
      });
    }

    const reminderId =
      body.reminderId === undefined || body.reminderId === null
        ? null
        : validId(body.reminderId);
    const patientId =
      body.patientId === undefined || body.patientId === null
        ? null
        : validId(body.patientId);

    if (body.reminderId != null && !reminderId) {
      return reply(400, { success: false, error: "invalid_reminder_id" });
    }
    if (body.patientId != null && !patientId) {
      return reply(400, { success: false, error: "invalid_patient_id" });
    }
    if (!reminderId && !patientId) {
      return reply(400, {
        success: false,
        error: "recipient_required",
        message: "Send a reminderId or a patientId. Phone numbers are looked up on the server.",
      });
    }

    // 3. Resolve the recipient (and, for stored reminders, the text) on the
    //    server.
    let rawPhone: unknown = null;
    let message = validMessageText(body.message);

    if (reminderId) {
      const { data: reminder, error } = await service
        .from("medication_reminders")
        .select("id, patient_id, phone_number, message, status")
        .eq("id", reminderId)
        .maybeSingle();
      if (error) {
        console.error("send-sms-reminder: reminder lookup failed:", error.code ?? "error");
        return reply(503, { success: false, error: "lookup_failed" });
      }
      if (!reminder) {
        return reply(404, {
          success: false,
          error: "reminder_not_found",
          message: "This reminder is not on the server.",
        });
      }
      if (patientId && reminder.patient_id !== patientId) {
        return reply(400, { success: false, error: "reminder_patient_mismatch" });
      }
      // Never text the patient twice for the same reminder.
      if (reminder.status === "sent") {
        return reply(409, {
          success: false,
          error: "already_sent",
          message: "This reminder is already recorded as sent. It was not sent again.",
        });
      }
      rawPhone = reminder.phone_number;
      // The stored text is what was scheduled; it wins over the client copy.
      message = validMessageText(reminder.message) ?? message;
    } else if (patientId) {
      const { data: patient, error } = await service
        .from("patients")
        .select("id, phone")
        .eq("id", patientId)
        .maybeSingle();
      if (error) {
        console.error("send-sms-reminder: patient lookup failed:", error.code ?? "error");
        return reply(503, { success: false, error: "lookup_failed" });
      }
      if (!patient) {
        return reply(404, {
          success: false,
          error: "patient_not_found",
          message: "This patient is not on the server yet. Sync, then try again.",
        });
      }
      rawPhone = patient.phone;
    }

    if (!message) {
      // A stored reminder whose text cannot be sent never will be: record it
      // as failed so it is not retried by every send run.
      const reminderRecorded = reminderId
        ? await recordReminderOutcome(service, reminderId, {
            status: "failed",
            error: "invalid_message: the message is empty or too long",
          })
        : undefined;
      return reply(400, {
        success: false,
        error: "invalid_message",
        message: "The message is empty or too long.",
        ...(reminderId ? { reminderRecorded } : {}),
      });
    }

    if (!rawPhone) {
      const reminderRecorded = reminderId
        ? await recordReminderOutcome(service, reminderId, {
            status: "failed",
            error: "no_phone: the reminder has no phone number",
          })
        : undefined;
      return reply(422, {
        success: false,
        error: "no_phone",
        message: "The patient has no phone number on the server.",
        ...(reminderId ? { reminderRecorded } : {}),
      });
    }

    const msisdn = normalizeNigerianMsisdn(rawPhone);
    if (!msisdn) {
      const reminderRecorded = reminderId
        ? await recordReminderOutcome(service, reminderId, {
            status: "failed",
            error: "invalid_recipient: not a valid Nigerian mobile number",
          })
        : undefined;
      return reply(422, {
        success: false,
        error: "invalid_recipient",
        message: "The stored phone number is not a valid Nigerian mobile number.",
        ...(reminderId ? { reminderRecorded } : {}),
      });
    }

    // 4. Rate limits (per staff user, then per recipient).
    const limit = await checkSmsLimits(service, [
      {
        bucket: "sms_send_user",
        key: auth.userId,
        ...PER_USER_LIMIT,
      },
      {
        bucket: "sms_send_recipient",
        key: await hashKey(msisdn),
        ...PER_RECIPIENT_LIMIT,
      },
    ]);
    if (!limit.allowed) {
      if ("error" in limit) {
        return reply(503, {
          success: false,
          error: "rate_limit_unavailable",
          message: "SMS sending is paused because the send limit could not be checked. Try again shortly.",
        });
      }
      return reply(
        429,
        {
          success: false,
          error: "rate_limited",
          scope: limit.bucket === "sms_send_user" ? "user" : "recipient",
          retry_after_seconds: limit.retryAfter,
          message:
            limit.bucket === "sms_send_user"
              ? "Too many SMS sent from your account in the last minute."
              : "This patient has already been sent several SMS in the last hour.",
        },
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    // 5. Send.
    const config = resolveSmsConfig();

    if (!config) {
      if (demoModeEnabled()) {
        console.log(
          `SMS demo mode: not sent - To: ${maskMsisdn(msisdn)}, Length: ${message.length} chars, ReminderId: ${reminderId || "N/A"}, By: ${auth.userId}`,
        );
        // Not sent, so a stored reminder is recorded as failed (not left
        // pending to be "sent" again by every run, and never marked sent).
        const reminderRecorded = reminderId
          ? await recordReminderOutcome(service, reminderId, {
              status: "failed",
              error: "sms_demo_mode: the server logged this message but did not send it",
            })
          : undefined;
        return reply(200, {
          success: true,
          demo: true,
          ...(reminderId ? { reminderRecorded } : {}),
          provider: "demo",
          message:
            "SMS_DEMO_MODE is on: message not sent (logged without the number or text)",
        });
      }

      // No provider secrets and no explicit demo opt-in: fail loudly instead
      // of pretending the SMS went out.
      console.error(
        "send-sms-reminder: no SMS provider configured (set TERMII_API_KEY + TERMII_SENDER_ID, or TWILIO_* secrets)",
      );
      return reply(503, {
        success: false,
        configured: false,
        error: "sms_not_configured",
        message:
          "No SMS provider configured. Set TERMII_API_KEY and TERMII_SENDER_ID (preferred) or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER, then redeploy.",
      });
    }

    const result = await sendSms(config, msisdn, message);

    if (!result.ok) {
      const safeError = redactNumbers(result.error || "Failed to send SMS");
      console.error(`${result.provider} send failed:`, safeError);
      const reminderRecorded = reminderId
        ? await recordReminderOutcome(service, reminderId, {
            status: "failed",
            error: `provider_rejected: ${safeError}`.slice(0, 500),
          })
        : undefined;
      return reply(502, {
        success: false,
        provider: result.provider,
        error: safeError,
        ...(reminderId ? { reminderRecorded } : {}),
      });
    }

    console.log(
      `SMS accepted by ${result.provider} - To: ${maskMsisdn(msisdn)}, ID: ${result.messageId ?? "n/a"}, ReminderId: ${reminderId || "N/A"}, By: ${auth.userId} (${auth.role})`,
    );

    // Record it only after the provider accepted it.
    const reminderRecorded = reminderId
      ? await recordReminderOutcome(service, reminderId, {
          status: "sent",
          messageId: result.messageId,
        })
      : undefined;

    return reply(200, {
      success: true,
      provider: result.provider,
      messageId: result.messageId,
      ...(reminderId ? { reminderRecorded } : {}),
    });
  } catch (error) {
    console.error("Error in send-sms-reminder:", errorName(error));
    return reply(500, {
      success: false,
      error: "internal_error",
      message: "The SMS could not be sent because of a server error.",
    });
  }
});
