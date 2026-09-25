// Access audit for the FHIR gateway.
//
// Every request that reaches a clinical resource is recorded in
// interop.access_audit (append-only) through public.fhir_record_access(),
// which stamps the actor from the session itself. The record is written
// BEFORE any data is returned: if it cannot be written, the caller gets a
// 503 and no data. Records hold who, what, when, why and the decision, and
// never tokens, search values (which can be names or birth dates) or
// resource content.

import type { Postgrest } from "../gateway/postgrest";

export interface AuditRecord {
  requestId: string;
  action: "read" | "search";
  resourceType: string;
  resourceId: string | null;
  /** Internal patients.id values whose data was returned (at most 100). */
  patientIds: string[];
  purpose: string;
  decision: "permit" | "deny";
  denialReason: string | null;
  resultCount: number;
  /** Search parameter NAMES only. */
  searchParams: string[];
  userAgent: string | null;
  ipHash: string | null;
}

export async function recordAccess(db: Postgrest, r: AuditRecord): Promise<void> {
  const res = await db.rpc<unknown>("fhir_record_access", {
    p_request_id: r.requestId,
    p_action: r.action,
    p_resource_type: r.resourceType,
    p_resource_id: r.resourceId,
    p_patient_ids: r.patientIds.slice(0, 100),
    p_purpose: r.purpose,
    p_decision: r.decision,
    p_denial_reason: r.denialReason,
    p_result_count: r.resultCount,
    p_search_params: r.searchParams.slice(0, 20),
    p_user_agent: r.userAgent ? r.userAgent.slice(0, 200) : null,
    p_ip_hash: r.ipHash,
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
