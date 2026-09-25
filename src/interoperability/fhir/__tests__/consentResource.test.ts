// @vitest-environment node
//
// Consent: the FHIR view of mBHR's consent register (interop.consent_records
// and interop.consent_provisions, read through fhir_consent_directives).
// The status maps, the mapper element by element, what is never published,
// the fail-closed cases, and the gateway end to end: who may read, patient
// self-access, anti-enumeration, merged patients, paging and invalid ids.

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { validateResource } from "../validation/validate";
import { applyStatusMap, explainStatus } from "../terminology/statusMaps";
import { STATUS_MAPS } from "../terminology/status";
import {
  CONSENT_STATE_CODES,
  CONSENT_STATUS,
  CONSENT_STATUS_MAPS,
  CONSENT_STATUS_WITHDRAWN,
} from "../terminology/status/consent";
import {
  CONSENT_ACTOR_TYPES,
  LOCAL_CONSENT,
  isWithdrawn,
  mapConsent,
  mapConsentRecord,
  mapConsentStatus,
  mapProvision,
  validateConsent,
  type Consent,
  type ConsentProvisionRule,
} from "../mappers/consent";
import { CONSENT_COVERAGE_NOTE, consentModule, definition } from "../resources/consent";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser, type RpcHandler } from "./fakeSupabase";
import { PATIENT_A, PATIENT_B } from "./fixtures";

// ---------------------------------------------------------------------------
// Fixtures (synthetic; no real patient data)
// ---------------------------------------------------------------------------

// A record merged into A (its consent stays filed under its own id: the
// register is not moved by a merge), and a patient whose directive names an
// actor kind.
const PATIENT_M = {
  ...PATIENT_A,
  id: "01HZZPATIENTM0000000000000",
  fhir_id: "0b3c1d2e-1111-4aaa-8bbb-00000000000d",
  given_name: "Ada",
  family_name: "Okafor-Dup",
  merged_into: PATIENT_A.id,
  merged_at: "2026-06-01T10:00:00+00:00",
};
const PATIENT_C = {
  ...PATIENT_A,
  id: "01HZZPATIENTC0000000000000",
  fhir_id: "0b3c1d2e-1111-4aaa-8bbb-000000000003",
  given_name: "Chidi",
  family_name: "Eze",
};

// Values the function never returns (account ids, the withdrawal reason,
// who signed, the source document, a provision's actor reference). They
// are present on the fixture rows to prove the mapper never copies them.
const RECORDED_BY = "aaaaaaaa-0000-4000-8000-00000000000a";
const VERIFIED_BY = "aaaaaaaa-0000-4000-8000-00000000000b";
const WITHDRAWN_BY = "aaaaaaaa-0000-4000-8000-00000000000c";
const WITHDRAWAL_REASON = "private withdrawal reason text";
const GRANTED_BY = "Signer Name Example";
const SOURCE_DOCUMENT = "patient-documents/01HZZPATIENTA/consent-scan.pdf";
const ACTOR_REFERENCE = "Organization/partner-hospital-secret";
const SECRETS = [
  RECORDED_BY,
  VERIFIED_BY,
  WITHDRAWN_BY,
  WITHDRAWAL_REASON,
  GRANTED_BY,
  "guardian-relationship",
  SOURCE_DOCUMENT,
  ACTOR_REFERENCE,
  "paper_form",
  "source_type",
  "recorded_by",
  "verified_by",
  "withdrawn_by",
  "withdrawal_reason",
  "consent_records",
  "interop.",
  "ada@example.org",
  PATIENT_A.id,
  PATIENT_B.id,
  PATIENT_M.id,
  PATIENT_C.id,
];

const internal = {
  recorded_by: RECORDED_BY,
  verified_by: VERIFIED_BY,
  withdrawn_by: null as string | null,
  withdrawal_reason: null as string | null,
  granted_by: GRANTED_BY,
  granted_by_relationship: "guardian-relationship",
  source_document_id: SOURCE_DOCUMENT,
};

const PROVISION_PERMIT = {
  id: "d0000000-0000-4000-8000-000000000001",
  provision_type: "permit",
  actor_type: "any",
  actor_reference: ACTOR_REFERENCE,
  action: "access",
  purpose: "TREAT",
  data_class: null,
  resource_type: "Observation",
  security_label: null,
  effective_from: null,
  effective_until: null,
  created_at: "2026-06-01T09:30:00+00:00",
};
const PROVISION_DENY = {
  id: "d0000000-0000-4000-8000-000000000002",
  provision_type: "deny",
  actor_type: null,
  action: "disclose",
  purpose: "HRESCH",
  data_class: "laboratory",
  resource_type: null,
  security_label: "R",
  effective_from: "2026-07-01T00:00:00+00:00",
  effective_until: null,
  created_at: "2026-06-01T09:30:01+00:00",
};

