// @vitest-environment node
//
// The gateway end to end against an in-memory Supabase: the security test
// matrix for the first delivery (authentication, permissions, patient
// context, enumeration, audit, errors, paging, caching).

import { describe, expect, it } from "vitest";
import { handleFhirRequest, fhirPath } from "../gateway/handler";
import { PUBLISHED_TYPES } from "../resources/registry";
import { fakeSupabase, makeToken, type FakeOptions } from "./fakeSupabase";
import { CONDITION_A, PATIENT_A, PATIENT_B, VISIT_A, VITALS_A } from "./fixtures";

const ENV = {
  FHIR_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

const NURSE = makeToken("nurse-1");
const DOCTOR = makeToken("doctor-1");
const PHARMACIST = makeToken("pharm-1");
const PORTAL = makeToken("portal-1");
const PERMS = {
  nurse: ["merge_patients", "portal_manage", "queue", "register", "resolve_conflicts", "vitals"],
  doctor: ["consult", "lab_release", "lab_review", "merge_patients", "portal_manage", "queue", "register", "resolve_conflicts", "vitals"],
  pharmacist: ["dispense", "inventory", "queue"],
};

const VITALS_B = { ...VITALS_A, id: "01HZZVITALSB0000000000000", patient_id: PATIENT_B.id, visit_id: null, pulse_bpm: 70 };
const CONDITION_ERR = { ...CONDITION_A, id: "c0000000-0000-4000-8000-00000000000b", verification_status: "entered-in-error" };

function setup(overrides: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    users: {
      [NURSE]: { id: "nurse-1", role: "nurse", permissions: PERMS.nurse },
      [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: PERMS.doctor },
      [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: PERMS.pharmacist },
      [PORTAL]: { id: "portal-1", role: null, permissions: [] },
    },
    tables: {
      patients: [PATIENT_A, PATIENT_B],
      visits: [VISIT_A],
      vitals: [VITALS_A, VITALS_B],
      conditions: [CONDITION_A, CONDITION_ERR],
    },
    ...overrides,
  });
  const logs: string[] = [];
  const call = (path: string, init: RequestInit & { token?: string } = {}, env: Record<string, string> = ENV) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    return handleFhirRequest(new Request(`https://mbhr.app${path}`, { ...init, headers }), {
      env,
      fetchImpl: fake.fetchImpl,
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: (l) => logs.push(l),
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
  };
  return { ...fake, call, logs };
}

async function body(res: Response) {
  return res.json() as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Ids of a searchset's matches (a searchset with nothing to list has no entry). */
function matchIds(b: Record<string, any>): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (b.entry ?? []).filter((e: { search: { mode: string } }) => e.search.mode === "match").map((e: { resource: { id: string } }) => e.resource.id);
}

describe("feature flag", () => {
  it("answers nothing but a 404 OperationOutcome when FHIR_ENABLED is off", async () => {
    const { call, calls } = setup();
    for (const path of ["/fhir/R4/metadata", `/fhir/R4/Patient/${PATIENT_A.fhir_id}`]) {
      const res = await call(path, { token: DOCTOR }, {});
      expect(res.status).toBe(404);
      expect((await body(res)).resourceType).toBe("OperationOutcome");
    }
    expect(calls).toHaveLength(0);
  });

  it("fails closed with 503 when switched on but misconfigured", async () => {
    const { call, calls } = setup();
    const res = await call("/fhir/R4/metadata", {}, { FHIR_ENABLED: "true" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await body(res))).not.toMatch(/FHIR_BASE_URL|SUPABASE/);
    expect(calls).toHaveLength(0);
  });
});

describe("metadata", () => {
  it("is public, FHIR JSON, and lists only implemented resources", async () => {
    const { call } = setup();
    const res = await call("/fhir/R4/metadata");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/fhir+json; charset=utf-8");
    const cs = await body(res);
    expect(cs.resourceType).toBe("CapabilityStatement");
    expect(cs.rest[0].resource.map((r: { type: string }) => r.type)).toEqual(PUBLISHED_TYPES);
    expect(res.headers.get("x-mbhr-fhir-flags")).toBe("read=on; patient=off; consent=off; audit=on; external=off; write=off; smart=off");
    // No write interaction, no SMART or OAuth claim anywhere.
    const text = JSON.stringify(cs);
    expect(text).not.toMatch(/"code":"(create|update|patch|delete)"|oauth-uris|smart-app-launch|supportedProfile/);
  });

  it("reads the rewritten path too", () => {
    expect(fhirPath(new URL("https://mbhr.app/api/fhir?__fhir_path=Patient/abc&name=x"))).toEqual(["Patient", "abc"]);
    expect(fhirPath(new URL("https://mbhr.app/fhir/R4/metadata"))).toEqual(["metadata"]);
  });
});

