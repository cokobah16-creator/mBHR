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
  validOtp,
} from "../_shared/security/recipient.ts";
import {
  demoModeEnabled,
  resolveSmsConfig,
  sendSms,
} from "../_shared/sms/provider.ts";

// Sends a portal verification code by SMS.
//
// Who calls this: only staff. No app screen calls it now: portal invitations
// go through send-otp-email (email) and send-sms-reminder (SMS) with purpose
// "portal_invitation" (sendPortalInvitation in src/services/portalEnrollment.ts).
// Patient self-service OTP (requestOTP in src/services/patientPortalAuth.ts)
// is disabled and does not call it. So the same rules as send-sms-reminder
// apply: a signed-in staff member with an SMS role (see SMS_SENDER_ROLES),
// 401 for anonymous / anon-key callers, 403 for other roles.
//
// Recipient: { patientId } is required and the number is looked up in
// patients.phone; a client-supplied "phone" is ignored. Only Nigerian mobile
// numbers are sent to. The text is a fixed
// template around a 4-8 digit code, so it cannot carry arbitrary content.
// Rate limits: 30/min per staff user, 5/hour per recipient (hashed key).
// Logs never contain the number or the code.

interface OTPRequest {
  phone?: unknown;
  patientId?: unknown;
  otp?: unknown;
  locale?: unknown;
}

// Kept in sync with the "otp" rows seeded into message_templates. Inlined here
// so the OTP path never needs a database round-trip.
const OTP_BODIES: Record<string, string> = {
  en: "Your mBHR verification code is {{otp}}. It expires in 10 minutes. Do not share this code with anyone.",
  ha: "Lambar tabbatarwa ta mBHR: {{otp}}. Tana karewa cikin minti 10. Kada ku ba kowa wannan lambar.",
  yo: "Koodu ijerisi mBHR yin ni {{otp}}. Yoo pari laarin iseju 10. E ma fi han enikeni.",
  ig: "Koodu nkwenye mBHR gi bu {{otp}}. O ga-agwu n'ime nkeji 10. Agwala onye obula ya.",
  pcm: "Your mBHR code na {{otp}}. E go expire after 10 minutes. Abeg no give anybody this code.",
};

function otpMessage(otp: string, locale?: unknown): string {
  const key = typeof locale === "string" ? locale : "en";
  const body = OTP_BODIES[key] ?? OTP_BODIES.en;
  return body.replace("{{otp}}", otp);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
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

  const rl = await enforceRateLimit(req, {
    bucket: "edge_otp_sms",
    keyStrategy: "ip",
    max: 10,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    const retryAfter = rl.retryAfter ?? 60;
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

    const auth = await requireStaff(req, service, SMS_SENDER_ROLES);
    if (!auth.ok) {
      return reply(auth.status, {
        success: false,
        error: auth.error,
        message: auth.message,
      });
    }

    let body: OTPRequest;
    try {
      body = (await req.json()) as OTPRequest;
    } catch {
      return reply(400, { success: false, error: "invalid_request" });
    }

    const otp = validOtp(body.otp);
    if (!otp) {
      return reply(400, {
        success: false,
        error: "invalid_otp",
        message: "A 4 to 8 digit code is required.",
      });
    }

    // The number always comes from the patient record on the server. A
    // client-supplied "phone" is ignored, so this function cannot be used to
    // text an arbitrary number.
    if (body.patientId == null) {
      return reply(400, {
        success: false,
        error: "recipient_required",
        message: "Send a patientId. Phone numbers are looked up on the server.",
      });
    }
    const patientId = validId(body.patientId);
    if (!patientId) {
      return reply(400, { success: false, error: "invalid_patient_id" });
    }
    const { data: patient, error: patientError } = await service
      .from("patients")
      .select("id, phone")
      .eq("id", patientId)
      .maybeSingle();
    if (patientError) {
      console.error("send-otp-sms: patient lookup failed:", patientError.code ?? "error");
      return reply(503, { success: false, error: "lookup_failed" });
    }
    if (!patient) {
      return reply(404, {
        success: false,
        error: "patient_not_found",
        message: "This patient is not on the server yet. Sync, then try again.",
      });
    }
    const rawPhone: unknown = patient.phone;

    if (!rawPhone) {
      return reply(422, {
        success: false,
        error: "no_phone",
        message: "The patient has no phone number on the server.",
      });
    }

    const msisdn = normalizeNigerianMsisdn(rawPhone);
    if (!msisdn) {
      // The number is never echoed back.
      return reply(422, {
        success: false,
        error: "invalid_recipient",
        message: "The phone number is not a valid Nigerian mobile number.",
      });
    }

    const limit = await checkSmsLimits(service, [
      { bucket: "sms_send_user", key: auth.userId, ...PER_USER_LIMIT },
      {
        bucket: "sms_otp_recipient",
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
        },
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    const config = resolveSmsConfig();

    if (!config) {
      if (demoModeEnabled()) {
        // Neither the number nor the code is logged.
        console.log(`OTP demo mode: not sent - To: ${maskMsisdn(msisdn)}, By: ${auth.userId}`);
        return reply(200, {
          success: true,
          demo: true,
          provider: "demo",
          message: "SMS_DEMO_MODE is on: code not sent",
        });
      }

      // Callers use supabase.functions.invoke and read the success flag, so
      // configuration errors keep HTTP 200 — but success is honestly false.
      return reply(200, {
        success: false,
        configured: false,
        error:
          "No SMS provider configured. Set TERMII_API_KEY and TERMII_SENDER_ID (preferred) or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER, then redeploy.",
      });
    }

    const result = await sendSms(config, msisdn, otpMessage(otp, body.locale));

    if (!result.ok) {
      const safeError = redactNumbers(result.error || "Failed to send OTP SMS");
      console.error(`${result.provider} OTP send failed:`, safeError);
      return reply(200, {
        success: false,
        provider: result.provider,
        error: safeError,
      });
    }

    console.log(
      `OTP SMS accepted by ${result.provider} - To: ${maskMsisdn(msisdn)}, ID: ${result.messageId ?? "n/a"}, By: ${auth.userId}`,
    );

    return reply(200, {
      success: true,
      provider: result.provider,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Error in send-otp-sms:", errorName(error));
    return reply(200, {
      success: false,
      error: "internal_error",
    });
  }
});
