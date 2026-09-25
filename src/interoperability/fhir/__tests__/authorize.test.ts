// @vitest-environment node
//
// authorizeFhirRequest(): the twelve steps in order, the first refusal
// winning, and the restrictions it hands to the resource modules.

import { describe, expect, it } from "vitest";
import { authorizeFhirRequest, type Actor, type AuthorizeDeps, type FhirAuthorizationRequest } from "../authorization/authorize";
import type { ConsentDirective } from "../consent/evaluateConsent";

const NOW = new Date("2026-09-25T12:00:00Z");
const A = "01HZZPATIENTA0000000000000";
const B = "01HZZPATIENTB0000000000000";

const staff = (role: string, permissions: string[]): Actor => ({
  userId: "u-staff",
  kind: "staff",
  role,
  permissions: new Set(permissions),
  patientIds: new Set(),
});
const doctor = staff("doctor", ["consult", "lab_review", "vitals", "register"]);
const nurse = staff("nurse", ["vitals", "register", "portal_manage"]);
const labOnly = staff("lab", ["lab_review"]);
const patientA: Actor = { userId: "u-a", kind: "patient", role: null, permissions: new Set(), patientIds: new Set([A]) };

const config = { enabled: true, readEnabled: true, patientAccessEnabled: true, consentEnforcementEnabled: true };
const deps = (over: Partial<AuthorizeDeps> = {}): AuthorizeDeps => ({ config, now: NOW, ...over });
const req = (over: Partial<FhirAuthorizationRequest>): FhirAuthorizationRequest => ({
  actor: doctor,
  client: null,
  interaction: "search",
  resourceType: "Observation",
  purposeOfUse: "TREAT",
  ...over,
});

describe("order of the steps", () => {
  it("1 enabled: nothing is decided while reads are off", async () => {
    const d = await authorizeFhirRequest(req({}), deps({ config: { ...config, readEnabled: false } }));
    expect(d).toMatchObject({ allowed: false, step: "enabled", status: 404 });
  });

  it("2 authenticated: no actor is a 401", async () => {
    expect(await authorizeFhirRequest(req({ actor: null }), deps())).toMatchObject({ allowed: false, step: "authenticated", status: 401 });
  });

  it("3 active: an account that is neither staff nor a linked patient gets nothing", async () => {
    const none: Actor = { userId: "u", kind: "none", role: null, permissions: new Set(["consult"]), patientIds: new Set([A]) };
    expect(await authorizeFhirRequest(req({ actor: none }), deps())).toMatchObject({ step: "active", reason: "no_active_account" });
    const unlinked: Actor = { ...patientA, patientIds: new Set() };
    expect(await authorizeFhirRequest(req({ actor: unlinked }), deps())).toMatchObject({ step: "active", reason: "no_linked_record" });
  });

  it("4 surface: external clients and SMART scopes are refused (default-deny)", async () => {
    const client = { clientId: "partner", kind: "external-system" as const };
    expect(await authorizeFhirRequest(req({ client }), deps())).toMatchObject({ step: "surface", reason: "external_access_disabled" });
    expect(await authorizeFhirRequest(req({ requestedScopes: ["patient/*.read"] }), deps())).toMatchObject({
      step: "surface",
      reason: "smart_not_enabled",
    });
  });

  it("4 surface: patients only when patient access is on, and each kind of account only its own purpose", async () => {
    const off = deps({ config: { ...config, patientAccessEnabled: false } });
    expect(await authorizeFhirRequest(req({ actor: patientA, purposeOfUse: "PATRQT" }), off)).toMatchObject({
      reason: "patient_access_disabled",
    });
    expect(await authorizeFhirRequest(req({ actor: patientA, purposeOfUse: "TREAT" }), deps())).toMatchObject({
      reason: "purpose_not_supported",
    });
    expect(await authorizeFhirRequest(req({ purposeOfUse: "PATRQT" }), deps())).toMatchObject({ reason: "purpose_not_supported" });
    expect(await authorizeFhirRequest(req({ purposeOfUse: "ETREAT" }), deps())).toMatchObject({ reason: "break_glass_not_enabled" });
    expect(await authorizeFhirRequest(req({ purposeOfUse: null }), deps())).toMatchObject({ reason: "purpose_invalid" });
  });

  it("5 permission: staff by mBHR permission, patients only for the types the portal shows", async () => {
    expect(await authorizeFhirRequest(req({ actor: nurse, resourceType: "Condition" }), deps())).toMatchObject({
      step: "permission",
      reason: "missing_permission",
    });
    expect(
      await authorizeFhirRequest(req({ actor: patientA, purposeOfUse: "PATRQT", resourceType: "Condition", patientIds: [A] }), deps()),
    ).toMatchObject({ step: "permission", reason: "not_available_to_patients" });
    expect(
      await authorizeFhirRequest(req({ actor: patientA, purposeOfUse: "PATRQT", resourceType: "AuditEvent" }), deps()),
    ).toMatchObject({ reason: "not_available_to_patients" });
  });

  it("6 organisation: a request naming an organisation scope is refused rather than ignored", async () => {
    expect(await authorizeFhirRequest(req({ organizationId: "org-1" }), deps())).toMatchObject({
      step: "organization",
      reason: "organization_scope_not_supported",
    });
  });

  it("7 patient context: a patient may name only their own record", async () => {
    const p = (patientIds: string[] | null | undefined) =>
      authorizeFhirRequest(req({ actor: patientA, purposeOfUse: "PATRQT", patientIds }), deps());
    expect((await p([A])).allowed).toBe(true);
    expect(await p([B])).toMatchObject({ allowed: false, step: "patient_context", reason: "patient_not_in_context" });
    expect(await p([A, B])).toMatchObject({ allowed: false, reason: "patient_not_in_context" });
    // Named a patient that could not be resolved (unknown, or hidden by row-level security).
    expect(await p(null)).toMatchObject({ allowed: false, reason: "patient_not_in_context" });
    // Named none: allowed, confined to their own records by the query itself.
    expect(await p(undefined)).toMatchObject({ allowed: true });
    expect((await p(undefined)).restrictions).toContain("patient_scope");
  });
});

