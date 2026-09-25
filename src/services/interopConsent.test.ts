import { describe, it, expect } from "vitest";
import {
  cleanWithdrawReason,
  consentState,
  externalSharingChip,
  EXTERNAL_SHARING_NOTE,
  loadConsentSummary,
  loadMyConsents,
  parseConsentSummary,
  parseMyConsents,
  withdrawConsent,
} from "./interopConsent";
import type { InteropRpcClient } from "./interopRpc";

const NOW = new Date("2026-09-25T12:00:00Z");
const ID_A = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c01";
const ID_B = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c02";
const ID_C = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c03";
const ID_D = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c04";

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID_A,
    patient_id: "01HXPATIENTINTERNAL",
    status: "active",
    scope: "patient-privacy",
    category: "mbhr-sharing",
    verified: false,
    effective_from: "2026-01-01T00:00:00Z",
    effective_until: null,
    recorded_at: "2025-12-31T09:00:00Z",
    withdrawn: false,
    withdrawn_at: null,
    provisions: [{ provision_type: "permit", actor_type: "external_system", purpose: "PATRQT" }],
    ...overrides,
  };
}

function fakeClient(
  result: { data: unknown; error: unknown },
  calls: { fn: string; args?: Record<string, unknown> }[] = [],
): InteropRpcClient {
  return {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
}

describe("consentState", () => {
  it("never reads an unknown or ended record as in place", () => {
    expect(consentState(record(), NOW)).toBe("in_place");
    expect(consentState(record({ status: "draft" }), NOW)).toBe("not_started");
    expect(consentState(record({ status: "proposed" }), NOW)).toBe("not_started");
    expect(consentState(record({ effective_from: "2027-01-01T00:00:00Z" }), NOW)).toBe(
      "not_started",
    );
    expect(consentState(record({ effective_until: "2026-06-01T00:00:00Z" }), NOW)).toBe("ended");
    expect(consentState(record({ status: "inactive" }), NOW)).toBe("ended");
    expect(consentState(record({ status: "rejected" }), NOW)).toBe("declined");
    expect(consentState(record({ status: "entered-in-error" }), NOW)).toBe("in_error");
    expect(consentState(record({ status: "something-new" }), NOW)).toBe("ended");
    expect(
      consentState(
        record({ status: "inactive", withdrawn: true, withdrawn_at: "2026-05-01T00:00:00Z" }),
        NOW,
      ),
    ).toBe("withdrawn");
  });
});

describe("parseMyConsents", () => {
  it("keeps what, since when and status, and never copies the patient id", () => {
    const [item] = parseMyConsents([record()], NOW);
    expect(item).toStrictEqual({
      id: ID_A,
      topic: "sharing",
      kind: "permission",
      permits: ["your_request"],
      refusesOutside: false,
      refuses: [],
      alsoPermits: false,
      state: "in_place",
      since: "2026-01-01T00:00:00Z",
      withdrawnAt: null,
      until: null,
      canWithdraw: true,
    });
    expect(JSON.stringify(item)).not.toContain("01HXPATIENTINTERNAL");
  });

  it("shows a deny-only record as a refusal, never offered for withdrawal", () => {
    const [item] = parseMyConsents(
      [record({ provisions: [{ provision_type: "deny", actor_type: "external_system" }] })],
      NOW,
    );
    expect(item.kind).toBe("refusal");
    expect(item.refusesOutside).toBe(true);
    expect(item.permits).toStrictEqual([]);
    expect(item.refuses).toStrictEqual([]);
    expect(item.alsoPermits).toBe(false);
    expect(item.state).toBe("in_place");
    expect(item.canWithdraw).toBe(false);
  });

  it("shows a record with a permit and a deny as a refusal, and says it also permits", () => {
    const [item] = parseMyConsents(
      [
        record({
          provisions: [
            { provision_type: "permit", actor_type: "external_system", purpose: "PATRQT" },
            { provision_type: "deny", actor_type: "organization", purpose: "HRESCH" },
          ],
        }),
      ],
      NOW,
    );
    expect(item.kind).toBe("refusal");
    expect(item.refusesOutside).toBe(true);
    expect(item.refuses).toStrictEqual(["research"]);
    expect(item.permits).toStrictEqual(["your_request"]);
    expect(item.alsoPermits).toBe(true);
    expect(item.canWithdraw).toBe(false);
  });

  it("says whether a refusal is for someone outside mBHR, and lists only those purposes", () => {
    const outside = (actor: unknown) =>
      parseMyConsents(
        [record({ provisions: [{ provision_type: "deny", actor_type: actor }] })],
        NOW,
      )[0].refusesOutside;
    expect(outside("external_system")).toBe(true);
    expect(outside("organization")).toBe(true);
    expect(outside("any")).toBe(true);
    expect(outside(null)).toBe(true);
    expect(outside(undefined)).toBe(true);
    expect(outside("care_team")).toBe(false);
    expect(outside("practitioner")).toBe(false);
    expect(outside("patient_portal")).toBe(false);
    expect(outside("something-new")).toBe(false);

    const [internal] = parseMyConsents(
      [
        record({
          provisions: [{ provision_type: "deny", actor_type: "care_team", purpose: "HRESCH" }],
        }),
      ],
      NOW,
    );
    // Still a refusal: never offered for withdrawal.
    expect(internal.kind).toBe("refusal");
    expect(internal.refuses).toStrictEqual([]);
    expect(internal.canWithdraw).toBe(false);

    // A care team rule with no purpose does not widen the outside refusal.
    const [both] = parseMyConsents(
      [
        record({
          provisions: [
            { provision_type: "deny", actor_type: "organization", purpose: "HRESCH" },
            { provision_type: "deny", actor_type: "care_team", purpose: null },
          ],
        }),
      ],
      NOW,
    );
    expect(both.refusesOutside).toBe(true);
    expect(both.refuses).toStrictEqual(["research"]);
  });

  it("leaves out treatment consents, advance care wishes and unknown scopes", () => {
    const items = parseMyConsents(
      [
        record({ id: ID_A, scope: "treatment", provisions: [{ provision_type: "permit", purpose: "TREAT" }] }),
        record({ id: ID_B, scope: "adr", provisions: [] }),
        record({ id: ID_C, scope: "something-new" }),
        record({ id: ID_D, scope: "research", provisions: [{ provision_type: "permit", purpose: "HRESCH" }] }),
      ],
      NOW,
    );
    expect(items.map((i) => [i.id, i.topic, i.kind, i.canWithdraw])).toStrictEqual([
      [ID_D, "research", "permission", true],
    ]);
  });

  it("never reads a record with no rules as a permission", () => {
    const [item] = parseMyConsents([record({ provisions: [] })], NOW);
    expect(item.kind).toBe("unclear");
    expect(item.canWithdraw).toBe(false);
  });

  it("lists no purposes when one provision covers every purpose", () => {
    const [item] = parseMyConsents(
      [
        record({
          provisions: [
            { provision_type: "permit", purpose: "PATRQT" },
            { provision_type: "permit", purpose: null },
          ],
        }),
      ],
      NOW,
    );
    expect(item.permits).toStrictEqual([]);
    expect(item.kind).toBe("permission");
  });

  it("offers Withdraw only for records not yet withdrawn or ended", () => {
    const items = parseMyConsents(
      [
        record({ id: ID_B, status: "inactive", withdrawn: true, withdrawn_at: "2026-05-01T00:00:00Z" }),
        record(),
      ],
      NOW,
    );
    expect(items.map((i) => [i.id, i.canWithdraw])).toEqual([
      [ID_A, true],
      [ID_B, false],
    ]);
  });

  it("drops rows without a valid id and tolerates junk", () => {
    expect(parseMyConsents(null)).toEqual([]);
    expect(parseMyConsents({})).toEqual([]);
    expect(parseMyConsents([record({ id: "not-a-uuid" }), 5, null])).toEqual([]);
    expect(parseMyConsents([record({ scope: 7 })])).toEqual([]);
    expect(parseMyConsents([record({ scope: "constructor" })])).toEqual([]);
    const [item] = parseMyConsents([record({ provisions: "x", effective_from: null })], NOW);
    expect(item.topic).toBe("sharing");
    expect(item.kind).toBe("unclear");
    expect(item.permits).toEqual([]);
    expect(item.since).toBe("2025-12-31T09:00:00Z");
  });
});

describe("loadMyConsents", () => {
  it("returns missing quietly when the function is not deployed", async () => {
    const out = await loadMyConsents(
      fakeClient({ data: null, error: { code: "PGRST202", message: "not found" } }),
      "01HXP",
      true,
    );
    expect(out).toEqual({ status: "missing" });
  });

  it("does not call when offline", async () => {
    const calls: { fn: string }[] = [];
    const out = await loadMyConsents(fakeClient({ data: [], error: null }, calls), "01HXP", false);
    expect(out).toEqual({ status: "offline" });
    expect(calls).toHaveLength(0);
  });

  it("asks for the page's patient only, and never calls without one", async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const client = fakeClient({ data: [record()], error: null }, calls);
    const out = await loadMyConsents(client, "01HXP", true, NOW);
    expect(out.status).toBe("ok");
    expect(calls).toStrictEqual([{ fn: "interop_my_consents", args: { p_patient_id: "01HXP" } }]);
    expect(await loadMyConsents(client, "", true, NOW)).toStrictEqual({ status: "invalid" });
    expect(await loadMyConsents(client, "bad id!", true, NOW)).toStrictEqual({ status: "invalid" });
    expect(calls).toHaveLength(1);
  });
});

