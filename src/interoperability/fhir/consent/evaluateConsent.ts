// Consent evaluation: evaluateConsent().
//
// One pure function decides whether a patient's stored consent directives
// (interop.consent_records + consent_provisions, read through
// public.fhir_consent_directives) permit a disclosure. The domain model is
// canonical; FHIR Consent resources are only a view of it.
//
// Which accesses consent governs:
//
//   internal-treatment   mBHR staff treating the patient (TREAT)      not-applicable
//   internal-operations  mBHR staff, operations (HOPERAT)             not-applicable
//   self-access          the patient reading their own record         not-applicable
//   external-sharing     another organisation or system               consent required
//   third-party-app      an app acting for someone (SMART, later)     consent required
//   research             any research use (HRESCH)                    consent required
//   public-health        reporting to public health (PUBHLTH)         consent required
//   emergency            break-glass (ETREAT)                         deny: not enabled
//
// "not-applicable" means stored consent neither permits nor blocks the
// access: other rules decide it (internal use is organisational policy, so
// ordinary care is never blocked by a missing form). For every access
// consent governs, the rule is default-deny: no explicit, active, in-period
// permit means deny, and any matching deny provision wins over permits.
//
// Withdrawal stops future disclosure only. Nothing here deletes a record or
// an audit entry; a withdrawn directive simply stops matching.

import type { PurposeOfUse } from "./policy";

export type AccessClass =
  | "internal-treatment"
  | "internal-operations"
  | "self-access"
  | "external-sharing"
  | "third-party-app"
  | "research"
  | "public-health"
  | "emergency";

export type ConsentAction = "collect" | "access" | "use" | "disclose" | "correct";

export interface ConsentProvision {
  id: string;
  provision_type: "permit" | "deny";
  actor_type: string | null;
  /**
   * True when the rule names one specific recipient (or the function did
   * not say). mBHR cannot tell whether a requester is that recipient, so
   * such a permit never grants access; a deny still refuses.
   */
  names_recipient: boolean;
  action: string | null;
  purpose: string | null;
  data_class: string | null;
  resource_type: string | null;
  security_label: string | null;
  effective_from: string | null;
  effective_until: string | null;
}

export interface ConsentDirective {
  id: string;
  patient_id: string;
  status: string;
  scope: string;
  category: string;
  verified: boolean;
  effective_from: string | null;
  effective_until: string | null;
  withdrawn: boolean;
  withdrawn_at: string | null;
  provisions: ConsentProvision[];
}

export interface ConsentActor {
  kind: "staff" | "patient" | "none";
  role: string | null;
}

export interface ConsentInput {
  patientId: string;
  actor: ConsentActor;
  /** Registered external client, if the request comes from one (none in this release). */
  clientId: string | null;
  clientKind?: "external-system" | "third-party-app";
  organizationId: string | null;
  resourceType: string;
  /** consent data class of the resource (ResourceDefinition.consentClass). */
  dataClass?: string;
  action: ConsentAction;
  purposeOfUse: PurposeOfUse;
  timestamp: Date;
}

export interface ConsentEvaluation {
  decision: "permit" | "deny" | "not-applicable";
  accessClass: AccessClass;
  consentId?: string;
  provisionId?: string;
  /** A short reason code, recorded in the access audit. */
  reason: string;
}

export interface ConsentOptions {
  /** FHIR_CONSENT_ENFORCEMENT_ENABLED: off = consent-governed access is refused outright. */
  enforcementEnabled: boolean;
}

export function accessClass(actor: ConsentActor, clientId: string | null, purpose: PurposeOfUse, clientKind?: string): AccessClass {
  if (purpose === "ETREAT") return "emergency";
  if (clientId !== null) return clientKind === "third-party-app" ? "third-party-app" : "external-sharing";
  if (purpose === "HRESCH") return "research";
  if (purpose === "PUBHLTH") return "public-health";
  if (actor.kind === "patient") return purpose === "PATRQT" ? "self-access" : "external-sharing";
  if (actor.kind === "staff") return purpose === "HOPERAT" ? "internal-operations" : purpose === "TREAT" ? "internal-treatment" : "external-sharing";
  return "external-sharing";
}

/** Consent scope each governed class is recorded under. */
const SCOPE_FOR: Partial<Record<AccessClass, string>> = {
  "external-sharing": "patient-privacy",
  "third-party-app": "patient-privacy",
  "public-health": "patient-privacy",
  research: "research",
};

/** Provision actor types that can cover each governed class. */
const ACTORS_FOR: Partial<Record<AccessClass, readonly string[]>> = {
  "external-sharing": ["external_system", "organization", "any"],
  "third-party-app": ["external_system", "any"],
  "public-health": ["organization", "external_system", "any"],
  research: ["organization", "external_system", "any"],
};

/**
 * Whether a period with this end has ended at t (ms): the end is exclusive
 * (a consent ending at 12:00 is no longer in force at 12:00), instants are
 * compared (timestamptz), and an unreadable end has ended (fails closed).
 * The same rule as interop_consent_summary (effective_until > now() is in
 * force) and the portal (consentState). The Consent mapper uses it too.
 */
