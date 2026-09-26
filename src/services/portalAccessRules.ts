// Pure rules for portal access (no database, network or React), so they
// can be tested on their own. The server owns portal access
// (set_patient_portal_access, supabase/migrations/20260925100100_*); these
// helpers read its answers and describe the device's copy honestly.

import { MINOR_RECORD_LINK_MESSAGE } from "@/pages/legal/policyMeta";

/** Why a portal access change was made (the RPC's p_source). */
export type PortalAccessSource = "staff" | "auto_enrollment" | "merge";

/** The server's answer to set_patient_portal_access, as far as it is known. */
export interface PortalAccessResult {
  patientId?: string;
  portalEnabled?: boolean;
  changedAt?: string | null;
  changed?: boolean;
  reason?: string;
  canonicalPatientId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the RPC result without trusting its shape. */
export function parsePortalAccessResult(value: unknown): PortalAccessResult {
  if (!isRecord(value)) return {};
  const result: PortalAccessResult = {};
  if (typeof value.patient_id === "string") result.patientId = value.patient_id;
  if (typeof value.portal_enabled === "boolean") result.portalEnabled = value.portal_enabled;
  if (typeof value.changed_at === "string" || value.changed_at === null) {
    result.changedAt = value.changed_at as string | null;
  }
  if (typeof value.changed === "boolean") result.changed = value.changed;
  if (typeof value.reason === "string") result.reason = value.reason;
  if (typeof value.canonical_patient_id === "string") {
    result.canonicalPatientId = value.canonical_patient_id;
  }
  return result;
}

/** Plain sentence for a refused portal access change (reason codes only). */
export function portalRejectionMessage(reason: string | undefined): string {
  switch (reason) {
    case "newer_decision_on_server":
      return "Portal access was changed on the server after this change was made, so the server's setting was kept.";
    case "server_decision_kept":
      return "The server already holds a portal access decision for this patient, so the automatic change was not applied.";
    case "patient_merged":
      return "This record was merged into another record. Change portal access on the record it was merged into.";
    case "permission_denied":
      return "The person who made this change is not allowed to manage portal access, so the server's setting was kept.";
    case "invalid_request":
      return "The server could not read this change. Make the change again.";
    default:
      return "The server refused this change, so the server's setting was kept.";
  }
}

/** The subset of a queued command these rules read. */
export interface PortalCommandLike {
  id: string;
  status: "pending" | "waiting_permission" | "applied" | "rejected";
  createdAt: number;
  settledAt?: number;
  rejectReason?: string;
  lastErrorCode?: string;
}

/** The subset of a patient record these rules read. */
export interface PortalPatientLike {
  portalEnabled?: 0 | 1;
  portalPending?: 0 | 1;
  portalEnabledChangedAt?: string | null;
  _syncedAt?: string;
}

export interface PortalAccessView {
  /** The value this device shows (the requested value while pending). */
  enabled: boolean;
  /** A change made here is waiting for the server. */
  pending: boolean;
  /** The server refused the sender; waiting for someone allowed to sync. */
  waitingPermission: boolean;
  /** The server has not been reached for the waiting change (e.g. offline). */
  lastErrorCode?: string;
  /** When the server last recorded a decision (ISO), if known. */
  confirmedAt?: string | null;
  /** The newest answer was a refusal (shown until a newer change). */
  rejection?: { reason: string; message: string; at?: number };
}

/**
 * Describe a patient's portal access on this device from the patient record
 * and that patient's portal access commands (any order).
 */
export function describePortalAccess(
  patient: PortalPatientLike,
  commands: PortalCommandLike[],
): PortalAccessView {
  const open = commands.filter(
    (c) => c.status === "pending" || c.status === "waiting_permission",
  );
  const settled = commands
    .filter((c) => c.status === "applied" || c.status === "rejected")
    .sort((a, b) => (b.settledAt ?? b.createdAt) - (a.settledAt ?? a.createdAt));
  const newestOpen = [...open].sort((a, b) => b.createdAt - a.createdAt)[0];
  const latest = settled[0];

  const view: PortalAccessView = {
    enabled: patient.portalEnabled === 1,
    pending: patient.portalPending === 1 || open.length > 0,
    waitingPermission: open.some((c) => c.status === "waiting_permission"),
    confirmedAt: patient.portalEnabledChangedAt ?? null,
  };
  if (newestOpen?.lastErrorCode) view.lastErrorCode = newestOpen.lastErrorCode;
  if (
    latest &&
    latest.status === "rejected" &&
    !open.some((c) => c.createdAt > latest.createdAt)
  ) {
    view.rejection = {
      reason: latest.rejectReason ?? "rejected_by_server",
      message: portalRejectionMessage(latest.rejectReason),
      at: latest.settledAt,
    };
  }
  return view;
}

/** Local portal sign-in may use this device's copy for at most this long. */
export const LOCAL_PORTAL_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LocalPortalDecision =
  | { allowed: true }
  | { allowed: false; reason: "disabled" | "pending" | "stale" | "no_record" };

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * May a local (PIN) portal sign-in on this device go ahead for this patient?
 *
 * - No server set up on this device: the device's value is the only one;
 *   only an explicit "off" refuses (older self-registered records have no
 *   value at all).
 * - A server is set up: portal access belongs to the server, and a PIN
 *   sign-in cannot ask it. The device's copy is trusted only when it is on,
 *   not waiting for the server, and was confirmed by a download or a
 *   server decision in the last `maxAgeMs`.
 */
export function localPortalAccessDecision(
  patient: PortalPatientLike | undefined,
  opts: { serverConfigured: boolean; now: number; maxAgeMs?: number },
): LocalPortalDecision {
  if (!opts.serverConfigured) {
    if (patient && patient.portalEnabled === 0) return { allowed: false, reason: "disabled" };
    return { allowed: true };
  }
  if (!patient) return { allowed: false, reason: "no_record" };
  if (patient.portalEnabled !== 1) return { allowed: false, reason: "disabled" };
  if (patient.portalPending === 1) return { allowed: false, reason: "pending" };
  const maxAge = opts.maxAgeMs ?? LOCAL_PORTAL_CACHE_MAX_AGE_MS;
  const times = [parseTime(patient.portalEnabledChangedAt), parseTime(patient._syncedAt)].filter(
    (t): t is number => t !== null,
  );
  const last = times.length ? Math.max(...times) : null;
  if (last === null || opts.now - last > maxAge) return { allowed: false, reason: "stale" };
  return { allowed: true };
}

/** Plain sentence for a refused local portal sign-in. */
export function localPortalRefusalMessage(
  reason: "disabled" | "pending" | "stale" | "no_record",
): string {
  switch (reason) {
    case "disabled":
      return "Your clinic has not turned on portal access for you. Please ask clinic staff.";
    case "pending":
      return "Your clinic has asked for portal access to be turned on, but the server has not confirmed it yet. Try again after this device syncs.";
    case "stale":
      return "This device could not confirm your portal access recently. Connect to the internet and sign in with your email and password, or ask clinic staff.";
    case "no_record":
      return "Your record is not on this device. Sign in with your email and password when you are online.";
  }
}

export type PortalSignInCheck =
  | { kind: "allowed"; patientIds: string[] }
  | { kind: "not_enabled" }
  | { kind: "not_linked" }
  | { kind: "unavailable" };

/**
 * Read portal_access_status() rows for the signed-in portal user. Anything
 * unexpected refuses: the portal only opens when the server says it is on.
 */
export function portalSignInDecision(rows: unknown, failed: boolean): PortalSignInCheck {
  if (failed || !Array.isArray(rows)) return { kind: "unavailable" };
  const parsed = rows.filter(isRecord).map((r) => ({
    patientId: typeof r.patient_id === "string" ? r.patient_id : "",
    enabled: r.portal_enabled === true,
  }));
  const valid = parsed.filter((r) => r.patientId);
  if (valid.length === 0) return { kind: "not_linked" };
  const enabled = valid.filter((r) => r.enabled).map((r) => r.patientId);
  if (enabled.length === 0) return { kind: "not_enabled" };
  return { kind: "allowed", patientIds: enabled };
}

/** Message shown when the portal refuses a sign-in. */
/** Access is off or revoked: no internal terms, no protected information. */
export const PORTAL_ACCESS_UNAVAILABLE_MESSAGE =
  "Your online access is currently unavailable. Please contact the care team for assistance.";

export function portalSignInRefusalMessage(kind: Exclude<PortalSignInCheck["kind"], "allowed">): string {
  switch (kind) {
    case "not_enabled":
      return PORTAL_ACCESS_UNAVAILABLE_MESSAGE;
    case "not_linked":
      return "Your account is not linked to a clinic record yet. Please ask clinic staff to check your record.";
    case "unavailable":
      return "We could not check your portal access with the clinic server. Check your internet connection and try again.";
  }
}

export interface PortalLinkOutcome {
  /** The account is linked to a clinic record (or one was created). */
  linked: boolean;
  /** Message for the patient when not linked. */
  message?: string;
}

/** What a portal_link_patient_record status means for the patient. */
export function portalLinkOutcome(status: unknown): PortalLinkOutcome {
  switch (status) {
    case "already_linked":
    case "linked":
    case "created":
      return { linked: true };
    case "staff_account":
      return {
        linked: false,
        message: "This email belongs to a staff account. Use the staff sign-in instead.",
      };
    case "linked_elsewhere":
      return {
        linked: false,
        message:
          "Your clinic record is already linked to another portal account. Please ask clinic staff to check your record.",
      };
    case "ambiguous":
      return {
        linked: false,
        message:
          "More than one clinic record matches your details. Please ask clinic staff to link your account.",
      };
    case "portal_not_enabled":
      return {
        linked: false,
        message:
          "Your account is created, but your clinic has not turned on portal access for you yet. Ask clinic staff to turn it on, then sign in.",
      };
    case "needs_staff_verification":
      // Returned when the date of birth does not match the clinic record,
      // when the matching record belongs to someone under 18, and when no
      // record matches and the date of birth is under 18
      // (20260926120100_portal_link_adults_only.sql). One message that is
      // true for all three: ask clinic staff.
      return { linked: false, message: MINOR_RECORD_LINK_MESSAGE };
    case "no_clinic_record":
      // The server never creates a clinic record for a sign-up: the clinic
      // registers patients, and the account links to that record.
      return {
        linked: false,
        message:
          "We could not find a clinic record that matches your details. Please ask the care team to check your record, then sign in again.",
      };
    case "contact_not_verified":
      return {
        linked: false,
        message:
          "Your account is created. Confirm your email address with the link we sent you, then sign in to finish.",
      };
    case "missing_details":
      return {
        linked: false,
        message: "Please enter your full name and date of birth, then try again.",
      };
    default:
      return {
        linked: false,
        message:
          "Your account is created, but we could not link it to your clinic record right now. Sign in again later, or ask clinic staff for help.",
      };
  }
}

export interface BulkAccessSummary {
  /** The server confirmed access is on. */
  confirmed: number;
  /** Still waiting for the server. */
  waiting: number;
  /** The server refused; its value (usually off) is shown instead. */
  refused: Array<{ patientId: string; message: string }>;
  /** Kept on this device only (no server set up). */
  deviceOnly: number;
}

/**
 * Where a bulk "turn portal access on" run stands, from the patients' current
 * records and their portal access commands. Follows the server's answers as
 * they arrive.
 */
export function summarizeBulkAccess(
  patientIds: string[],
  patients: (({ id: string } & PortalPatientLike) | undefined)[],
  commands: (PortalCommandLike & { entityRefs?: { table: string; id: string }[] })[],
  serverConfigured: boolean,
): BulkAccessSummary {
  const summary: BulkAccessSummary = { confirmed: 0, waiting: 0, refused: [], deviceOnly: 0 };
  const byId = new Map(
    patients.filter((p): p is { id: string } & PortalPatientLike => !!p).map((p) => [p.id, p]),
  );
  for (const id of patientIds) {
    const own = commands.filter((c) =>
      (c.entityRefs ?? []).some((ref) => ref.table === "patients" && ref.id === id),
    );
    const patient = byId.get(id);
    if (!serverConfigured) {
      summary.deviceOnly++;
      continue;
    }
    const view = describePortalAccess(patient ?? {}, own);
    if (view.pending) summary.waiting++;
    else if (view.rejection) summary.refused.push({ patientId: id, message: view.rejection.message });
    else if (view.enabled) summary.confirmed++;
    else summary.waiting++;
  }
  return summary;
}

/**
 * Where portal access commands stand for patients that may exist only on the
 * server (the newest command per patient decides).
 */
export function summarizeCommandOutcomes(
  patientIds: string[],
  commands: (PortalCommandLike & { entityRefs?: { table: string; id: string }[] })[],
): { applied: number; waiting: number; refused: Array<{ patientId: string; message: string }> } {
  const summary = { applied: 0, waiting: 0, refused: [] as Array<{ patientId: string; message: string }> };
  for (const id of patientIds) {
    const newest = commands
      .filter((c) => (c.entityRefs ?? []).some((ref) => ref.table === "patients" && ref.id === id))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!newest) continue;
    if (newest.status === "applied") summary.applied++;
    else if (newest.status === "rejected") {
      summary.refused.push({ patientId: id, message: portalRejectionMessage(newest.rejectReason) });
    } else summary.waiting++;
  }
  return summary;
}
