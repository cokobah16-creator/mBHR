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
          `SMS Demo - To: ${msisdn}, Message: ${message}, ReminderId: ${reminderId || "N/A"}`,
        );
        return new Response(
          JSON.stringify({
            success: true,
            demo: true,
            provider: "demo",
            message: "SMS_DEMO_MODE is on: message logged, not sent",
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
      console.error(`${result.provider} send failed:`, result.error);
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
      `SMS sent via ${result.provider} - To: ${msisdn}, ID: ${result.messageId ?? "n/a"}, ReminderId: ${reminderId || "N/A"}`,
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
    console.error("Error in send-sms-reminder:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
