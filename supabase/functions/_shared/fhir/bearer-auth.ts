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
import { boundPatientId, purposeAllowedForCaller } from "./access.ts";

type SupabaseLike = ReturnType<typeof createClient>;

export interface BearerIntrospection {
  active: boolean;
  client_id?: string;
  scopes: string[];
  qhinId?: string;
  expiresAt?: string;
  /** Token subject: the patient id for patient-scoped tokens. */
  subject?: string | null;
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
    .select(
      "client_id, scope, qhin_partner_id, subject, expires_at, revoked_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!data) return { active: false, scopes: [] };

  const row = data as {
    client_id: string;
    scope: string;
    qhin_partner_id: string | null;
    subject: string | null;
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
    subject: row.subject,
  };
}

export interface AuthDecision {
  context: TEFCAContext;
  /** Scopes the caller is authorized for. */
  scopes: string[];
  /**
   * The patient a patient-scoped token is bound to ("" when it is bound to
   * nobody), or null for a system token. See access.ts.
   */
  patientId: string | null;
  /** True when there is no active bearer token. */
  unauthorized: boolean;
  unauthorizedReason?: string;
  /** True when the token may not use the requested exchange purpose. */
  purposeRefused?: boolean;
}

/**
 * Resolve the TEFCAContext for an incoming request from its Bearer token
 * (introspected against oauth_access_tokens). There is no other way in: the
 * old X-QHIN-ID header is no longer accepted on its own.
 */
export async function resolveAuth(
  supabase: SupabaseLike,
  req: Request,
): Promise<AuthDecision> {
  const requestedPurpose = req.headers.get("X-Exchange-Purpose");
  const ipAddress =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";

  const refused = (reason: string): AuthDecision => ({
    context: {
      qhinId: "unknown",
      exchangePurpose: (requestedPurpose ||
        "individual-access") as ExchangePurpose,
      requestingOrganization: "unknown",
      ipAddress,
    },
    scopes: [],
    patientId: null,
    unauthorized: true,
    unauthorizedReason: reason,
  });

  const bearer = extractBearerToken(req);
  if (!bearer) return refused("missing Authorization bearer token");

  const introspection = await introspectBearer(supabase, bearer);
  if (!introspection.active) {
    return refused("bearer token is inactive, expired, or revoked");
  }

  const patientId = boundPatientId(introspection.scopes, introspection.subject);
  // A patient reads their own record (individual access); a partner must say
  // why it is asking, and defaults to treatment, which needs consent.
  const exchangePurpose = (requestedPurpose ||
    (patientId !== null ? "individual-access" : "treatment")) as ExchangePurpose;

  return {
    context: {
      qhinId: introspection.qhinId ?? introspection.client_id ?? "unknown",
      exchangePurpose,
      requestingOrganization:
        introspection.client_id ?? introspection.qhinId ?? "unknown",
      ipAddress,
    },
    scopes: introspection.scopes,
    patientId,
    unauthorized: false,
    purposeRefused: !purposeAllowedForCaller(exchangePurpose, patientId),
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
