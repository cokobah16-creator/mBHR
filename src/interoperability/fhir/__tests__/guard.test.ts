// @vitest-environment node
//
// The single routing guard (gateway/guard.ts) and keyset paging
// (resources/shared.ts): everything the gateway does not do is refused
// before any database call, and a page cut short still links onwards.

import { describe, expect, it } from "vitest";
import { routeRequest } from "../gateway/guard";
import { readFhirConfig } from "../config/config";
import { FhirError } from "../errors/operationOutcome";
import { keysetPage, likeLiteral } from "../resources/shared";
import type { Postgrest } from "../gateway/postgrest";
import type { Resource } from "../types/fhir";
import { validateResource } from "../validation/validate";

const config = readFhirConfig({
  FHIR_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
});

function status(path: string, init: RequestInit = {}, c = config): number {
  try {
    routeRequest(new Request(`https://mbhr.app${path}`, init), c);
    return 200;
  } catch (e) {
    return e instanceof FhirError ? e.status : -1;
  }
}

describe("routeRequest", () => {
  it("routes metadata, reads and searches", () => {
    expect(routeRequest(new Request("https://mbhr.app/fhir/R4/metadata"), config)).toEqual({ kind: "metadata" });
    const read = routeRequest(new Request("https://mbhr.app/fhir/R4/Encounter/abc"), config);
    expect(read).toMatchObject({ kind: "read", type: "Encounter", id: "abc" });
    const search = routeRequest(new Request("https://mbhr.app/api/fhir?__fhir_path=Observation&patient=Patient/x"), config);
    expect(search.kind).toBe("search");
    if (search.kind === "search") expect(search.query.toString()).toBe("patient=Patient%2Fx");
  });

  it("refuses every write method with 405", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) expect(status("/fhir/R4/Patient", { method }), method).toBe(405);
  });

  it("refuses a body on a GET, an oversized URL, and whole-system or deep paths", () => {
    expect(status("/fhir/R4/Patient", { headers: { "content-length": "10" } })).toBe(400);
    expect(status(`/fhir/R4/Patient?name=${"a".repeat(5000)}`)).toBe(414);
    expect(status("/fhir/R4")).toBe(400);
    expect(status("/fhir/R4/Patient/abc/_history/1")).toBe(400);
    expect(status("/fhir/R4/Patient/$everything")).toBe(400);
    expect(status("/fhir/R4/Patient/_search")).toBe(400);
    expect(status("/fhir/R4/Patient/a%2Fb")).toBe(400);
  });

  it("answers near-miss paths (vercel.json sends /fhir/* here) with a FHIR 404", () => {
    expect(status("/api/fhir?__fhir_path=__not_fhir_r4__")).toBe(404);
    expect(status("/api/fhir?__fhir_path=__not_fhir_r4__&x=1")).toBe(404);
  });

  it("refuses unknown types, and reads with parameters", () => {
    expect(status("/fhir/R4/Immunization")).toBe(404);
    expect(status("/fhir/R4/Procedure/1")).toBe(404);
    expect(status("/fhir/R4/CarePlan?patient=x")).toBe(404);
    expect(status("/fhir/R4/Communication/1")).toBe(404);
    expect(status("/fhir/R4/Patient/abc?name=x")).toBe(400);
  });

  it("negotiates FHIR JSON only (406 otherwise)", () => {
    expect(status("/fhir/R4/Patient/abc", { headers: { accept: "application/fhir+xml" } })).toBe(406);
    expect(status("/fhir/R4/Patient/abc?_format=xml")).toBe(406);
    expect(status("/fhir/R4/Patient/abc", { headers: { accept: "application/fhir+json; fhirVersion=4.0" } })).toBe(200);
    expect(status("/fhir/R4/Patient/abc", { headers: { accept: "text/html, */*;q=0.1" } })).toBe(200);
  });

  it("serves Binary by id only, as the file itself", () => {
    expect(status("/fhir/R4/Binary")).toBe(400);
    expect(status("/fhir/R4/Binary/doc1", { headers: { accept: "application/fhir+json" } })).toBe(406);
    expect(status("/fhir/R4/Binary/doc1", { headers: { accept: "application/pdf" } })).toBe(200);
  });

  it("answers only metadata while read and search are switched off", () => {
    const off = { ...config, readEnabled: false };
    expect(status("/fhir/R4/metadata", {}, off)).toBe(200);
    expect(status("/fhir/R4/Patient/abc", {}, off)).toBe(404);
  });
});

