import { describe, it, expect } from "vitest";
import {
  boundPatientId,
  gatePatientBoundRequest,
  hasSystemScope,
  patientSearchRefusal,
  purposeAllowedForCaller,
  userGrantableScopes,
  writeChangeRefusal,
} from "./access";

const q = (s: string) => new URLSearchParams(s);

describe("boundPatientId", () => {
  it("binds a patient-scoped token to its subject", () => {
    expect(boundPatientId(["patient/*.read"], "p1")).toBe("p1");
  });

  it("binds a patient-scoped token with no subject to nobody", () => {
    expect(boundPatientId(["patient/*.read"], null)).toBe("");
    expect(boundPatientId(["patient/Observation.read"], "  ")).toBe("");
  });

  it("leaves system tokens unbound", () => {
    expect(boundPatientId(["system/*.read"], "client-1")).toBeNull();
    expect(boundPatientId(["system/*.read", "patient/*.read"], "p1")).toBeNull();
    expect(hasSystemScope(["system/Patient.read"])).toBe(true);
  });
});

describe("purposeAllowedForCaller", () => {
  it("allows individual access only with a patient-bound token", () => {
    expect(purposeAllowedForCaller("individual-access", "p1")).toBe(true);
    expect(purposeAllowedForCaller("individual-access", null)).toBe(false);
  });

  it("keeps patient-bound tokens to individual access", () => {
    expect(purposeAllowedForCaller("treatment", "p1")).toBe(false);
    expect(purposeAllowedForCaller("treatment", null)).toBe(true);
    expect(purposeAllowedForCaller("operations", null)).toBe(true);
  });
});

describe("gatePatientBoundRequest", () => {
  it("does not gate system callers", () => {
    expect(gatePatientBoundRequest(null, "GET", ["Patient"], q(""))).toEqual({
      allow: true,
    });
  });

  it("lets a patient read their own record", () => {
    const own = (path: string[], params = "") =>
      gatePatientBoundRequest("p1", "GET", path, q(params)).allow;
    expect(own(["Patient", "p1"])).toBe(true);
    expect(own(["Patient", "p1", "$everything"])).toBe(true);
    expect(own(["Patient", "$everything"], "patient=Patient/p1")).toBe(true);
    expect(own(["Patient"], "_id=p1")).toBe(true);
    expect(own(["Patient"], "identifier=urn:mbhr|p1")).toBe(true);
    expect(own(["Observation"], "patient=p1")).toBe(true);
    expect(own(["Condition"], "subject=Patient/p1")).toBe(true);
    expect(own(["metadata"])).toBe(true);
  });

  it("refuses anyone else's record", () => {
    const other = (path: string[], params = "") =>
      gatePatientBoundRequest("p1", "GET", path, q(params)).allow;
    expect(other(["Patient", "p2"])).toBe(false);
    expect(other(["Patient", "p2", "$everything"])).toBe(false);
    expect(other(["Patient", "$everything"], "patient=p2")).toBe(false);
    expect(other(["Patient"])).toBe(false);
    expect(other(["Patient"], "name=Ada")).toBe(false);
    expect(other(["Patient"], "_id=p1&identifier=p2")).toBe(false);
    expect(other(["Observation"])).toBe(false);
    expect(other(["Observation"], "patient=p2")).toBe(false);
    expect(other(["Observation"], "patient=p1&subject=p2")).toBe(false);
    expect(other(["Observation", "obs-1"])).toBe(false);
    expect(other(["Patient", "p1", "_history"])).toBe(false);
    expect(other(["Patient", "$match"])).toBe(false);
  });

  it("refuses writes and tokens bound to nobody", () => {
    expect(
      gatePatientBoundRequest("p1", "POST", ["Observation"], q("")).allow,
    ).toBe(false);
    expect(
      gatePatientBoundRequest("p1", "DELETE", ["Observation", "o1"], q("")).allow,
    ).toBe(false);
    expect(
      gatePatientBoundRequest("", "GET", ["Patient", ""], q("")).allow,
    ).toBe(false);
    expect(
      gatePatientBoundRequest("", "GET", ["Observation"], q("patient=")).allow,
    ).toBe(false);
  });
});

describe("patientSearchRefusal", () => {
  it("refuses an open search", () => {
    expect(patientSearchRefusal(q(""))).not.toBeNull();
    expect(patientSearchRefusal(q("name=Ada"))).not.toBeNull();
    expect(patientSearchRefusal(q("birthdate=1990-01-01"))).not.toBeNull();
    expect(patientSearchRefusal(q("name=A&birthdate=1990-01-01"))).not.toBeNull();
  });

  it("allows a search that names someone", () => {
    expect(patientSearchRefusal(q("identifier=sys|abc"))).toBeNull();
    expect(patientSearchRefusal(q("_id=abc"))).toBeNull();
    expect(patientSearchRefusal(q("name=Ada&birthdate=1990-01-01"))).toBeNull();
  });
});

describe("writeChangeRefusal", () => {
  const row = { source_client_id: "c1", patient_id: "p1", version_id: 3 };

  it("allows the writing client to change its own resource", () => {
    expect(writeChangeRefusal(row, "c1", "p1", null)).toBeNull();
    expect(writeChangeRefusal(row, "c1", undefined, 'W/"3"')).toBeNull();
    expect(writeChangeRefusal(null, "c1", "p1", null)).toBeNull();
  });

  it("refuses another client's resource", () => {
    expect(writeChangeRefusal(row, "c2", "p1", null)?.status).toBe(403);
    expect(
      writeChangeRefusal({ ...row, source_client_id: null }, "c1", "p1", null)
        ?.status,
    ).toBe(403);
  });

  it("refuses moving a resource to another patient", () => {
    expect(writeChangeRefusal(row, "c1", "p2", null)?.status).toBe(409);
    expect(writeChangeRefusal(row, "c1", null, null)?.status).toBe(409);
  });

  it("honours If-Match", () => {
    expect(writeChangeRefusal(row, "c1", "p1", 'W/"2"')?.status).toBe(412);
    expect(writeChangeRefusal(null, "c1", "p1", 'W/"1"')?.status).toBe(412);
  });
});

describe("userGrantableScopes", () => {
  it("never grants system scopes through the user flow", () => {
    expect(userGrantableScopes(["system/*.read"], true).ok).toBe(false);
  });

  it("grants patient scopes only to an account linked to a patient", () => {
    expect(userGrantableScopes(["patient/*.read"], true).ok).toBe(true);
    expect(userGrantableScopes(["patient/*.read"], false).ok).toBe(false);
    expect(userGrantableScopes(["openid", "fhirUser"], false).ok).toBe(true);
  });
});
