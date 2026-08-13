/**
 * Sends one real SMS through the deployed send-sms-reminder edge function,
 * end to end: edge function -> provider (Termii or Twilio) -> handset.
 *
 * Usage:
 *   npx tsx scripts/send-test-sms.ts +2348012345678
 *   npx tsx scripts/send-test-sms.ts 08031234567 "Custom message"
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or SUPABASE_URL /
 * SUPABASE_ANON_KEY) from the environment, .env.local, or .env.
 *
 * Exits non-zero when the SMS did not actually go out — including the case
 * where the function is running with SMS_DEMO_MODE on, so this script can
 * serve as the go-live check.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(): void {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const to = process.argv[2];
  if (!to) {
    console.error(
      "Usage: npx tsx scripts/send-test-sms.ts <phone> [message]\n" +
        '  e.g. npx tsx scripts/send-test-sms.ts "+2348012345678"',
    );
    process.exit(2);
  }

  const message =
    process.argv[3] ||
    "mBHR: This is a test message. Your SMS setup is working correctly.";

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error(
      "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (checked env, .env.local, .env).",
    );
    process.exit(2);
  }

  console.log(`Sending test SMS to ${to} via ${url}/functions/v1/send-sms-reminder ...`);

  const response = await fetch(`${url}/functions/v1/send-sms-reminder`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, message }),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text
  }

  console.log(`HTTP ${response.status}`);
  console.log(text);

  if (data.demo === true) {
    console.error(
      "\nFAIL: function is in SMS_DEMO_MODE — the message was logged, not sent. " +
        "Unset SMS_DEMO_MODE and set TERMII_API_KEY + TERMII_SENDER_ID.",
    );
    process.exit(1);
  }

  if (!response.ok || data.success !== true) {
    console.error(
      "\nFAIL: SMS was not sent. See error above (secrets missing or provider rejected the message).",
    );
    process.exit(1);
  }

  console.log(
    `\nOK: sent via ${String(data.provider ?? "unknown")} (id: ${String(data.messageId ?? "n/a")}). ` +
      "Confirm the message arrived on the handset.",
  );
}

main().catch((error) => {
  console.error("Unexpected failure:", error);
  process.exit(1);
});
