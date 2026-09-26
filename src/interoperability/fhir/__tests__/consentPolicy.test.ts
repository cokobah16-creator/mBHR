// @vitest-environment node
//
// Consent evaluation (consent/evaluateConsent.ts): which accesses stored
// consent governs, default-deny for everything it governs, deny provisions
// winning over permits, and withdrawal and expiry.

import { describe, expect, it } from "vitest";
import {
  accessClass,
  evaluateConsent,
  parseDirectives,
  type ConsentDirective,
  type ConsentInput,
  type ConsentProvision,
} from "../consent/evaluateConsent";

const NOW = new Date("2026-09-25T12:00:00Z");
const PATIENT = "01HZZPATIENTA0000000000000";

const provision = (over: Partial<ConsentProvision> = {}): ConsentProvision => ({
  id: "p0000000-0000-4000-8000-000000000001",
  provision_type: "permit",
  actor_type: null,
  action: null,
  purpose: null,
  data_class: null,
  resource_type: null,
  security_label: null,
  effective_from: null,
  effective_until: null,
  ...over,
});

const directive = (over: Partial<ConsentDirective> = {}): ConsentDirective => ({
  id: "c0000000-0000-4000-8000-000000000001",
  patient_id: PATIENT,
  status: "active",
  scope: "patient-privacy",
  category: "data-sharing",
  verified: true,
  effective_from: null,
  effective_until: null,
  withdrawn: false,
  withdrawn_at: null,
  provisions: [provision()],
  ...over,
});

const external: ConsentInput = {
  patientId: PATIENT,
  actor: { kind: "none", role: null },
  clientId: "partner-hospital",
  clientKind: "external-system",
  organizationId: null,
  resourceType: "Observation",
  dataClass: "clinical",
  action: "access",
  purposeOfUse: "TREAT",
  timestamp: NOW,
};
const on = { enforcementEnabled: true };

describe("which accesses consent governs", () => {
  it("does not govern internal treatment, internal operations or a patient's own access", () => {
    const staff = { kind: "staff" as const, role: "doctor" };
    expect(evaluateConsent({ ...external, clientId: null, actor: staff }, [], on).decision).toBe("not-applicable");
    expect(evaluateConsent({ ...external, clientId: null, actor: staff, purposeOfUse: "HOPERAT" }, [], on).decision).toBe("not-applicable");
    const self = { ...external, clientId: null, actor: { kind: "patient" as const, role: null }, purposeOfUse: "PATRQT" as const };
    expect(evaluateConsent(self, [], on).decision).toBe("not-applicable");
    // Internal care is never blocked by a missing form, even with enforcement off.
    expect(evaluateConsent({ ...external, clientId: null, actor: staff }, [], { enforcementEnabled: false }).decision).toBe("not-applicable");
  });

  it("classifies external, third-party, research, public-health and emergency access", () => {
    const staff = { kind: "staff" as const, role: "doctor" };
    expect(accessClass(staff, "x", "TREAT")).toBe("external-sharing");
    expect(accessClass(staff, "x", "TREAT", "third-party-app")).toBe("third-party-app");
    expect(accessClass(staff, null, "HRESCH")).toBe("research");
    expect(accessClass(staff, null, "PUBHLTH")).toBe("public-health");
    expect(accessClass(staff, null, "ETREAT")).toBe("emergency");
    // A patient asking for another purpose is a disclosure, not self-access.
    expect(accessClass({ kind: "patient", role: null }, null, "TREAT")).toBe("external-sharing");
  });

  it("refuses break-glass (not enabled in this release)", () => {
    const r = evaluateConsent({ ...external, clientId: null, purposeOfUse: "ETREAT" }, [directive()], on);
    expect(r).toMatchObject({ decision: "deny", reason: "break_glass_not_enabled" });
  });
});

