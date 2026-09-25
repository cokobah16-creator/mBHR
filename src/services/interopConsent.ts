/**
 * Consent records for the patient portal's privacy section and the staff
 * "External sharing" chip.
 *
 * Database functions (supabase/migrations-deferred/20260926130000_interop_phase2.sql):
 * - interop_my_consents(): the signed-in portal patient's own records
 * - interop_withdraw_consent(p_consent_id, p_reason): withdraw one record
 * - interop_consent_summary(p_patient_id): the external sharing summary
 *
 * They may not be deployed yet: every loader returns a status instead of
 * throwing, and "missing" is a normal outcome the screens show quietly.
 *
 * Consent here is about sharing records outside mBHR. It never affects the
 * care mBHR staff give (see docs/interoperability).
 *
 * No imports from the app on purpose, so these functions can be unit-tested
 * without the Supabase client.
 */
import {
  callInteropRpc,
  toTimestamp,
  toCount,
  type InteropRpcClient,
  type RpcFailure,
} from "./interopRpc";

/** What a stored record is about (consent_records.scope). */
export type ConsentTopic =
  | "sharing" // patient-privacy
  | "research" // research
  | "care" // treatment
  | "future_care" // adr (advance care wishes)
  | "other";

/** Where a record stands today, in the patient's terms. */
export type ConsentState =
  | "in_place" // active, in its period, not withdrawn
  | "not_started" // draft/proposed, or active with a start date in the future
  | "ended" // inactive, or its end date has passed
  | "withdrawn" // withdrawn (by the patient or staff)
  | "declined" // rejected
  | "in_error"; // entered-in-error

export interface PatientConsentItem {
  id: string;
  topic: ConsentTopic;
  /** Purposes the record permits, as plain groups (no codes). */
  permits: ConsentPurpose[];
  state: ConsentState;
  /** When it started (effective_from, else when it was recorded). */
  since: string | null;
  /** When it was withdrawn, if it was. */
  withdrawnAt: string | null;
  /** When it ends, if it has an end date. */
  until: string | null;
  canWithdraw: boolean;
}

export type ConsentPurpose =
  | "care"
  | "emergency_care"
  | "operations"
  | "your_request"
  | "research"
  | "public_health";

const TOPICS: Record<string, ConsentTopic> = {
  "patient-privacy": "sharing",
  research: "research",
  treatment: "care",
  adr: "future_care",
};

const PURPOSES: Record<string, ConsentPurpose> = {
  TREAT: "care",
  ETREAT: "emergency_care",
  HOPERAT: "operations",
  PATRQT: "your_request",
  HRESCH: "research",
  PUBHLTH: "public_health",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a consent record id the server can accept. */
export function isConsentId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Where a record stands at `now`. Unknown statuses are never "in place". */
export function consentState(record: Record<string, unknown>, now: Date = new Date()): ConsentState {
  const status = typeof record.status === "string" ? record.status : "";
  const withdrawn = record.withdrawn === true || toTimestamp(record.withdrawn_at) !== null;
  if (status === "entered-in-error") return "in_error";
  if (withdrawn) return "withdrawn";
  if (status === "rejected") return "declined";
  if (status === "inactive") return "ended";
  if (status === "draft" || status === "proposed") return "not_started";
  if (status === "active") {
    const until = toTimestamp(record.effective_until);
    if (until !== null && Date.parse(until) <= now.getTime()) return "ended";
    const from = toTimestamp(record.effective_from);
    if (from !== null && Date.parse(from) > now.getTime()) return "not_started";
    return "in_place";
  }
  // An unknown status is shown as ended, never as in place.
  return "ended";
}

/**
 * The patient's records from interop_my_consents(), newest first with the
 * ones in place at the top. Rows without a valid id are dropped. Patient
 * ids and internal fields are never copied out.
 */
export function parseMyConsents(data: unknown, now: Date = new Date()): PatientConsentItem[] {
  if (!Array.isArray(data)) return [];
  const items: PatientConsentItem[] = [];
  for (const raw of data) {
    const r = obj(raw);
    if (!r || !isConsentId(r.id)) continue;
    const state = consentState(r, now);
    const provisions = Array.isArray(r.provisions) ? r.provisions : [];
    const permits: ConsentPurpose[] = [];
    for (const p of provisions) {
      const prov = obj(p);
      if (!prov || prov.provision_type !== "permit") continue;
      const purpose = typeof prov.purpose === "string" ? PURPOSES[prov.purpose] : undefined;
      if (purpose && !permits.includes(purpose)) permits.push(purpose);
    }
    items.push({
      id: r.id,
      topic: (typeof r.scope === "string" && TOPICS[r.scope]) || "other",
      permits,
      state,
      since: toTimestamp(r.effective_from) ?? toTimestamp(r.recorded_at) ?? toTimestamp(r.created_at),
      withdrawnAt: toTimestamp(r.withdrawn_at),
      until: toTimestamp(r.effective_until),
      canWithdraw: state === "in_place" || state === "not_started",
    });
  }
  const rank = (s: ConsentState) => (s === "in_place" ? 0 : s === "not_started" ? 1 : 2);
  return items.sort((a, b) => {
    const byState = rank(a.state) - rank(b.state);
    if (byState !== 0) return byState;
    return (b.since ? Date.parse(b.since) : 0) - (a.since ? Date.parse(a.since) : 0);
  });
}

export type MyConsentsResult =
  | { status: "ok"; items: PatientConsentItem[] }
  | { status: RpcFailure };

/** Loads the signed-in portal patient's own records. Never throws. */
export async function loadMyConsents(
  client: InteropRpcClient | null | undefined,
  online: boolean,
  now: Date = new Date(),
): Promise<MyConsentsResult> {
  const out = await callInteropRpc(client, "interop_my_consents", undefined, online);
  if (out.ok === false) return { status: out.reason };
  return { status: "ok", items: parseMyConsents(out.data, now) };
}

export const WITHDRAW_REASON_MAX = 500;

/** The reason as sent to the server: trimmed, at most 500 characters, or null. */
export function cleanWithdrawReason(reason: string | null | undefined): string | null {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, WITHDRAW_REASON_MAX);
}

