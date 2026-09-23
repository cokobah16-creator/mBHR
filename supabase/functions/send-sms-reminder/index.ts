import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import {
  demoModeEnabled,
  normalizeMsisdn,
  resolveSmsConfig,
  sendSms,
} from "../_shared/sms/provider.ts";

interface SMSRequest {
  to: string;
  message: string;
  reminderId?: string;
}

// Logs must not carry the full phone number or the message text (it names
// the patient and their medicine). Same format as maskPhoneForLog in
// src/services/logSafe.ts: "2348031234567" -> "234803***4567".
function maskMsisdn(msisdn: string): string {
  const digits = (msisdn || "").replace(/\D/g, "");
  if (!digits) return "(none)";
  if (digits.length < 8) return "***";
  const keepStart = Math.min(6, digits.length - 7);
  return `${digits.slice(0, keepStart)}***${digits.slice(-4)}`;
}

// Provider error text can quote the number (Twilio: "The 'To' number +234...
// is not a valid phone number"); mask any long digit run before logging.
function redactNumbers(text: string): string {
  return String(text ?? "").replace(/\+?\d[\d\s-]{6,}\d/g, (run) =>
    maskMsisdn(run),
  );
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

  const rl = await enforceRateLimit(req, {
    bucket: "edge_sms_reminder",
    keyStrategy: "ip",
    max: 30,
    windowSeconds: 60,
  });
  if (!rl.allowed && rl.response) {
    return new Response(rl.response.body, {
      status: rl.response.status,
      headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) },
    });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const { to, message, reminderId }: SMSRequest = await req.json();

    if (!to || !message) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Phone number and message are required",
        }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const msisdn = normalizeMsisdn(to);
    if (!msisdn) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid phone number: ${to}`,
        }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const config = resolveSmsConfig();

    if (!config) {
      if (demoModeEnabled()) {
        console.log(
          `SMS demo mode: not sent - To: ${maskMsisdn(msisdn)}, Length: ${message.length} chars, ReminderId: ${reminderId || "N/A"}`,
        );
        return new Response(
          JSON.stringify({
            success: true,
            demo: true,
            provider: "demo",
            message:
              "SMS_DEMO_MODE is on: message not sent (logged without the number or text)",
          }),
          { status: 200, headers: jsonHeaders },
        );
      }

      // No provider secrets and no explicit demo opt-in: fail loudly instead
      // of pretending the SMS went out.
      console.error(
        "send-sms-reminder: no SMS provider configured (set TERMII_API_KEY + TERMII_SENDER_ID, or TWILIO_* secrets)",
      );
      return new Response(
        JSON.stringify({
          success: false,
          configured: false,
          error: "sms_not_configured",
          message:
            "No SMS provider configured. Set TERMII_API_KEY and TERMII_SENDER_ID (preferred) or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER, then redeploy.",
        }),
        { status: 503, headers: jsonHeaders },
      );
    }

    const result = await sendSms(config, msisdn, message);

    if (!result.ok) {
      console.error(
        `${result.provider} send failed:`,
        redactNumbers(result.error || "no error text"),
      );
      return new Response(
        JSON.stringify({
          success: false,
          provider: result.provider,
          error: result.error || "Failed to send SMS",
        }),
        { status: 502, headers: jsonHeaders },
      );
    }

    console.log(
      `SMS accepted by ${result.provider} - To: ${maskMsisdn(msisdn)}, ID: ${result.messageId ?? "n/a"}, ReminderId: ${reminderId || "N/A"}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        provider: result.provider,
        messageId: result.messageId,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (error) {
    console.error("Error in send-sms-reminder:", errorName(error));
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