describe("authentication", () => {
  it("refuses a request with no token", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await body(res)).issue[0].code).toBe("login");
    expect(audits).toHaveLength(0);
  });

  it("refuses an invalid, expired, wrong-audience or unknown token", async () => {
    const { call } = setup();
    const tokens = [
      "not-a-jwt",
      makeToken("nurse-1", { exp: 1 }),
      makeToken("nurse-1", { aud: "some-other-api" }),
      makeToken("nurse-1", { role: "service_role" }),
      makeToken("stranger"),
    ];
    for (const token of tokens) {
      const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token });
      expect(res.status, token).toBe(401);
    }
  });
});

describe("authorisation", () => {
  it("an account that is neither staff nor a linked patient is refused and the denial is audited", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: PORTAL });
    expect(res.status).toBe(403);
    expect(audits).toEqual([
      expect.objectContaining({ p_decision: "deny", p_denial_reason: "no_active_account", p_http_status: 403, actor: "portal-1" }),
    ]);
  });

  it("a pharmacist cannot read diagnoses or vital signs, but can read the patient", async () => {
    const { call, calls } = setup();
    expect((await call(`/fhir/R4/Condition/${CONDITION_A.id}`, { token: PHARMACIST })).status).toBe(403);
    expect((await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}`, { token: PHARMACIST })).status).toBe(403);
    // Refused before any clinical table was read.
    expect(calls.some((c) => /\/rest\/v1\/(conditions|vitals)/.test(c.url))).toBe(false);
    expect((await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: PHARMACIST })).status).toBe(200);
  });

  it("a nurse cannot read diagnoses; a doctor can", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Condition/${CONDITION_A.id}`, { token: NURSE })).status).toBe(403);
    expect((await call(`/fhir/R4/Condition/${CONDITION_A.id}`, { token: DOCTOR })).status).toBe(200);
  });

  it("refuses break-glass, research and unknown purposes", async () => {
    const { call, audits } = setup();
    for (const purpose of ["ETREAT", "HRESCH", "marketing"]) {
      const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR, headers: { "X-Purpose-Of-Use": purpose } });
      expect(res.status, purpose).toBe(403);
    }
    expect(audits.map((a) => a.p_denial_reason)).toEqual(["break_glass_not_enabled", "purpose_not_supported", "purpose_invalid"]);
  });

  it("row-level security still applies: what the database hides stays hidden", async () => {
    // The doctor may read Patients, but the database shows them only A.
    const { call } = setup({ visible: (table, row) => table !== "patients" || row.id === PATIENT_A.id });
    const hidden = await call(`/fhir/R4/Patient/${PATIENT_B.fhir_id}`, { token: DOCTOR });
    expect(hidden.status).toBe(404);
    // Changing the patient in the search does not reach B's vital signs.
    const search = await body(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_B.fhir_id}`, { token: DOCTOR }));
    expect(search.resourceType).toBe("Bundle");
    // Nothing to list: no entry at all (FHIR JSON has no empty arrays).
    expect(search).not.toHaveProperty("entry");
    // Nor does naming B's vitals row directly.
    const direct = await call(`/fhir/R4/Observation/${VITALS_B.id}-heart-rate`, { token: DOCTOR });
    expect(direct.status).toBe(404);
  });
});

describe("enumeration protection", () => {
  it("refuses searches that do not name a record", async () => {
    const { call } = setup();
    for (const path of [
      "/fhir/R4/Patient",
      "/fhir/R4/Patient?name=Ada",
      "/fhir/R4/Patient?birthdate=1984-03-02",
      "/fhir/R4/Observation",
      "/fhir/R4/Observation?category=vital-signs",
      "/fhir/R4/Encounter?status=finished",
      "/fhir/R4/Condition?clinical-status=active",
    ]) {
      const res = await call(path, { token: DOCTOR });
      expect(res.status, path).toBe(403);
    }
  });

  it("refuses search values that carry filter syntax", async () => {
    const { call, calls } = setup();
    for (const q of ["name=A*&birthdate=1984-03-02", "name=a)or(id.gt.0&birthdate=1984-03-02", "name=Ada&birthdate=ge1900-01-01"]) {
      const res = await call(`/fhir/R4/Patient?${q}`, { token: DOCTOR });
      expect([400], q).toContain(res.status);
    }
    expect(calls.some((c) => c.url.includes("/rest/v1/patients"))).toBe(false);
  });

  it("caps pages at 100", async () => {
    const { call } = setup();
    const b = await body(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=100000`, { token: DOCTOR }));
    expect(new URL(b.link[0].url).searchParams.get("_count")).toBe("100");
  });
});

