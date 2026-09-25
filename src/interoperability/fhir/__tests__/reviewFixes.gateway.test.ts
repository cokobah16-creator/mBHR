// @vitest-environment node
//
// Fixes from the Phase 2 final review, gateway side, end to end against the
// in-memory Supabase where they change what a caller gets:
//   C2  a date search never matches a visit published without a period
//   C3  a searchset with nothing to list has no "entry"
//   L4  a padded visit status is unknown in the mapper, the map and search
//   L9  Binary declares no versioning and no conditional read
//   L10 a status token in another code system matches nothing
//   L11 code= matches only the codings Observation.code carries
//   L12 a read answered 304 is audited as 304
//       and a module's refusal is audited with the reason it names
//       (a laboratory Observation read without the permission:
//       missing_permission, as DiagnosticReport)
//   L16 what patients get is published only while patient access is on
// C1 (laboratory results withheld from nurses) is in laboratory.test.ts,
// Binary's conditional read in documents.test.ts, and the laboratory status
// systems (DiagnosticReport, ServiceRequest, laboratory Observation) in
// laboratory.test.ts.

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { errors } from "../errors/operationOutcome";
import { capabilityStatement } from "../capability/capabilityStatement";
import { conformanceExamples } from "../conformance/examples";
import { mapEncounter, mapVisitStatus } from "../mappers/encounter";
import { mapEncounterStatus } from "../terminology/statusMaps";
import { PUBLISHED_TYPES, RESOURCE_DEFINITIONS } from "../resources/registry";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser } from "./fakeSupabase";
import { CONDITION_A, PATIENT_A, PATIENT_B, VISIT_A, VITALS_A } from "./fixtures";

const BASE = "https://mbhr.app/fhir/R4";
const ENV = {
  FHIR_ENABLED: "true",
  FHIR_PATIENT_ACCESS_ENABLED: "true",
  FHIR_BASE_URL: BASE,
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

const DOCTOR = makeToken("doctor-1");
const NURSE = makeToken("nurse-1");
const PAT_A = makeToken("portal-a");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "lab_review", "register", "vitals", "queue"] },
  [NURSE]: { id: "nurse-1", role: "nurse", permissions: ["register", "vitals", "queue", "portal_manage"] },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
};

/** Row-level security as the portal policies have it: a patient sees only their own rows. */
function visible(table: string, row: Record<string, unknown>, user: FakeUser): boolean {
  if ((user.kind ?? "staff") !== "patient") return true;
  const own = user.patientIds ?? [];
  if (table === "patients") return own.includes(String(row.id));
  return own.includes(String(row.patient_id));
}

// Visits on one clinic day (2026-07-14): two "Portal entry" visits (typed in
// afterwards; the mapper publishes no period), one on the tablet's default
// site and one with no site (both published with their start time).
const DAY = "2026-07-14";
const PORTAL = { ...VISIT_A, id: "01HZZVISITPORTAL0000000000", site_name: "Portal entry", started_at: "2026-07-14T15:47:12.345+00:00" };
const PORTAL_PADDED = { ...VISIT_A, id: "01HZZVISITPORTAL1000000000", site_name: "  PORTAL ENTRY ", started_at: "2026-07-14T16:00:00+00:00" };
const MOBILE = { ...VISIT_A, id: "01HZZVISITMOBILE0000000000", site_name: "Mobile Clinic", started_at: "2026-07-14T10:00:00+00:00" };
const NO_SITE = { ...VISIT_A, id: "01HZZVISITNOSITE0000000000", site_name: null, started_at: "2026-07-14T09:00:00+00:00" };
// A status stored with padding: not one the app writes, so unknown everywhere.
const PADDED_STATUS = { ...VISIT_A, id: "01HZZVISITPADDED0000000000", status: " closed", started_at: "2026-06-01T09:00:00+00:00" };
// A blood pressure with only the diastolic half recorded.
const VITALS_HALF_BP = { ...VITALS_A, id: "01HZZVITALSHALF0000000000", systolic: null, diastolic: 90, temp_c: null, height_cm: null, spo2: null };