describe("restrictions handed to the modules", () => {
  it("records what is not enforced and what is checked after the read", async () => {
    const d = await authorizeFhirRequest(req({}), deps());
    expect(d.allowed).toBe(true);
    expect(d.restrictions).toEqual(expect.arrayContaining(["org_scope_not_applied", "owner_check_after_read", "no_security_labels"]));
  });

  it("keeps laboratory rows away from staff without lab permissions", async () => {
    expect((await authorizeFhirRequest(req({ actor: nurse }), deps())).restrictions).toContain("no_lab_rows");
    expect((await authorizeFhirRequest(req({ actor: doctor }), deps())).restrictions).not.toContain("no_lab_rows");
  });

  it("limits Provenance to laboratory events without audit_access", async () => {
    const d = await authorizeFhirRequest(req({ actor: labOnly, resourceType: "Provenance" }), deps());
    expect(d.allowed).toBe(true);
    expect(d.restrictions).toContain("lab_events_only");
  });

  it("gives a patient the portal's own limits per type", async () => {
    const r = async (resourceType: FhirAuthorizationRequest["resourceType"]) =>
      (await authorizeFhirRequest(req({ actor: patientA, purposeOfUse: "PATRQT", resourceType, patientIds: [A] }), deps())).restrictions;
    expect(await r("Encounter")).toContain("closed_encounters_only");
    expect(await r("Observation")).toContain("portal_visible_only");
    expect(await r("DiagnosticReport")).toContain("released_results_only");
    expect(await r("MedicationDispense")).toContain("portal_visible_only");
    expect(await r("DocumentReference")).toContain("own_documents_only");
    expect(await r("Binary")).toContain("patient_uploads_only");
    expect(await r("Consent")).toContain("own_consents_only");
  });
});

describe("consent step", () => {
  it("is not applicable to internal treatment and patient self-access, so directives are not even loaded", async () => {
    let loaded = 0;
    const loadDirectives = async () => {
      loaded++;
      return [];
    };
    const d = await authorizeFhirRequest(req({ patientIds: [A] }), deps({ loadDirectives }));
    expect(d.consent).toMatchObject({ decision: "not-applicable", reason: "internal_treatment" });
    const p = await authorizeFhirRequest(req({ actor: patientA, purposeOfUse: "PATRQT", patientIds: [A] }), deps({ loadDirectives }));
    expect(p.consent).toMatchObject({ decision: "not-applicable", reason: "patient_self_access" });
    expect(loaded).toBe(0);
  });

  it("would need an explicit permit for a governed purpose, and a named patient", async () => {
    // Staff research access is refused at the surface step already (purpose
    // not supported); the consent engine below it is default-deny as well.
    const d = await authorizeFhirRequest(req({ purposeOfUse: "HRESCH", patientIds: [A] }), deps());
    expect(d).toMatchObject({ allowed: false, step: "surface" });
  });

  it("evaluates each named patient for a governed access (engine level)", async () => {
    // Simulate a future surface that allows a governed purpose, by calling
    // the engine the way step 10 does: a withdrawn directive denies.
    const withdrawn: ConsentDirective = {
      id: "c1",
      patient_id: A,
      status: "active",
      scope: "research",
      category: "research",
      verified: true,
      effective_from: null,
      effective_until: null,
      withdrawn: true,
      withdrawn_at: "2026-09-01T00:00:00Z",
      provisions: [],
    };
    const { evaluateConsent } = await import("../consent/evaluateConsent");
    const r = evaluateConsent(
      {
        patientId: A,
        actor: { kind: "staff", role: "doctor" },
        clientId: null,
        organizationId: null,
        resourceType: "Observation",
        action: "access",
        purposeOfUse: "HRESCH",
        timestamp: NOW,
      },
      [withdrawn],
      { enforcementEnabled: true },
    );
    expect(r).toMatchObject({ decision: "deny", reason: "consent_withdrawn" });
  });
});
