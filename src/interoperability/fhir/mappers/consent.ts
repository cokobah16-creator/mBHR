// interop.consent_records (+ interop.consent_provisions) -> Consent
//
// mBHR's consent register is the canonical consent model: the policy engine
// (consent/evaluateConsent.ts) decides with it, and a FHIR Consent is only
// a view of one register record. The gateway reads the register through
// public.fhir_consent_directives, which returns each record with its
// provisions and never returns account ids (recorded_by, verified_by,
// withdrawn_by), the withdrawal reason, who signed (granted_by and the
// relationship), the source document or a provision's actor reference
// (names_recipient says only whether a provision names one).
//
// What is published, and what is not:
//
//   - status: the stored consent-state code (CONSENT_STATUS); a withdrawn
//     record is inactive (CONSENT_STATUS_WITHDRAWN), and so is an active
//     record past its end date at the time of the request
//     (CONSENT_STATUS_ENDED, the consent check's own rule), never active.
//     A record with no usable status is not published (Consent.status is
//     required and the value set has no "unknown").
//   - scope: the stored consentscope code, with the R4 display. category:
//     the stored category as an mBHR local code
//     (https://mbhr.app/codes/consent-category), never a LOINC code, since
//     no reviewed mapping says which LOINC document class a category is.
//   - patient: the canonical record's Patient id (a record still filed
//     under a merged-away patient shows the kept record). A record whose
//     patient cannot be resolved is not published.
//   - dateTime: when the record was entered in the register (recorded_at).
//   - policy.uri: the recorded policy. R4 requires policy or policyRule
//     (invariant ppc-1) and mBHR records no policy rule. Recording a
//     consent needs a policy link (interop_record_consent and the
//     register's CHECK consent_records_policy_required); a record that
//     still cites none is withheld here as defence in depth, never given
//     an invented rule.
//   - verification: only from the recorded flag. verified true: verified,
//     with the date when recorded; false: verified false (the register
//     records that nobody has verified it yet); absent: left out. Who
//     verified it is never published.
//   - provision.period: the record's effective period. The root rule has no
//     type: mBHR records none (its default-deny for sharing is mBHR policy,
//     not the patient's statement). One nested provision per stored
//     provision, in the stored order, with only what was recorded: type,
//     period, actor (the kind of recipient; a rule naming one specific
//     recipient withholds the record, below), action (consentaction),
//     purpose (v3 ActReason), class (resource type or mBHR data class) and
//     securityLabel.
//   - performer, organization, source[x] and policyRule are never filled:
//     mBHR records no performer in a form this interface can show, no
//     organisation, and the source document is not published.
//
// A directive is published whole or not at all. When a stored rule cannot
// be shown in R4 without changing its meaning (a code outside the
// register's own lists; an unreadable period; a resource type AND a data
// class on one rule, which FHIR would read as either one; a rule for one
// named recipient, which would read as a rule for every recipient of that
// kind), the record is withheld: leaving out a condition would make a
// permit look broader than the patient agreed to. Resource modules say how
// many were left out.

import type { CodeableConcept, Coding, Period, Reference, Resource } from "../types/fhir";
import { applyStatusMap } from "../terminology/statusMaps";
import { MBHR_CODES } from "../terminology/codeSystems";
import {
  CONSENT_STATE_CODES,
  CONSENT_STATUS,
  CONSENT_STATUS_ENDED,
  CONSENT_STATUS_WITHDRAWN,
  type ConsentState,
} from "../terminology/status/consent";
import { PURPOSE_OF_USE_SYSTEM } from "../consent/policy";
import { periodEnded } from "../consent/evaluateConsent";
import { DATETIME, isObj, type AddIssue } from "../validation/validate";
import { instant, patientReference, versionMeta, type MapContext, type Row } from "./common";

export const CONSENT_SCOPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/consentscope";
export const CONSENT_ACTION_SYSTEM = "http://terminology.hl7.org/CodeSystem/consentaction";
export const RESOURCE_TYPES_SYSTEM = "http://hl7.org/fhir/resource-types";