export function periodEnded(until: string | null, t: number): boolean {
  if (until === null) return false;
  const u = Date.parse(until);
  return Number.isNaN(u) || t >= u;
}

function within(from: string | null, until: string | null, t: number): "before" | "in" | "after" {
  if (from !== null) {
    const f = Date.parse(from);
    if (Number.isNaN(f) || t < f) return "before";
  }
  if (periodEnded(until, t)) return "after";
  return "in";
}

function provisionMatches(p: ConsentProvision, cls: AccessClass, input: ConsentInput, t: number): boolean {
  const actors = ACTORS_FOR[cls] ?? [];
  if (p.actor_type !== null && !actors.includes(p.actor_type)) return false;
  if (p.action !== null && p.action !== input.action) return false;
  if (p.purpose !== null && p.purpose !== input.purposeOfUse) return false;
  if (p.resource_type !== null && p.resource_type !== input.resourceType) return false;
  if (p.data_class !== null && p.data_class !== (input.dataClass ?? null)) return false;
  // mBHR records no security labels on data, so a provision limited to a
  // labelled class of data covers nothing here (neither permits nor denies).
  if (p.security_label !== null) return false;
  return within(p.effective_from, p.effective_until, t) === "in";
}

export function evaluateConsent(
  input: ConsentInput,
  directives: readonly ConsentDirective[],
  options: ConsentOptions,
): ConsentEvaluation {
  const cls = accessClass(input.actor, input.clientId, input.purposeOfUse, input.clientKind);
  switch (cls) {
    case "internal-treatment":
      return { decision: "not-applicable", accessClass: cls, reason: "internal_treatment" };
    case "internal-operations":
      return { decision: "not-applicable", accessClass: cls, reason: "internal_operations" };
    case "self-access":
      return { decision: "not-applicable", accessClass: cls, reason: "patient_self_access" };
    case "emergency":
      return { decision: "deny", accessClass: cls, reason: "break_glass_not_enabled" };
    default:
      break;
  }
  if (!options.enforcementEnabled) {
    return { decision: "deny", accessClass: cls, reason: "consent_enforcement_disabled" };
  }

  const t = input.timestamp.getTime();
  const scope = SCOPE_FOR[cls];
  let sawWithdrawn = false;
  let sawExpired = false;
  let permit: { consentId: string; provisionId: string } | null = null;

  for (const d of directives) {
    if (d.patient_id !== input.patientId || d.scope !== scope) continue;
    if (d.withdrawn || d.withdrawn_at !== null) {
      sawWithdrawn = true;
      continue;
    }
    if (d.status !== "active") continue;
    const period = within(d.effective_from, d.effective_until, t);
    if (period === "after") {
      sawExpired = true;
      continue;
    }
    if (period === "before") continue;
    for (const p of d.provisions) {
      if (!provisionMatches(p, cls, input, t)) continue;
      // A patient's refusal counts even before staff verify the form.
      if (p.provision_type === "deny") {
        return { decision: "deny", accessClass: cls, consentId: d.id, provisionId: p.id, reason: "consent_deny_provision" };
      }
      // A permit counts only once the directive has been verified, and
      // only when it names no specific recipient.
      if (p.provision_type === "permit" && d.verified && !p.names_recipient && !permit) {
        permit = { consentId: d.id, provisionId: p.id };
      }
    }
  }
  if (permit) return { decision: "permit", accessClass: cls, ...permit, reason: "consent_permit_provision" };
  return {
    decision: "deny",
    accessClass: cls,
    reason: sawWithdrawn ? "consent_withdrawn" : sawExpired ? "consent_expired" : "no_consent_permit",
  };
}

/** Validate what the database function returned; anything malformed is dropped (fails closed). */
export function parseDirectives(raw: unknown): ConsentDirective[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const out: ConsentDirective[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.id);
    const patient = str(r.patient_id);
    const status = str(r.status);
    const scope = str(r.scope);
    if (!id || !patient || !status || !scope) continue;
    const provisions: ConsentProvision[] = [];
    for (const p of Array.isArray(r.provisions) ? (r.provisions as Record<string, unknown>[]) : []) {
      const pid = str(p?.id);
      const type = str(p?.provision_type);
      if (!pid || (type !== "permit" && type !== "deny")) continue;
      provisions.push({
        id: pid,
        provision_type: type,
        actor_type: str(p.actor_type),
        // Only an explicit false proves the rule names no one.
        names_recipient: p.names_recipient !== false,
        action: str(p.action),
        purpose: str(p.purpose),
        data_class: str(p.data_class),
        resource_type: str(p.resource_type),
        security_label: str(p.security_label),
        effective_from: str(p.effective_from),
        effective_until: str(p.effective_until),
      });
    }
    out.push({
      id,
      patient_id: patient,
      status,
      scope,
      category: str(r.category) ?? "",
      verified: r.verified === true,
      effective_from: str(r.effective_from),
      effective_until: str(r.effective_until),
      withdrawn: r.withdrawn === true,
      withdrawn_at: str(r.withdrawn_at),
      provisions,
    });
  }
  return out;
}
