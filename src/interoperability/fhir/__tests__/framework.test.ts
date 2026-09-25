// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFhirConfig, FhirConfigError } from "../config/config";
import {
  decodeCursor,
  encodeCursor,
  parseDateSearch,
  parseNameSearch,
  parseSearch,
  parseToken,
  parseReferenceId,
} from "../search/params";
import { searchsetBundle } from "../search/bundle";
import { canAccessFHIRResource, type Actor } from "../authorization/policy";
import { parsePurposeOfUse, type PurposeOfUse } from "../consent/policy";
import { capabilityStatement } from "../capability/capabilityStatement";
import { RESOURCE_DEFINITIONS } from "../mappers/registry";
import { FhirError } from "../errors/operationOutcome";

const ENABLED = {
  FHIR_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

describe("configuration and flags", () => {
  it("is off by default and needs nothing else when off", () => {
    const c = readFhirConfig({});
    expect(c.enabled).toBe(false);
    expect(c.writeEnabled).toBe(false);
    expect(c.smartEnabled).toBe(false);
    expect(c.smartExternalClientsEnabled).toBe(false);
  });

  it("refuses to start half-configured", () => {
    expect(() => readFhirConfig({ FHIR_ENABLED: "true" })).toThrow(FhirConfigError);
    expect(() => readFhirConfig({ ...ENABLED, FHIR_BASE_URL: "http://mbhr.app/fhir/R4" })).toThrow(/https/);
    expect(() => readFhirConfig({ ...ENABLED, SUPABASE_ANON_KEY: "" })).toThrow(FhirConfigError);
  });

  it("refuses features this release does not have", () => {
    for (const flag of ["FHIR_WRITE_ENABLED", "SMART_ENABLED", "SMART_EXTERNAL_CLIENTS_ENABLED"]) {
      expect(() => readFhirConfig({ ...ENABLED, [flag]: "true" })).toThrow(/not supported/);
    }
  });

  it("refuses the service-role key", () => {
    expect(() =>
      readFhirConfig({ ...ENABLED, SUPABASE_ANON_KEY: "same", SUPABASE_SERVICE_ROLE_KEY: "same" }),
    ).toThrow(/service-role/);
  });

  it("caps the page size at 100", () => {
    const c = readFhirConfig({ ...ENABLED, FHIR_MAX_PAGE_SIZE: "5000", FHIR_DEFAULT_PAGE_SIZE: "20" });
    expect(c.maxPageSize).toBe(100);
    expect(c.defaultPageSize).toBe(20);
    expect(c.baseUrl).toBe("https://mbhr.app/fhir/R4");
  });
});

describe("search parameters", () => {
  const defs = RESOURCE_DEFINITIONS.Observation.searchParams;
  const paging = { defaultCount: 20, maxCount: 100 };
  const parse = (q: string) => parseSearch(new URLSearchParams(q), defs, paging);

  it("accepts declared parameters and clamps _count", () => {
    const s = parse("patient=Patient/abc&_count=500");
    expect(s.values.get("patient")).toEqual(["Patient/abc"]);
    expect(s.count).toBe(100);
    expect(parse("patient=x").count).toBe(20);
  });

  it("refuses what it does not implement, instead of ignoring it", () => {
    const bad = ["value-quantity=5", "patient:missing=true", "code=a,b", "_count=0", "_count=-1", "_sort=date", "_include=Observation:patient", "_format=xml", "patient=a&patient=b", "_count=1&_count=2"];
    for (const q of bad) expect(() => parse(q), q).toThrow(FhirError);
  });

  it("allows two date bounds but not three", () => {
    expect(parse("patient=x&date=ge2026-01-01&date=lt2026-02-01").values.get("date")).toHaveLength(2);
    expect(() => parse("patient=x&date=ge2026&date=lt2027&date=eq2026-05")).toThrow(FhirError);
  });

  it("parses dates into half-open ranges", () => {
    expect(parseDateSearch("2026-05-01", "date")).toEqual({ from: "2026-05-01T00:00:00.000Z", to: "2026-05-02T00:00:00.000Z" });
    expect(parseDateSearch("ge2026-05", "date")).toEqual({ from: "2026-05-01T00:00:00.000Z", to: null });
    expect(parseDateSearch("lt2026", "date")).toEqual({ from: null, to: "2026-01-01T00:00:00.000Z" });
    expect(parseDateSearch("gt2026-05-01T10:00+01:00", "date").from).toBe("2026-05-01T09:01:00.000Z");
    expect(parseDateSearch("gt2026-05-01T10:00:00+01:00", "date").from).toBe("2026-05-01T09:00:01.000Z");
    for (const bad of ["2026-13-01", "2026-02-30", "2026-05-01T10:00", "sa2026", "yesterday", "2026-05-01;drop"]) {
      expect(() => parseDateSearch(bad, "date"), bad).toThrow(FhirError);
    }
  });

  it("never lets filter syntax through a value", () => {
    for (const v of ["a*", "x,y", "a)or(id.gt.0", 'a"b', "%", "ab;cd"]) {
      expect(() => parseNameSearch(v, "name"), v).toThrow(FhirError);
    }
    expect(parseNameSearch("  O'Neil-Ada ", "name")).toBe("O'Neil-Ada");
    expect(parseNameSearch("Ọlá", "name")).toBe("Ọlá");
    expect(() => parseReferenceId("Patient/../x", "Patient", "patient")).toThrow(FhirError);
    expect(() => parseReferenceId("https://evil.example/Patient/1", "Patient", "patient")).toThrow(FhirError);
    expect(() => parseReferenceId("Encounter/1", "Patient", "patient")).toThrow(FhirError);
    expect(() => parseToken("a|b|c", "code")).toThrow(FhirError);
    expect(parseToken("http://loinc.org|8867-4", "code")).toEqual({ system: "http://loinc.org", code: "8867-4" });
  });

  it("round-trips cursors and refuses tampered ones", () => {
    const c = { k: "01HZZVITALSA0000000000000", s: 3 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    for (const bad of ["", "!!", encodeCursor({ k: "a b" }), btoa('{"k":1}'), btoa("not json")]) {
      expect(() => decodeCursor(bad), bad).toThrow(FhirError);
    }
  });

  it("builds searchset bundles with self and next links", () => {
    const b = searchsetBundle({
      baseUrl: "https://mbhr.app/fhir/R4",
      resourceType: "Observation",
      query: new URLSearchParams("patient=Patient/p1&code=8867-4"),
      count: 2,
      page: { resources: [{ resourceType: "Observation", id: "o1" }], next: { k: "row1", s: 2 } },
      now: new Date("2026-09-25T00:00:00Z"),
    });
    expect(b.type).toBe("searchset");
    expect(b.link[0]).toEqual({ relation: "self", url: "https://mbhr.app/fhir/R4/Observation?code=8867-4&patient=Patient%2Fp1&_count=2" });
    expect(b.link[1].relation).toBe("next");
    expect(new URL(b.link[1].url).searchParams.get("_cursor")).toBe(encodeCursor({ k: "row1", s: 2 }));
    expect(b.entry[0]).toEqual({ fullUrl: "https://mbhr.app/fhir/R4/Observation/o1", resource: { resourceType: "Observation", id: "o1" }, search: { mode: "match" } });
  });
});

describe("access decision", () => {
  const actor = (role: string | null, permissions: string[]): Actor => ({ userId: "u", role, permissions: new Set(permissions) });
  const nurse = actor("nurse", ["register", "vitals", "queue", "portal_manage", "resolve_conflicts", "merge_patients"]);
  const doctor = actor("doctor", ["register", "vitals", "consult", "lab_review", "queue"]);
  const pharmacist = actor("pharmacist", ["dispense", "inventory", "queue"]);
  const auditor = actor("auditor", ["export", "audit_access", "approve_phi_conflicts", "resolve_conflicts", "merge_patients"]);
  const portalPatient = actor(null, []);
  const decide = (a: Actor, resourceType: "Patient" | "Encounter" | "Observation" | "Condition", purpose: PurposeOfUse = "TREAT") =>
    canAccessFHIRResource({ actor: a, action: "read", resourceType, purposeOfUse: purpose }).permit;

  it("follows mBHR permissions, not titles", () => {
    expect(decide(nurse, "Observation")).toBe(true);
    expect(decide(nurse, "Condition")).toBe(false);
    expect(decide(doctor, "Condition")).toBe(true);
    expect(decide(pharmacist, "Patient")).toBe(true);
    expect(decide(pharmacist, "Condition")).toBe(false);
    expect(decide(pharmacist, "Observation")).toBe(false);
    expect(decide(auditor, "Patient")).toBe(false);
  });

  it("gives accounts without a staff role nothing (patient self-access is a later release)", () => {
    for (const t of ["Patient", "Encounter", "Observation", "Condition"] as const) expect(decide(portalPatient, t)).toBe(false);
  });

  it("permits treatment only; everything else is default-deny", () => {
    expect(decide(doctor, "Patient", "TREAT")).toBe(true);
    for (const p of ["ETREAT", "HOPERAT", "PATRQT", "HRESCH"] as const) expect(decide(doctor, "Patient", p)).toBe(false);
    expect(parsePurposeOfUse(null)).toBe("TREAT");
    expect(parsePurposeOfUse("treat")).toBe("TREAT");
    expect(parsePurposeOfUse("MARKETING")).toBeNull();
  });
});

describe("CapabilityStatement", () => {
  const cs = capabilityStatement("https://mbhr.app/fhir/R4");

  it("advertises exactly what is implemented", () => {
    expect(cs.fhirVersion).toBe("4.0.1");
    expect(cs.format).toEqual(["application/fhir+json"]);
    const types = cs.rest[0].resource.map((r) => r.type);
    expect(types).toEqual(["Patient", "Encounter", "Observation", "Condition"]);
    for (const r of cs.rest[0].resource) {
      expect(r.interaction.map((i) => i.code).sort()).toEqual(["read", "search-type"]);
      expect(r.searchParam.map((p) => p.name)).toEqual(RESOURCE_DEFINITIONS[r.type].searchParams.map((p) => p.name));
    }
    const json = JSON.stringify(cs);
    expect(json).not.toMatch(/"code":"(create|update|patch|delete|history-instance|batch|transaction)"/);
    expect(json).not.toMatch(/SMART-on-FHIR|oauth-uris|_include|_revinclude/);
    expect(cs.implementation.url).toBe("https://mbhr.app/fhir/R4");
  });
});
