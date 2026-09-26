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
import { authorizeFhirRequest, type Actor } from "../authorization/policy";
import type { FhirResourceType } from "../authorization/permissions";
import { parsePurposeOfUse, type PurposeOfUse } from "../consent/policy";
import { capabilityStatement } from "../capability/capabilityStatement";
import { PUBLISHED_TYPES, RESOURCE_DEFINITIONS } from "../mappers/registry";
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

  it("answers a parameter a type refuses with the type's own message, whatever its value, modifier or the rest of the query", () => {
    const allergyDefs = RESOURCE_DEFINITIONS.AllergyIntolerance.searchParams;
    const refused = [{ name: "category", diagnostics: "Ask for all of them instead." }];
    const refusal = (q: string, r = refused): unknown => {
      try {
        parseSearch(new URLSearchParams(q), allergyDefs, paging, r);
        return null;
      } catch (e) {
        return e;
      }
    };
    for (const q of ["patient=x&category=food", "category:not=food&patient=x", "_count=abc&category=food", "category=a,b", "category=", "category=food&category=drug"]) {
      const e = refusal(q);
      expect(e, q).toBeInstanceOf(FhirError);
      const { status, code, message } = e as FhirError;
      expect({ status, code, message }, q).toEqual({ status: 400, code: "not-supported", message: "Ask for all of them instead." });
    }
    // Without the refusal: the generic answer. No prefix match.
    expect((refusal("patient=x&category=food", []) as FhirError).message).toBe("Search parameter category is not supported.");
    expect((refusal("patient=x&categoryx=1") as FhirError).message).toBe("Search parameter categoryx is not supported.");
    expect(parseSearch(new URLSearchParams("patient=x&criticality=high"), allergyDefs, paging, refused).values.get("criticality")).toEqual(["high"]);
    // A refused parameter is never also declared, so the CapabilityStatement never offers it.
    for (const t of PUBLISHED_TYPES) {
      const names = RESOURCE_DEFINITIONS[t].searchParams.map((d) => d.name);
      for (const r of RESOURCE_DEFINITIONS[t].refusedSearchParams ?? []) expect(names, `${t}.${r.name}`).not.toContain(r.name);
    }
  });

  it("allows two date bounds but not three", () => {
    expect(parse("patient=x&date=ge2026-01-01&date=lt2026-02-01").values.get("date")).toHaveLength(2);
    expect(() => parse("patient=x&date=ge2026&date=lt2027&date=eq2026-05")).toThrow(FhirError);
  });

  it("parses dates into half-open ranges, a date without a time being a clinic day in Africa/Lagos", () => {
    expect(parseDateSearch("2026-05-01", "date")).toEqual({ from: "2026-04-30T23:00:00.000Z", to: "2026-05-01T23:00:00.000Z" });
    expect(parseDateSearch("ge2026-05", "date")).toEqual({ from: "2026-04-30T23:00:00.000Z", to: null });
    expect(parseDateSearch("lt2026", "date")).toEqual({ from: null, to: "2025-12-31T23:00:00.000Z" });
    // Years before 100 are not shifted into the 1900s.
    expect(parseDateSearch("0050-01-01", "date").from).toBe("0049-12-31T23:00:00.000Z");
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
    expect(b.entry).toStrictEqual([
      { fullUrl: "https://mbhr.app/fhir/R4/Observation/o1", resource: { resourceType: "Observation", id: "o1" }, search: { mode: "match" } },
    ]);
  });

  it("leaves entry out of a searchset with nothing to list (FHIR JSON has no empty arrays)", () => {
    const opts = {
      baseUrl: "https://mbhr.app/fhir/R4",
      resourceType: "Encounter",
      query: new URLSearchParams("patient=Patient/p1"),
      count: 20,
      page: { resources: [], next: null },
      now: new Date("2026-09-25T00:00:00Z"),
      newId: () => "0e0e0e0e-0000-4000-8000-000000000001",
    };
    const empty = searchsetBundle(opts);
    expect("entry" in empty).toBe(false);
    expect(JSON.stringify(empty)).not.toContain("[]");
    // A note alone is still listed, as the one outcome entry.
    const noted = searchsetBundle({ ...opts, outcomes: [{ severity: "information", code: "informational", diagnostics: "A note." }] });
    expect(noted.entry?.map((e) => e.search?.mode)).toStrictEqual(["outcome"]);
  });
});

