// Who is calling. First-party mBHR sessions only: the bearer token must be a
// Supabase access token for this project, and Supabase Auth itself checks
// the signature, issuer and expiry (GET /auth/v1/user). The audience and
// role claims are then checked here, and the caller's mBHR role and
// permissions are read from the database for this account, never taken
// from the token or the request.

import { errors } from "../errors/operationOutcome";
import type { Actor } from "../authorization/authorize";
import type { FetchLike, Postgrest } from "./postgrest";

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  // The scheme name is case-insensitive (RFC 7235).
  const m = /^Bearer ([A-Za-z0-9_\-.]+)$/i.exec(header.trim());
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
  role: unknown;
  permissions: unknown;
  actor_kind: unknown;
  patient_ids: unknown;
  rate_allowed: unknown;
  retry_after_seconds: unknown;
}

/** The caller, and whether this request is within their rate limit(s). */
export interface LoadedActor {
  actor: Actor;
  /** null: allowed; otherwise the seconds to wait (the request is refused with 429). */
  retryAfter: number | null;
}

/**
 * Who the caller is to mBHR, and one step of their rate limit(s), from
 * public.fhir_gateway_context_v2() (see the Phase 2 interop migration):
 * the staff role and permissions, or the patient records a portal account
 * is linked to. Nothing here comes from the token or the request.
 *
 * Only an explicit rate_allowed = true lets the request through; the
 * gateway still records a rate-limited request in the access audit.
 */
export async function loadActor(
  db: Postgrest,
  userId: string,
  limits: { perMinute: number; sensitivePerMinute: number; sensitive: boolean },
): Promise<LoadedActor> {
  const ctx = await db.rpc<GatewayContext>("fhir_gateway_context_v2", {
    p_rate_limit: limits.perMinute,
    p_sensitive_rate_limit: limits.sensitivePerMinute,
    p_sensitive: limits.sensitive,
  });
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) throw errors.unavailable();
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
  const role = typeof ctx.role === "string" && ctx.role ? ctx.role : null;
  const kind = ctx.actor_kind === "staff" && role ? "staff" : ctx.actor_kind === "patient" ? "patient" : "none";
  const actor: Actor = {
    userId,
    kind,
    role: kind === "staff" ? role : null,
    permissions: new Set(kind === "staff" ? strings(ctx.permissions) : []),
    patientIds: new Set(kind === "patient" ? strings(ctx.patient_ids) : []),
  };
  const retry = typeof ctx.retry_after_seconds === "number" && ctx.retry_after_seconds > 0 ? ctx.retry_after_seconds : 60;
  return { actor, retryAfter: ctx.rate_allowed === true ? null : retry };
}