export type WithdrawResult =
  | { status: "withdrawn" } // done now
  | { status: "already_withdrawn" } // it was withdrawn before
  | { status: "invalid" } // not a record id
  | { status: RpcFailure };

/** Withdraws one record. Never throws. */
export async function withdrawConsent(
  client: InteropRpcClient | null | undefined,
  consentId: string,
  reason: string | null | undefined,
  online: boolean,
): Promise<WithdrawResult> {
  if (!isConsentId(consentId)) return { status: "invalid" };
  const out = await callInteropRpc(
    client,
    "interop_withdraw_consent",
    { p_consent_id: consentId, p_reason: cleanWithdrawReason(reason) },
    online,
  );
  if (out.ok === false) return { status: out.reason };
  return out.data === false ? { status: "already_withdrawn" } : { status: "withdrawn" };
}

/** interop_consent_summary(p_patient_id).external_sharing */
export type ExternalSharing = "allowed" | "not_allowed" | "withdrawn";

export interface ConsentSummary {
  externalSharing: ExternalSharing;
  activeRecords: number | null;
  withdrawnRecords: number | null;
  lastChangedAt: string | null;
}

/** The summary, or null when the answer is not one we understand. */
export function parseConsentSummary(data: unknown): ConsentSummary | null {
  const d = obj(data);
  if (!d) return null;
  const v = d.external_sharing;
  if (v !== "allowed" && v !== "not_allowed" && v !== "withdrawn") return null;
  return {
    externalSharing: v,
    activeRecords: toCount(d.active_records),
    withdrawnRecords: toCount(d.withdrawn_records),
    lastChangedAt: toTimestamp(d.last_changed_at),
  };
}

export const EXTERNAL_SHARING_LABEL: Record<ExternalSharing, string> = {
  allowed: "External sharing: Allowed",
  not_allowed: "External sharing: Not allowed",
  withdrawn: "External sharing: Withdrawn",
};

/** Hover text: the chip is about sharing outside mBHR, not about care. */
export const EXTERNAL_SHARING_HINT =
  "This is about sharing records outside mBHR. It does not affect care.";

/** The chip's text and tone. Neutral tones only: nothing here blocks care. */
export function externalSharingChip(summary: ConsentSummary | null): {
  label: string;
  tone: "info" | "neutral";
} | null {
  if (!summary) return null;
  return {
    label: EXTERNAL_SHARING_LABEL[summary.externalSharing],
    tone: summary.externalSharing === "allowed" ? "info" : "neutral",
  };
}

const PATIENT_ID = /^[A-Za-z0-9._-]{1,128}$/;

export type ConsentSummaryResult =
  | { status: "ok"; summary: ConsentSummary }
  | { status: RpcFailure | "invalid" };

/** Loads the summary for one patient. Never throws. */
export async function loadConsentSummary(
  client: InteropRpcClient | null | undefined,
  patientId: string,
  online: boolean,
): Promise<ConsentSummaryResult> {
  if (typeof patientId !== "string" || !PATIENT_ID.test(patientId)) {
    return { status: "invalid" };
  }
  const out = await callInteropRpc(
    client,
    "interop_consent_summary",
    { p_patient_id: patientId },
    online,
  );
  if (out.ok === false) return { status: out.reason };
  const summary = parseConsentSummary(out.data);
  return summary ? { status: "ok", summary } : { status: "failed" };
}
