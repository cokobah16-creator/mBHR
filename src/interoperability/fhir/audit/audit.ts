// Access audit for the FHIR gateway.
//
// Every request from a signed-in account is recorded in
// interop.access_audit (append-only) through public.fhir_record_access_v2(),
// which stamps the actor from the session itself and refuses a "permit" row
// from anyone but staff or the patient whose records were read. The record
// is written BEFORE any data is returned: if it cannot be written, the
// caller gets a 503 and no data. Refusals, bad requests, rate limiting and
// server errors are recorded too (best effort: when the audit write itself
// fails on an error path, the server log keeps the request id).
//
// Records hold who, what, when, why, the decision, the consent result and
// the HTTP status, and never: access or refresh tokens, the Authorization
// header, passwords, search values (which can be names or birth dates) or
// any resource content.

import type { Postgrest } from "../gateway/postgrest";

export interface AuditRecord {
  requestId: string;
  interaction: "read" | "search";
  resourceType: string;
  resourceId: string | null;
  /** Internal patients.id values whose data was returned or named (at most 100). */
  patientIds: string[];
  purpose: string;
  decision: "permit" | "deny";
  denialReason: string | null;
  resultCount: number;
  /** Search parameter NAMES only. */
  searchParams: string[];
  userAgent: string | null;
  ipHash: string | null;
  httpStatus: number;
  consentDecision: "permit" | "deny" | "not-applicable" | null;
  consentId: string | null;
  provisionId: string | null;
  restrictions: string[];
  /** What the gateway believed the caller was; the database records its own view too. */
  actorKind: "staff" | "patient" | "none" | null;
}

const PATIENT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const RESTRICTION = /^[a-z][a-z0-9_:-]{0,63}$/;
const REASON = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordAccess(db: Postgrest, r: AuditRecord): Promise<void> {
  const res = await db.rpc<unknown>("fhir_record_access_v2", {
    p_request_id: r.requestId,
    p_interaction: r.interaction,
    p_resource_type: r.resourceType,
    p_resource_id: r.resourceId,
    p_patient_ids: [...new Set(r.patientIds)].filter((id) => PATIENT_ID.test(id)).slice(0, 100),
    p_purpose: r.purpose,
    p_decision: r.decision,
    p_denial_reason: r.denialReason && REASON.test(r.denialReason) ? r.denialReason : r.denialReason ? "other" : null,
    p_result_count: r.resultCount,
    p_search_params: r.searchParams.slice(0, 20),
    p_user_agent: r.userAgent ? r.userAgent.slice(0, 200) : null,
    p_ip_hash: r.ipHash,
    p_http_status: r.httpStatus,
    p_consent_decision: r.consentDecision,
    p_consent_id: r.consentId && UUID.test(r.consentId) ? r.consentId : null,
    p_provision_id: r.provisionId && UUID.test(r.provisionId) ? r.provisionId : null,
    p_restrictions: r.restrictions.filter((x) => RESTRICTION.test(x)).slice(0, 12),
    p_actor_kind: r.actorKind,
  });
  // The function returns the new row id; anything else means not recorded.
  if (typeof res !== "string" || !res) throw new Error("audit not recorded");
}

/**
 * HMAC-SHA-256 of the client IP with a server secret, so repeat callers can
 * be correlated without storing addresses. Without a secret nothing is kept:
 * an unsalted hash of an IPv4 address is trivially reversible.
 */
export async function hashIp(ip: string | null, secret: string | null): Promise<string | null> {
  if (!ip || !secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Server log lines: the request id and outcome only. No headers, tokens,
 * query values, patient ids or resource content ever reach the log.
 */
export function logLine(
  log: (line: string) => void,
  fields: { requestId: string; status: number; outcome: string; resourceType?: string; ms?: number },
): void {
  log(JSON.stringify({ component: "fhir-gateway", ...fields }));
}
