import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import {
  demoModeEnabled,
  normalizeMsisdn,
  resolveSmsConfig,
  sendSms,
} from "../_shared/sms/provider.ts";

interface OTPRequest {
  phone: string;
  otp: string;
  locale?: string;
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

function otpMessage(otp: string, locale?: string): string {
  const body = OTP_BODIES[locale ?? "en"] ?? OTP_BODIES.en;
  return body.replace("{{otp}}", otp);
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
    bucket: "edge_otp_sms",
    keyStrategy: "ip",
    max: 10,
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
    const { phone, otp, locale }: OTPRequest = await req.json();

    if (!phone || !otp) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone and OTP are required" }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const msisdn = normalizeMsisdn(phone);
    if (!msisdn) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid phone number: ${phone}` }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const config = resolveSmsConfig();

    if (!config) {
      if (demoModeEnabled()) {
        console.log(`OTP Demo - To: ${msisdn}, OTP: ${otp}`);
        return new Response(
          JSON.stringify({
            success: true,
            demo: true,
            provider: "demo",
            message: "SMS_DEMO_MODE is on: OTP logged, not sent",
          }),
          { status: 200, headers: jsonHeaders },
        );
      }

      // Callers use supabase.functions.invoke and read the success flag, so
      // configuration errors keep HTTP 200 — but success is honestly false.
      return new Response(
        JSON.stringify({
          success: false,
          configured: false,
          error:
            "No SMS provider configured. Set TERMII_API_KEY and TERMII_SENDER_ID (preferred) or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER, then redeploy.",
        }),
        { status: 200, headers: jsonHeaders },
      );
    }

    const result = await sendSms(config, msisdn, otpMessage(otp, locale));

    if (!result.ok) {
      console.error(`${result.provider} OTP send failed:`, result.error);
      return new Response(
        JSON.stringify({
          success: false,
          provider: result.provider,
          error: result.error || "Failed to send OTP SMS",
        }),
        { status: 200, headers: jsonHeaders },
      );
    }

    console.log(`OTP SMS sent via ${result.provider}: ${result.messageId ?? "n/a"}`);

    return new Response(
      JSON.stringify({
        success: true,
        provider: result.provider,
        messageId: result.messageId,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (error) {
    console.error("Error in send-otp-sms:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 200, headers: jsonHeaders },
    );
  }
});
