import { describe, it, expect } from "vitest";
import {
  describeFlags,
  fetchMetadataSummary,
  loadAdminStatus,
  parseAdminStatus,
  parseFlagsHeader,
  reasonLabel,
  safeBaseUrl,
  summarizeMetadata,
  unknownFlags,
  type FetchLike,
} from "./interopStatus";
import type { InteropRpcClient } from "./interopRpc";

const CAPABILITY = {
  resourceType: "CapabilityStatement",
  fhirVersion: "4.0.1",
  software: { name: "mBHR FHIR gateway", version: "0.2.0" },
  implementation: { url: "https://mbhr.example.org/fhir/R4/" },
  rest: [
    {
      mode: "server",
      resource: [{ type: "Patient" }, { type: "Encounter" }, { type: "bad type" }, { type: "Patient" }],
    },
  ],
};

describe("parseFlagsHeader", () => {
  it("reads the documented format", () => {
    expect(
      parseFlagsHeader("read=on; patient=off; consent=on; audit=on; external=off; write=off; smart=off"),
    ).toEqual({
      read: true,
      patient: false,
      consent: true,
      audit: true,
      external: false,
      write: false,
      smart: false,
    });
  });

  it("treats a missing header or value as unknown, never off", () => {
    expect(parseFlagsHeader(null)).toEqual(unknownFlags());
    expect(parseFlagsHeader("")).toEqual(unknownFlags());
    const partial = parseFlagsHeader("read=on;smart=maybe;bogus=on;external");
    expect(partial.read).toBe(true);
    expect(partial.smart).toBeNull();
    expect(partial.external).toBeNull();
    expect(partial.write).toBeNull();
  });

  it("is tolerant of case and spacing", () => {
    expect(parseFlagsHeader(" WRITE = OFF , Smart=Off").write).toBe(false);
  });
});

describe("describeFlags", () => {
  it("labels the flags the admin screen shows", () => {
    const rows = describeFlags(
      parseFlagsHeader("read=on; patient=off; consent=on; audit=on; external=off; write=off; smart=off"),
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["External apps"]).toBe("No");
    expect(byLabel["SMART"]).toBe("No");
    expect(byLabel["Writes"]).toBe("No");
    expect(byLabel["Patient access"]).toBe("Off");
    expect(byLabel["Consent enforcement"]).toBe("On");
    expect(describeFlags(unknownFlags()).every((r) => r.value === "Unknown")).toBe(true);
  });
});

describe("summarizeMetadata", () => {
  it("404 means off", () => {
    expect(summarizeMetadata(404, null, null).state).toBe("off");
  });

  it("200 with a capability statement means on", () => {
    const s = summarizeMetadata(200, CAPABILITY, "external=off");
    expect(s).toEqual({
      state: "on",
      fhirVersion: "4.0.1",
      softwareVersion: "0.2.0",
      baseUrl: "https://mbhr.example.org/fhir/R4",
      resources: ["Encounter", "Patient"],
      flags: { ...unknownFlags(), external: false },
    });
  });

  it("does not claim on for other answers", () => {
    expect(summarizeMetadata(200, "<html>", null).state).toBe("unknown");
    expect(summarizeMetadata(200, { resourceType: "OperationOutcome" }, null).state).toBe("unknown");
    expect(summarizeMetadata(503, null, null).state).toBe("unavailable");
    expect(summarizeMetadata(401, null, null).state).toBe("unknown");
  });
});

describe("safeBaseUrl", () => {
  it("drops credentials, query and fragment", () => {
    expect(safeBaseUrl("https://user:pw@host.example/fhir/R4?key=abc#x")).toBe(
      "https://host.example/fhir/R4",
    );
    expect(safeBaseUrl("javascript:alert(1)")).toBeNull();
    expect(safeBaseUrl("not a url")).toBeNull();
    expect(safeBaseUrl(42)).toBeNull();
  });
});

