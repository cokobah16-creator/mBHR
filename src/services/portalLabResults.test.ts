import { describe, it, expect } from "vitest";
import {
  fetchMyReleasedLabResults,
  mapPortalLabRows,
  toPortalInterpretation,
  type PortalLabClient,
  type PortalLabResultRow,
} from "./portalLabResults";

function row(overrides: Partial<PortalLabResultRow> = {}): PortalLabResultRow {
  return {
    result_id: "r1",
    order_id: "o1",
    patient_id: "p1",
    test_name: "Haemoglobin",
    test_code: "HB",
    specimen_type: "Blood",
    ordered_at: "2026-09-01T08:00:00Z",
    result_value: "12.5",
    result_unit: "g/dL",
    reference_range: "12-16",
    interpretation: "normal",
    result_date: "2026-09-01T10:00:00Z",
    released_at: "2026-09-02T09:00:00Z",
    patient_note: "  No action needed.  ",
    ...overrides,
  };
}

interface FakeCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeClient(opts: {
  signedIn?: boolean;
  data?: unknown;
  error?: unknown;
  throwOnRpc?: boolean;
}): { client: PortalLabClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client: PortalLabClient = {
    auth: {
      getSession: async () => ({
        data: {
          session: opts.signedIn === false ? null : { user: { id: "auth-1" } },
        },
      }),
    },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (opts.throwOnRpc) throw new TypeError("network");
      return { data: opts.data ?? null, error: opts.error ?? null };
    },
  };
  return { client, calls };
}

describe("toPortalInterpretation", () => {
  it("keeps the three stored values", () => {
    expect(toPortalInterpretation("normal")).toBe("normal");
    expect(toPortalInterpretation("abnormal")).toBe("abnormal");
    expect(toPortalInterpretation("critical")).toBe("critical");
  });

  it("never reads a missing or unexpected value as normal", () => {
    expect(toPortalInterpretation(null)).toBe("unknown");
    expect(toPortalInterpretation(undefined)).toBe("unknown");
    expect(toPortalInterpretation("")).toBe("unknown");
    expect(toPortalInterpretation("Normal")).toBe("unknown");
  });
});

describe("mapPortalLabRows", () => {
  it("maps the fields the patient sees and trims text", () => {
    const [r] = mapPortalLabRows([row()]);
    expect(r.resultId).toBe("r1");
    expect(r.testName).toBe("Haemoglobin");
    expect(r.resultValue).toBe("12.5");
    expect(r.resultUnit).toBe("g/dL");
    expect(r.interpretation).toBe("normal");
    expect(r.patientNote).toBe("No action needed.");
    expect(r.releasedAt?.toISOString()).toBe("2026-09-02T09:00:00.000Z");
  });

  it("returns newest result first and skips malformed rows", () => {
    const out = mapPortalLabRows([
      row({ result_id: "old", result_date: "2026-08-01T00:00:00Z" }),
      null,
      { nonsense: true },
      row({ result_id: "new", result_date: "2026-09-10T00:00:00Z" }),
    ]);
    expect(out.map((r) => r.resultId)).toEqual(["new", "old"]);
  });

  it("returns an empty list for a non-array answer", () => {
    expect(mapPortalLabRows(null)).toEqual([]);
    expect(mapPortalLabRows({})).toEqual([]);
  });

  it("drops blank optional text and invalid dates", () => {
    const [r] = mapPortalLabRows([
      row({ result_unit: " ", patient_note: null, result_date: "not a date" }),
    ]);
    expect(r.resultUnit).toBeUndefined();
    expect(r.patientNote).toBeUndefined();
    expect(r.resultDate).toBeUndefined();
  });
});

describe("fetchMyReleasedLabResults", () => {
  it("says unavailable when the portal has no online connection set up", async () => {
    const out = await fetchMyReleasedLabResults({ client: null });
    expect(out).toEqual({ status: "unavailable", results: [] });
  });

  it("does not call the server while offline", async () => {
    const { client, calls } = fakeClient({ data: [row()] });
    const out = await fetchMyReleasedLabResults({ client, online: false });
    expect(out.status).toBe("offline");
    expect(calls).toHaveLength(0);
  });

  it("reports a missing online sign-in instead of an empty list", async () => {
    const { client, calls } = fakeClient({ signedIn: false, data: [row()] });
    const out = await fetchMyReleasedLabResults({ client, online: true });
    expect(out.status).toBe("not_signed_in");
    expect(calls).toHaveLength(0);
  });

  it("does not answer for a different online account on this device", async () => {
    const { client, calls } = fakeClient({ data: [row()] });
    const out = await fetchMyReleasedLabResults({
      client,
      online: true,
      accountId: "someone-else",
    });
    expect(out).toEqual({ status: "not_signed_in", results: [] });
    expect(calls).toHaveLength(0);

    const same = await fetchMyReleasedLabResults({
      client,
      online: true,
      accountId: "auth-1",
    });
    expect(same.status).toBe("ok");
  });

  it("uses the default limit for a missing or invalid one", async () => {
    const { client, calls } = fakeClient({ data: [] });
    await fetchMyReleasedLabResults({ client, online: true, limit: Number.NaN });
    await fetchMyReleasedLabResults({ client, online: true, limit: 0 });
    expect(calls.map((c) => c.args.p_limit)).toEqual([100, 1]);
  });

  it("reads through portal_my_lab_results only", async () => {
    const { client, calls } = fakeClient({ data: [row()] });
    const out = await fetchMyReleasedLabResults({
      client,
      online: true,
      limit: 5,
      patientId: "p1",
    });
    expect(out.status).toBe("ok");
    expect(out.results).toHaveLength(1);
    expect(calls).toEqual([
      { fn: "portal_my_lab_results", args: { p_limit: 5, p_patient_id: "p1" } },
    ]);
  });

  it("caps the limit and sends no patient filter by default", async () => {
    const { client, calls } = fakeClient({ data: [] });
    const out = await fetchMyReleasedLabResults({ client, online: true, limit: 9999 });
    expect(out).toEqual({ status: "ok", results: [] });
    expect(calls[0].args).toEqual({ p_limit: 500, p_patient_id: null });
  });

  it("says the server is not updated when the function is missing", async () => {
    const { client } = fakeClient({ error: { code: "PGRST202", message: "x" } });
    const out = await fetchMyReleasedLabResults({ client, online: true });
    expect(out).toEqual({ status: "not_updated", results: [] });
  });

  it("returns failed, not an empty success, when the request fails", async () => {
    const { client } = fakeClient({ error: { code: "57014", message: "timeout" } });
    expect((await fetchMyReleasedLabResults({ client, online: true })).status).toBe(
      "failed",
    );
    const thrown = fakeClient({ throwOnRpc: true });
    expect(
      (await fetchMyReleasedLabResults({ client: thrown.client, online: true })).status,
    ).toBe("failed");
  });
});
