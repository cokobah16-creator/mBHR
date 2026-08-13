import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";

// Server-side authority for patient-portal OTP and sessions.
//
//   POST /portal-otp/issue            { contact, channel: "sms"|"email", locale? }
//   POST /portal-otp/verify           { contact, channel, otp }
//   POST /portal-otp/session-validate { sessionToken }
//
// The OTP is generated HERE, stored as a salted hash, compared HERE, and
// only a successful verify flips account_status to 'active' and mints a
// session — all with the service role. The send-otp-sms / send-otp-email
// functions stay pure relays, but are now fed exclusively by this function.
// Previously the client minted and compared the code itself and enrollment
// rows were born 'active', so activation was forgeable by any anon caller.

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const MAX_SENDS_PER_CONTACT_PER_HOUR = 5;
const SESSION_HOURS = 4; // matches SESSION_CONFIGS.patient.duration
const SESSION_GRACE_MS = 5 * 60 * 1000;
const SESSION_REFRESH_BEFORE_MS = 15 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any>>;

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

async function hashOtp(otp: string, saltB64?: string): Promise<string> {
  const salt =
    saltB64 ??
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const digest = await sha256Hex(`${salt}:${otp}`);
  return `${salt}:${digest}`;
}

async function otpMatches(otp: string, stored: string): Promise<boolean> {
  const salt = stored.split(":")[0];
  const candidate = await hashOtp(otp, salt);
  // Same length by construction; constant-time-ish compare.
  let diff = 0;
  for (let i = 0; i < stored.length; i++) {
    diff |= stored.charCodeAt(i) ^ (candidate.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}

// Phone numbers reach the table in whatever format the enrolling client used,
// so match on the common Nigerian variants of the same number.
function phoneVariants(raw: string): string[] {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  const variants = new Set<string>([raw, cleaned]);
  let msisdn: string | null = null;
  if (/^\+\d{8,15}$/.test(cleaned)) msisdn = cleaned.slice(1);
  else if (/^0\d{10}$/.test(cleaned)) msisdn = `234${cleaned.slice(1)}`;
  else if (/^\d{8,15}$/.test(cleaned)) msisdn = cleaned;
  if (msisdn) {
    variants.add(msisdn);
    variants.add(`+${msisdn}`);
    if (msisdn.startsWith("234")) variants.add(`0${msisdn.slice(3)}`);
  }
  return [...variants];
}

async function findPortalUser(
  db: Db,
  contact: string,
  channel: "sms" | "email",
) {
  const query = db
    .from("patient_portal_users")
    .select(
      "id, patient_id, phone_number, email, account_status, otp_secret, otp_expires_at, otp_attempts",
    );
  const { data, error } =
    channel === "email"
      ? await query.ilike("email", contact.trim()).limit(1)
      : await query.in("phone_number", phoneVariants(contact)).limit(1);
  if (error) throw new Error(`portal user lookup failed: ${error.message}`);
  return data?.[0] ?? null;
}

async function handleIssue(
  db: Db,
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  const channel = body.channel === "email" ? "email" : "sms";
  const locale = typeof body.locale === "string" ? body.locale : "en";
  if (!contact) {
    return json({ success: false, error: "contact is required" }, 400, headers);
  }

  // Per-contact rate limit through the (previously dead) tracking table.
  const { data: rl, error: rlErr } = await db.rpc(
    "check_and_increment_otp_rate_limit",
    {
      p_contact_method: channel === "email" ? "email" : "phone",
      p_contact_value: contact.toLowerCase(),
      p_max_requests: MAX_SENDS_PER_CONTACT_PER_HOUR,
    },
  );
  if (rlErr) {
    console.error("otp rate limit rpc failed:", rlErr.message);
  } else if (rl && (rl as { allowed?: boolean }).allowed === false) {
    return json(
      {
        success: false,
        error: "Too many codes requested. Please wait before trying again.",
        retryAfterSeconds: (rl as { retry_after_seconds?: number })
          .retry_after_seconds,
      },
      429,
      headers,
    );
  }

  const user = await findPortalUser(db, contact, channel);
  // Do not reveal whether an account exists for this contact.
  if (!user) return json({ success: true }, 200, headers);

  const otp = generateOtp();
  const { error: updateErr } = await db
    .from("patient_portal_users")
    .update({
      otp_secret: await hashOtp(otp),
      otp_expires_at: new Date(
        Date.now() + OTP_TTL_MINUTES * 60_000,
      ).toISOString(),
      otp_attempts: 0,
      last_otp_sent_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (updateErr) throw new Error(`otp store failed: ${updateErr.message}`);

  const sendFn = channel === "email" ? "send-otp-email" : "send-otp-sms";
  const payload =
    channel === "email"
      ? { email: user.email ?? contact, otp }
      : { phone: user.phone_number ?? contact, otp, locale };
  const sendResp = await fetch(`${supabaseUrl}/functions/v1/${sendFn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const sendResult = await sendResp.json().catch(() => ({}));
  if (!sendResp.ok || sendResult.success !== true) {
    console.error(`${sendFn} failed:`, JSON.stringify(sendResult));
    return json(
      { success: false, error: "Could not send the verification code. Try again later." },
      502,
      headers,
    );
  }

  return json({ success: true }, 200, headers);
}

async function handleVerify(
  db: Db,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  const channel = body.channel === "email" ? "email" : "sms";
  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  const invalid = { success: false, error: "Invalid or expired code." };
  if (!contact || !/^\d{6}$/.test(otp)) return json(invalid, 400, headers);

  const user = await findPortalUser(db, contact, channel);
  if (!user || !user.otp_secret) return json(invalid, 400, headers);

  if (!user.otp_expires_at || new Date(user.otp_expires_at).getTime() < Date.now()) {
    return json(invalid, 400, headers);
  }
  if ((user.otp_attempts ?? 0) >= MAX_OTP_ATTEMPTS) {
    return json(
      { success: false, error: "Too many attempts. Request a new code." },
      429,
      headers,
    );
  }

  if (!(await otpMatches(otp, user.otp_secret))) {
    const attempts = (user.otp_attempts ?? 0) + 1;
    await db
      .from("patient_portal_users")
      .update(
        attempts >= MAX_OTP_ATTEMPTS
          ? { otp_attempts: attempts, otp_secret: null, otp_expires_at: null }
          : { otp_attempts: attempts },
      )
      .eq("id", user.id);
    return json(invalid, 400, headers);
  }

  const verifiedFields =
    channel === "email" ? { email_verified: true } : { phone_verified: true };
  const { error: activateErr } = await db
    .from("patient_portal_users")
    .update({
      account_status: "active",
      ...verifiedFields,
      otp_secret: null,
      otp_expires_at: null,
      otp_attempts: 0,
    })
    .eq("id", user.id);
  if (activateErr) throw new Error(`activation failed: ${activateErr.message}`);

  const sessionToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString();
  const { error: sessionErr } = await db.from("patient_portal_sessions").insert({
    portal_user_id: user.id,
    session_token: sessionToken,
    expires_at: expiresAt,
    is_active: true,
    last_activity_at: new Date().toISOString(),
  });
  if (sessionErr) throw new Error(`session create failed: ${sessionErr.message}`);

  return json(
    {
      success: true,
      sessionToken,
      expiresAt,
      portalUserId: user.id,
      patientId: user.patient_id,
    },
    200,
    headers,
  );
}

async function handleSessionValidate(
  db: Db,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  const sessionToken =
    typeof body.sessionToken === "string" ? body.sessionToken : "";
  if (!sessionToken) {
    return json({ valid: false, needsRefresh: false }, 200, headers);
  }

  const { data: session, error } = await db
    .from("patient_portal_sessions")
    .select("id, expires_at, is_active")
    .eq("session_token", sessionToken)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !session) {
    return json({ valid: false, needsRefresh: false }, 200, headers);
  }

  const now = Date.now();
  const timeUntilExpiry = new Date(session.expires_at).getTime() - now;

  if (timeUntilExpiry < -SESSION_GRACE_MS) {
    await db
      .from("patient_portal_sessions")
      .update({ is_active: false })
      .eq("id", session.id);
    return json({ valid: false, needsRefresh: false }, 200, headers);
  }

  if (timeUntilExpiry < SESSION_REFRESH_BEFORE_MS) {
    const newExpiresAt = new Date(now + SESSION_HOURS * 3_600_000).toISOString();
    await db
      .from("patient_portal_sessions")
      .update({
        expires_at: newExpiresAt,
        last_activity_at: new Date(now).toISOString(),
      })
      .eq("id", session.id);
    return json(
      { valid: true, needsRefresh: true, expiresAt: newExpiresAt },
      200,
      headers,
    );
  }

  await db
    .from("patient_portal_sessions")
    .update({ last_activity_at: new Date(now).toISOString() })
    .eq("id", session.id);
  return json(
    { valid: true, needsRefresh: false, expiresAt: session.expires_at },
    200,
    headers,
  );
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const rl = await enforceRateLimit(req, {
    bucket: "edge_portal_otp",
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json(
        { success: false, error: "missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        500,
        corsHeaders,
      );
    }
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const path = new URL(req.url).pathname.split("/").filter(Boolean).pop();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    switch (path) {
      case "issue":
        return await handleIssue(db, supabaseUrl, serviceKey, body, corsHeaders);
      case "verify":
        return await handleVerify(db, body, corsHeaders);
      case "session-validate":
        return await handleSessionValidate(db, body, corsHeaders);
      default:
        return json(
          { success: false, error: "unknown action; use issue | verify | session-validate" },
          404,
          corsHeaders,
        );
    }
  } catch (error) {
    console.error("Error in portal-otp:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
      corsHeaders,
    );
  }
});