describe("reads", () => {
  it("returns the resource with ETag, Last-Modified and no-store", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: NURSE });
    expect(res.status).toBe(200);
    const p = await body(res);
    expect(p.resourceType).toBe("Patient");
    expect(p.id).toBe(PATIENT_A.fhir_id);
    expect(res.headers.get("etag")).toBe(`W/"${p.meta.versionId}"`);
    expect(res.headers.get("last-modified")).toBe("Fri, 01 May 2026 10:30:00 GMT");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // The version is a digest of what was served (stable for the same content).
    expect(p.meta.versionId).toMatch(/^[0-9a-f]{24}$/);
    expect(res.headers.get("x-request-id")).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("answers If-None-Match with 304", async () => {
    const { call } = setup();
    const first = await call(`/fhir/R4/Encounter/${VISIT_A.id}`, { token: NURSE });
    const etag = first.headers.get("etag")!;
    const again = await call(`/fhir/R4/Encounter/${VISIT_A.id}`, { token: NURSE, headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
  });

  it("404s a missing resource and an invalid id without querying", async () => {
    const { call } = setup();
    expect((await call("/fhir/R4/Patient/0b3c1d2e-1111-4aaa-8bbb-0000000000ff", { token: NURSE })).status).toBe(404);
    expect((await call("/fhir/R4/Patient/not-a-uuid", { token: NURSE })).status).toBe(404);
    expect((await call(`/fhir/R4/Observation/${VITALS_A.id}-heart-rate`, { token: NURSE })).status).toBe(404); // pulse 0
    expect((await call(`/fhir/R4/Observation/${VITALS_A.id}-weight`, { token: NURSE })).status).toBe(200);
  });

  it("audits every read before returning data, with the patient", async () => {
    const { call, audits } = setup();
    await call(`/fhir/R4/Observation/${VITALS_A.id}-weight`, { token: NURSE });
    expect(audits).toEqual([
      expect.objectContaining({
        actor: "nurse-1",
        p_interaction: "read",
        p_resource_type: "Observation",
        p_resource_id: `${VITALS_A.id}-weight`,
        p_patient_ids: [PATIENT_A.id],
        p_decision: "permit",
        p_result_count: 1,
        p_purpose: "TREAT",
        p_http_status: 200,
        p_consent_decision: "not-applicable",
        p_actor_kind: "staff",
      }),
    ]);
  });

  it("returns no data when the audit cannot be written", async () => {
    const { call } = setup({ auditFails: true });
    const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: NURSE });
    expect(res.status).toBe(503);
    const text = JSON.stringify(await body(res));
    expect(text).not.toContain(PATIENT_A.family_name);
    expect(text).not.toMatch(/interop|access_audit|relation/);
  });
});

