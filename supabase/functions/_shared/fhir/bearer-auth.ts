// Bearer token introspection for the TEFCA IAS endpoint.
//
// Phase C-1 design: tokens are signed JWTs issued by /oauth/token, but
// here we introspect by sha-256 hashing the presented token and looking it
// up in oauth_access_tokens. That is sufficient because:
//
//   1. We issued and persisted every token we accept; an attacker can't
//      forge a hash without a corresponding row.
//   2. TLS protects the token in transit (Supabase Edge Functions are HTTPS).
//   3. Hashed lookups give us cheap revocation: setting revoked_at on a row
//      immediately invalidates that token without any cache invalidation.
//
// Cryptographic verification of the JWT signature would add defense-in-depth
// but isn't required for the threat model. Phase C-2 may add it once an
// auth-code-flow is in play and tokens travel through more hops.

import { createClient } from "npm:@supabase/supabase-js@2";
import type { ExchangePurpose, TEFCAContext } from "./codes.ts";

type SupabaseLike = ReturnType<typeof createClient>;

export interface BearerIntrospection {
  active: boolean;
  client_id?: string;
  scopes: string[];
  qhinId?: string;
  expiresAt?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function introspectBearer(
  supabase: SupabaseLike,
  token: string,
): Promise<BearerIntrospection> {
  const tokenHash = await sha256Hex(token);
  const { data } = await supabase
    .from("oauth_access_tokens")
    .select("client_id, scope, qhin_partner_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!data) return { active: false, scopes: [] };

  const row = data as {
    client_id: string;
    scope: string;
    qhin_partner_id: string | null;
    expires_at: string;
    revoked_at: string | null;
  };

  if (row.revoked_at) return { active: false, scopes: [] };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { active: false, scopes: [] };
  }

  return {
    active: true,
    client_id: row.client_id,
    scopes: row.scope.split(/\s+/).filter(Boolean),
    qhinId: row.qhin_partner_id ?? row.client_id,
    expiresAt: row.expires_at,
  };
}

export interface AuthDecision {
  context: TEFCAContext;
  /** Scopes the caller is authorized for. */
  scopes: string[];
  /** True when no acceptable bearer token was presented. */
  unauthorized: boolean;
  unauthorizedReason?: string;
  /**
   * True when the request carried the retired X-QHIN-ID header without a
   * bearer token. The caller was NEVER authenticated; respond 410 Gone with
   * the successor Link so a straggling partner gets a migration signal.
   */
  legacyGone?: boolean;
}

/**
 * Resolve the TEFCAContext for an incoming request. Bearer tokens only,
 * introspected against oauth_access_tokens. The legacy X-QHIN-ID header
 * trust path was removed after its declared sunset (2026-08-02) passed:
 * it authenticated nothing and skipped all scope checks.
 */
export async function resolveAuth(
  supabase: SupabaseLike,
  req: Request,
): Promise<AuthDecision> {
  const exchangePurpose = (req.headers.get("X-Exchange-Purpose") ||
    "individual-access") as ExchangePurpose;
  const ipAddress =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";

  const bearer = extractBearerToken(req);
  if (bearer) {
    const introspection = await introspectBearer(supabase, bearer);
    if (!introspection.active) {
      return {
        context: {
          qhinId: "unknown",
          exchangePurpose,
          requestingOrganization: "unknown",
          ipAddress,
        },
        scopes: [],
        unauthorized: true,
        unauthorizedReason: "bearer token is inactive, expired, or revoked",
      };
    }

    return {
      context: {
        qhinId: introspection.qhinId ?? introspection.client_id ?? "unknown",
        exchangePurpose,
        requestingOrganization:
          introspection.client_id ?? introspection.qhinId ?? "unknown",
        ipAddress,
      },
      scopes: introspection.scopes,
      unauthorized: false,
    };
  }

  const unauthorizedContext: TEFCAContext = {
    qhinId: "unknown",
    exchangePurpose,
    requestingOrganization: "unknown",
    ipAddress,
  };

  // Retired legacy header-trust mode: X-QHIN-ID authenticated nothing and
  // bypassed scope checks. Its declared sunset (2026-08-02) has passed —
  // 410 tombstone only, never authentication.
  if (req.headers.get("X-QHIN-ID")) {
    return {
      context: unauthorizedContext,
      scopes: [],
      unauthorized: true,
      unauthorizedReason:
        "X-QHIN-ID header auth was retired on 2026-08-02; use SMART Backend Services bearer tokens",
      legacyGone: true,
    };
  }

  return {
    context: unauthorizedContext,
    scopes: [],
    unauthorized: true,
    unauthorizedReason: "missing Authorization bearer token",
  };
}

/**
 * Check whether the introspected scopes authorize an interaction on a given
 * FHIR resource type. Recognizes system/<Type>.<verb> and the system/*.<verb>
 * wildcard, plus the patient/* equivalents.
 *
 * `verb` defaults to "read" so existing call sites (read-side dispatch) keep
 * working without changes. Pass "write" from POST/PUT/DELETE handlers to
 * gate write paths separately from reads.
 */
export function scopeAllowsResource(
  scopes: string[],
  resourceType: string,
  verb: "read" | "write" = "read",
): boolean {
  if (scopes.length === 0) return false;
  if (scopes.includes(`system/*.${verb}`)) return true;
  if (scopes.includes(`system/${resourceType}.${verb}`)) return true;
  if (scopes.includes(`patient/*.${verb}`)) return true;
  if (scopes.includes(`patient/${resourceType}.${verb}`)) return true;
  return false;
}