/** mBHR's own consent code systems (no international code is claimed for these). */
export const LOCAL_CONSENT = {
  category: `${MBHR_CODES}/consent-category`,
  actorType: `${MBHR_CODES}/consent-actor-type`,
  dataClass: `${MBHR_CODES}/consent-data-class`,
  resourceType: `${MBHR_CODES}/consent-resource-type`,
  securityLabel: `${MBHR_CODES}/consent-security-label`,
} as const;

/** R4 consentscope codes (the register's CHECK list) with their R4 displays. */
export const CONSENT_SCOPES: Readonly<Record<string, string>> = {
  adr: "Advanced Care Directive",
  research: "Research",
  "patient-privacy": "Privacy Consent",
  treatment: "Treatment",
};

/** R4 consentaction codes (the register's CHECK list) with their R4 displays. */
export const CONSENT_ACTIONS: Readonly<Record<string, string>> = {
  collect: "Collect",
  access: "Access",
  use: "Use",
  disclose: "Disclose",
  correct: "Access and Correct",
};

/** v3 ActReason purpose-of-use codes the register accepts (published without a display). */
export const CONSENT_PURPOSES: readonly string[] = ["TREAT", "ETREAT", "HOPERAT", "PATRQT", "HRESCH", "PUBHLTH"];

/**
 * The register's actor types (its CHECK list) and how each is labelled in
 * mBHR's local code system. "any" is not an actor: a rule for any recipient
 * has no actor element.
 */
export const CONSENT_ACTOR_TYPES: Readonly<Record<string, string>> = {
  organization: "Organisation",
  practitioner: "Practitioner",
  care_team: "Care team",
  patient_portal: "Patient portal",
  external_system: "External system",
};

/**
 * FHIR R4 (4.0.1) resource type names: a provision's resource_type is
 * published under http://hl7.org/fhir/resource-types only when it is one of
 * these; any other stored name keeps the mBHR local system.
 */
export const R4_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "Account", "ActivityDefinition", "AdverseEvent", "AllergyIntolerance", "Appointment", "AppointmentResponse",
  "AuditEvent", "Basic", "Binary", "BiologicallyDerivedProduct", "BodyStructure", "Bundle", "CapabilityStatement",
  "CarePlan", "CareTeam", "CatalogEntry", "ChargeItem", "ChargeItemDefinition", "Claim", "ClaimResponse",
  "ClinicalImpression", "CodeSystem", "Communication", "CommunicationRequest", "CompartmentDefinition",
  "Composition", "ConceptMap", "Condition", "Consent", "Contract", "Coverage", "CoverageEligibilityRequest",
  "CoverageEligibilityResponse", "DetectedIssue", "Device", "DeviceDefinition", "DeviceMetric", "DeviceRequest",
  "DeviceUseStatement", "DiagnosticReport", "DocumentManifest", "DocumentReference", "EffectEvidenceSynthesis",
  "Encounter", "Endpoint", "EnrollmentRequest", "EnrollmentResponse", "EpisodeOfCare", "EventDefinition",
  "Evidence", "EvidenceVariable", "ExampleScenario", "ExplanationOfBenefit", "FamilyMemberHistory", "Flag", "Goal",
  "GraphDefinition", "Group", "GuidanceResponse", "HealthcareService", "ImagingStudy", "Immunization",
  "ImmunizationEvaluation", "ImmunizationRecommendation", "ImplementationGuide", "InsurancePlan", "Invoice",
  "Library", "Linkage", "List", "Location", "Measure", "MeasureReport", "Media", "Medication",
  "MedicationAdministration", "MedicationDispense", "MedicationKnowledge", "MedicationRequest",
  "MedicationStatement", "MedicinalProduct", "MedicinalProductAuthorization", "MedicinalProductContraindication",
  "MedicinalProductIndication", "MedicinalProductIngredient", "MedicinalProductInteraction",
  "MedicinalProductManufactured", "MedicinalProductPackaged", "MedicinalProductPharmaceutical",
  "MedicinalProductUndesirableEffect", "MessageDefinition", "MessageHeader", "MolecularSequence", "NamingSystem",
  "NutritionOrder", "Observation", "ObservationDefinition", "OperationDefinition", "OperationOutcome",
  "Organization", "OrganizationAffiliation", "Parameters", "Patient", "PaymentNotice", "PaymentReconciliation",
  "Person", "PlanDefinition", "Practitioner", "PractitionerRole", "Procedure", "Provenance", "Questionnaire",
  "QuestionnaireResponse", "RelatedPerson", "RequestGroup", "ResearchDefinition", "ResearchElementDefinition",
  "ResearchStudy", "ResearchSubject", "RiskAssessment", "RiskEvidenceSynthesis", "Schedule", "SearchParameter",
  "ServiceRequest", "Slot", "Specimen", "SpecimenDefinition", "StructureDefinition", "StructureMap", "Subscription",
  "Substance", "SubstanceNucleicAcid", "SubstancePolymer", "SubstanceProtein", "SubstanceReferenceInformation",
  "SubstanceSourceMaterial", "SubstanceSpecification", "SupplyDelivery", "SupplyRequest", "Task",
  "TerminologyCapabilities", "TestReport", "TestScript", "ValueSet", "VerificationResult", "VisionPrescription",
]);