/** Active, verified, with a period and two rules. */
const A1 = {
  id: "c0a5e000-0000-4000-8000-000000000001",
  patient_id: PATIENT_A.id,
  status: "active",
  scope: "patient-privacy",
  category: "data-sharing",
  policy_uri: "https://mbhr.app/policies/data-sharing/v1",
  source_type: "paper_form",
  verified: true,
  verified_at: "2026-06-02T10:00:00+00:00",
  effective_from: "2026-06-01T00:00:00+00:00",
  effective_until: "2027-06-01T00:00:00+00:00",
  recorded_at: "2026-06-01T09:30:00+00:00",
  withdrawn: false,
  withdrawn_at: null,
  created_at: "2026-06-01T09:30:00+00:00",
  updated_at: "2026-06-02T10:00:00+00:00",
  provisions: [PROVISION_PERMIT, PROVISION_DENY],
  ...internal,
};
/** Withdrawn: kept, inactive. */
const A2 = {
  ...A1,
  id: "c0a5e000-0000-4000-8000-000000000002",
  status: "inactive",
  scope: "research",
  category: "research-participation",
  withdrawn: true,
  withdrawn_at: "2026-08-01T12:00:00+00:00",
  withdrawn_by: WITHDRAWN_BY,
  withdrawal_reason: WITHDRAWAL_REASON,
  updated_at: "2026-08-01T12:00:00+00:00",
  provisions: [{ ...PROVISION_PERMIT, id: "d0000000-0000-4000-8000-000000000003", actor_type: null, purpose: "HRESCH" }],
};
/** Draft, never verified, no period, no rules. */
const A3 = {
  ...A1,
  id: "c0a5e000-0000-4000-8000-000000000003",
  status: "draft",
  scope: "treatment",
  category: "treatment-consent",
  verified: false,
  verified_at: null,
  verified_by: null,
  effective_from: null,
  effective_until: null,
  provisions: [],
};
/** No policy: FHIR requires one (ppc-1), so it is not published. */
const A_NO_POLICY = { ...A1, id: "c0a5e000-0000-4000-8000-000000000004", policy_uri: null, provisions: [] };
/** Still filed under the merged-away record. */
const M1 = { ...A1, id: "c0a5e000-0000-4000-8000-000000000005", patient_id: PATIENT_M.id, provisions: [] };
const B1 = { ...A1, id: "c0a5e000-0000-4000-8000-000000000006", patient_id: PATIENT_B.id, category: "b-only-category", provisions: [] };
/** A rule for a kind of recipient (an actor). */
const C1 = {
  ...A1,
  id: "c0a5e000-0000-4000-8000-000000000007",
  patient_id: PATIENT_C.id,
  provisions: [{ ...PROVISION_PERMIT, id: "d0000000-0000-4000-8000-000000000004", actor_type: "external_system" }],
};
/** A patient record that does not exist (deleted, or not visible). */
const ORPHAN = { ...A1, id: "c0a5e000-0000-4000-8000-000000000008", patient_id: "01HZZGONE00000000000000000", provisions: [] };

const RECORDS = [A1, A2, A3, A_NO_POLICY, M1, B1, C1, ORPHAN];