describe("fetchMetadataSummary", () => {
  function fakeFetch(status: number, body: unknown, flags: string | null) {
    const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = [];
    const fn: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({
        status,
        headers: { get: (name: string) => (name === "X-MBHR-FHIR-Flags" ? flags : null) },
        json: () => (body === undefined ? Promise.reject(new SyntaxError("bad")) : Promise.resolve(body)),
      });
    };
    return { fn, calls };
  }

  it("fetches this site's metadata without credentials", async () => {
    const { fn, calls } = fakeFetch(200, CAPABILITY, "write=off");
    const s = await fetchMetadataSummary(fn, "https://app.example/", true);
    expect(s.state).toBe("on");
    expect(s.flags.write).toBe(false);
    expect(calls[0].url).toBe("https://app.example/fhir/R4/metadata");
    expect(calls[0].init?.credentials).toBe("omit");
    expect(calls[0].init?.headers).toEqual({ Accept: "application/fhir+json" });
  });

  it("handles 404, bad JSON, offline and network failure", async () => {
    expect((await fetchMetadataSummary(fakeFetch(404, null, null).fn, "", true)).state).toBe("off");
    expect((await fetchMetadataSummary(fakeFetch(200, undefined, null).fn, "", true)).state).toBe(
      "unknown",
    );
    const { fn, calls } = fakeFetch(200, CAPABILITY, null);
    expect((await fetchMetadataSummary(fn, "", false)).state).toBe("offline");
    expect(calls).toHaveLength(0);
    const failing: FetchLike = () => Promise.reject(new TypeError("Failed to fetch"));
    expect((await fetchMetadataSummary(failing, "", true)).state).toBe("offline");
  });
});

describe("parseAdminStatus", () => {
  const row = {
    occurred_at: "2026-09-25T10:00:00Z",
    action: "search",
    resource_type: "Observation",
    decision: "deny",
    denial_reason: "missing_patient_filter",
    actor_role: "nurse",
    http_status: 403,
  };

  it("keeps the documented fields only", () => {
    const s = parseAdminStatus({
      requests_24h: 4,
      denials_24h: 1,
      requests_7d: 10,
      denials_7d: 2,
      recent: [{ ...row, patient_ids: ["01HXSECRET"], actor_user_id: "uid", token: "t" }],
      recent_denials: [row],
      consent: { records: 3, active: 1, withdrawn: 1 },
    });
    expect(s?.requests24h).toBe(4);
    expect(s?.recent[0]).toEqual({
      occurredAt: "2026-09-25T10:00:00Z",
      action: "search",
      resourceType: "Observation",
      decision: "deny",
      reason: "missing_patient_filter",
      role: "nurse",
      httpStatus: 403,
    });
    const text = JSON.stringify(s);
    expect(text).not.toContain("01HXSECRET");
    expect(text).not.toContain("uid");
    expect(s?.consent).toEqual({ records: 3, active: 1, withdrawn: 1 });
  });

  it("drops values that do not match their pattern", () => {
    const s = parseAdminStatus({
      recent: [
        { ...row, resource_type: "Patient/123", denial_reason: "Bearer abc.def", actor_role: "a@b.c", http_status: 9999 },
        { ...row, occurred_at: "not a time" },
      ],
    });
    expect(s?.recent).toHaveLength(1);
    expect(s?.recent[0].resourceType).toBeNull();
    expect(s?.recent[0].reason).toBeNull();
    expect(s?.recent[0].role).toBeNull();
    expect(s?.recent[0].httpStatus).toBeNull();
    expect(s?.requests24h).toBeNull();
    expect(s?.consent).toBeNull();
    expect(parseAdminStatus([])).toBeNull();
  });
});

describe("loadAdminStatus", () => {
  const client = (result: { data: unknown; error: unknown }): InteropRpcClient => ({
    rpc: () => Promise.resolve(result),
  });

  it("returns missing quietly when the function is not deployed", async () => {
    expect(await loadAdminStatus(client({ data: null, error: { code: "PGRST202" } }), true)).toEqual({
      status: "missing",
    });
    expect(await loadAdminStatus(client({ data: null, error: { code: "42501" } }), true)).toEqual({
      status: "denied",
    });
    expect(await loadAdminStatus(client({ data: {}, error: null }), false)).toEqual({
      status: "offline",
    });
  });

  it("parses a good answer", async () => {
    const out = await loadAdminStatus(client({ data: { requests_24h: 1 }, error: null }), true);
    expect(out.status).toBe("ok");
  });
});

describe("reasonLabel", () => {
  it("turns a code into words", () => {
    expect(reasonLabel("scope_violation")).toBe("Scope violation");
    expect(reasonLabel(null)).toBe("");
  });
});
