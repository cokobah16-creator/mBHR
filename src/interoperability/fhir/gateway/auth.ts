// Who is calling. First-party mBHR sessions only: the bearer token must be a
// Supabase access token for this project, and Supabase Auth itself checks
// the signature, issuer and expiry (GET /auth/v1/user). The audience and
// role claims are then checked here, and the caller's mBHR role and
// permissions are read from the database for this account, never taken
// from the token or the request.

import { errors } from "../errors/operationOutcome";
import type { Actor } from "../authorization/policy";
import type { FetchLike, Postgrest } from "./postgrest";

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(header.trim());
  return m && JWT.test(m[1]) ? m[1] : null;
}

function claims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(part + "=".repeat((4 - (part.length % 4)) % 4));
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns the auth user id, or throws 401. */
export async function authenticate(
  token: string,
  opts: { supabaseUrl: string; anonKey: string; fetchImpl: FetchLike; nowMs: number },
): Promise<string> {
  const c = claims(token);
  const aud = c?.aud;
  const audOk = aud === "authenticated" || (Array.isArray(aud) && aud.includes("authenticated"));
  if (!c || !audOk || c.role !== "authenticated") {
    throw errors.unauthenticated("The token is not an mBHR sign-in token.");
  }
  if (typeof c.exp !== "number" || c.exp * 1000 <= opts.nowMs) {
    throw errors.unauthenticated("The session has expired. Sign in again.");
  }

  let res: Response;
  try {
    res = await opts.fetchImpl(`${opts.supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: { apikey: opts.anonKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw errors.unavailable();
  }
  if (res.status === 401 || res.status === 403) {
    throw errors.unauthenticated("The session is not valid. Sign in again.");
  }
  if (!res.ok) throw errors.unavailable();
  const user = (await res.json()) as { id?: unknown };
  if (typeof user.id !== "string" || user.id !== c.sub) {
    throw errors.unauthenticated("The session is not valid. Sign in again.");
  }
  return user.id;
}

interface GatewayContext {
  role: string | null;
  permissions: string[] | null;
  rate_allowed: boolean;
  retry_after_seconds: number | null;
}

/**
 * The caller's role and permissions, and one step of their rate limit, from
 * public.fhir_gateway_context() (see the interop migration).
 */
export async function loadActor(db: Postgrest, userId: string, ratePerMinute: number): Promise<Actor> {
  const ctx = await db.rpc<GatewayContext>("fhir_gateway_context", { p_rate_limit: ratePerMinute });
  if (!ctx || typeof ctx !== "object") throw errors.unavailable();
  if (ctx.rate_allowed === false) throw errors.tooMany(ctx.retry_after_seconds ?? 60);
  return {
    userId,
    role: typeof ctx.role === "string" && ctx.role ? ctx.role : null,
    permissions: new Set(Array.isArray(ctx.permissions) ? ctx.permissions.filter((p) => typeof p === "string") : []),
  };
}
