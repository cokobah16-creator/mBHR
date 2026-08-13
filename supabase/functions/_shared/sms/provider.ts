// Shared SMS provider for edge functions.
//
// Termii is the preferred provider (naira billing, local routes, and a DND
// channel that reaches the many Nigerian numbers with Do-Not-Disturb active).
// Twilio remains supported as a fallback so existing deployments keep working.
//
// Secrets (set via `supabase secrets set`):
//   TERMII_API_KEY     - Termii API key
//   TERMII_SENDER_ID   - approved sender ID (registration takes days — start early)
//   TERMII_CHANNEL     - optional, "dnd" (default) or "generic"
//   TERMII_BASE_URL    - optional, defaults to https://api.ng.termii.com
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER - fallback
//   SMS_DEMO_MODE      - "true" to log instead of send (explicit opt-in only)

export interface SmsSendResult {
  ok: boolean;
  provider: "termii" | "twilio";
  messageId?: string;
  error?: string;
}

export type SmsConfig =
  | {
      provider: "termii";
      apiKey: string;
      senderId: string;
      channel: string;
      baseUrl: string;
    }
  | {
      provider: "twilio";
      accountSid: string;
      authToken: string;
      from: string;
    };

export function resolveSmsConfig(): SmsConfig | null {
  const termiiApiKey = Deno.env.get("TERMII_API_KEY");
  const termiiSenderId = Deno.env.get("TERMII_SENDER_ID");
  if (termiiApiKey && termiiSenderId) {
    return {
      provider: "termii",
      apiKey: termiiApiKey,
      senderId: termiiSenderId,
      channel: Deno.env.get("TERMII_CHANNEL") || "dnd",
      baseUrl: Deno.env.get("TERMII_BASE_URL") || "https://api.ng.termii.com",
    };
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (accountSid && authToken && from) {
    return { provider: "twilio", accountSid, authToken, from };
  }

  return null;
}

export function demoModeEnabled(): boolean {
  return Deno.env.get("SMS_DEMO_MODE") === "true";
}

// Normalizes a Nigerian (or already-international) number to digits without a
// leading "+", e.g. "0803 123 4567" -> "2348031234567". Returns null when the
// input cannot be a valid MSISDN.
export function normalizeMsisdn(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned.slice(1);
  if (/^0\d{10}$/.test(cleaned)) return `234${cleaned.slice(1)}`;
  if (/^\d{8,15}$/.test(cleaned)) return cleaned;
  return null;
}

async function sendViaTermii(
  config: Extract<SmsConfig, { provider: "termii" }>,
  msisdn: string,
  message: string,
): Promise<SmsSendResult> {
  const response = await fetch(`${config.baseUrl}/api/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: config.apiKey,
      to: msisdn,
      from: config.senderId,
      sms: message,
      type: "plain",
      channel: config.channel,
    }),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON error body; keep raw text for the error message
  }

  if (!response.ok) {
    return {
      ok: false,
      provider: "termii",
      error:
        typeof data.message === "string"
          ? data.message
          : `Termii HTTP ${response.status}: ${text.slice(0, 200)}`,
    };
  }

  return {
    ok: true,
    provider: "termii",
    messageId: typeof data.message_id === "string" ? data.message_id : undefined,
  };
}

async function sendViaTwilio(
  config: Extract<SmsConfig, { provider: "twilio" }>,
  msisdn: string,
  message: string,
): Promise<SmsSendResult> {
  const auth = btoa(`${config.accountSid}:${config.authToken}`);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: `+${msisdn}`,
        From: config.from,
        Body: message,
      }).toString(),
    },
  );

  const data = await response.json().catch(() => ({}) as Record<string, unknown>);

  if (!response.ok) {
    return {
      ok: false,
      provider: "twilio",
      error:
        typeof data.message === "string"
          ? data.message
          : `Twilio HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    provider: "twilio",
    messageId: typeof data.sid === "string" ? data.sid : undefined,
  };
}

export async function sendSms(
  config: SmsConfig,
  msisdn: string,
  message: string,
): Promise<SmsSendResult> {
  try {
    return config.provider === "termii"
      ? await sendViaTermii(config, msisdn, message)
      : await sendViaTwilio(config, msisdn, message);
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      error: error instanceof Error ? error.message : "SMS provider request failed",
    };
  }
}