describe("access decision", () => {
  const actor = (role: string | null, permissions: string[]): Actor => ({
    userId: "u",
    kind: role ? "staff" : "none",
    role,
    permissions: new Set(permissions),
    patientIds: new Set(),
  });
  const nurse = actor("nurse", ["register", "vitals", "queue", "portal_manage", "resolve_conflicts", "merge_patients"]);
  const doctor = actor("doctor", ["register", "vitals", "consult", "lab_review", "queue"]);
  const pharmacist = actor("pharmacist", ["dispense", "inventory", "queue"]);
  const auditor = actor("auditor", ["export", "audit_access", "approve_phi_conflicts", "resolve_conflicts", "merge_patients"]);
  const noRole = actor(null, []);
  const config = { enabled: true, readEnabled: true, patientAccessEnabled: false, consentEnforcementEnabled: false };
  const decide = async (a: Actor, resourceType: FhirResourceType, purpose: PurposeOfUse | null = "TREAT") =>
    (
      await authorizeFhirRequest(
        { actor: a, client: null, interaction: "read", resourceType, purposeOfUse: purpose },
        { config, now: new Date("2026-09-25T12:00:00Z") },
      )
    ).allowed;

  it("follows mBHR permissions, not titles", async () => {
    expect(await decide(nurse, "Observation")).toBe(true);
    expect(await decide(nurse, "Condition")).toBe(false);
    expect(await decide(doctor, "Condition")).toBe(true);
    expect(await decide(pharmacist, "Patient")).toBe(true);
    expect(await decide(pharmacist, "Condition")).toBe(false);
    expect(await decide(pharmacist, "Observation")).toBe(false);
    expect(await decide(pharmacist, "MedicationDispense")).toBe(true);
    expect(await decide(auditor, "Patient")).toBe(false);
    expect(await decide(auditor, "AuditEvent")).toBe(true);
    expect(await decide(nurse, "AuditEvent")).toBe(false);
  });

  it("gives accounts that are neither staff nor a linked patient nothing", async () => {
    for (const t of PUBLISHED_TYPES) expect(await decide(noRole, t)).toBe(false);
  });

  it("permits treatment only for staff; everything else is default-deny", async () => {
    expect(await decide(doctor, "Patient", "TREAT")).toBe(true);
    for (const p of ["ETREAT", "HOPERAT", "PATRQT", "HRESCH", "PUBHLTH", null] as const) expect(await decide(doctor, "Patient", p)).toBe(false);
    expect(parsePurposeOfUse(null)).toBe("TREAT");
    expect(parsePurposeOfUse(null, "PATRQT")).toBe("PATRQT");
    expect(parsePurposeOfUse("treat")).toBe("TREAT");
    expect(parsePurposeOfUse("MARKETING")).toBeNull();
  });
});

describe("CapabilityStatement", () => {
  const cs = capabilityStatement("https://mbhr.app/fhir/R4");

  it("advertises exactly what is implemented", () => {
    expect(cs.fhirVersion).toBe("4.0.1");
    expect(cs.format).toEqual(["application/fhir+json"]);
    const resources = cs.rest[0].resource ?? [];
    expect(resources.map((r) => r.type)).toEqual(PUBLISHED_TYPES);
    for (const r of resources) {
      const def = RESOURCE_DEFINITIONS[r.type];
      expect(r.interaction.map((i) => i.code)).toEqual(def.interactions);
      for (const code of r.interaction.map((i) => i.code)) expect(["read", "search-type"]).toContain(code);
      expect((r.searchParam ?? []).map((p) => p.name)).toEqual(def.searchParams.map((p) => p.name));
      expect(r.readHistory).toBe(false);
      expect(r.updateCreate).toBe(false);
    }
    const json = JSON.stringify(cs);
    expect(json).not.toMatch(/"code":"(create|update|patch|delete|history-instance|batch|transaction)"/);
    expect(json).not.toMatch(/SMART-on-FHIR|oauth-uris|_include|_revinclude/);
    expect(cs.implementation.url).toBe("https://mbhr.app/fhir/R4");
  });

  it("lists no resource when reads are switched off, and names patient access only when on", () => {
    expect(capabilityStatement("https://mbhr.app/fhir/R4", undefined, { readEnabled: false }).rest[0].resource).toBeUndefined();
    expect(cs.implementation.description).not.toMatch(/patients reading/);
    expect(capabilityStatement("https://x.example/fhir/R4", undefined, { patientAccessEnabled: true }).implementation.description).toMatch(
      /patients reading their own records/,
    );
  });
});
