/**
 * Sends one real SMS through the deployed send-sms-reminder edge function,
 * end to end: staff sign-in -> edge function -> provider (Termii or Twilio)
 * -> handset.
 *
 * The function only sends for a signed-in staff account whose role may send
 * SMS (pharmacist, doctor, nurse, lead_clinician, admin), and only to the
 * phone number on the patient's record on the server. It never takes a
 * number from the caller. So this script:
 *   1. signs in as a staff user (email + password),
 *   2. sends { patientId, message } with that user's access token.
 *
 * Use a TEST patient record whose phone number is a handset you can check
 * (a Nigerian mobile number). Never point this at a real patient.
 *
 * Usage:
 *   MBHR_STAFF_EMAIL=you@example.org MBHR_STAFF_PASSWORD=... \
 *     npx tsx scripts/send-test-sms.ts <patientId> ["Custom message"]
 *   npm run test:sms -- <patientId>
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or SUPABASE_URL /
 * SUPABASE_ANON_KEY) and MBHR_STAFF_EMAIL / MBHR_STAFF_PASSWORD from the
 * environment, .env.local, or .env. The anon key is only the project's
 * public API key (sent as `apikey`); it cannot send SMS by itself.
 *
 * Exits non-zero when the SMS did not actually go out, including when the
 * function is running with SMS_DEMO_MODE on, so this script can serve as
 * the go-live check.
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

/** Signs in with email + password and returns the user's access token. */
async function signIn(
  url: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    error_description?: unknown;
    msg?: unknown;
  };
  if (!response.ok || typeof data.access_token !== "string") {
    const reason =
      typeof data.error_description === "string"
        ? data.error_description
        : typeof data.msg === "string"
          ? data.msg
          : `HTTP ${response.status}`;
    throw new Error(`Staff sign-in failed: ${reason}`);
  }
  return data.access_token;
}

async function main(): Promise<void> {
  loadDotEnv();

  const patientId = process.argv[2];
  if (!patientId || /^\+?\d[\d\s-]+$/.test(patientId)) {
    console.error(
      "Usage: npx tsx scripts/send-test-sms.ts <patientId> [message]\n" +
        "  The SMS goes to the phone number on that patient's record on the server;\n" +
        "  a phone number is not accepted. Use a test patient whose number is a\n" +
        "  handset you can check.",
    );
    process.exit(2);
  }

  const message =
    process.argv[3] ||
    "mBHR: This is a test message. Your SMS setup is working correctly.";

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const email = process.env.MBHR_STAFF_EMAIL;
  const password = process.env.MBHR_STAFF_PASSWORD;

  if (!url || !anonKey) {
    console.error(
      "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (checked env, .env.local, .env).",
    );
    process.exit(2);
  }
  if (!email || !password) {
    console.error(
      "Missing MBHR_STAFF_EMAIL / MBHR_STAFF_PASSWORD. Sign in as a staff user whose\n" +
        "role may send SMS (pharmacist, doctor, nurse, lead_clinician or admin).",
    );
    process.exit(2);
  }

  console.log(`Signing in as a staff user at ${url} ...`);
  const accessToken = await signIn(url, anonKey, email, password);

  console.log(
    `Sending a test SMS to the number on patient ${patientId}'s record via ${url}/functions/v1/send-sms-reminder ...`,
  );

  const response = await fetch(`${url}/functions/v1/send-sms-reminder`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ patientId, message }),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text
  }

  // The function's responses never contain the phone number or the text.
  console.log(`HTTP ${response.status}`);
  console.log(text);

  if (data.demo === true) {
    console.error(
      "\nFAIL: function is in SMS_DEMO_MODE: the message was logged, not sent. " +
        "Unset SMS_DEMO_MODE and set TERMII_API_KEY + TERMII_SENDER_ID.",
    );
    process.exit(1);
  }

  if (!response.ok || data.success !== true) {
    const hints: Record<string, string> = {
      not_authenticated: "The access token was refused. Check the staff sign-in.",
      not_permitted:
        "This staff role cannot send SMS, or the account is deactivated. Use a pharmacist, doctor, nurse, lead_clinician or admin account.",
      patient_not_found: "That patient id is not on the server. Sync it first.",
      no_phone: "The patient's record on the server has no phone number.",
      invalid_recipient:
        "The number on the patient's record is not a valid Nigerian mobile number.",
      rate_limited: "A send limit was hit (30/min per staff user, 5/hour per number). Wait and retry.",
      rate_limit_unavailable:
        "The send limit could not be checked (RATE_LIMIT_KEY_SALT unset or the rate-limit table unreachable). Nothing was sent.",
      sms_not_configured: "Set TERMII_API_KEY and TERMII_SENDER_ID, then redeploy.",
    };
    const code = typeof data.error === "string" ? data.error : "";
    console.error(
      `\nFAIL: SMS was not sent.${hints[code] ? ` ${hints[code]}` : " See the error above."}`,
    );
    process.exit(1);
  }

  console.log(
    `\nOK: accepted by ${String(data.provider ?? "unknown")} (id: ${String(data.messageId ?? "n/a")}). ` +
      "Confirm the message arrived on the handset; acceptance is not delivery.",
  );
}

main().catch((error) => {
  console.error("Unexpected failure:", error instanceof Error ? error.message : error);
  process.exit(1);
});