describe("searches", () => {
  it("finds a patient by identifier, or by name with birth date", async () => {
    const { call } = setup();
    const byId = await body(await call(`/fhir/R4/Patient?identifier=https://mbhr.app/identifiers/patient|${PATIENT_A.fhir_id}`, { token: NURSE }));
    expect(byId.entry.map((e: { resource: { id: string } }) => e.resource.id)).toEqual([PATIENT_A.fhir_id]);
    const byName = await body(await call("/fhir/R4/Patient?name=oka&birthdate=1984-03-02", { token: NURSE }));
    expect(byName.entry).toHaveLength(1);
    const wrongDob = await body(await call("/fhir/R4/Patient?name=oka&birthdate=1984-03-03", { token: NURSE }));
    expect(wrongDob).not.toHaveProperty("entry");
    const otherSystem = await body(await call(`/fhir/R4/Patient?identifier=urn:oid:2.16.840|${PATIENT_A.fhir_id}`, { token: NURSE }));
    expect(otherSystem).not.toHaveProperty("entry");
  });

  it("pages vital signs with a stable cursor and no duplicates", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let url: string | null = `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=2`;
    let pages = 0;
    while (url && pages < 10) {
      const b = await body(await call(url, { token: NURSE }));
      expect(b.type).toBe("searchset");
      // Matches only: a nurse's searchset also carries the note that laboratory results were left out.
      seen.push(...matchIds(b));
      const next = b.link.find((l: { relation: string }) => l.relation === "next");
      url = next ? next.url.replace("https://mbhr.app", "") : null;
      pages++;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(["bp", "temperature", "weight", "height", "spo2"].map((k) => `${VITALS_A.id}-${k}`));
  });

  it("filters Observations by code, category, status, encounter and date", async () => {
    const { call } = setup();
    const ids = async (q: string) => matchIds(await body(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&${q}`, { token: NURSE })));
    expect(await ids("code=http://loinc.org|29463-7")).toEqual([`${VITALS_A.id}-weight`]);
    expect(await ids("code=weight_kg")).toEqual([`${VITALS_A.id}-weight`]);
    expect(await ids("category=laboratory")).toEqual([]);
    expect(await ids("status=preliminary")).toEqual([]);
    expect(await ids(`encounter=Encounter/${VISIT_A.id}&code=8310-5`)).toEqual([`${VITALS_A.id}-temperature`]);
    expect(await ids("date=2026-05-01&code=8302-2")).toEqual([`${VITALS_A.id}-height`]);
    expect(await ids("date=lt2026-05-01&code=8302-2")).toEqual([]);
  });

  it("filters Conditions by clinical status and never matches entered-in-error", async () => {
    const { call } = setup();
    const b = await body(await call(`/fhir/R4/Condition?patient=Patient/${PATIENT_A.fhir_id}&clinical-status=active`, { token: DOCTOR }));
    const matches = b.entry.filter((e: { search: { mode: string } }) => e.search.mode === "match");
    expect(matches.map((e: { resource: { id: string } }) => e.resource.id)).toEqual([CONDITION_A.id]);
    const all = await body(await call(`/fhir/R4/Condition?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR }));
    expect(all.entry.filter((e: { search: { mode: string } }) => e.search.mode === "match")).toHaveLength(2);
    // Every Condition searchset says what the table does not cover.
    const note = all.entry.find((e: { search: { mode: string } }) => e.search.mode === "outcome");
    expect(note.resource.issue[0].severity).toBe("information");
  });

  it("sends a diagnosis only with what was recorded: nothing filled in, a stored 'confirmed' as confirmed", async () => {
    const UNMARKED = { ...CONDITION_A, id: "c0000000-0000-4000-8000-00000000000c", clinical_status: null, verification_status: null, category: null };
    const CONFIRMED = { ...CONDITION_A, id: "c0000000-0000-4000-8000-00000000000d", verification_status: "confirmed" };
    const { call } = setup({
      tables: { patients: [PATIENT_A, PATIENT_B], visits: [VISIT_A], vitals: [VITALS_A, VITALS_B], conditions: [CONDITION_A, UNMARKED, CONFIRMED] },
    });
    const unmarked = await body(await call(`/fhir/R4/Condition/${UNMARKED.id}`, { token: DOCTOR }));
    expect(unmarked.resourceType).toBe("Condition");
    expect(unmarked.clinicalStatus).toBeUndefined();
    expect(unmarked.verificationStatus).toBeUndefined();
    expect(unmarked.category).toBeUndefined();
    const confirmed = await body(await call(`/fhir/R4/Condition/${CONFIRMED.id}`, { token: DOCTOR }));
    expect(confirmed.verificationStatus).toEqual({
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }],
    });
    // A diagnosis with no recorded clinical status matches no clinical-status search.
    const active = await body(await call(`/fhir/R4/Condition?patient=Patient/${PATIENT_A.fhir_id}&clinical-status=active`, { token: DOCTOR }));
    expect(matchIds(active)).toEqual([CONDITION_A.id, CONFIRMED.id]);
    const all = await body(await call(`/fhir/R4/Condition?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR }));
    expect(matchIds(all)).toEqual([CONDITION_A.id, UNMARKED.id, CONFIRMED.id]);
  });

  it("adds verified terminology mappings to the local code", async () => {
    const { call } = setup({ terminology: [{ local_code: "MAL", fhir_system: "http://hl7.org/fhir/sid/icd-10", fhir_code: "B54", fhir_display: null }] });
    const c = await body(await call(`/fhir/R4/Condition/${CONDITION_A.id}`, { token: DOCTOR }));
    expect(c.code.coding.map((x: { system: string }) => x.system)).toEqual(["https://mbhr.app/codes/condition", "http://hl7.org/fhir/sid/icd-10"]);
  });

  it("finds encounters by patient and status", async () => {
    const { call } = setup();
    const ok = await body(await call(`/fhir/R4/Encounter?subject=Patient/${PATIENT_A.fhir_id}&status=finished`, { token: NURSE }));
    expect(ok.entry).toHaveLength(1);
    const none = await body(await call(`/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}&status=in-progress`, { token: NURSE }));
    expect(none).not.toHaveProperty("entry");
  });

  it("audits searches with parameter names only, never values", async () => {
    const { call, audits } = setup();
    await call("/fhir/R4/Patient?name=oka&birthdate=1984-03-02", { token: NURSE });
    expect(audits[0]).toMatchObject({ p_interaction: "search", p_search_params: ["birthdate", "name"], p_patient_ids: [PATIENT_A.id] });
    expect(JSON.stringify(audits)).not.toMatch(/oka|1984/);
  });

  it("records a parameter name the type does not support as unsupported", async () => {
    const { call, audits } = setup();
    // Denied before the parameters are checked, so the name reaches the audit.
    await call("/fhir/R4/Patient?Okafor=1&_count=5", { token: PORTAL });
    expect(audits[0]).toMatchObject({ p_decision: "deny", p_search_params: ["_count", "unsupported"] });
    expect(JSON.stringify(audits)).not.toMatch(/Okafor/);
  });
});

describe("errors and request limits", () => {
  it("refuses writes and other methods with 405", async () => {
    const { call } = setup();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await call("/fhir/R4/Patient", { method, token: DOCTOR, body: method === "DELETE" ? undefined : "{}" });
      expect(res.status, method).toBe(405);
      expect((await body(res)).resourceType).toBe("OperationOutcome");
    }
  });

  it("refuses unknown types, history, operations and oversized URLs", async () => {
    const { call } = setup();
    expect((await call("/fhir/R4/Immunization/1", { token: DOCTOR })).status).toBe(404);
    expect((await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}/_history`, { token: DOCTOR })).status).toBe(400);
    expect((await call("/fhir/R4/Patient/$everything", { token: DOCTOR })).status).toBe(400);
    expect((await call("/fhir/R4/Patient/_search", { token: DOCTOR })).status).toBe(400);
    // Not a FHIR id (too long, or characters ids cannot hold): refused
    // before any query or audit write.
    const { call: probe, calls } = setup();
    expect((await probe(`/fhir/R4/Encounter/${"a".repeat(65)}`, { token: DOCTOR })).status).toBe(400);
    expect((await probe("/fhir/R4/Encounter/a%2Cb", { token: DOCTOR })).status).toBe(400);
    expect(calls.length).toBe(0);
    expect((await call("/fhir/R4", { token: DOCTOR })).status).toBe(400);
    expect((await call(`/fhir/R4/Observation?patient=${"a".repeat(5000)}`, { token: DOCTOR })).status).toBe(414);
    expect((await call("/fhir/R4/.well-known/smart-configuration")).status).toBe(404);
  });

  it("rate-limits per account with 429 and Retry-After", async () => {
    const { call } = setup({ rateAllowed: false });
    const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: NURSE });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });

  it("never leaks database detail and logs no patient data", async () => {
    const { call, logs } = setup({ tables: {} });
    const res = await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}`, { token: NURSE });
    expect(res.status).toBe(200);
    const all = logs.join("\n");
    expect(all).not.toContain(PATIENT_A.fhir_id);
    expect(all).not.toContain(NURSE);
    for (const line of logs) expect(Object.keys(JSON.parse(line)).sort()).toEqual(expect.arrayContaining(["component", "requestId", "status"]));
  });
});