export interface ConsentProvisionActor {
  role: CodeableConcept;
  reference: Reference;
}

export interface ConsentProvisionRule {
  type?: "deny" | "permit";
  period?: Period;
  actor?: ConsentProvisionActor[];
  action?: CodeableConcept[];
  securityLabel?: Coding[];
  purpose?: Coding[];
  class?: Coding[];
  provision?: ConsentProvisionRule[];
}

export interface ConsentVerification {
  verified: boolean;
  verificationDate?: string;
}

export interface Consent extends Resource {
  resourceType: "Consent";
  status: ConsentState;
  scope: CodeableConcept;
  category: CodeableConcept[];
  patient: Reference;
  dateTime?: string;
  policy?: { uri: string }[];
  verification?: ConsentVerification[];
  provision?: ConsentProvisionRule;
}

/** Why a register record was not published (never shown to clients by name). */
export type ConsentWithheld =
  | "no_id"
  | "no_patient"
  | "no_status"
  | "no_scope"
  | "no_category"
  | "no_policy"
  | "not_expressible";

export type ConsentMapResult = { resource: Consent; withheld: null } | { resource: null; withheld: ConsentWithheld };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** FHIR code: no leading, trailing or repeated whitespace. */
const FHIR_CODE = /^\S+( \S+)*$/;
const URI = /^[a-z][a-z0-9+.-]*:\S+$/i;
const RESOURCE_TYPE_NAME = /^[A-Z][A-Za-z]{1,63}$/;
const MAX_CODE_LENGTH = 128;

/** Returned by the readers below when a stored value cannot be shown faithfully. */
const INVALID = Symbol("invalid");
type Invalid = typeof INVALID;

/**
 * A stored text value exactly as recorded: undefined when absent (null),
 * INVALID when present but not usable text. Values are compared exactly,
 * like the register's own CHECKs.
 */
function recorded(row: Row, key: string): string | undefined | Invalid {
  const v = row[key];
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "string" || v === "" || v.length > MAX_CODE_LENGTH) return INVALID;
  return v;
}

/** A stored time: undefined when absent, INVALID when present but unreadable. */
function recordedTime(row: Row, key: string): string | undefined | Invalid {
  const v = row[key];
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "string") return INVALID;
  return instant(row, key) ?? INVALID;
}

