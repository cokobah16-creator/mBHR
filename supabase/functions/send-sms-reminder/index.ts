import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { allowedOrigins, corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import {
  authenticateStaff,
  getServiceClient,
  SMS_SENDER_ROLES,
} from "../_shared/security/staffAuth.ts";
import {
  invitationOrigin,
  invitationRefusal,
  invitationSmsText,
  isPortalInvitationText,
  PORTAL_INVITATION_PURPOSE,
  registrationLink,
  resolveSmsPurpose,
} from "../_shared/security/portalInvitation.ts";
import {
  beginInvitation,
  finishInvitation,
} from "../_shared/security/portalInvitationDb.ts";
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
// - Every request has a purpose ("purpose" in the body; older app versions
//   send none and get the purpose their ids imply, see resolveSmsPurpose):
//     medication_reminder { reminderId }  -> the stored reminder's number and text
//     patient_message     { patientId, message } -> patients.phone
//     portal_invitation   { patientId }  -> patients.phone, text built here
//   Reminders and patient messages need a role in SMS_SENDER_ROLES
//   (pharmacist, doctor, nurse, lead_clinician, admin), else 403.
//   A portal invitation needs the 'portal_invite' permission instead
//   (registration_lead, lead_clinician, admin), checked in the database by
//   public.portal_invitation_begin(), which also requires the patient to be
//   on the server, not merged away, with portal access on, and records who
//   sent which invitation (public.portal_invitation_events). So a
//   medication-reminder sender cannot send an invitation and an invitation
//   sender cannot send reminders or free text. An invitation's text and
//   link come from the patient record; any client "message" is ignored.
//   Free text carrying the portal registration link (how older app
//   versions sent invitations) is refused as a patient message (400
//   use_portal_invitation).
// - The recipient is never taken from the client. A "to" field in the body
//   is ignored. Only Nigerian mobile numbers are sent to.
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
  purpose?: unknown;
  /** The app's address, for the invitation link (used only if allowed). */
  appOrigin?: unknown;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

type ServiceClient = ReturnType<typeof getServiceClient>;

type Reply = (
  status: number,
  body: Record<string, unknown>,
  extra?: Record<string, string>,
) => Response;

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

/**
 * Purpose "portal_invitation": the database checks the sender
 * (portal_invite) and the patient, returns the stored phone and records the
 * request; the text and link are built here; the outcome is recorded after
 * the provider answers. `invitationRecorded` in the reply says whether that
 * outcome was recorded.
 */
async function sendPortalInvitationSms(
  service: ServiceClient,
  auth: { userId: string; role: string },
  patientId: string,
  requestedOrigin: unknown,
  reply: Reply,
): Promise<Response> {
  const begun = await beginInvitation(service, auth.userId, patientId, "sms");
  if ("refused" in begun) {
    const refusal = invitationRefusal(begun.refused, "sms");
    return reply(refusal.status, {
      success: false,
      error: refusal.error,
      message: refusal.message,
    });
  }
  const { grant } = begun;
  const finish = (
    outcome: "sent" | "not_sent",
    detail: string,
    provider: string | null = null,
    messageId: string | null = null,
  ) =>
    finishInvitation(service, grant.invitationId, outcome, detail, provider, messageId);

  const msisdn = normalizeNigerianMsisdn(grant.recipient);
  if (!msisdn) {
    const invitationRecorded = await finish("not_sent", "invalid_recipient");
    return reply(422, {
      success: false,
      error: "invalid_recipient",
      message: "The stored phone number is not a valid Nigerian mobile number.",
      invitationRecorded,
    });
  }

  // Same limits and buckets as reminders: an invitation counts towards the
  // patient's hourly SMS limit.
  const limit = await checkSmsLimits(service, [
    { bucket: "sms_send_user", key: auth.userId, ...PER_USER_LIMIT },
    {
      bucket: "sms_send_recipient",
      key: await hashKey(msisdn),
      ...PER_RECIPIENT_LIMIT,
    },
  ]);
  if (!limit.allowed) {
    if ("error" in limit) {
      const invitationRecorded = await finish("not_sent", "rate_limit_unavailable");
      return reply(503, {
        success: false,
        error: "rate_limit_unavailable",
        message: "SMS sending is paused because the send limit could not be checked. Try again shortly.",
        invitationRecorded,
      });
    }
    const invitationRecorded = await finish("not_sent", "rate_limited");
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
        invitationRecorded,
      },
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  // The link pre-fills the stored number, so the text is never logged.
  const origin = invitationOrigin(
    requestedOrigin,
    Deno.env.get("PORTAL_APP_ORIGIN"),
    allowedOrigins(),
  );
  const message = invitationSmsText(
    grant.givenName,
    registrationLink(origin, "sms", grant.recipient),
  );

  const config = resolveSmsConfig();
  if (!config) {
    if (demoModeEnabled()) {
      console.log(
        `SMS demo mode: portal invitation not sent - To: ${maskMsisdn(msisdn)}, Invitation: ${grant.invitationId}, By: ${auth.userId}`,
      );
      const invitationRecorded = await finish("not_sent", "demo_mode");
      return reply(200, {
        success: true,
        demo: true,
        provider: "demo",
        invitationRecorded,
        message:
          "SMS_DEMO_MODE is on: message not sent (logged without the number or text)",
      });
    }
    console.error(
      "send-sms-reminder: no SMS provider configured (set TERMII_API_KEY + TERMII_SENDER_ID, or TWILIO_* secrets)",
    );
    const invitationRecorded = await finish("not_sent", "sms_not_configured");
    return reply(503, {
      success: false,
      configured: false,
      error: "sms_not_configured",
      message:
        "No SMS provider configured. Set TERMII_API_KEY and TERMII_SENDER_ID (preferred) or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER, then redeploy.",
      invitationRecorded,
    });
  }

  const result = await sendSms(config, msisdn, message);
  if (!result.ok) {
    const safeError = redactNumbers(result.error || "Failed to send SMS");
    console.error(`${result.provider} portal invitation send failed:`, safeError);
    const invitationRecorded = await finish("not_sent", "provider_rejected", result.provider);
    return reply(502, {
      success: false,
      provider: result.provider,
      error: safeError,
      invitationRecorded,
    });
  }

  console.log(
    `Portal invitation SMS accepted by ${result.provider} - To: ${maskMsisdn(msisdn)}, ID: ${result.messageId ?? "n/a"}, Invitation: ${grant.invitationId}, By: ${auth.userId} (${auth.role})`,
  );
  const invitationRecorded = await finish(
    "sent",
    "provider_accepted",
    result.provider,
    result.messageId ?? null,
  );
  return reply(200, {
    success: true,
    provider: result.provider,
    messageId: result.messageId,
    invitationRecorded,
  });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const reply: Reply = (status, body, extra = {}) =>
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

    // 1. Who is calling? (What their role may send depends on the purpose,
    //    checked in step 2.)
    const auth = await authenticateStaff(req, service);
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

    // What is it for, and may this role send it?
    const purpose = resolveSmsPurpose({ purpose: body.purpose, reminderId, patientId });
    if (!purpose.ok) {
      return reply(400, {
        success: false,
        error: purpose.error,
        message: purpose.message,
      });
    }
    if (purpose.purpose === PORTAL_INVITATION_PURPOSE) {
      // resolveSmsPurpose has checked: a patientId and no reminderId.
      if (!patientId) {
        return reply(400, { success: false, error: "recipient_required" });
      }
      return await sendPortalInvitationSms(
        service,
        auth,
        patientId,
        body.appOrigin,
        reply,
      );
    }
    // Medication reminders and patient messages.
    if (!SMS_SENDER_ROLES.includes(auth.role)) {
      return reply(403, {
        success: false,
        error: "not_permitted",
        message: "Your role cannot send SMS to patients.",
      });
    }
    // An invitation sent as free text (older app versions) would skip the
    // portal_invite check and the invitation record: refused.
    if (purpose.purpose === "patient_message" && isPortalInvitationText(body.message)) {
      return reply(400, {
        success: false,
        error: "use_portal_invitation",
        message:
          'Portal invitations are sent with purpose "portal_invitation" by registration leads, lead clinicians and admins. Nothing was sent.',
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
