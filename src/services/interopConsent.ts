/**
 * Consent records for the patient portal's privacy section and the staff
 * "External sharing" chip.
 *
 * Database functions (supabase/migrations-deferred/20260926130000_interop_phase2.sql):
 * - interop_my_consents(p_patient_id): the records of one of the signed-in
 *   portal patient's own records (and of records merged into it)
 * - interop_withdraw_consent(p_consent_id, p_reason, p_patient_id): withdraw
 *   one record of the page's patient (a patient: only a permission to
 *   share, never a refusal)
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

/**
 * What a stored record is about (consent_records.scope). The portal lists
 * only these two: a treatment consent (scope treatment) or an advance care
 * directive (scope adr) is not a sharing choice and is left out.
 */
export type ConsentTopic =
  | "sharing" // patient-privacy
  | "research"; // research

/**
 * What the record says, in the patient's terms:
 * - permission: it permits something and refuses nothing
 * - refusal: it has at least one deny provision (whatever else it permits)
 * - unclear: it has no provisions, so it says nothing either way
 */
export type ConsentKind = "permission" | "refusal" | "unclear";

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
  kind: ConsentKind;
  /**
   * Purposes the permit provisions name, as plain groups (no codes). Empty
   * when none names a purpose, or when one applies to every purpose.
   */
  permits: ConsentPurpose[];
  /**
   * True when a deny provision is for someone outside mBHR (actor
   * external_system, organization, any or unset). A deny only for the care
   * team or a practitioner is not a refusal to share outside mBHR.
   */
  refusesOutside: boolean;
  /** Purposes those outside deny provisions name (same rule as permits). */
  refuses: ConsentPurpose[];
  /** A refusal that also permits something (shown, never hidden). */
  alsoPermits: boolean;
  state: ConsentState;
  /** When it started (effective_from, else when it was recorded). */
  since: string | null;
  /** When it was withdrawn, if it was. */
  withdrawnAt: string | null;
  /** When it ends, if it has an end date. */
  until: string | null;
  /** Only a permission that is in place or not started yet. */
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
};

const PURPOSES: Record<string, ConsentPurpose> = {
  TREAT: "care",
  ETREAT: "emergency_care",
  HOPERAT: "operations",
  PATRQT: "your_request",
  HRESCH: "research",
  PUBHLTH: "public_health",
};

/** Provision actors outside mBHR (the gateway's external-sharing actors); unset counts too. */
const OUTSIDE_ACTORS: readonly string[] = ["external_system", "organization", "any"];

