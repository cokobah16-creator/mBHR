// Fail-closed rate limits for SMS edge functions.
//
// Uses public.rate_limits / public.check_and_increment_rate_limit from
// 20260520000004_generic_rate_limits.sql (RLS on, service_role only; anon and
// authenticated cannot read, write or call it). Unlike the generic
// enforceRateLimit helper, an error here blocks the send: an SMS that cannot
// be counted is not sent.
//
// Recipient keys are stored as salted SHA-256 hashes so the table never holds
// patient phone numbers. Set RATE_LIMIT_KEY_SALT to a random secret (the
// service-role key is used when it is unset; never a constant). Changing the
// salt resets the per-recipient counters.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface SmsLimit {
  bucket: string;
  key: string;
  max: number;
  windowSeconds: number;
}

export type SmsLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number; bucket: string }
  | { allowed: false; error: true };

/** Per staff user: at most 30 SMS a minute. */
export const PER_USER_LIMIT = { max: 30, windowSeconds: 60 } as const;
/** Per recipient number: at most 5 SMS an hour. */
export const PER_RECIPIENT_LIMIT = { max: 5, windowSeconds: 3600 } as const;

export async function hashKey(value: string): Promise<string> {
  // The Nigerian mobile number space is small enough to brute-force a hash
  // with a known salt, so never fall back to a constant: without
  // RATE_LIMIT_KEY_SALT, use the (secret) service-role key as the salt.
  const salt =
    Deno.env.get("RATE_LIMIT_KEY_SALT") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!salt) throw new Error("RATE_LIMIT_KEY_SALT is not set");
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Counts one send against every limit, in order, and stops at the first one
 * that is exhausted.
 */
export async function checkSmsLimits(
  service: SupabaseClient,
  limits: SmsLimit[],
): Promise<SmsLimitResult> {
  for (const limit of limits) {
    try {
      const { data, error } = await service.rpc(
        "check_and_increment_rate_limit",
        {
          p_bucket: limit.bucket,
          p_key: limit.key,
          p_max: limit.max,
          p_window_seconds: limit.windowSeconds,
        },
      );
      if (error) {
        console.error("[smsRateLimit] RPC error, blocking send:", error.code ?? "error");
        return { allowed: false, error: true };
      }
      const payload = data as {
        allowed?: boolean;
        retry_after_seconds?: number | null;
      } | null;
      if (!payload?.allowed) {
        return {
          allowed: false,
          bucket: limit.bucket,
          retryAfter: Math.max(
            1,
            Number(payload?.retry_after_seconds) || limit.windowSeconds,
          ),
        };
      }
    } catch (err) {
      console.error(
        "[smsRateLimit] failed, blocking send:",
        err instanceof Error ? err.name : typeof err,
      );
      return { allowed: false, error: true };
    }
  }
  return { allowed: true };
}
