// The single access decision for the FHIR gateway: authorizeFhirRequest().
//
// Every endpoint calls it exactly once per request, before any clinical row
// is read, and the gateway writes every decision (permit or deny) to
// interop.access_audit before it answers. The steps run in this order and
// the first refusal wins; no step can widen what an earlier one allowed:
//
//    1. enabled        FHIR_ENABLED and FHIR_READ_ENABLED
//    2. authenticated  a valid Supabase session for a real account
//    3. active         the account is active staff, or a portal patient
//                      linked to a kept (not merged) record
//    4. surface        the account kind and client may use this surface:
//                      no external clients, no SMART scopes, patients only
//                      with FHIR_PATIENT_ACCESS_ENABLED; the purpose of use
//                      is one this kind of account may state
//    5. permission     staff: the mBHR permissions for the type; patients:
//                      only the types the portal shows them
//    6. organisation   no organisation or site boundary exists on mBHR
//                      clinical rows yet, so nothing narrows here (recorded
//                      as the restriction org_scope_not_applied)
//    7. patient        patients: every patient the request names must be
//                      their own; the query is confined to their records
//    8. ownership      every row returned must belong to a patient in scope
//                      (enforced after the read, before release)
//    9. class          per-class limits (portal-visible only, released lab
//                      results only, lab rows need lab permissions, ...)
//   10. consent        evaluateConsent() for every named patient
//   11. sensitivity    security labels: none are recorded in mBHR yet
//   12. log            the gateway audits the decision before answering
//
// Writes never reach this function (405 at the routing guard).

import type { FhirConfig } from "../config/config";
import {
  LAB_PERMISSIONS,
  PATIENT_SELF_ACCESS,
  canRead,
  hasAny,
  type FhirResourceType,
} from "./permissions";
import { SUPPORTED_PURPOSES, type PurposeOfUse } from "../consent/policy";
import {
  evaluateConsent,
  type ConsentAction,
  type ConsentDirective,
  type ConsentEvaluation,
} from "../consent/evaluateConsent";

export interface Actor {
  /** auth.users id of the caller. Never published. */
  userId: string;
  /** staff: active mBHR staff role; patient: portal account linked to a record; none: neither. */
  kind: "staff" | "patient" | "none";
  /** mBHR role from app_users, or null (portal patient, guest, deactivated). */
  role: string | null;
  permissions: ReadonlySet<string>;
  /** Internal ids of the caller's own linked patient records (patients only). */
  patientIds: ReadonlySet<string>;
}

/** An external (non-mBHR) client. None can reach the gateway in this release. */
export interface FhirClient {
  clientId: string;
  kind: "external-system" | "third-party-app";
}

export interface FhirAuthorizationRequest {
  actor: Actor | null;
  client: FhirClient | null;
  interaction: "read" | "search";
  resourceType: FhirResourceType;
  resourceId?: string | null;
  /**
   * Internal ids of the patients the request names (patient=, subject=, or
   * the Patient read id), resolved server-side. null: the request named a
   * patient that could not be resolved. undefined: it named none.
   */
  patientIds?: string[] | null;
  encounterId?: string | null;
  organizationId?: string | null;
  /** SMART scopes on the token. First-party sessions carry none. */
  requestedScopes?: string[];
  /** null: the requested purpose was not a known code. */
  purposeOfUse: PurposeOfUse | null;
  /** consent data class of the resource type. */
  dataClass?: string;
}

export type AuthorizationStep =
  | "enabled"
  | "authenticated"
  | "active"
  | "surface"
  | "permission"
  | "organization"
  | "patient_context"
  | "ownership"
  | "resource_class"
  | "consent"
  | "sensitivity"
  | "log";

export interface FhirAuthorizationDecision {
  allowed: boolean;
  /** "permitted", or a short denial reason code (recorded in the audit). */
  reason: string;
  /** The step that decided. */
  step: AuthorizationStep;
  /** HTTP status for a refusal (200 when allowed). */
  status: 200 | 401 | 403 | 404;
  /**
   * Conditions the gateway and the resource modules must apply to an
   * allowed request, e.g. "patient_scope", "closed_encounters_only".
   */
  restrictions: string[];
  /** The consent result for the named patient(s), when evaluated. */
  consent: ConsentEvaluation | null;
}

export interface AuthorizeDeps {
  config: Pick<FhirConfig, "enabled" | "readEnabled" | "patientAccessEnabled" | "consentEnforcementEnabled">;
  now: Date;
  /** Load consent directives for these internal patient ids (fhir_consent_directives). */
  loadDirectives?: (patientIds: string[]) => Promise<ConsentDirective[]>;
}

/** Per-class limits a portal patient's view carries (the portal's own rules). */
const PATIENT_CLASS_RESTRICTIONS: Partial<Record<FhirResourceType, string>> = {
  Encounter: "closed_encounters_only",
  Observation: "portal_visible_only",
  DiagnosticReport: "released_results_only",
  MedicationDispense: "portal_visible_only",
  DocumentReference: "own_documents_only",
  Binary: "patient_uploads_only",
  Consent: "own_consents_only",
};

/** Consent refusals that do not depend on any directive. */
const DIRECTIVE_INDEPENDENT = new Set(["consent_enforcement_disabled", "break_glass_not_enabled"]);
/** Permissions fhir_consent_directives accepts (Phase 2 migration). */
const CONSENT_READERS = ["consult", "portal_manage", "audit_access"] as const;