function setup(overrides: Partial<FakeOptions> = {}, env: Record<string, string> = ENV) {
  const fake = fakeSupabase({
    users: USERS,
    tables: {
      patients: [PATIENT_A, PATIENT_B],
      visits: [VISIT_A, PORTAL, PORTAL_PADDED, MOBILE, NO_SITE, PADDED_STATUS],
      vitals: [VITALS_A, VITALS_HALF_BP],
      conditions: [CONDITION_A],
    },
    visible,
    ...overrides,
  });
  const call = (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    return handleFhirRequest(new Request(`https://mbhr.app${path}`, { ...init, headers }), {
      env,
      fetchImpl: fake.fetchImpl,
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: () => undefined,
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
  };
  return { ...fake, call };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const json = async (res: Response) => (await res.json()) as Json;
const matches = (b: Json): Json[] => (b.entry ?? []).filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const ids = (b: Json): string[] => matches(b).map((r) => r.id);

/** Every match of a search, following next links; and the number of pages. */
async function allPages(call: ReturnType<typeof setup>["call"], path: string, token: string): Promise<{ ids: string[]; pages: Json[] }> {
  const out: string[] = [];
  const pages: Json[] = [];
  let url: string | null = path;
  for (let i = 0; url && i < 20; i++) {
    const res = await call(url, { token });
    expect(res.status, url).toBe(200);
    const b = await json(res);
    pages.push(b);
    out.push(...ids(b));
    const next = (b.link as Json[]).find((l) => l.relation === "next");
    url = next ? String(next.url).replace("https://mbhr.app", "") : null;
  }
  return { ids: out, pages };
}

describe("C2: Encounter date search and visits published without a period", () => {
  it("a date search never matches a 'Portal entry' visit, by the mapper's own rule", async () => {
    const { call } = setup();
    const search = async (q: string, token = DOCTOR) => json(await call(`/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}&${q}`, { token }));
    // Without a date both Portal entry visits are listed, with no period.
    const all = matches(await search("_count=50"));
    for (const v of [PORTAL, PORTAL_PADDED]) expect(all.find((e) => e.id === v.id)).not.toHaveProperty("period");
    // On their day, only the visits that publish a period match.
    const onDay = matches(await search(`date=${DAY}`));
    expect(onDay.map((e) => e.id)).toStrictEqual([MOBILE.id, NO_SITE.id]);
    for (const e of onDay) expect(e.period.start.startsWith(DAY)).toBe(true);
    // The hidden start time cannot be found by bracketing it.
    expect(ids(await search("date=ge2026-07-14T15:47:12Z&date=lt2026-07-14T15:47:13Z"))).toStrictEqual([]);
    expect(ids(await search("date=ge2026-07-14T15:59:00Z&date=lt2026-07-14T16:01:00Z"))).toStrictEqual([]);
    expect(ids(await search(`date=ge${DAY}&status=finished`))).toStrictEqual([MOBILE.id, NO_SITE.id]);
    // A patient reading their own visits gets the same answer.
    const own = await json(await call(`/fhir/R4/Encounter?date=${DAY}`, { token: PAT_A }));
    expect(ids(own)).toStrictEqual([MOBILE.id, NO_SITE.id]);
  });

  it("pages past Portal entry visits without losing a later match", async () => {
    // 200 visits on one day in id order, all Portal entry except #150 and #190.
    const visits = Array.from({ length: 200 }, (_, i) => ({
      ...VISIT_A,
      id: `01HZZVISIT${String(i).padStart(16, "0")}`,
      site_name: i === 150 || i === 190 ? "Asaba outreach" : "Portal entry",
      started_at: "2026-07-14T10:00:00+00:00",
    }));
    const { call } = setup({ tables: { patients: [PATIENT_A], visits } });
    const want = [visits[150].id, visits[190].id];
    for (const count of [1, 2, 50]) {
      const { ids: got, pages } = await allPages(call, `/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}&date=${DAY}&_count=${count}`, DOCTOR);
      expect(got, String(count)).toStrictEqual(want);
      if (count === 1) {
        // The first page reached the round limit with nothing to show: it is short, and links on.
        expect(pages[0]).not.toHaveProperty("entry");
        expect((pages[0].link as Json[]).some((l) => l.relation === "next")).toBe(true);
      }
    }
    // Without a date every visit is listed.
    const { ids: undated } = await allPages(call, `/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}&_count=100`, DOCTOR);
    expect(undated).toHaveLength(200);
  });

  it("documents the rule on the date parameter", () => {
    const date = RESOURCE_DEFINITIONS.Encounter.searchParams.find((p) => p.name === "date");
    expect(date?.documentation).toMatch(/without a period \(site 'Portal entry'\) never matches/);
  });
});

describe("C3: empty searchsets", () => {
  it("a search with no match and no note has no entry", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Encounter?patient=Patient/${PATIENT_B.fhir_id}`, { token: DOCTOR }));
    expect(b).toMatchObject({ resourceType: "Bundle", type: "searchset" });
    expect("entry" in b).toBe(false);
  });

  it("the conformance examples include one, for the HL7 validator", () => {
    const example = conformanceExamples()["Bundle-empty-search"] as Json;
    expect(example).toMatchObject({ resourceType: "Bundle", type: "searchset" });
    expect("entry" in example).toBe(false);
    expect(JSON.stringify(example)).not.toContain("[]");
  });
});

describe("L4: a padded visit status", () => {
  it("is unknown in the mapper, the status map and the search alike", async () => {
    const refs = { patientFhirIds: new Map([[PATIENT_A.id, PATIENT_A.fhir_id]]) };
    expect(mapEncounterStatus(" closed")).toBe("unknown");
    expect(mapVisitStatus(" closed")).toBe("unknown");
    expect(mapEncounter(PADDED_STATUS, refs)?.status).toBe("unknown");
    for (const blank of ["", "   ", null, undefined]) expect(mapEncounter({ ...VISIT_A, status: blank }, refs)?.status).toBe("unknown");
    // Case is not padding: the app's own value in capitals is still recognised.
    expect(mapEncounter({ ...VISIT_A, status: "CLOSED" }, refs)?.status).toBe("finished");

    const { call } = setup();
    const search = async (q: string) => json(await call(`/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}&${q}`, { token: DOCTOR }));
    const unknown = matches(await search("status=unknown"));
    expect(unknown.map((e) => e.id)).toStrictEqual([PADDED_STATUS.id]);
    expect(unknown[0].status).toBe("unknown");
    expect(ids(await search("status=finished"))).not.toContain(PADDED_STATUS.id);
    expect((await json(await call(`/fhir/R4/Encounter/${PADDED_STATUS.id}`, { token: DOCTOR }))).status).toBe("unknown");
  });
});

describe("L10: status tokens and their code system", () => {
  it("match a bare code or the element's own system; another system matches nothing", async () => {
    const { call } = setup();
    const search = async (path: string) => ids(await json(await call(path, { token: DOCTOR })));
    const enc = `/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}&_id=${VISIT_A.id}`;
    expect(await search(`${enc}&status=finished`)).toStrictEqual([VISIT_A.id]);
    expect(await search(`${enc}&status=http://hl7.org/fhir/encounter-status|finished`)).toStrictEqual([VISIT_A.id]);
    expect(await search(`${enc}&status=http://example.org/other|finished`)).toStrictEqual([]);
    expect(await search(`${enc}&status=|finished`)).toStrictEqual([]);

    const height = `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&code=8302-2`;
    expect(await search(`${height}&status=final`)).toStrictEqual([`${VITALS_A.id}-height`]);
    expect(await search(`${height}&status=http://hl7.org/fhir/observation-status|final`)).toStrictEqual([`${VITALS_A.id}-height`]);
    expect(await search(`${height}&status=http://example.org/other|final`)).toStrictEqual([]);

    const cond = `/fhir/R4/Condition?patient=Patient/${PATIENT_A.fhir_id}`;
    expect(await search(`${cond}&clinical-status=active`)).toStrictEqual([CONDITION_A.id]);
    expect(await search(`${cond}&clinical-status=http://terminology.hl7.org/CodeSystem/condition-clinical|active`)).toStrictEqual([CONDITION_A.id]);
    expect(await search(`${cond}&clinical-status=http://example.org/other|active`)).toStrictEqual([]);
    expect(await search(`${cond}&clinical-status=http://terminology.hl7.org/CodeSystem/condition-ver-status|active`)).toStrictEqual([]);
  });
});