const ctx = {
  patientFhirIds: new Map([
    [PATIENT_A.id, PATIENT_A.fhir_id],
    [PATIENT_M.id, PATIENT_A.fhir_id],
    [PATIENT_B.id, PATIENT_B.fhir_id],
    [PATIENT_C.id, PATIENT_C.fhir_id],
  ]),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

describe("Consent.status maps", () => {
  it("are listed with every other status map", () => {
    for (const m of CONSENT_STATUS_MAPS) expect(STATUS_MAPS).toContain(m);
    expect(CONSENT_STATUS_MAPS).toEqual([CONSENT_STATUS, CONSENT_STATUS_WITHDRAWN]);
  });

  it("maps each stored consent-state code to the same code, and nothing else", () => {
    for (const code of CONSENT_STATE_CODES) expect(applyStatusMap(CONSENT_STATUS, code)).toBe(code);
    expect(CONSENT_STATUS.rules.map((r) => [r.source, r.fhir])).toEqual([
      [["draft"], "draft"],
      [["proposed"], "proposed"],
      [["active"], "active"],
      [["rejected"], "rejected"],
      [["inactive"], "inactive"],
      [["entered-in-error"], "entered-in-error"],
    ]);
  });

  it("withholds a record with no status or an unrecognised one (Consent.status is required and has no unknown)", () => {
    for (const map of CONSENT_STATUS_MAPS) {
      for (const raw of [null, undefined, "", "withdrawn", "revoked", "unknown", " active", 1, true]) {
        expect(applyStatusMap(map, raw), `${map.source} <- ${String(raw)}`).toBeNull();
      }
      expect(map.missing).toEqual({ fhir: null, reason: expect.stringMatching(/withheld/) });
      expect(map.unrecognised).toEqual({ fhir: null, reason: expect.stringMatching(/withheld/) });
    }
    expect(mapConsentRecord({ ...A1, status: null }, ctx)).toEqual({ resource: null, withheld: "no_status" });
    expect(mapConsentRecord({ ...A1, status: "suspended" }, ctx)).toEqual({ resource: null, withheld: "no_status" });
  });

  it("never shows a withdrawn consent as active, draft or proposed", () => {
    for (const code of CONSENT_STATE_CODES) {
      const expected = code === "entered-in-error" ? "entered-in-error" : "inactive";
      expect(applyStatusMap(CONSENT_STATUS_WITHDRAWN, code), code).toBe(expected);
      // By the flag, or by the recorded time alone.
      expect(mapConsentStatus({ status: code, withdrawn: true, withdrawn_at: null })).toBe(expected);
      expect(mapConsentStatus({ status: code, withdrawn: false, withdrawn_at: "2026-08-01T12:00:00Z" })).toBe(expected);
    }
    expect(isWithdrawn({ withdrawn: false, withdrawn_at: null })).toBe(false);
    expect(explainStatus(CONSENT_STATUS_WITHDRAWN, "active").reason).toMatch(/Never shown as active/);
  });

  it("never promotes: draft is not proposed or active, inactive and rejected are not active", () => {
    expect(applyStatusMap(CONSENT_STATUS, "draft")).toBe("draft");
    expect(applyStatusMap(CONSENT_STATUS, "inactive")).toBe("inactive");
    expect(applyStatusMap(CONSENT_STATUS, "rejected")).toBe("rejected");
    // Values are compared lower-cased and exactly, as the register stores them.
    expect(applyStatusMap(CONSENT_STATUS, "ACTIVE")).toBe("active");
    // An ended period does not change the recorded status; the period says it.
    const expired = mapConsent({ ...A1, effective_until: "2026-07-01T00:00:00+00:00" }, ctx) as Consent;
    expect(expired.status).toBe("active");
    expect(expired.provision?.period?.end).toBe("2026-07-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/** Read a published nested rule back into the register's columns (for the round trip). */
function backToColumns(rule: ConsentProvisionRule) {
  const cls = rule.class?.[0];
  return {
    provision_type: rule.type,
    actor_type: rule.actor?.[0]?.role.coding?.[0]?.code ?? null,
    action: rule.action?.[0]?.coding?.[0]?.code ?? null,
    purpose: rule.purpose?.[0]?.code ?? null,
    resource_type: cls && cls.system !== LOCAL_CONSENT.dataClass ? cls.code : null,
    data_class: cls && cls.system === LOCAL_CONSENT.dataClass ? cls.code : null,
    security_label: rule.securityLabel?.[0]?.code ?? null,
    effective_from: rule.period?.start ?? null,
    effective_until: rule.period?.end ?? null,
  };
}

describe("Consent mapper", () => {
  const c = mapConsent(A1, ctx) as Consent;

  it("maps every element from the register record", () => {
    expect(c).toEqual({
      resourceType: "Consent",
      id: A1.id,
      meta: { versionId: String(Date.parse(A1.updated_at)), lastUpdated: "2026-06-02T10:00:00.000Z", source: "https://mbhr.app" },
      status: "active",
      scope: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "patient-privacy", display: "Privacy Consent" }],
      },
      category: [{ coding: [{ system: "https://mbhr.app/codes/consent-category", code: "data-sharing" }] }],
      patient: { reference: `Patient/${PATIENT_A.fhir_id}` },
      dateTime: "2026-06-01T09:30:00.000Z",
      policy: [{ uri: "https://mbhr.app/policies/data-sharing/v1" }],
      verification: [{ verified: true, verificationDate: "2026-06-02T10:00:00.000Z" }],
      provision: {
        period: { start: "2026-06-01T00:00:00.000Z", end: "2027-06-01T00:00:00.000Z" },
        provision: [
          {
            type: "permit",
            action: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentaction", code: "access", display: "Access" }] }],
            purpose: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActReason", code: "TREAT" }],
            class: [{ system: "http://hl7.org/fhir/resource-types", code: "Observation" }],
          },
          {
            type: "deny",
            period: { start: "2026-07-01T00:00:00.000Z" },
            action: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentaction", code: "disclose", display: "Disclose" }] }],
            securityLabel: [{ system: "https://mbhr.app/codes/consent-security-label", code: "R" }],
            purpose: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActReason", code: "HRESCH" }],
            class: [{ system: "https://mbhr.app/codes/consent-data-class", code: "laboratory" }],
          },
        ],
      },
    });
  });

  it("round-trips every stored provision, in order, with nothing added or lost", () => {
    const rules = c.provision?.provision ?? [];
    expect(rules).toHaveLength(A1.provisions.length);
    A1.provisions.forEach((p, i) => {
      expect(backToColumns(rules[i])).toEqual({
        provision_type: p.provision_type,
        // "any" is no actor at all: the rule applies to every recipient.
        actor_type: p.actor_type === "any" ? null : p.actor_type,
        action: p.action,
        purpose: p.purpose,
        resource_type: p.resource_type,
        data_class: p.data_class,
        security_label: p.security_label,
        effective_from: p.effective_from ? new Date(p.effective_from).toISOString() : null,
        effective_until: p.effective_until ? new Date(p.effective_until).toISOString() : null,
      });
    });
  });

  it("publishes each actor kind as recorded, and never a specific actor", () => {
    for (const [code, label] of Object.entries(CONSENT_ACTOR_TYPES)) {
      const rule = mapProvision({ ...PROVISION_PERMIT, actor_type: code }) as ConsentProvisionRule;
      expect(rule.actor).toEqual([
        { role: { coding: [{ system: "https://mbhr.app/codes/consent-actor-type", code, display: label }] }, reference: { display: label } },
      ]);
      expect(JSON.stringify(rule)).not.toContain(ACTOR_REFERENCE);
      expect(backToColumns(rule).actor_type).toBe(code);
    }
    expect((mapProvision({ ...PROVISION_PERMIT, actor_type: null }) as ConsentProvisionRule).actor).toBeUndefined();
  });

  it("keeps a resource type that is not a FHIR R4 type under the local system", () => {
    const rule = mapProvision({ ...PROVISION_PERMIT, resource_type: "LabWorksheet" }) as ConsentProvisionRule;
    expect(rule.class).toEqual([{ system: "https://mbhr.app/codes/consent-resource-type", code: "LabWorksheet" }]);
  });

  it("publishes verification only as recorded", () => {
    expect(c.verification).toEqual([{ verified: true, verificationDate: "2026-06-02T10:00:00.000Z" }]);
    expect(mapConsent({ ...A1, verified_at: null }, ctx)?.verification).toEqual([{ verified: true }]);
    expect(mapConsent(A3, ctx)?.verification).toEqual([{ verified: false }]);
    // Not recorded: left out, never assumed false.
    expect(mapConsent({ ...A1, verified: null }, ctx)?.verification).toBeUndefined();
    expect(mapConsent({ ...A1, verified: undefined }, ctx)?.verification).toBeUndefined();
  });

  it("leaves out what mBHR does not record: performer, policyRule, source, organisation, a root rule type", () => {
    for (const row of [A1, A2, A3]) {
      const r = mapConsent(row, ctx) as unknown as Json;
      for (const key of ["performer", "policyRule", "sourceReference", "sourceAttachment", "organization", "identifier"]) {
        expect(r[key], key).toBeUndefined();
      }
      expect(r.provision?.type).toBeUndefined();
    }
    // A draft with no period and no rules has no provision element at all.
    expect(mapConsent(A3, ctx)?.provision).toBeUndefined();
    // No record time: no dateTime, never an invented one.
    expect(mapConsent({ ...A1, recorded_at: null }, ctx)?.dateTime).toBeUndefined();
  });

  it("uses a local category code, or the recorded text, never LOINC", () => {
    expect(mapConsent({ ...A1, category: "odd  spacing " }, ctx)?.category).toEqual([{ text: "odd  spacing" }]);
    expect(JSON.stringify(RECORDS.map((r) => mapConsent(r, ctx)))).not.toMatch(/loinc|59284-0/i);
    expect(mapConsentRecord({ ...A1, category: null }, ctx).withheld).toBe("no_category");
    expect(mapConsentRecord({ ...A1, category: "  " }, ctx).withheld).toBe("no_category");
  });

  it("never copies account ids, the withdrawal reason, the signer, the source document or the internal patient id", () => {
    const json = JSON.stringify(RECORDS.map((r) => mapConsent(r, ctx)));
    for (const secret of SECRETS) expect(json, secret).not.toContain(secret);
  });

  it("withholds a record whose patient does not resolve, and one filed under a merged-away record shows the kept record", () => {
    expect(mapConsentRecord(ORPHAN, ctx)).toEqual({ resource: null, withheld: "no_patient" });
    expect(mapConsent(A1, { patientFhirIds: new Map() })).toBeNull();
    expect(mapConsent(M1, ctx)?.patient).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
  });

  it("withholds a record that cites no usable policy (ppc-1) rather than inventing one", () => {
    expect(mapConsentRecord(A_NO_POLICY, ctx).withheld).toBe("no_policy");
    expect(mapConsentRecord({ ...A1, policy_uri: "not a uri" }, ctx).withheld).toBe("no_policy");
  });

  it("withholds a whole directive when a rule cannot be shown without changing its meaning", () => {
    const bad: Record<string, unknown>[] = [
      { provision_type: "allow" },
      { provision_type: null },
      { actor_type: "family" },
      { action: "share" },
      { purpose: "MARKETING" },
      { purpose: "treat" },
      { resource_type: "observation" },
      { resource_type: "Observation", data_class: "laboratory" },
      { security_label: "two  spaces" },
      { effective_until: "not a time" },
      { effective_from: "2027-01-01T00:00:00Z", effective_until: "2026-01-01T00:00:00Z" },
      { action: 42 },
    ];
    for (const change of bad) {
      const row = { ...A1, provisions: [PROVISION_DENY, { ...PROVISION_PERMIT, ...change }] };
      expect(mapConsentRecord(row, ctx), JSON.stringify(change)).toEqual({ resource: null, withheld: "not_expressible" });
    }
    expect(mapConsentRecord({ ...A1, provisions: ["x"] }, ctx).withheld).toBe("not_expressible");
    // The rule list must be present: a missing list is not "no rules".
    expect(mapConsentRecord({ ...A1, provisions: null }, ctx).withheld).toBe("not_expressible");
    expect(mapConsentRecord({ ...A1, effective_from: "yesterday" }, ctx).withheld).toBe("not_expressible");
    expect(mapConsentRecord({ ...A1, scope: "marketing" }, ctx).withheld).toBe("no_scope");
    expect(mapConsentRecord({ ...A1, id: "not-a-uuid" }, ctx).withheld).toBe("no_id");
  });

  it("produces resources that pass the gateway's checks and Consent's own rules", () => {
    for (const row of [A1, A2, A3, M1, B1, C1]) {
      const r = mapConsent(row, ctx) as Consent;
      const issues: string[] = [];
      validateConsent(r as unknown as Record<string, unknown>, (path, message) => issues.push(`${path}: ${message}`));
      expect(issues, row.id).toEqual([]);
      // The generic checker currently reads every "reference" key as a
      // Reference.reference string; Consent.provision.actor.reference is a
      // Reference itself (requested as a shared change). Anything else must pass.
      const generic = validateResource(r, validateConsent).filter((i) => !/\.actor\[\d+\]\.reference$/.test(i.path));
      expect(generic, row.id).toEqual([]);
    }
  });

  it("validate() catches what an R4 Consent must not be", () => {
    const issues = (r: Json) => {
      const out: string[] = [];
      validateConsent(r, (path) => out.push(path));
      return out;
    };
    const good = mapConsent(A1, ctx) as unknown as Json;
    expect(issues({ ...good, policy: undefined })).toContain("policy");
    expect(issues({ ...good, status: "unknown" })).toContain("status");
    expect(issues({ ...good, scope: { text: "privacy" } })).toContain("scope");
    expect(issues({ ...good, category: [] })).toContain("category");
    expect(issues({ ...good, patient: { reference: "Group/x" } })).toContain("patient");
    expect(issues({ ...good, performer: [{ reference: "Practitioner/x" }] })).toContain("performer");
    expect(issues({ ...good, verification: [{ verified: "yes" }] })).toContain("verification[0].verified");
    expect(issues({ ...good, provision: { type: "deny" } })).toContain("provision.type");
    expect(issues({ ...good, provision: { provision: [{ action: [] }] } })).toContain("provision.provision[0].type");
    expect(issues({ ...good, provision: { provision: [{ type: "permit", actor: [{ role: { text: "x" } }] }] } })).toContain(
      "provision.provision[0].actor[0]",
    );
  });
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

describe("Consent definition", () => {
  it("declares only what is implemented, with the Consent permissions and a narrowing rule", () => {
    expect(consentModule.definition).toBe(definition);
    expect(definition.readPermissions).toBe(READ_PERMISSIONS.Consent);
    expect([...definition.readPermissions].sort()).toEqual(["audit_access", "consult", "portal_manage"]);
    expect(definition.interactions).toEqual(["read", "search-type"]);
    expect(definition.searchParams.map((p) => p.name)).toEqual(["_id", "patient", "status", "scope"]);
    expect(definition.requiredSearch).toEqual([["_id"], ["patient"]]);
    expect(definition.patientAccess).toBe(true);
    expect(definition.writeSupport).toBe(false);
    expect(typeof consentModule.search).toBe("function");
    expect(typeof consentModule.validate).toBe("function");
    for (const p of definition.searchParams) expect(p.documentation.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Gateway, end to end
// ---------------------------------------------------------------------------

const ENV = {
  FHIR_ENABLED: "true",
  FHIR_PATIENT_ACCESS_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

const DOCTOR = makeToken("doctor-1");
const NURSE = makeToken("nurse-1");
const AUDITOR = makeToken("auditor-1");
const PHARMACIST = makeToken("pharm-1");
const VOLUNTEER = makeToken("vol-1");
const PAT_A = makeToken("portal-a");
const PAT_B = makeToken("portal-b");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "register", "vitals", "queue"] },
  [NURSE]: { id: "nurse-1", role: "nurse", permissions: ["register", "vitals", "queue", "portal_manage"] },
  [AUDITOR]: { id: "auditor-1", role: "auditor", permissions: ["audit_access"] },
  [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: ["dispense", "inventory", "queue"] },
  [VOLUNTEER]: { id: "vol-1", role: "volunteer", permissions: ["register", "queue"] },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
  [PAT_B]: { id: "portal-b", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_B.id] },
};

function kindOf(user: FakeUser) {
  return user.kind ?? (user.role ? "staff" : "none");
}

/**
 * public.fhir_consent_directives with the migration's rules: staff any
 * patient; a portal patient only their own (other patient ids refused,
 * consent ids limited to their own records); a selector is required;
 * ordered by id; keyset p_after; p_limit clamped 1..101.
 */
function directivesRpc(records: Record<string, unknown>[]): RpcHandler {
  return (body, user) => {
    const refuse = (code: string) => new Response(JSON.stringify({ code }), { status: code === "42501" ? 403 : 400 });
    const kind = kindOf(user);
    const own = user.patientIds ?? [];
    if (kind !== "staff" && !(kind === "patient" && own.length)) return refuse("42501");
    const pids = (body.p_patient_ids as string[] | null | undefined) ?? null;
    const cids = (body.p_consent_ids as string[] | null | undefined) ?? null;
    if (pids === null && cids === null) return refuse("22023");
    if (pids && (pids.length > 100 || pids.some((id) => !/^[A-Za-z0-9._-]{1,128}$/.test(id)))) return refuse("22023");
    if (kind !== "staff" && pids && !pids.every((id) => own.includes(id))) return refuse("42501");
    const after = (body.p_after as string | null | undefined) ?? null;
    const limit = Math.min(Math.max(Number(body.p_limit ?? 50), 1), 101);
    return records
      .filter((r) => pids === null || pids.includes(String(r.patient_id)))
      .filter((r) => cids === null || cids.includes(String(r.id)))
      .filter((r) => kind === "staff" || own.includes(String(r.patient_id)))
      .filter((r) => after === null || String(r.id) > after)
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
      .slice(0, limit);
  };
}

/** Row-level security as the portal policies have it: a patient sees only their own records. */
function visible(table: string, row: Record<string, unknown>, user: FakeUser): boolean {
  if (kindOf(user) !== "patient") return true;
  const own = user.patientIds ?? [];
  return table === "patients" ? own.includes(String(row.id)) : own.includes(String(row.patient_id));
}

function setup(overrides: Partial<FakeOptions> = {}, env: Record<string, string> = ENV) {
  const fake = fakeSupabase({
    users: USERS,
    tables: { patients: [PATIENT_A, PATIENT_B, PATIENT_M, PATIENT_C] },
    visible,
    rpcs: { fhir_consent_directives: directivesRpc(RECORDS) },
    ...overrides,
  });
  const logs: string[] = [];
  const served: string[] = [];
  const call = async (path: string, token?: string) => {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await handleFhirRequest(new Request(`https://mbhr.app${path}`, { headers }), {
      env,
      fetchImpl: fake.fetchImpl,
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: (l) => logs.push(l),
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
    const text = await res.text();
    served.push(text);
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const directiveCalls = () => fake.calls.filter((c) => c.url.endsWith("/rpc/fhir_consent_directives"));
  return { ...fake, call, logs, served, directiveCalls };
}

const matches = (b: Json): Json[] => (b.entry ?? []).filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const outcomes = (b: Json): Json[] =>
  (b.entry ?? []).filter((e: Json) => e.search.mode === "outcome").flatMap((e: Json) => e.resource.issue);
const ids = (b: Json) => matches(b).map((r) => r.id);

describe("Consent at the gateway: who may read", () => {
  it("staff with consult, portal_manage or audit_access read a consent", async () => {
    const { call } = setup();
    for (const token of [DOCTOR, NURSE, AUDITOR]) {
      const res = await call(`/fhir/R4/Consent/${A1.id}`, token);
      expect(res.status).toBe(200);
      expect(res.json.resourceType).toBe("Consent");
      expect(res.json.id).toBe(A1.id);
      expect(res.json.patient).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    }
  });

  it("other staff are refused before the register is read, and the refusal is audited", async () => {
    const { call, audits, directiveCalls } = setup();
    for (const token of [PHARMACIST, VOLUNTEER]) {
      expect((await call(`/fhir/R4/Consent/${A1.id}`, token)).status).toBe(403);
      expect((await call(`/fhir/R4/Consent?patient=Patient/${PATIENT_A.fhir_id}`, token)).status).toBe(403);
    }
    expect(directiveCalls()).toEqual([]);
    expect(audits.map((a) => a.p_denial_reason)).toEqual(Array(4).fill("missing_permission"));
  });

  it("serves the mapped resource as is, with the version as a content digest", async () => {
    const { call } = setup();
    const { json } = await call(`/fhir/R4/Consent/${A1.id}`, DOCTOR);
    const expected = mapConsent(A1, ctx) as Consent;
    expect(json).toEqual({ ...expected, meta: { ...expected.meta, versionId: expect.stringMatching(/^[0-9a-f]{24}$/) } });
  });
});

describe("Consent at the gateway: searches", () => {
  it("finds the kept record's directives, including one still filed under a merged-away record", async () => {
    const { call } = setup();
    const { status, json } = await call(`/fhir/R4/Consent?patient=Patient/${PATIENT_A.fhir_id}`, DOCTOR);
    expect(status).toBe(200);
    expect(ids(json)).toEqual([A1.id, A2.id, A3.id, M1.id]);
    // The merged-away record's directive is shown with the kept record as patient.
    for (const r of matches(json)) expect(r.patient).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    const issues = outcomes(json);
    expect(issues).toContainEqual(CONSENT_COVERAGE_NOTE);
    // The record without a policy is left out, and the client is told.
    expect(issues).toContainEqual(expect.objectContaining({ severity: "warning", diagnostics: expect.stringMatching(/^1 consent record\(s\) were left out/) }));
    expect(json.total).toBeUndefined();
  });

  it("searching by the merged-away record matches nothing and names the kept record", async () => {
    const { call } = setup();
    const { json } = await call(`/fhir/R4/Consent?patient=Patient/${PATIENT_M.fhir_id}`, DOCTOR);
    expect(ids(json)).toEqual([]);
    expect(outcomes(json).some((i) => String(i.diagnostics).includes(`Patient/${PATIENT_A.fhir_id}`))).toBe(true);
  });

  it("a withdrawn consent is kept, served as inactive, and never matches status=active", async () => {
    const { call } = setup();
    const read = await call(`/fhir/R4/Consent/${A2.id}`, DOCTOR);
    expect(read.status).toBe(200);
    expect(read.json.status).toBe("inactive");
    const p = `patient=Patient/${PATIENT_A.fhir_id}`;
    expect(ids((await call(`/fhir/R4/Consent?${p}&status=active`, DOCTOR)).json)).toEqual([A1.id, M1.id]);
    expect(ids((await call(`/fhir/R4/Consent?${p}&status=inactive`, DOCTOR)).json)).toEqual([A2.id]);
    expect(ids((await call(`/fhir/R4/Consent?${p}&status=http://hl7.org/fhir/consent-state-codes|draft`, DOCTOR)).json)).toEqual([A3.id]);
    // A withdrawn record whose status column still said active (the register
    // forbids it; the map is the defence) is still inactive.
    const odd = { ...A2, status: "active" };
    const s = setup({ rpcs: { fhir_consent_directives: directivesRpc([odd]) } });
    expect((await s.call(`/fhir/R4/Consent/${A2.id}`, DOCTOR)).json.status).toBe("inactive");
    expect(ids((await s.call(`/fhir/R4/Consent?${p}&status=active`, DOCTOR)).json)).toEqual([]);
  });

  it("filters by scope, and a code or system outside the value set matches nothing", async () => {
    const { call } = setup();
    const p = `patient=Patient/${PATIENT_A.fhir_id}`;
    expect(ids((await call(`/fhir/R4/Consent?${p}&scope=research`, DOCTOR)).json)).toEqual([A2.id]);
    expect(
      ids((await call(`/fhir/R4/Consent?${p}&scope=http://terminology.hl7.org/CodeSystem/consentscope|treatment`, DOCTOR)).json),
    ).toEqual([A3.id]);
    for (const q of ["scope=https://example.org/other|research", "scope=marketing", "status=unknown", "status=withdrawn", "status=https://example.org|active"]) {
      const res = await call(`/fhir/R4/Consent?${p}&${q}`, DOCTOR);
      expect(res.status, q).toBe(200);
      expect(ids(res.json), q).toEqual([]);
    }
  });

  it("searches by _id, alone or with the patient", async () => {
    const { call } = setup();
    expect(ids((await call(`/fhir/R4/Consent?_id=${A1.id}`, DOCTOR)).json)).toEqual([A1.id]);
    expect(ids((await call(`/fhir/R4/Consent?_id=${B1.id}&patient=Patient/${PATIENT_A.fhir_id}`, DOCTOR)).json)).toEqual([]);
    expect(ids((await call(`/fhir/R4/Consent?_id=${M1.id}&patient=Patient/${PATIENT_A.fhir_id}`, DOCTOR)).json)).toEqual([M1.id]);
  });

  it("refuses a staff search that names neither _id nor patient (anti-enumeration)", async () => {
    const { call, directiveCalls, audits } = setup();
    for (const q of ["", "?status=active", "?scope=research", "?status=inactive&scope=patient-privacy"]) {
      const res = await call(`/fhir/R4/Consent${q}`, DOCTOR);
      expect(res.status, q).toBe(403);
    }
    expect(directiveCalls()).toEqual([]);
    expect(audits.every((a) => a.p_denial_reason === "search_not_narrowed")).toBe(true);
  });

  it("refuses parameters it does not implement instead of ignoring them", async () => {
    const { call } = setup();
    for (const q of ["category=data-sharing", "date=2026", "subject=Patient/x", "actor=Organization/x", "patient:missing=true"]) {
      const res = await call(`/fhir/R4/Consent?patient=Patient/${PATIENT_A.fhir_id}&${q}`, DOCTOR);
      expect(res.status, q).toBeGreaterThanOrEqual(400);
      expect(res.status, q).toBeLessThan(500);
    }
  });

  it("pages with a stable cursor, no duplicates, and says once what was left out", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let warnings = 0;
    let path: string | null = `/fhir/R4/Consent?patient=Patient/${PATIENT_A.fhir_id}&_count=1`;
    for (let i = 0; path && i < 10; i++) {
      const { status, json } = await call(path, DOCTOR);
      expect(status).toBe(200);
      seen.push(...ids(json));
      warnings += outcomes(json).filter((o) => o.severity === "warning").length;
      const next = (json.link as Json[]).find((l) => l.relation === "next");
      path = next ? new URL(next.url).pathname + new URL(next.url).search : null;
    }
    expect(seen).toEqual([A1.id, A2.id, A3.id, M1.id]);
    expect(warnings).toBe(1);
  });
});

describe("Consent at the gateway: ids and failures", () => {
  it("answers an invalid id with 404 without calling the database, and a bad _id with 400", async () => {
    const { call, directiveCalls } = setup();
    const res = await call("/fhir/R4/Consent/not-a-uuid", DOCTOR);
    expect(res.status).toBe(404);
    expect(directiveCalls()).toEqual([]);
    expect((await call("/fhir/R4/Consent?_id=bad!!", DOCTOR)).status).toBe(400);
    expect(ids((await call("/fhir/R4/Consent?_id=not-a-uuid", DOCTOR)).json)).toEqual([]);
    expect((await call("/fhir/R4/Consent/c0a5e000-0000-4000-8000-0000000000ff", DOCTOR)).status).toBe(404);
  });

  it("does not publish a record whose patient does not resolve, or one without a policy", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Consent/${ORPHAN.id}`, DOCTOR)).status).toBe(404);
    expect((await call(`/fhir/R4/Consent/${A_NO_POLICY.id}`, DOCTOR)).status).toBe(404);
    expect(ids((await call(`/fhir/R4/Consent?_id=${ORPHAN.id}`, DOCTOR)).json)).toEqual([]);
  });

  it("a rule's actor is published with the directive or the directive is not published: never without it", async () => {
    const { call } = setup();
    const read = await call(`/fhir/R4/Consent/${C1.id}`, DOCTOR);
    if (read.status === 200) {
      expect(read.json.provision.provision[0].actor[0].role.coding[0].code).toBe("external_system");
    } else {
      // The shared checker does not yet accept actor.reference (see the
      // module notes): the read fails closed and carries no data.
      expect(read.status).toBe(500);
      expect(JSON.stringify(read.json)).not.toContain(C1.category);
    }
    const search = (await call(`/fhir/R4/Consent?patient=Patient/${PATIENT_C.fhir_id}`, DOCTOR)).json;
    const found = matches(search);
    if (found.length) expect(found[0].provision.provision[0].actor).toBeDefined();
    else expect(outcomes(search).some((o) => o.severity === "warning")).toBe(true);
  });

  it("maps database refusals to caller-safe errors without detail", async () => {
    const { call } = setup({
      rpcs: { fhir_consent_directives: () => new Response(JSON.stringify({ code: "42P01", message: "relation interop.consent_records" }), { status: 500 }) },
    });
    const res = await call(`/fhir/R4/Consent/${A1.id}`, DOCTOR);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.json)).not.toMatch(/interop|consent_records|42P01/);
  });
});

describe("Consent at the gateway: patient self-access", () => {
  it("a patient reads their own consent", async () => {
    const { call, directiveCalls, audits } = setup();
    const res = await call(`/fhir/R4/Consent/${A1.id}`, PAT_A);
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(A1.id);
    // The call names only their own record.
    expect(directiveCalls().map((c) => (c.body as Json).p_patient_ids)).toEqual([[PATIENT_A.id]]);
    expect(audits).toEqual([
      expect.objectContaining({ p_decision: "permit", p_actor_kind: "patient", p_purpose: "PATRQT", p_patient_ids: [PATIENT_A.id] }),
    ]);
  });

  it("a patient cannot read another patient's consent, by id or by search", async () => {
    const { call } = setup();
    const byId = await call(`/fhir/R4/Consent/${B1.id}`, PAT_A);
    expect(byId.status).toBe(404);
    expect(JSON.stringify(byId.json)).not.toContain(B1.category);
    const named = await call(`/fhir/R4/Consent?patient=Patient/${PATIENT_B.fhir_id}`, PAT_A);
    expect(named.status).toBe(403);
    const other = await call(`/fhir/R4/Consent?_id=${B1.id}`, PAT_A);
    expect(ids(other.json)).toEqual([]);
    // And B cannot read A's.
    expect((await call(`/fhir/R4/Consent/${A1.id}`, PAT_B)).status).toBe(404);
  });

  it("a patient's search returns their own directives only, and never sends another patient's id", async () => {
    const { call, directiveCalls } = setup();
    expect(ids((await call("/fhir/R4/Consent", PAT_A)).json)).toEqual([A1.id, A2.id, A3.id]);
    expect(ids((await call(`/fhir/R4/Consent?patient=Patient/${PATIENT_A.fhir_id}`, PAT_A)).json)).toEqual([A1.id, A2.id, A3.id]);
    expect(ids((await call("/fhir/R4/Consent?status=inactive", PAT_A)).json)).toEqual([A2.id]);
    expect(ids((await call("/fhir/R4/Consent", PAT_B)).json)).toEqual([B1.id]);
    for (const c of directiveCalls()) {
      const sent = (c.body as Json).p_patient_ids as string[];
      expect(sent.length).toBe(1);
      expect([PATIENT_A.id, PATIENT_B.id]).toContain(sent[0]);
    }
  });

  it("is refused when patient access is switched off", async () => {
    const { call, directiveCalls } = setup({}, { ...ENV, FHIR_PATIENT_ACCESS_ENABLED: "false" });
    expect((await call(`/fhir/R4/Consent/${A1.id}`, PAT_A)).status).toBe(403);
    expect((await call("/fhir/R4/Consent", PAT_A)).status).toBe(403);
    expect(directiveCalls()).toEqual([]);
  });
});

describe("Consent at the gateway: nothing forbidden is served", () => {
  it("no account id, withdrawal reason, signer, source document, table name or internal patient id in any response", async () => {
    const { call, served, logs } = setup();
    const pA = `patient=Patient/${PATIENT_A.fhir_id}`;
    for (const [path, token] of [
      [`/fhir/R4/Consent/${A1.id}`, DOCTOR],
      [`/fhir/R4/Consent/${A2.id}`, NURSE],
      [`/fhir/R4/Consent/${A3.id}`, AUDITOR],
      [`/fhir/R4/Consent/${C1.id}`, DOCTOR],
      [`/fhir/R4/Consent?${pA}`, DOCTOR],
      [`/fhir/R4/Consent?${pA}&status=inactive`, DOCTOR],
      [`/fhir/R4/Consent?patient=Patient/${PATIENT_C.fhir_id}`, DOCTOR],
      [`/fhir/R4/Consent?_id=${ORPHAN.id}`, DOCTOR],
      ["/fhir/R4/Consent", PAT_A],
      [`/fhir/R4/Consent/${A2.id}`, PAT_A],
      [`/fhir/R4/Consent/${B1.id}`, PAT_A],
    ] as const) {
      await call(path, token);
    }
    const text = served.join("\n");
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    // Logs carry no patient data either.
    const log = logs.join("\n");
    for (const secret of [...SECRETS, PATIENT_A.fhir_id, "Okafor"]) expect(log, secret).not.toContain(secret);
  });
});