/** A period from effective_from / effective_until. Dropping an unreadable bound would widen the rule. */
function periodOf(row: Row): Period | undefined | Invalid {
  const start = recordedTime(row, "effective_from");
  const end = recordedTime(row, "effective_until");
  if (start === INVALID || end === INVALID) return INVALID;
  if (start !== undefined && end !== undefined && Date.parse(end) <= Date.parse(start)) return INVALID;
  const period: Period = {};
  if (start !== undefined) period.start = start;
  if (end !== undefined) period.end = end;
  return Object.keys(period).length ? period : undefined;
}

/** A register record is withdrawn when the withdrawal was recorded (the flag or its time). */
export function isWithdrawn(row: Row): boolean {
  return row.withdrawn === true || (typeof row.withdrawn_at === "string" && row.withdrawn_at !== "");
}

/**
 * A record whose own end date is at or before `at` (evaluateConsent's
 * rule; a non-string end is no end, as parseDirectives reads it).
 */
export function hasEnded(row: Row, at: Date): boolean {
  return periodEnded(typeof row.effective_until === "string" ? row.effective_until : null, at.getTime());
}

/**
 * Consent.status for a register record at the request's time `at`, or null
 * (withheld): see terminology/status/consent.ts. The withdrawn map takes
 * precedence over the ended one.
 */
export function mapConsentStatus(row: Row, at: Date): ConsentState | null {
  const map = isWithdrawn(row) ? CONSENT_STATUS_WITHDRAWN : hasEnded(row, at) ? CONSENT_STATUS_ENDED : CONSENT_STATUS;
  return applyStatusMap(map, row.status);
}

/** Consent.scope code for a register record, or null when it is not a consentscope code. */
export function mapConsentScope(row: Row): string | null {
  const v = row.scope;
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CONSENT_SCOPES, v) ? v : null;
}

function categoryOf(row: Row): CodeableConcept | null {
  const v = row.category;
  if (typeof v !== "string" || v.trim() === "") return null;
  // The register takes a short code-like value; anything else stays text.
  if (FHIR_CODE.test(v) && v.length <= MAX_CODE_LENGTH) return { coding: [{ system: LOCAL_CONSENT.category, code: v }] };
  return { text: v.trim() };
}

/** One stored provision as a nested rule, or INVALID when it cannot be shown without changing its meaning. */
export function mapProvision(p: unknown): ConsentProvisionRule | Invalid {
  if (!isObj(p)) return INVALID;
  const type = p.provision_type;
  if (type !== "permit" && type !== "deny") return INVALID;
  const rule: ConsentProvisionRule = { type };

  const period = periodOf(p);
  if (period === INVALID) return INVALID;
  if (period) rule.period = period;

  // A rule for one named recipient (actor_reference) cannot be shown: the
  // recipient is never published, and without it the rule would cover
  // every recipient of that kind. Only an explicit false proves it names
  // none; a missing or unreadable flag withholds too.
  if (p.names_recipient !== false) return INVALID;

  const actorType = recorded(p, "actor_type");
  if (actorType === INVALID) return INVALID;
  if (actorType !== undefined && actorType !== "any") {
    const label = Object.prototype.hasOwnProperty.call(CONSENT_ACTOR_TYPES, actorType) ? CONSENT_ACTOR_TYPES[actorType] : null;
    if (!label) return INVALID;
    // R4 requires actor.reference. The rule names no specific recipient
    // (checked above), so the reference is a display naming the kind of
    // recipient, and the role carries the recorded code.
    rule.actor = [
      {
        role: { coding: [{ system: LOCAL_CONSENT.actorType, code: actorType, display: label }] },
        reference: { display: label },
      },
    ];
  }

  const action = recorded(p, "action");
  if (action === INVALID) return INVALID;
  if (action !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(CONSENT_ACTIONS, action)) return INVALID;
    rule.action = [{ coding: [{ system: CONSENT_ACTION_SYSTEM, code: action, display: CONSENT_ACTIONS[action] }] }];
  }

  const label = recorded(p, "security_label");
  if (label === INVALID) return INVALID;
  if (label !== undefined) {
    if (!FHIR_CODE.test(label)) return INVALID;
    rule.securityLabel = [{ system: LOCAL_CONSENT.securityLabel, code: label }];
  }

  const purpose = recorded(p, "purpose");
  if (purpose === INVALID) return INVALID;
  if (purpose !== undefined) {
    if (!CONSENT_PURPOSES.includes(purpose)) return INVALID;
    rule.purpose = [{ system: PURPOSE_OF_USE_SYSTEM, code: purpose }];
  }

  const resourceType = recorded(p, "resource_type");
  const dataClass = recorded(p, "data_class");
  if (resourceType === INVALID || dataClass === INVALID) return INVALID;
  // Two class entries mean "either" in FHIR; the register means "both".
  if (resourceType !== undefined && dataClass !== undefined) return INVALID;
  if (resourceType !== undefined) {
    if (!RESOURCE_TYPE_NAME.test(resourceType)) return INVALID;
    rule.class = [{ system: R4_RESOURCE_TYPES.has(resourceType) ? RESOURCE_TYPES_SYSTEM : LOCAL_CONSENT.resourceType, code: resourceType }];
  }
  if (dataClass !== undefined) {
    if (!FHIR_CODE.test(dataClass)) return INVALID;
    rule.class = [{ system: LOCAL_CONSENT.dataClass, code: dataClass }];
  }
  return rule;
}

