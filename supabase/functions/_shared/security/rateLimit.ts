// Generic per-bucket rate limiter for Supabase edge functions.
//
// Backed by the SQL function public.check_and_increment_rate_limit, which is
// service_role-only. Each edge function picks a bucket name + a key strategy
// (per-IP, per-client-id, per-token-jti) and a (max, window_seconds) budget.
//
// Usage:
//   const rl = await enforceRateLimit(req, {
//     bucket: "edge_otp_sms",
//     keyStrategy: "ip",
//     max: 10,
//     windowSeconds: 60,
//   });
//   if (!rl.allowed) return rl.response;  // 429 with Retry-After
//
// Fail-open semantics: if the rate-limit RPC errors (e.g. transient DB
// hiccup) the request is allowed through but logged. Better than locking
// the whole function out of action.

import { createClient } from "npm:@supabase/supabase-js@2";

type KeyStrategy = "ip" | "custom";

export interface RateLimitOptions {
  bucket: string;
  keyStrategy?: KeyStrategy;
  customKey?: string;
  max: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number | null;
  response?: Response;
}

const corsForRateLimitResponse = (req: Request): Record<string, string> => {
  // Local minimal CORS for the rate-limit 429. We can't import the cors
  // helper here without a circular dep risk; the caller will normally
  // overwrite these headers when composing the final response.
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Content-Type": "application/json",
    Vary: "Origin",
  };
};

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error(
      "rateLimit: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function enforceRateLimit(
  req: Request,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const key =
    opts.keyStrategy === "custom"
      ? (opts.customKey ?? clientIp(req))
      : clientIp(req);

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc(
      "check_and_increment_rate_limit",
      {
        p_bucket: opts.bucket,
        p_key: key,
        p_max: opts.max,
        p_window_seconds: opts.windowSeconds,
      },
    );
    if (error) {
      console.error("[rateLimit] RPC error, failing open:", error.message);
      return { allowed: true, remaining: opts.max, retryAfter: null };
    }
    const payload = data as {
      allowed: boolean;
      remaining: number;
      retry_after_seconds: number | null;
    };
    if (payload.allowed) {
      return {
        allowed: true,
        remaining: payload.remaining ?? 0,
        retryAfter: null,
      };
    }
    const retryAfter = payload.retry_after_seconds ?? opts.windowSeconds;
    return {
      allowed: false,
      remaining: 0,
      retryAfter,
      response: new Response(
        JSON.stringify({
          error: "rate_limited",
          bucket: opts.bucket,
          retry_after_seconds: retryAfter,
        }),
        {
          status: 429,
          headers: {
            ...corsForRateLimitResponse(req),
            "Retry-After": String(retryAfter),
          },
        },
      ),
    };
  } catch (err) {
    console.error("[rateLimit] uncaught, failing open:", err);
    return { allowed: true, remaining: opts.max, retryAfter: null };
  }
}