export async function authorizeFhirRequest(
  req: FhirAuthorizationRequest,
  deps: AuthorizeDeps,
): Promise<FhirAuthorizationDecision> {
  const restrictions: string[] = [];
  const deny = (step: AuthorizationStep, reason: string, status: 401 | 403 | 404 = 403): FhirAuthorizationDecision => ({
    allowed: false,
    reason,
    step,
    status,
    restrictions,
    consent: null,
  });

  // 1. enabled
  if (!deps.config.enabled || !deps.config.readEnabled) return deny("enabled", "reads_disabled", 404);

  // 2. authenticated
  const actor = req.actor;
  if (!actor) return deny("authenticated", "unauthenticated", 401);

  // 3. active
  if (actor.kind === "none") return deny("active", "no_active_account");
  if (actor.kind === "staff" && !actor.role) return deny("active", "no_staff_role");
  if (actor.kind === "patient" && actor.patientIds.size === 0) return deny("active", "no_linked_record");

  // 4. surface
  // External clients are default-deny; none is enabled in this release
  // (FHIR_EXTERNAL_ACCESS_ENABLED cannot be switched on).
  if (req.client !== null) return deny("surface", "external_access_disabled");
  if (req.requestedScopes && req.requestedScopes.length) return deny("surface", "smart_not_enabled");
  if (actor.kind === "patient" && !deps.config.patientAccessEnabled) return deny("surface", "patient_access_disabled");
  if (req.purposeOfUse === null) return deny("surface", "purpose_invalid");
  if (req.purposeOfUse === "ETREAT") return deny("surface", "break_glass_not_enabled");
  if (!SUPPORTED_PURPOSES[actor.kind].includes(req.purposeOfUse)) return deny("surface", "purpose_not_supported");

  // 5. permission
  if (actor.kind === "staff") {
    if (!canRead(actor.permissions, req.resourceType)) return deny("permission", "missing_permission");
  } else if (!PATIENT_SELF_ACCESS.has(req.resourceType)) {
    return deny("permission", "not_available_to_patients");
  }

  // 6. organisation
  if (req.organizationId !== undefined && req.organizationId !== null) {
    // No request can name an organisation scope yet; refuse rather than ignore.
    return deny("organization", "organization_scope_not_supported");
  }
  restrictions.push("org_scope_not_applied");

  // 7. patient context
  if (actor.kind === "patient") {
    restrictions.push("patient_scope");
    if (req.patientIds === null) return deny("patient_context", "patient_not_in_context");
    if (req.patientIds && req.patientIds.some((id) => !actor.patientIds.has(id))) {
      return deny("patient_context", "patient_not_in_context");
    }
  }

  // 8. ownership: checked on every returned row before release.
  restrictions.push("owner_check_after_read");

  // 9. resource class
  if (actor.kind === "patient") {
    const r = PATIENT_CLASS_RESTRICTIONS[req.resourceType];
    if (r) restrictions.push(r);
  } else {
    if (req.resourceType === "Observation" && !hasAny(actor.permissions, LAB_PERMISSIONS)) {
      restrictions.push("no_lab_rows");
    }
    if (req.resourceType === "Provenance" && !actor.permissions.has("audit_access")) {
      restrictions.push("lab_events_only");
    }
  }

  // 10. consent
  const step10 = await consentStep(actor, req, deps);
  if (step10.denied) return { ...deny("consent", step10.denied), consent: step10.consent };
  const consent = step10.consent;

  // 11. sensitivity
  restrictions.push("no_security_labels");

  // 12. log (the gateway records this decision before answering)
  return { allowed: true, reason: "permitted", step: "log", status: 200, restrictions, consent };
}

/**
 * Step 10 on its own. No purpose the surface accepts today is governed by
 * consent, so the gateway never reaches the directive lookup yet; the step
 * is exported so its tests can drive the governed path directly.
 */
export async function consentStep(
  actor: Actor,
  req: FhirAuthorizationRequest,
  deps: AuthorizeDeps,
): Promise<{ denied: string | null; consent: ConsentEvaluation | null }> {
  const purposeOfUse = req.purposeOfUse;
  if (purposeOfUse === null) return { denied: "purpose_invalid", consent: null };
  const action: ConsentAction = "access";
  const named = req.patientIds ?? [];
  const enforcementEnabled = deps.config.consentEnforcementEnabled;
  const base = {
    actor: { kind: actor.kind, role: actor.role },
    clientId: null,
    organizationId: null,
    resourceType: req.resourceType,
    dataClass: req.dataClass,
    action,
    purposeOfUse,
    timestamp: deps.now,
  };
  // Whether consent governs this access does not depend on the patient.
  const probe = evaluateConsent({ ...base, patientId: "" }, [], { enforcementEnabled });
  if (probe.decision === "not-applicable") return { denied: null, consent: probe };
  // Refusals that no directive can change (enforcement off, break-glass)
  // are final without reading anyone's consent records.
  if (probe.decision === "deny" && DIRECTIVE_INDEPENDENT.has(probe.reason)) return { denied: probe.reason, consent: probe };
  if (!named.length) return { denied: "consent_requires_patient_context", consent: probe };
  // fhir_consent_directives answers only callers who may read consent
  // records; anyone else is refused here rather than by an empty answer.
  if (actor.kind === "staff" && !hasAny(actor.permissions, CONSENT_READERS)) {
    return { denied: "consent_not_readable", consent: probe };
  }
  const directives = deps.loadDirectives ? await deps.loadDirectives(named) : [];
  let consent: ConsentEvaluation = probe;
  for (const patientId of named) {
    consent = evaluateConsent({ ...base, patientId }, directives, { enforcementEnabled });
    if (consent.decision !== "permit") return { denied: consent.reason, consent };
  }
  return { denied: null, consent };
}
