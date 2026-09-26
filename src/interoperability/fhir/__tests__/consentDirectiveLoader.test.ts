// @vitest-environment node
//
// loadConsentDirectives(): the directives a consent decision reads. A merge
// does not move consent records, so the named patient's whole merge family
// is asked for and every directive counts as the named patient's; more than
// the limit is refused rather than decided on the first hundred.

import { describe, expect, it } from "vitest";
import { loadConsentDirectives, MAX_DECISION_DIRECTIVES } from "../gateway/handler";
import { evaluateConsent, parseDirectives } from "../consent/evaluateConsent";
import { FhirError } from "../errors/operationOutcome";
import type { Postgrest } from "../gateway/postgrest";

const KEPT = "01HZZPATIENTKEPT0000000000";
const OLD = "01HZZPATIENTOLD00000000000";
const OTHER = "01HZZPATIENTOTHER000000000";

const directive = (id: string, patientId: string, type: "permit" | "deny") => ({
  id,
  patient_id: patientId,
  status: "active",
  scope: "research",
  verified: true,
  withdrawn: false,
  provisions: [{ id: `${id}-p`, provision_type: type, names_recipient: false, action: "access", purpose: "HRESCH" }],
});

const research = (directives: Parameters<typeof evaluateConsent>[1]) =>
  evaluateConsent(
    {
      actor: { kind: "staff", role: "doctor" },
      clientId: null,
      organizationId: null,
      patientId: KEPT,
      resourceType: "Observation",
      dataClass: "clinical",
      action: "access",
      purposeOfUse: "HRESCH",
      timestamp: new Date("2026-09-25T12:00:00Z"),
    },
    directives,
    { enforcementEnabled: true },
  );

function fakeDb(rows: unknown) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    rpc: async (fn: string, body: Record<string, unknown>) => {
      calls.push({ fn, ...body });
      return rows;
    },
  } as unknown as Postgrest;
  return { db, calls };
}

describe("loadConsentDirectives", () => {
  it("asks for the named patient's merge family and reads each directive as the named patient's", async () => {
    const rows = [directive("d-kept", KEPT, "permit"), directive("d-old", OLD, "deny")];
    const { db, calls } = fakeDb(rows);
    const out = await loadConsentDirectives(db, [KEPT], [KEPT, OLD]);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("fhir_consent_directives");
    expect(calls[0].p_patient_ids).toEqual([KEPT, OLD]);
    expect(out.map((d) => [d.id, d.patient_id])).toEqual([
      ["d-kept", KEPT],
      ["d-old", KEPT],
    ]);
    // The refusal filed under the merged-away record now governs the kept
    // one; read as filed, only the permit would count.
    expect(research(out)).toMatchObject({ decision: "deny", reason: "consent_deny_provision", consentId: "d-old" });
    expect(research(parseDirectives(rows.filter((r) => r.patient_id === KEPT))).decision).toBe("permit");
  });

  it("drops a row outside the family instead of reassigning it", async () => {
    const { db } = fakeDb([directive("d-kept", KEPT, "permit"), directive("d-other", OTHER, "permit")]);
    const out = await loadConsentDirectives(db, [KEPT], [KEPT, OLD]);
    expect(out.map((d) => d.id)).toEqual(["d-kept"]);
  });

  it("asks for exactly the named ids when no family is known or several are named", async () => {
    const one = fakeDb([]);
    await loadConsentDirectives(one.db, [KEPT], null);
    expect(one.calls[0].p_patient_ids).toEqual([KEPT]);
    const two = fakeDb([]);
    await loadConsentDirectives(two.db, [KEPT, OTHER], [KEPT, OLD]);
    expect(two.calls[0].p_patient_ids).toEqual([KEPT, OTHER]);
    const unrelated = fakeDb([]);
    await loadConsentDirectives(unrelated.db, [OTHER], [KEPT, OLD]);
    expect(unrelated.calls[0].p_patient_ids).toEqual([OTHER]);
  });

  it("refuses to decide on a partial set: one row over the limit is a 503", async () => {
    const rows = Array.from({ length: MAX_DECISION_DIRECTIVES + 1 }, (_, i) => directive(`d-${i}`, KEPT, "permit"));
    const { db, calls } = fakeDb(rows);
    const err = await loadConsentDirectives(db, [KEPT], null).catch((e) => e);
    expect(calls[0].p_limit).toBe(MAX_DECISION_DIRECTIVES + 1);
    expect(err).toBeInstanceOf(FhirError);
    expect((err as FhirError).status).toBe(503);
  });

  it("accepts exactly the limit", async () => {
    const rows = Array.from({ length: MAX_DECISION_DIRECTIVES }, (_, i) => directive(`d-${i}`, KEPT, "permit"));
    const out = await loadConsentDirectives(fakeDb(rows).db, [KEPT], null);
    expect(out).toHaveLength(MAX_DECISION_DIRECTIVES);
  });

  it("treats an answer that is not a list as unavailable", async () => {
    const err = await loadConsentDirectives(fakeDb({ code: "42501" }).db, [KEPT], null).catch((e) => e);
    expect((err as FhirError).status).toBe(503);
  });
});