function withheld(reason: ConsentWithheld): ConsentMapResult {
  return { resource: null, withheld: reason };
}

/**
 * A register record (fhir_consent_directives shape) as a Consent at the
 * request's time `at` (the gateway's; a mapper never reads the clock), or
 * the reason it is withheld.
 */
export function mapConsentRecord(row: Row, ctx: MapContext, at: Date): ConsentMapResult {
  const id = typeof row.id === "string" && UUID.test(row.id) ? row.id.toLowerCase() : null;
  if (!id) return withheld("no_id");
  const patient = patientReference(ctx, row.patient_id);
  if (!patient) return withheld("no_patient");
  const status = mapConsentStatus(row, at);
  if (!status) return withheld("no_status");
  const scope = mapConsentScope(row);
  if (!scope) return withheld("no_scope");
  const category = categoryOf(row);
  if (!category) return withheld("no_category");
  const policy = row.policy_uri;
  if (typeof policy !== "string" || policy.length > 500 || !URI.test(policy)) return withheld("no_policy");

  const period = periodOf(row);
  if (period === INVALID) return withheld("not_expressible");
  // The function always sends the list (empty when there are none). A record
  // without it is not shown as having no rules.
  if (!Array.isArray(row.provisions)) return withheld("not_expressible");
  const nested: ConsentProvisionRule[] = [];
  for (const p of row.provisions) {
    const rule = mapProvision(p);
    if (rule === INVALID) return withheld("not_expressible");
    nested.push(rule);
  }

  // A consent that ended after its last recorded change is published as
  // inactive from its end on, so that is when this version began.
  const meta = versionMeta(row);
  if (
    period?.end &&
    !isWithdrawn(row) &&
    applyStatusMap(CONSENT_STATUS, row.status) === "active" &&
    status === "inactive" &&
    (!meta.lastUpdated || Date.parse(period.end) > Date.parse(meta.lastUpdated))
  ) {
    meta.lastUpdated = period.end;
    meta.versionId = String(Date.parse(period.end));
  }

  const consent: Consent = {
    resourceType: "Consent",
    id,
    meta,
    status,
    scope: { coding: [{ system: CONSENT_SCOPE_SYSTEM, code: scope, display: CONSENT_SCOPES[scope] }] },
    category: [category],
    patient,
  };
  const recordedAt = instant(row, "recorded_at");
  if (recordedAt) consent.dateTime = recordedAt;
  consent.policy = [{ uri: policy }];
  if (row.verified === true) {
    const verifiedAt = instant(row, "verified_at");
    consent.verification = [verifiedAt ? { verified: true, verificationDate: verifiedAt } : { verified: true }];
  } else if (row.verified === false) {
    consent.verification = [{ verified: false }];
  }
  const provision: ConsentProvisionRule = {};
  if (period) provision.period = period;
  if (nested.length) provision.provision = nested;
  if (Object.keys(provision).length) consent.provision = provision;
  return { resource: consent, withheld: null };
}

