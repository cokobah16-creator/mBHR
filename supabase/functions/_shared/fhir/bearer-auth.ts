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
  /** True when the caller used the legacy X-QHIN-ID header. */
  isLegacy: boolean;
  /** When isLegacy, the response should carry Deprecation/Sunset headers. */
  deprecationHeaders?: Record<string, string>;
  /** Scopes the caller is authorized for; empty for legacy callers. */
  scopes: string[];
  /** True when neither bearer nor X-QHIN-ID is acceptable. */
  unauthorized: boolean;
  unauthorizedReason?: string;
}

/**
 * Resolve the TEFCAContext for an incoming request. Prefers a Bearer token
 * (introspected against oauth_access_tokens); falls back to the legacy
 * X-QHIN-ID header during the transition window with Deprecation/Sunset
 * response headers.
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
        isLegacy: false,
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
      isLegacy: false,
      scopes: introspection.scopes,
      unauthorized: false,
    };
  }

  // Legacy header-trust mode. We accept it for now and emit a Deprecation
  // header so QHIN partners migrate to bearer auth before the sunset date.
  const legacyQhinId = req.headers.get("X-QHIN-ID");
  if (legacyQhinId) {
    const requestingOrg =
      req.headers.get("X-Requesting-Organization") || legacyQhinId;
    return {
      context: {
        qhinId: legacyQhinId,
        exchangePurpose,
        requestingOrganization: requestingOrg,
        ipAddress,
      },
      isLegacy: true,
      scopes: [],
      unauthorized: false,
      deprecationHeaders: {
        Deprecation: "true",
        Sunset: legacySunsetDate(),
        Link: '</functions/v1/tefca-oauth/.well-known/smart-configuration>; rel="successor-version"',
        Warning:
          '299 - "X-QHIN-ID auth is deprecated; switch to SMART Backend Services bearer tokens before Sunset"',
      },
    };
  }

  return {
    context: {
      qhinId: "unknown",
      exchangePurpose,
      requestingOrganization: "unknown",
      ipAddress,
    },
    isLegacy: false,
    scopes: [],
    unauthorized: true,
    unauthorizedReason: "missing Authorization or X-QHIN-ID header",
  };
}

/**
 * Check whether the introspected scopes authorize an interaction on a given
 * FHIR resource type. Recognizes system/<Type>.read and the system/*.read
 * wildcard.
 */
export function scopeAllowsResource(
  scopes: string[],
  resourceType: string,
): boolean {
  if (scopes.length === 0) return false;
  if (scopes.includes("system/*.read")) return true;
  if (scopes.includes(`system/${resourceType}.read`)) return true;
  if (scopes.includes("patient/*.read")) return true;
  if (scopes.includes(`patient/${resourceType}.read`)) return true;
  return false;
}

/**
 * Sunset date for legacy X-QHIN-ID auth. Set as the day this code is shipped
 * (PHASE_C_LAUNCH) plus 90 days. Hard-coded so the value is deterministic and
 * survives redeploys.
 */
function legacySunsetDate(): string {
  // Phase C-1 ship date: 2026-05-03; sunset 90 days later.
  return "Sun, 02 Aug 2026 00:00:00 GMT";
}