describe("withdrawConsent", () => {
  it("sends the id, a cleaned reason and the page's patient", async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const out = await withdrawConsent(
      fakeClient({ data: true, error: null }, calls),
      ID_A,
      "01HXP",
      "  changed my mind  ",
      true,
    );
    expect(out).toEqual({ status: "withdrawn" });
    expect(calls).toEqual([
      {
        fn: "interop_withdraw_consent",
        args: { p_consent_id: ID_A, p_reason: "changed my mind", p_patient_id: "01HXP" },
      },
    ]);
  });

  it("never calls without a valid record id and patient id", async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const client = fakeClient({ data: true, error: null }, calls);
    expect(await withdrawConsent(client, "x", "01HXP", "", true)).toEqual({ status: "invalid" });
    expect(await withdrawConsent(client, ID_A, "", "", true)).toEqual({ status: "invalid" });
    expect(await withdrawConsent(client, ID_A, "bad id!", "", true)).toEqual({ status: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("reports an earlier withdrawal, a refusal and a missing function", async () => {
    expect(
      await withdrawConsent(fakeClient({ data: false, error: null }), ID_A, "01HXP", "", true),
    ).toEqual({ status: "already_withdrawn" });
    const denied = fakeClient({ data: null, error: { code: "42501" } });
    expect(await withdrawConsent(denied, ID_A, "01HXP", "", true)).toEqual({ status: "denied" });
    const missing = fakeClient({ data: null, error: { code: "42883" } });
    expect(await withdrawConsent(missing, ID_A, "01HXP", null, true)).toEqual({ status: "missing" });
  });

  it("limits the reason to 500 characters", () => {
    expect(cleanWithdrawReason("   ")).toBeNull();
    expect(cleanWithdrawReason(undefined)).toBeNull();
    expect(cleanWithdrawReason("a".repeat(600))).toHaveLength(500);
  });
});

describe("consent summary", () => {
  const chipFor = (state: string, reason?: string) =>
    externalSharingChip(parseConsentSummary({ sharing_state: state, sharing_reason: reason }));

  it("shows the owner's three states: Allowed, Restricted, Withdrawn", () => {
    expect(chipFor("allowed", "permitted")?.label).toBe("External sharing: Allowed");
    expect(chipFor("restricted", "limited")?.label).toBe("External sharing: Restricted");
    expect(chipFor("withdrawn", "withdrawn")?.label).toBe("External sharing: Withdrawn");
  });

  it("says Restricted, never Allowed, for a refusal, a limit, no check, no start or no record", () => {
    for (const reason of [
      "refused",
      "refused_partly",
      "limited",
      "pending_verification",
      "not_started",
      "no_permission",
    ]) {
      expect(chipFor("restricted", reason)?.label).toBe("External sharing: Restricted");
    }
  });

  it("gives the reason in plain words and says external access is off", () => {
    expect(chipFor("restricted", "refused")?.hint).toBe(
      "The patient asked us not to share their records outside mBHR. " +
        "External access is off in this release, so this is not used to share records yet. " +
        "It does not affect care.",
    );
    expect(chipFor("restricted", "refused_partly")?.hint).toBe(
      `The patient refused some sharing outside mBHR. ${EXTERNAL_SHARING_NOTE}`,
    );
    expect(
      parseConsentSummary({ sharing_state: "restricted", sharing_reason: "refused_partly" })?.reason,
    ).toBe("refused_partly");
    expect(chipFor("restricted", "limited")?.hint).toContain(
      "The patient's permission covers only some records or uses.",
    );
    expect(chipFor("restricted", "pending_verification")?.hint).toContain("staff have not checked it yet");
    expect(chipFor("restricted", "not_started")?.hint).toContain("it has not started yet");
    expect(chipFor("restricted", "no_permission")?.hint).toContain("No permission to share");
    expect(chipFor("allowed", "permitted")?.hint).toContain("with no limits");
    // Neutral about who withdrew it: staff may have made the change.
    expect(chipFor("withdrawn", "withdrawn")?.hint).toBe(
      `A permission to share outside mBHR was withdrawn. ${EXTERNAL_SHARING_NOTE}`,
    );
    expect(chipFor("withdrawn", "withdrawn")?.hint).not.toMatch(/the patient withdrew/i);
    expect(chipFor("restricted", "mystery")?.hint).toBe(
      `The reason is not known. ${EXTERNAL_SHARING_NOTE}`,
    );
    expect(EXTERNAL_SHARING_NOTE).toContain("External access is off in this release");
    expect(EXTERNAL_SHARING_NOTE).toContain("It does not affect care.");
    expect(EXTERNAL_SHARING_NOTE).not.toMatch(/nothing is shared|does not share/i);
  });

  it("uses no alarming tone", () => {
    for (const v of ["allowed", "restricted", "withdrawn"]) {
      expect(["info", "neutral"]).toContain(chipFor(v)?.tone);
    }
    expect(chipFor("restricted", "refused")?.tone).toBe("neutral");
  });

  it("shows nothing for an answer it does not understand, including the older key alone", () => {
    expect(parseConsentSummary(null)).toBeNull();
    expect(parseConsentSummary({ sharing_state: "maybe" })).toBeNull();
    expect(parseConsentSummary({ external_sharing: "allowed" })).toBeNull();
    expect(parseConsentSummary({ sharing_state: "not_allowed" })).toBeNull();
    expect(externalSharingChip(null)).toBeNull();
  });

  it("keeps an unknown reason unknown", () => {
    expect(parseConsentSummary({ sharing_state: "restricted", sharing_reason: "new_code" })?.reason).toBeNull();
    expect(parseConsentSummary({ sharing_state: "restricted" })?.reason).toBeNull();
  });

  it("keeps counts and the last change", () => {
    expect(
      parseConsentSummary({
        external_sharing: "withdrawn",
        sharing_state: "withdrawn",
        sharing_reason: "withdrawn",
        active_records: 0,
        withdrawn_records: 2,
        last_changed_at: "2026-05-01T00:00:00Z",
      }),
    ).toStrictEqual({
      externalSharing: "withdrawn",
      reason: "withdrawn",
      activeRecords: 0,
      withdrawnRecords: 2,
      lastChangedAt: "2026-05-01T00:00:00Z",
    });
  });

  it("loads quietly: offline, missing, invalid id", async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const ok = fakeClient(
      { data: { sharing_state: "allowed", sharing_reason: "permitted" }, error: null },
      calls,
    );
    expect((await loadConsentSummary(ok, "01HXP", true)).status).toBe("ok");
    expect(calls[0]).toEqual({ fn: "interop_consent_summary", args: { p_patient_id: "01HXP" } });
    expect(await loadConsentSummary(ok, "01HXP", false)).toEqual({ status: "offline" });
    expect(await loadConsentSummary(ok, "bad id!", true)).toEqual({ status: "invalid" });
    expect(
      await loadConsentSummary(fakeClient({ data: null, error: { code: "PGRST202" } }), "p1", true),
    ).toEqual({ status: "missing" });
    expect(
      await loadConsentSummary(fakeClient({ data: { nope: 1 }, error: null }), "p1", true),
    ).toEqual({ status: "failed" });
  });
});