describe("default-deny for governed access", () => {
  it("denies an external client with no directive at all", () => {
    expect(evaluateConsent(external, [], on)).toMatchObject({ decision: "deny", reason: "no_consent_permit" });
  });

  it("denies everything governed while enforcement is switched off, even with a permit", () => {
    expect(evaluateConsent(external, [directive()], { enforcementEnabled: false })).toMatchObject({
      decision: "deny",
      reason: "consent_enforcement_disabled",
    });
  });

  it("permits only on an explicit, verified, active, in-period permit for this patient", () => {
    expect(evaluateConsent(external, [directive()], on)).toMatchObject({
      decision: "permit",
      consentId: "c0000000-0000-4000-8000-000000000001",
      provisionId: "p0000000-0000-4000-8000-000000000001",
    });
    expect(evaluateConsent(external, [directive({ verified: false })], on).decision).toBe("deny");
    expect(evaluateConsent(external, [directive({ status: "draft" })], on).decision).toBe("deny");
    expect(evaluateConsent(external, [directive({ patient_id: "someone-else" })], on).decision).toBe("deny");
    expect(evaluateConsent(external, [directive({ scope: "research" })], on).decision).toBe("deny");
  });

  it("lets a deny provision win over any permit, even before verification", () => {
    const deny = provision({ id: "p0000000-0000-4000-8000-000000000002", provision_type: "deny" });
    const r = evaluateConsent(external, [directive(), directive({ id: "c2", verified: false, provisions: [deny] })], on);
    expect(r).toMatchObject({ decision: "deny", reason: "consent_deny_provision", provisionId: deny.id });
  });

  it("applies provision filters: actor, action, purpose, class, resource type and period", () => {
    const matches = (p: Partial<ConsentProvision>) => evaluateConsent(external, [directive({ provisions: [provision(p)] })], on).decision;
    expect(matches({ actor_type: "external_system" })).toBe("permit");
    expect(matches({ actor_type: "research_team" })).toBe("deny");
    expect(matches({ action: "access" })).toBe("permit");
    expect(matches({ action: "disclose" })).toBe("deny");
    expect(matches({ purpose: "HRESCH" })).toBe("deny");
    expect(matches({ data_class: "clinical" })).toBe("permit");
    expect(matches({ data_class: "document" })).toBe("deny");
    expect(matches({ resource_type: "DocumentReference" })).toBe("deny");
    expect(matches({ effective_until: "2026-09-01T00:00:00Z" })).toBe("deny");
    expect(matches({ effective_from: "2026-10-01T00:00:00Z" })).toBe("deny");
    // mBHR data carries no security labels: a labelled provision covers nothing.
    expect(matches({ security_label: "R" })).toBe("deny");
  });
});

describe("withdrawal and expiry", () => {
  it("stops future disclosure when withdrawn, and says so", () => {
    const r = evaluateConsent(external, [directive({ withdrawn: true, withdrawn_at: "2026-09-20T00:00:00Z" })], on);
    expect(r).toMatchObject({ decision: "deny", reason: "consent_withdrawn" });
  });

  it("denies an expired directive, and one not yet in force", () => {
    expect(evaluateConsent(external, [directive({ effective_until: "2026-09-01T00:00:00Z" })], on)).toMatchObject({
      decision: "deny",
      reason: "consent_expired",
    });
    expect(evaluateConsent(external, [directive({ effective_from: "2027-01-01T00:00:00Z" })], on).decision).toBe("deny");
  });

  it("treats unparseable dates as out of period (fails closed)", () => {
    expect(evaluateConsent(external, [directive({ effective_from: "not a date" })], on).decision).toBe("deny");
  });
});

describe("parseDirectives", () => {
  it("drops malformed rows and provisions instead of guessing", () => {
    const parsed = parseDirectives([
      { id: "c1", patient_id: PATIENT, status: "active", scope: "patient-privacy", verified: "yes", provisions: [{ id: "p1", provision_type: "maybe" }, { id: "p2", provision_type: "permit" }] },
      { id: "c2", status: "active" },
      "junk",
      null,
    ]);
    expect(parsed).toHaveLength(1);
    // "yes" is not true: an unverified directive cannot permit.
    expect(parsed[0].verified).toBe(false);
    expect(parsed[0].provisions.map((p) => p.id)).toEqual(["p2"]);
    expect(parseDirectives({ not: "an array" })).toEqual([]);
  });
});
