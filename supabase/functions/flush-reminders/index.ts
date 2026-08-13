import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import {
  demoModeEnabled,
  normalizeMsisdn,
  resolveSmsConfig,
  sendSms,
} from "../_shared/sms/provider.ts";

// Server-side drain for the SMS queues. Invoked every 5 minutes by pg_cron
// (see migration 20260813190000_add_reminder_flush_cron.sql) so reminders go
// out even when no clinic device has the app open. Also callable manually.
//
// Per due row: claim it (status -> 'sending', so a concurrently running
// browser worker or second cron tick cannot double-send), send through the
// shared Termii/Twilio provider, then mark sent/failed. Failures retry up to
// MAX_ATTEMPTS with a growing delay; rows stuck in 'sending' longer than
// STALE_CLAIM_MINUTES (a crashed run) are reclaimed.

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 10;
const STALE_CLAIM_MINUTES = 15;

interface FlushCounts {
  sent: number;
  failed: number;
  retried: number;
}

function newCounts(): FlushCounts {
  return { sent: 0, failed: 0, retried: 0 };
}

function retryAt(attempts: number): string {
  return new Date(Date.now() + attempts * RETRY_DELAY_MINUTES * 60_000).toISOString();
}

function staleCutoff(): string {
  return new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
}

function renderTemplate(body: string, vars: Record<string, unknown>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    typeof vars[name] === "string" || typeof vars[name] === "number"
      ? String(vars[name])
      : match,
  );
}

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any>>;

async function drainMedicationReminders(
  db: Db,
  send: (to: string, message: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<FlushCounts> {
  const counts = newCounts();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await db
    .from("medication_reminders")
    .select("id, phone_number, message, attempts, status, updated_at")
    .lte("scheduled_at", nowIso)
    .or(`status.eq.pending,and(status.eq.sending,updated_at.lt.${staleCutoff()})`)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`medication_reminders select failed: ${error.message}`);

  for (const row of due ?? []) {
    // Claim: only proceed if the row is still in the state we read it in.
    const { data: claimed, error: claimErr } = await db
      .from("medication_reminders")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("updated_at", row.updated_at)
      .select("id");
    if (claimErr) throw new Error(`medication_reminders claim failed: ${claimErr.message}`);
    if (!claimed?.length) continue; // someone else took it

    const attempts = (row.attempts ?? 0) + 1;
    const msisdn = normalizeMsisdn(row.phone_number ?? "");
    const result = msisdn
      ? await send(msisdn, row.message)
      : { ok: false, error: `invalid phone number: ${row.phone_number}` };

    if (result.ok) {
      await db
        .from("medication_reminders")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts })
        .eq("id", row.id);
      counts.sent++;
    } else if (attempts >= MAX_ATTEMPTS || !msisdn) {
      await db
        .from("medication_reminders")
        .update({ status: "failed", attempts, error_message: result.error ?? "send failed" })
        .eq("id", row.id);
      counts.failed++;
    } else {
      await db
        .from("medication_reminders")
        .update({
          status: "pending",
          attempts,
          error_message: result.error ?? "send failed",
          scheduled_at: retryAt(attempts),
        })
        .eq("id", row.id);
      counts.retried++;
    }
  }

  return counts;
}

async function drainOutboundMessages(
  db: Db,
  send: (to: string, message: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<FlushCounts> {
  const counts = newCounts();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await db
    .from("outbound_messages")
    .select("id, to_number, locale, template_key, payload, attempts, status, last_attempt_at")
    .eq("channel", "sms")
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .or(`status.eq.queued,and(status.eq.sending,last_attempt_at.lt.${staleCutoff()})`)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`outbound_messages select failed: ${error.message}`);

  for (const row of due ?? []) {
    const { data: claimed, error: claimErr } = await db
      .from("outbound_messages")
      .update({ status: "sending", last_attempt_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id");
    if (claimErr) throw new Error(`outbound_messages claim failed: ${claimErr.message}`);
    if (!claimed?.length) continue;

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    let message = typeof payload.message === "string" ? payload.message : "";
    if (!message && row.template_key) {
      const { data: tpl } = await db
        .from("message_templates")
        .select("locale, body")
        .eq("channel", "sms")
        .eq("key", row.template_key)
        .in("locale", row.locale === "en" ? ["en"] : [row.locale, "en"]);
      const body =
        tpl?.find((t: { locale: string }) => t.locale === row.locale)?.body ??
        tpl?.find((t: { locale: string }) => t.locale === "en")?.body;
      if (body) message = renderTemplate(body, payload);
    }

    const attempts = (row.attempts ?? 0) + 1;
    const msisdn = normalizeMsisdn(row.to_number ?? "");
    const result = !message
      ? { ok: false, error: `no message body (template ${row.template_key} missing?)` }
      : msisdn
        ? await send(msisdn, message)
        : { ok: false, error: `invalid phone number: ${row.to_number}` };

    if (result.ok) {
      await db
        .from("outbound_messages")
        .update({ status: "sent", attempts, last_attempt_at: new Date().toISOString() })
        .eq("id", row.id);
      counts.sent++;
    } else if (attempts >= MAX_ATTEMPTS || !msisdn || !message) {
      await db
        .from("outbound_messages")
        .update({
          status: "failed",
          attempts,
          error_message: result.error ?? "send failed",
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      counts.failed++;
    } else {
      await db
        .from("outbound_messages")
        .update({
          status: "queued",
          attempts,
          error_message: result.error ?? "send failed",
          scheduled_for: retryAt(attempts),
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      counts.retried++;
    }
  }

  return counts;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const rl = await enforceRateLimit(req, {
    bucket: "edge_flush_reminders",
    keyStrategy: "ip",
    max: 12,
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: jsonHeaders },
      );
    }
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const config = resolveSmsConfig();
    if (!config && !demoModeEnabled()) {
      // Leave rows pending: they will send once a provider is configured.
      // 200 (not 5xx) so the cron job's logs are a config notice, not errors.
      return new Response(
        JSON.stringify({
          success: false,
          configured: false,
          error: "sms_not_configured",
          message:
            "No SMS provider configured; queued rows left pending. Set TERMII_API_KEY and TERMII_SENDER_ID, then redeploy.",
        }),
        { status: 200, headers: jsonHeaders },
      );
    }

    const send = async (to: string, message: string) => {
      if (!config) {
        console.log(`SMS Demo (flush) - To: ${to}, Message: ${message}`);
        return { ok: true };
      }
      const result = await sendSms(config, to, message);
      return { ok: result.ok, error: result.error };
    };

    const reminders = await drainMedicationReminders(db, send);
    const messages = await drainOutboundMessages(db, send);

    const summary = {
      success: true,
      provider: config?.provider ?? "demo",
      reminders,
      messages,
    };
    if (reminders.sent + reminders.failed + messages.sent + messages.failed > 0) {
      console.log("flush-reminders:", JSON.stringify(summary));
    }
    return new Response(JSON.stringify(summary), { status: 200, headers: jsonHeaders });
  } catch (error) {
    console.error("Error in flush-reminders:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