function isOutsideActor(actor: unknown): boolean {
  if (actor === null || actor === undefined) return true;
  return typeof actor === "string" && OUTSIDE_ACTORS.includes(actor);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Patient ids the consent functions accept. */
const PATIENT_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** True for a consent record id the server can accept. */
export function isConsentId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** map[key] for the map's own keys only (never a prototype member). */
function lookup<T>(map: Record<string, T>, key: unknown): T | undefined {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key)
    ? map[key]
    : undefined;
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
 * The purposes one kind of provision names. Empty when there is none of
 * that kind, or when one of them names no purpose (it covers every
 * purpose, so listing the others would understate it).
 */
function purposesOf(provisions: Record<string, unknown>[], type: "permit" | "deny"): ConsentPurpose[] {
  const out: ConsentPurpose[] = [];
  for (const prov of provisions) {
    if (prov.provision_type !== type) continue;
    const purpose = lookup(PURPOSES, prov.purpose);
    if (!purpose) return [];
    if (!out.includes(purpose)) out.push(purpose);
  }
  return out;
}

/**
 * The patient's sharing choices from interop_my_consents(), newest first
 * with the ones in place at the top. Only scopes patient-privacy and
 * research are kept (a treatment consent or an advance care directive is
 * not a sharing choice). A record with any deny provision is a refusal:
 * never offered for withdrawal, because withdrawing it could allow sharing
 * (the server refuses it too). refusesOutside says whether one of its
 * deny provisions is for someone outside mBHR. Rows without a valid id are
 * dropped. Patient ids and internal fields are never copied out.
 */
export function parseMyConsents(data: unknown, now: Date = new Date()): PatientConsentItem[] {
  if (!Array.isArray(data)) return [];
  const items: PatientConsentItem[] = [];
  for (const raw of data) {
    const r = obj(raw);
    if (!r || !isConsentId(r.id)) continue;
    const topic = lookup(TOPICS, r.scope);
    if (!topic) continue;
    const state = consentState(r, now);
    const provisions = (Array.isArray(r.provisions) ? r.provisions : [])
      .map(obj)
      .filter((p): p is Record<string, unknown> => p !== null);
    const hasPermit = provisions.some((p) => p.provision_type === "permit");
    const hasDeny = provisions.some((p) => p.provision_type === "deny");
    const outsideDenies = provisions.filter(
      (p) => p.provision_type === "deny" && isOutsideActor(p.actor_type),
    );
    const kind: ConsentKind = hasDeny ? "refusal" : hasPermit ? "permission" : "unclear";
    items.push({
      id: r.id,
      topic,
      kind,
      permits: purposesOf(provisions, "permit"),
      refusesOutside: outsideDenies.length > 0,
      refuses: purposesOf(outsideDenies, "deny"),
      alsoPermits: hasDeny && hasPermit,
      state,
      since: toTimestamp(r.effective_from) ?? toTimestamp(r.recorded_at) ?? toTimestamp(r.created_at),
      withdrawnAt: toTimestamp(r.withdrawn_at),
      until: toTimestamp(r.effective_until),
      canWithdraw: kind === "permission" && (state === "in_place" || state === "not_started"),
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
  | { status: RpcFailure | "invalid" };

/**
 * Loads the sharing choices of the page's patient: `patientId` is the
 * portal record the page shows (one sign-in can be linked to several
 * people, for example on a shared phone). The server checks that it is one
 * of the caller's own records and returns only that record's family (the
 * records merged into it, whose ids the app does not know, so no second
 * filter is applied here). No call without a valid id. Never throws.
 */
export async function loadMyConsents(
  client: InteropRpcClient | null | undefined,
  patientId: string,
  online: boolean,
  now: Date = new Date(),
): Promise<MyConsentsResult> {
  if (typeof patientId !== "string" || !PATIENT_ID.test(patientId)) {
    return { status: "invalid" };
  }
  const out = await callInteropRpc(
    client,
    "interop_my_consents",
    { p_patient_id: patientId },
    online,
  );
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
  | { status: "invalid" } // not a record id, or not a patient id
  | { status: RpcFailure };

/**
 * Withdraws one record of the page's patient. `patientId` is the portal
 * record the page shows: the server refuses the call unless the record
 * belongs to that patient (or to a record merged into it) and that patient
 * is one of the caller's own, so a sign-in linked to two people withdraws
 * only for the person on the page. No call without valid ids. Never throws.
 */
export async function withdrawConsent(
  client: InteropRpcClient | null | undefined,
  consentId: string,
  patientId: string,
  reason: string | null | undefined,
  online: boolean,
): Promise<WithdrawResult> {
  if (!isConsentId(consentId)) return { status: "invalid" };
  if (typeof patientId !== "string" || !PATIENT_ID.test(patientId)) return { status: "invalid" };
  const out = await callInteropRpc(
    client,
    "interop_withdraw_consent",
    {
      p_consent_id: consentId,
      p_reason: cleanWithdrawReason(reason),
      p_patient_id: patientId,
    },
    online,
  );
  if (out.ok === false) return { status: out.reason };
  return out.data === false ? { status: "already_withdrawn" } : { status: "withdrawn" };
}

/**
 * interop_consent_summary(p_patient_id).sharing_state, the owner's three
 * states: "allowed" only for a verified permit in force with no limit and
 * no refusal in force; "withdrawn"; "restricted" for everything else.
 */
export type ExternalSharing = "allowed" | "restricted" | "withdrawn";

/**
 * interop_consent_summary(p_patient_id).sharing_reason: why. A refusal
 * counts only when it is in force (active and started), as in the gateway.
 */
export type SharingReason =
  | "permitted" // a verified permit in force, with no limit
  | "withdrawn" // a permission to share outside mBHR was withdrawn, and nothing newer applies
  | "refused" // a refusal in force, with no limit (verified or not)
  | "refused_partly" // a refusal in force, limited to some purposes, uses or records
  | "limited" // the only permits in force are limited (purpose, type, ...)
  | "pending_verification" // a permit in force that staff have not verified
  | "not_started" // a permit that is not in force yet
  | "no_permission"; // nothing permits sharing

const SHARING_REASONS: readonly SharingReason[] = [
  "permitted",
  "withdrawn",
  "refused",
  "refused_partly",
  "limited",
  "pending_verification",
  "not_started",
  "no_permission",
];

export interface ConsentSummary {
  externalSharing: ExternalSharing;
  /** null when the server gave no reason we know (the hover says so). */
  reason: SharingReason | null;
  activeRecords: number | null;
  withdrawnRecords: number | null;
  lastChangedAt: string | null;
}

/**
 * The summary, or null when the answer is not one we understand. Only
 * sharing_state is read for the state: the older external_sharing key
 * says "allowed" for a limited permit too, so an answer without
 * sharing_state shows nothing.
 */
export function parseConsentSummary(data: unknown): ConsentSummary | null {
  const d = obj(data);
  if (!d) return null;
  const v = d.sharing_state;
  if (v !== "allowed" && v !== "restricted" && v !== "withdrawn") return null;
  const reason = SHARING_REASONS.find((r) => r === d.sharing_reason) ?? null;
  return {
    externalSharing: v,
    reason,
    activeRecords: toCount(d.active_records),
    withdrawnRecords: toCount(d.withdrawn_records),
    lastChangedAt: toTimestamp(d.last_changed_at),
  };
}

export const EXTERNAL_SHARING_LABEL: Record<ExternalSharing, string> = {
  allowed: "External sharing: Allowed",
  restricted: "External sharing: Restricted",
  withdrawn: "External sharing: Withdrawn",
};

/** Hover text, first sentence: the reason, in plain words. */
export const SHARING_REASON_TEXT: Record<SharingReason, string> = {
  permitted: "The patient allowed sharing outside mBHR, with no limits.",
  withdrawn: "A permission to share outside mBHR was withdrawn.",
  refused: "The patient asked us not to share their records outside mBHR.",
  refused_partly: "The patient refused some sharing outside mBHR.",
  limited: "The patient's permission covers only some records or uses.",
  pending_verification: "A permission is recorded, but staff have not checked it yet.",
  not_started: "A permission is recorded, but it has not started yet.",
  no_permission: "No permission to share outside mBHR is in force.",
};

/** Hover text when the reason is not one we know. */
export const SHARING_REASON_UNKNOWN = "The reason is not known.";

/**
 * Hover text, the rest: this release shares nothing through it, and care is
 * never affected. (It does not claim that no record ever leaves mBHR: the
 * older sharing functions are outside this record.)
 */
export const EXTERNAL_SHARING_NOTE =
  "External access is off in this release, so this is not used to share records yet. It does not affect care.";

/** The chip's text, tone and hover text. Neutral tones only: nothing here blocks care. */
export function externalSharingChip(summary: ConsentSummary | null): {
  label: string;
  tone: "info" | "neutral";
  hint: string;
} | null {
  if (!summary) return null;
  const why = summary.reason ? SHARING_REASON_TEXT[summary.reason] : SHARING_REASON_UNKNOWN;
  return {
    label: EXTERNAL_SHARING_LABEL[summary.externalSharing],
    tone: summary.externalSharing === "allowed" ? "info" : "neutral",
    hint: `${why} ${EXTERNAL_SHARING_NOTE}`,
  };
}

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