describe("keysetPage", () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: `r${String(i).padStart(4, "0")}` }));
  const db = {
    async select(_t: string, _c: readonly string[], filters: [string, string][], opts: { limit?: number } = {}) {
      const after = filters.find(([k]) => k === "id")?.[1].replace(/^gt\./, "");
      return rows.filter((r) => after === undefined || r.id > after).slice(0, opts.limit ?? 1000);
    },
  } as unknown as Postgrest;
  const as = (id: string): Resource => ({ resourceType: "Basic", id });

  it("fills a page and links onwards from its last entry", async () => {
    const { page } = await keysetPage({ db, table: "vitals", columns: ["id"], key: "id", keyPattern: /^r\d+$/, filters: [], count: 10, cursor: null, map: async (rs) => rs.map((r) => as(String(r.id))) });
    expect(page.resources.map((r) => r.id)).toEqual(rows.slice(0, 10).map((r) => r.id));
    expect(page.next).toEqual({ k: "r0009" });
  });

  it("cuts a page short after the round limit, but still links onwards so no match is lost", async () => {
    // Only the last row maps to a resource.
    const map = async (rs: Record<string, unknown>[]) => rs.map((r) => (r.id === "r0299" ? as("hit") : null));
    const first = await keysetPage({ db, table: "vitals", columns: ["id"], key: "id", keyPattern: /^r\d+$/, filters: [], count: 10, cursor: null, map });
    expect(first.page.resources).toEqual([]);
    expect(first.page.next).not.toBeNull();
    let cursor = first.page.next;
    let found: string[] = [];
    for (let i = 0; i < 5 && cursor; i++) {
      const p = await keysetPage({ db, table: "vitals", columns: ["id"], key: "id", keyPattern: /^r\d+$/, filters: [], count: 10, cursor, map });
      found = found.concat(p.page.resources.map((r) => r.id as string));
      cursor = p.page.next;
    }
    expect(found).toEqual(["hit"]);
  });

  it("refuses a cursor key that does not look like its key", async () => {
    await expect(
      keysetPage({ db, table: "vitals", columns: ["id"], key: "id", keyPattern: /^r\d+$/, filters: [], count: 10, cursor: { k: "x;drop" }, map: async () => [] }),
    ).rejects.toThrow(FhirError);
  });
});

describe("likeLiteral", () => {
  it("makes LIKE wildcards literal", () => {
    expect(likeLiteral("in_progress")).toBe("in\\_progress");
    expect(likeLiteral("50%")).toBe("50\\%");
    expect(likeLiteral("a*b\\c")).toBe("ab\\\\c");
  });
});

describe("reference checks in validateResource", () => {
  const consent = (reference: unknown): Resource =>
    ({
      resourceType: "Basic",
      id: "c1",
      code: { text: "x" },
      provision: { actor: [{ role: { text: "recipient" }, reference }] },
    }) as unknown as Resource;
  const paths = (r: Resource) => validateResource(r).map((i) => `${i.path}: ${i.message}`);

  it("walks a Reference held in an element named reference (Consent.provision.actor.reference)", () => {
    expect(paths(consent({ reference: "Organization/org-1", display: "Partner" })).filter((p) => p.includes("reference"))).toEqual([]);
    expect(paths(consent({ reference: "https://elsewhere.example/Organization/x" }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/provision\.actor\[0\]\.reference\.reference: not a relative Type\/id reference/)]),
    );
  });

  it("still refuses a reference string that is not Type/id", () => {
    expect(paths(consent("https://elsewhere.example/Patient/x"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/provision\.actor\[0\]\.reference: not a relative Type\/id reference/)]),
    );
  });
});
