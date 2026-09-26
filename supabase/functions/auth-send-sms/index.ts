import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getServiceClient } from "../_shared/security/staffAuth.ts";
import {
  checkSmsLimits,
  hashKey,
  PER_RECIPIENT_LIMIT,
} from "../_shared/security/smsRateLimit.ts";
import {
  maskMsisdn,
  normalizeNigerianMsisdn,
  redactNumbers,
} from "../_shared/security/recipient.ts";
import { resolveSmsConfig, sendSms } from "../_shared/sms/provider.ts";
import {
  hookError,
  parseSendSmsPayload,
  signInSmsText,
  verifyWebhook,
} from "../_shared/sms/authSmsHook.ts";

// Supabase Auth "Send SMS" hook: texts the sign-in code Supabase Auth made
// for a patient signing in with their phone (signInWithOtp), through Termii
// (Twilio as a fallback), using the same provider code as send-otp-sms.
//
// Who calls this: only Supabase Auth. It carries no user JWT, so the function
// is deployed with JWT verification off (the deploy workflow does this for
// this function only). Instead every call must carry a valid Standard
// Webhooks signature made with this project's hook secret
// (SEND_SMS_HOOK_SECRET, "v1,whsec_…" from Auth > Hooks) and be under five
// minutes old; anything else gets 401 before the body is used.
//
// Recipient: the phone on the Auth user, which Supabase Auth supplies. Only
// Nigerian mobile numbers are sent to. The text is a fixed template around
// the code. At most 5 texts an hour per number (hashed key, fail-closed), on
// top of Supabase Auth's own SMS limits.
//
// Logs never contain the number (masked) or the code. Answers: 200 {} when
// the provider accepted the text; otherwise an error Supabase Auth passes on,
// so the sign-in screen says the code was not sent.
//
// Secrets: SEND_SMS_HOOK_SECRET, the SMS provider secrets (see
// _shared/sms/provider.ts) and RATE_LIMIT_KEY_SALT. SMS_DEMO_MODE is ignored
// here: a sign-in code that was not sent is never reported as sent.

const JSON_HEADERS = { "Content-Type": "application/json" };

function fail(status: number, message: string): Response {
  return new Response(hookError(status, message), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const body = await req.text();
  const check = await verifyWebhook(Deno.env.get("SEND_SMS_HOOK_SECRET"), req.headers, body);
  if (!check.ok) {
    if (check.reason === "no_secret") {
      console.error("auth-send-sms: SEND_SMS_HOOK_SECRET is not set; refusing all calls");
      return fail(500, "SMS sign-in is not set up");
    }
    console.warn(`auth-send-sms: refused unsigned or stale call (${check.reason})`);
    return fail(401, "Unauthorized");
  }

  let payload: ReturnType<typeof parseSendSmsPayload>;
  try {
    payload = parseSendSmsPayload(JSON.parse(body));
  } catch {
    payload = null;
  }
  if (!payload) return fail(400, "Invalid hook payload");

  const msisdn = normalizeNigerianMsisdn(payload.phone);
  if (!msisdn) {
    console.warn(`auth-send-sms: not a Nigerian mobile number, not sent (user ${payload.userId})`);
    return fail(422, "Codes can only be sent to Nigerian mobile numbers");
  }

  try {
    const service = getServiceClient();
    const limit = await checkSmsLimits(service, [
      {
        bucket: "sms_auth_otp_recipient",
        key: await hashKey(msisdn),
        ...PER_RECIPIENT_LIMIT,
      },
    ]);
    if (!limit.allowed) {
      if ("error" in limit) return fail(503, "SMS sending is paused; try again shortly");
      return fail(429, "Too many codes for this number; try again later");
    }

    const config = resolveSmsConfig();
    if (!config) {
      console.error("auth-send-sms: no SMS provider configured; code not sent");
      return fail(500, "SMS provider is not configured");
    }

    const result = await sendSms(config, msisdn, signInSmsText(payload.otp, payload.locale));
    if (!result.ok) {
      console.error(
        `auth-send-sms: ${result.provider} send failed for ${maskMsisdn(msisdn)}:`,
        redactNumbers(result.error || "unknown error"),
      );
      return fail(502, "The text message could not be sent");
    }

    console.log(
      `auth-send-sms: accepted by ${result.provider} - To: ${maskMsisdn(msisdn)}, ID: ${result.messageId ?? "n/a"}`,
    );
    return new Response("{}", { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    console.error(
      "auth-send-sms: unexpected error:",
      error instanceof Error ? error.name : typeof error,
    );
    return fail(500, "The text message could not be sent");
  }
});