export function mapConsent(row: Row, ctx: MapContext, at: Date): Consent | null {
  return mapConsentRecord(row, ctx, at).resource;
}

// ---------------------------------------------------------------------------
// Structural rules for a published Consent (run by the gateway before release)
// ---------------------------------------------------------------------------

function checkRule(rule: unknown, path: string, root: boolean, add: AddIssue): void {
  if (!isObj(rule)) {
    add(path, "not an object");
    return;
  }
  if (root) {
    if (rule.type !== undefined) add(`${path}.type`, "not permitted in the root rule");
  } else if (rule.type !== "permit" && rule.type !== "deny") {
    add(`${path}.type`, "required in a nested rule: permit or deny");
  }
  if (rule.actor !== undefined) {
    const actors = Array.isArray(rule.actor) ? rule.actor : [];
    actors.forEach((a, i) => {
      if (!isObj(a) || !isObj(a.role) || !isObj(a.reference)) add(`${path}.actor[${i}]`, "role and reference are required");
    });
  }
  if (rule.provision !== undefined) {
    const nested = Array.isArray(rule.provision) ? rule.provision : [];
    nested.forEach((n, i) => checkRule(n, `${path}.provision[${i}]`, false, add));
  }
}

/** Consent's own R4 rules, on top of the generic checks in validation/validate.ts. */
export function validateConsent(r: Record<string, unknown>, add: AddIssue): void {
  if (!CONSENT_STATE_CODES.includes(r.status as ConsentState)) add("status", "required: a consent-state code");
  const scope = r.scope;
  const scopeOk =
    isObj(scope) &&
    Array.isArray(scope.coding) &&
    scope.coding.some(
      (c) =>
        isObj(c) &&
        c.system === CONSENT_SCOPE_SYSTEM &&
        typeof c.code === "string" &&
        Object.prototype.hasOwnProperty.call(CONSENT_SCOPES, c.code),
    );
  if (!scopeOk) add("scope", "required: a consentscope code");
  if (!Array.isArray(r.category) || r.category.length === 0) add("category", "required (1..*)");
  const patient = r.patient;
  if (!isObj(patient) || typeof patient.reference !== "string" || !patient.reference.startsWith("Patient/")) {
    add("patient", "required: mBHR publishes a consent only with its patient");
  }
  // ppc-1: either a policy or a policy rule.
  if (!Array.isArray(r.policy) && r.policyRule === undefined) add("policy", "ppc-1: policy or policyRule is required");
  if (Array.isArray(r.policy)) {
    r.policy.forEach((p, i) => {
      if (!isObj(p) || (p.uri === undefined && p.authority === undefined)) add(`policy[${i}]`, "ppc-1 (policy): uri or authority");
    });
  }
  if (r.verification !== undefined) {
    const list = Array.isArray(r.verification) ? r.verification : [];
    list.forEach((v, i) => {
      if (!isObj(v) || typeof v.verified !== "boolean") add(`verification[${i}].verified`, "required boolean");
      else if (v.verificationDate !== undefined && (typeof v.verificationDate !== "string" || !DATETIME.test(v.verificationDate))) {
        add(`verification[${i}].verificationDate`, "not a FHIR dateTime");
      }
    });
  }
  // mBHR publishes no performer; a staff reference here would be a leak.
  if (r.performer !== undefined) add("performer", "not published by mBHR");
  if (r.provision !== undefined) checkRule(r.provision, "provision", true, add);
}