describe("L11: Observation code= matches what Observation.code carries", () => {
  it("a blood pressure matches on its panel code only, never on a component's code", async () => {
    const { call } = setup();
    const search = async (q: string) => ids(await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=50&${q}`, { token: DOCTOR })));
    const bp = [`${VITALS_A.id}-bp`, `${VITALS_HALF_BP.id}-bp`];
    expect(await search("code=http://loinc.org|85354-9")).toStrictEqual(bp);
    expect(await search("code=85354-9")).toStrictEqual(bp);
    for (const q of [
      "code=https://mbhr.app/codes/vitals|systolic",
      "code=https://mbhr.app/codes/vitals|diastolic",
      "code=systolic",
      "code=diastolic",
      "code=http://loinc.org|8480-6",
      "code=8462-4",
    ]) {
      expect(await search(q), q).toStrictEqual([]);
    }
    // Single-column kinds still match on their column code, in its own system only.
    expect(await search("code=https://mbhr.app/codes/vitals|weight_kg")).toStrictEqual([`${VITALS_A.id}-weight`, `${VITALS_HALF_BP.id}-weight`]);
    expect(await search("code=http://loinc.org|weight_kg")).toStrictEqual([]);
  });

  it("every coding a vital sign carries finds it, and every match carries the coding searched", async () => {
    const { call } = setup();
    const url = (q: string) => `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&category=vital-signs&_count=50${q}`;
    const all = matches(await json(await call(url(""), { token: DOCTOR })));
    expect(all.length).toBeGreaterThan(5);
    for (const obs of all) {
      for (const c of obs.code.coding as Json[]) {
        const found = matches(await json(await call(url(`&code=${encodeURIComponent(`${c.system}|${c.code}`)}`), { token: DOCTOR })));
        expect(found.map((o) => o.id), `${c.system}|${c.code}`).toContain(obs.id);
        for (const o of found) expect((o.code.coding as Json[]).some((x) => x.system === c.system && x.code === c.code)).toBe(true);
      }
    }
  });
});

describe("L12: conditional reads in the access record", () => {
  it("a read answered 304 is recorded with 304, and one answered 200 with 200", async () => {
    const { call, audits } = setup();
    const path = `/fhir/R4/Encounter/${VISIT_A.id}`;
    const first = await call(path, { token: NURSE });
    expect(first.status).toBe(200);
    expect(audits.at(-1)).toMatchObject({ p_decision: "permit", p_http_status: 200, p_result_count: 1 });
    const etag = first.headers.get("etag") as string;

    const again = await call(path, { token: NURSE, headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("private, no-store");
    expect(audits.at(-1)).toMatchObject({ p_decision: "permit", p_http_status: 304, p_patient_ids: [PATIENT_A.id] });

    const changed = await call(path, { token: NURSE, headers: { "If-None-Match": 'W/"000000000000000000000000"' } });
    expect(changed.status).toBe(200);
    expect(audits.at(-1)).toMatchObject({ p_http_status: 200 });

    // Not found stays 404 whatever the client holds.
    const missing = await call("/fhir/R4/Encounter/01HZZVISITMISSING000000000", { token: NURSE, headers: { "If-None-Match": "*" } });
    expect(missing.status).toBe(404);
    expect(audits.at(-1)).toMatchObject({ p_http_status: 404 });
    expect(audits).toHaveLength(4);
  });
});

describe("Audit reasons for a refusal from a resource module", () => {
  it("records the reason the error names, else one from the status, and never sends it to the caller", async () => {
    expect(errors.forbidden().auditReason).toBeUndefined();
    expect(errors.forbidden("x", { auditReason: "missing_permission" })).toMatchObject({ status: 403, code: "forbidden", auditReason: "missing_permission" });

    // A 403 that names no reason (here: a Patient name search without a birth date) stays "forbidden".
    const { call, audits } = setup();
    const r = await call(`/fhir/R4/Patient?_id=${PATIENT_A.fhir_id}&name=Ada`, { token: DOCTOR });
    expect(r.status).toBe(403);
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "forbidden", p_http_status: 403 });
    // A laboratory Observation read without consult or lab_review is recorded as missing_permission
    // (laboratory.test.ts checks it for nurses and volunteers); the caller sees only the refusal.
    const lab = await call("/fhir/R4/Observation/lab-00000000-0000-4000-8000-0000000000ff", { token: NURSE });
    expect(lab.status).toBe(403);
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "missing_permission", p_http_status: 403 });
    expect(await lab.text()).not.toMatch(/missing_permission/);
  });
});

/**
 * Wording that describes what a patient gets or does ("Patients see",
 * "A patient gets", "a patient's view", "for a patient", "patients reading",
 * "a patient account", "the patient's own"). Not "Patient" as a resource
 * type or a parameter name (Patient/[id], patient=), and not "this
 * patient's records" about the record a search names.
 */
const PATIENT_WORDING = /\bpatients?(?:'s)? (?:account|caller|view|see|sees|get|gets|reading|own)|\ba patient's\b|\bfor a patient\b/i;

describe("L9 and L16: the CapabilityStatement", () => {
  const byType = (cs: Json): Record<string, Json> => Object.fromEntries((cs.rest[0].resource as Json[]).map((r) => [r.type, r]));

  it("declares no versioning and no conditional read for Binary only", () => {
    const types = byType(capabilityStatement(BASE));
    expect(types.Binary).toMatchObject({ versioning: "no-version", conditionalRead: "not-supported" });
    for (const t of PUBLISHED_TYPES.filter((x) => x !== "Binary")) {
      expect(types[t], t).toMatchObject({ versioning: "versioned", conditionalRead: "not-match" });
    }
  });

  it("says what patients get only while patient access is on", async () => {
    const withPatientAccessNotes = PUBLISHED_TYPES.filter((t) => RESOURCE_DEFINITIONS[t].patientAccessNotes?.length);
    expect(withPatientAccessNotes).toEqual(
      expect.arrayContaining(["Encounter", "Observation", "MedicationDispense", "DiagnosticReport", "DocumentReference", "Binary", "Consent"]),
    );
    // Only types a patient may read at all describe what a patient gets.
    for (const t of withPatientAccessNotes) expect(RESOURCE_DEFINITIONS[t].patientAccess, t).toBe(true);

    const off = capabilityStatement(BASE, undefined, { patientAccessEnabled: false });
    const on = capabilityStatement(BASE, undefined, { patientAccessEnabled: true });
    const offTypes = byType(off);
    const onTypes = byType(on);
    for (const t of withPatientAccessNotes) {
      for (const sentence of RESOURCE_DEFINITIONS[t].patientAccessNotes ?? []) {
        expect(offTypes[t].documentation ?? "", t).not.toContain(sentence);
        expect(onTypes[t].documentation, t).toContain(sentence);
      }
      // The staff notes are published either way.
      for (const sentence of RESOURCE_DEFINITIONS[t].notes ?? []) expect(offTypes[t].documentation, t).toContain(sentence);
    }
    // Nothing anywhere in the statement describes what a patient gets or does
    // while patient access is off: not the descriptions, not the resource
    // notes, not a search parameter. "Patient" as a type or a parameter name
    // (Patient/[id], patient=) is not patient wording.
    expect(JSON.stringify(off)).not.toMatch(PATIENT_WORDING);
    expect(JSON.stringify(on)).toMatch(PATIENT_WORDING);
    expect(JSON.stringify(on)).toMatch(/Patients see their closed visits only/);
    expect(on.rest[0].security.description).toMatch(/the patient's own records for a patient account/);
    // The regex does catch every patient sentence the definitions hold.
    for (const t of PUBLISHED_TYPES) {
      for (const sentence of RESOURCE_DEFINITIONS[t].patientAccessNotes ?? []) expect(sentence, t).toMatch(PATIENT_WORDING);
      for (const p of RESOURCE_DEFINITIONS[t].searchParams) {
        if (p.patientDocumentation) expect(p.patientDocumentation, `${t}.${p.name}`).toMatch(PATIENT_WORDING);
      }
    }

    // The same through /metadata, from the flag.
    const { call } = setup({}, { ...ENV, FHIR_PATIENT_ACCESS_ENABLED: "false" });
    const metadataOff = await json(await call("/fhir/R4/metadata"));
    expect(JSON.stringify(metadataOff)).not.toMatch(PATIENT_WORDING);
    expect(byType(metadataOff).Encounter.documentation).not.toMatch(/Patients see/);
    const metadataOn = await json(await setup().call("/fhir/R4/metadata"));
    expect(byType(metadataOn).Encounter.documentation).toMatch(/Patients see their closed visits only/);
  });

  it("says what a search parameter does for a patient only while patient access is on", async () => {
    const withPatientDocs = PUBLISHED_TYPES.flatMap((t) =>
      RESOURCE_DEFINITIONS[t].searchParams.filter((p) => p.patientDocumentation).map((p) => `${t}.${p.name}`),
    );
    expect(withPatientDocs).toEqual(expect.arrayContaining(["DiagnosticReport.status", "MedicationDispense.prescription", "Consent.patient"]));
    for (const t of PUBLISHED_TYPES) {
      for (const p of RESOURCE_DEFINITIONS[t].searchParams) {
        // The text published either way never describes patients.
        expect(p.documentation, `${t}.${p.name}`).not.toMatch(PATIENT_WORDING);
        // Only types a patient may read at all describe what a patient gets.
        if (p.patientDocumentation) expect(RESOURCE_DEFINITIONS[t].patientAccess, `${t}.${p.name}`).toBe(true);
      }
    }

    const param = (cs: Json, type: string, name: string): string =>
      (byType(cs)[type].searchParam as Json[]).find((p) => p.name === name)?.documentation;
    const off = capabilityStatement(BASE, undefined, { patientAccessEnabled: false });
    const on = capabilityStatement(BASE, undefined, { patientAccessEnabled: true });
    for (const t of PUBLISHED_TYPES) {
      for (const p of RESOURCE_DEFINITIONS[t].searchParams) {
        expect(param(off, t, p.name), `${t}.${p.name}`).toBe(p.documentation);
        expect(param(on, t, p.name), `${t}.${p.name}`).toBe(
          p.patientDocumentation ? `${p.documentation} ${p.patientDocumentation}` : p.documentation,
        );
      }
    }
    expect(param(off, "DiagnosticReport", "status")).not.toMatch(/never final/);
    expect(param(on, "DiagnosticReport", "status")).toMatch(/A patient's reports are never final, so status=final finds none for a patient\.$/);
    expect(param(off, "MedicationDispense", "prescription")).not.toMatch(/patient|Staff only/i);
    expect(param(on, "MedicationDispense", "prescription")).toMatch(/Staff only: a patient's view carries no authorizingPrescription\.$/);
    expect(param(off, "Consent", "patient")).not.toMatch(/staff|own current record/i);
    expect(param(on, "Consent", "patient")).toMatch(/A patient gets only directives filed under their own current record/);

    // The same through /metadata, from the flag.
    const metadataOff = await json(await setup({}, { ...ENV, FHIR_PATIENT_ACCESS_ENABLED: "false" }).call("/fhir/R4/metadata"));
    expect(param(metadataOff, "DiagnosticReport", "status")).not.toMatch(/patient/i);
    const metadataOn = await json(await setup().call("/fhir/R4/metadata"));
    expect(param(metadataOn, "DiagnosticReport", "status")).toMatch(/A patient's reports are never final/);
  });
});
