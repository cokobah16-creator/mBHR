import { describe, it, expect } from "vitest";
import {
  describePortalAccess,
  localPortalAccessDecision,
  localPortalRefusalMessage,
  parsePortalAccessResult,
  portalLinkOutcome,
  portalRejectionMessage,
  portalSignInDecision,
  portalSignInRefusalMessage,
  summarizeBulkAccess,
  summarizeCommandOutcomes,
  LOCAL_PORTAL_CACHE_MAX_AGE_MS,
  type PortalCommandLike,
} from "./portalAccessRules";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("parsePortalAccessResult", () => {
  it("reads the RPC answer", () => {
    expect(
      parsePortalAccessResult({
        outcome: "applied",
        patient_id: "p1",
        portal_enabled: false,
        changed_at: "2026-09-23T10:00:00Z",
        changed: true,
      }),
    ).toEqual({
      patientId: "p1",
      portalEnabled: false,
      changedAt: "2026-09-23T10:00:00Z",
      changed: true,
    });
  });

  it("keeps a refusal reason and the surviving record id", () => {
    const parsed = parsePortalAccessResult({
      reason: "patient_merged",
      canonical_patient_id: "p9",
      portal_enabled: true,
    });
    expect(parsed.reason).toBe("patient_merged");
    expect(parsed.canonicalPatientId).toBe("p9");
    expect(parsed.portalEnabled).toBe(true);
  });

  it("ignores values of the wrong type and non-objects", () => {
    expect(parsePortalAccessResult({ portal_enabled: "yes", changed_at: 5 })).toEqual({});
    expect(parsePortalAccessResult(null)).toEqual({});
    expect(parsePortalAccessResult([1, 2])).toEqual({});
    expect(parsePortalAccessResult("applied")).toEqual({});
  });
});

describe("portalRejectionMessage", () => {
  it("explains each known refusal and falls back for unknown codes", () => {
    expect(portalRejectionMessage("newer_decision_on_server")).toMatch(/server's setting was kept/);
    expect(portalRejectionMessage("server_decision_kept")).toMatch(/automatic change was not applied/);
    expect(portalRejectionMessage("patient_merged")).toMatch(/merged/);
    expect(portalRejectionMessage("permission_denied")).toMatch(/not allowed/);
    expect(portalRejectionMessage(undefined)).toMatch(/refused/);
    expect(portalRejectionMessage("something_else")).toMatch(/refused/);
  });
});

describe("describePortalAccess", () => {
  const cmd = (over: Partial<PortalCommandLike>): PortalCommandLike => ({
    id: "c1",
    status: "pending",
    createdAt: NOW - 1000,
    ...over,
  });

  it("shows a confirmed value with no commands", () => {
    const view = describePortalAccess(
      { portalEnabled: 1, portalEnabledChangedAt: "2026-09-20T00:00:00Z" },
      [],
    );
    expect(view).toMatchObject({ enabled: true, pending: false, waitingPermission: false });
    expect(view.confirmedAt).toBe("2026-09-20T00:00:00Z");
    expect(view.rejection).toBeUndefined();
  });

  it("is pending while the patient is marked or a command is open", () => {
    expect(describePortalAccess({ portalEnabled: 1, portalPending: 1 }, []).pending).toBe(true);
    expect(describePortalAccess({ portalEnabled: 0 }, [cmd({})]).pending).toBe(true);
  });

  it("reports waiting for an authorised person and the last error code", () => {
    const view = describePortalAccess({ portalEnabled: 1, portalPending: 1 }, [
      cmd({ status: "waiting_permission", lastErrorCode: "42501" }),
    ]);
    expect(view.waitingPermission).toBe(true);
    expect(view.lastErrorCode).toBe("42501");
  });

  it("shows the newest refusal until a newer change is queued", () => {
    const rejected = cmd({
      id: "c1",
      status: "rejected",
      rejectReason: "newer_decision_on_server",
      createdAt: NOW - 5000,
      settledAt: NOW - 4000,
    });
    const view = describePortalAccess({ portalEnabled: 0 }, [rejected]);
    expect(view.rejection?.reason).toBe("newer_decision_on_server");
    expect(view.rejection?.message).toMatch(/kept/);

    const newer = cmd({ id: "c2", status: "pending", createdAt: NOW - 1000 });
    expect(describePortalAccess({ portalEnabled: 1 }, [rejected, newer]).rejection).toBeUndefined();
  });

  it("does not show an old refusal once a later change was applied", () => {
    const view = describePortalAccess({ portalEnabled: 1 }, [
      cmd({ id: "c1", status: "rejected", createdAt: NOW - 9000, settledAt: NOW - 8000 }),
      cmd({ id: "c2", status: "applied", createdAt: NOW - 3000, settledAt: NOW - 2000 }),
    ]);
    expect(view.rejection).toBeUndefined();
  });
});

describe("localPortalAccessDecision", () => {
  const fresh = new Date(NOW - DAY).toISOString();
  const old = new Date(NOW - LOCAL_PORTAL_CACHE_MAX_AGE_MS - DAY).toISOString();

  it("without a server, only an explicit off refuses", () => {
    const opts = { serverConfigured: false, now: NOW };
    expect(localPortalAccessDecision(undefined, opts)).toEqual({ allowed: true });
    expect(localPortalAccessDecision({}, opts)).toEqual({ allowed: true });
    expect(localPortalAccessDecision({ portalEnabled: 1 }, opts)).toEqual({ allowed: true });
    expect(localPortalAccessDecision({ portalEnabled: 0 }, opts)).toEqual({
      allowed: false,
      reason: "disabled",
    });
  });

  it("with a server, needs a confirmed, recent 'on'", () => {
    const opts = { serverConfigured: true, now: NOW };
    expect(localPortalAccessDecision(undefined, opts)).toEqual({ allowed: false, reason: "no_record" });
    expect(localPortalAccessDecision({ portalEnabled: 0, _syncedAt: fresh }, opts)).toEqual({
      allowed: false,
      reason: "disabled",
    });
    expect(
      localPortalAccessDecision({ portalEnabled: 1, portalPending: 1, _syncedAt: fresh }, opts),
    ).toEqual({ allowed: false, reason: "pending" });
    expect(localPortalAccessDecision({ portalEnabled: 1 }, opts)).toEqual({
      allowed: false,
      reason: "stale",
    });
    expect(
      localPortalAccessDecision({ portalEnabled: 1, _syncedAt: old, portalEnabledChangedAt: old }, opts),
    ).toEqual({ allowed: false, reason: "stale" });
    expect(localPortalAccessDecision({ portalEnabled: 1, _syncedAt: fresh }, opts)).toEqual({
      allowed: true,
    });
    expect(
      localPortalAccessDecision({ portalEnabled: 1, _syncedAt: old, portalEnabledChangedAt: fresh }, opts),
    ).toEqual({ allowed: true });
  });

  it("the online check wins: a cache older than the limit is not trusted", () => {
    const justInside = new Date(NOW - LOCAL_PORTAL_CACHE_MAX_AGE_MS + 1000).toISOString();
    const opts = { serverConfigured: true, now: NOW };
    expect(localPortalAccessDecision({ portalEnabled: 1, _syncedAt: justInside }, opts).allowed).toBe(true);
    expect(
      localPortalAccessDecision({ portalEnabled: 1, _syncedAt: justInside }, { ...opts, maxAgeMs: 1000 })
        .allowed,
    ).toBe(false);
  });

  it("has a message for every refusal", () => {
    for (const reason of ["disabled", "pending", "stale", "no_record"] as const) {
      expect(localPortalRefusalMessage(reason).length).toBeGreaterThan(10);
    }
  });
});

describe("portalSignInDecision", () => {
  it("refuses when the check failed or the answer is not a list", () => {
    expect(portalSignInDecision([{ patient_id: "p1", portal_enabled: true }], true)).toEqual({
      kind: "unavailable",
    });
    expect(portalSignInDecision(null, false)).toEqual({ kind: "unavailable" });
  });

  it("is not linked when there are no rows", () => {
    expect(portalSignInDecision([], false)).toEqual({ kind: "not_linked" });
    expect(portalSignInDecision([{ portal_enabled: true }], false)).toEqual({ kind: "not_linked" });
  });

  it("refuses when access is off for every linked record", () => {
    expect(
      portalSignInDecision([{ patient_id: "p1", portal_enabled: false }], false),
    ).toEqual({ kind: "not_enabled" });
    expect(
      portalSignInDecision([{ patient_id: "p1", portal_enabled: "true" }], false),
    ).toEqual({ kind: "not_enabled" });
  });

  it("allows the records with access on", () => {
    expect(
      portalSignInDecision(
        [
          { patient_id: "p1", portal_enabled: false },
          { patient_id: "p2", portal_enabled: true },
        ],
        false,
      ),
    ).toEqual({ kind: "allowed", patientIds: ["p2"] });
  });

  it("has a plain message for each refusal", () => {
    expect(portalSignInRefusalMessage("not_enabled")).toMatch(/not turned on portal access/);
    expect(portalSignInRefusalMessage("not_linked")).toMatch(/not linked/);
    expect(portalSignInRefusalMessage("unavailable")).toMatch(/could not check/);
  });
});

describe("portalLinkOutcome", () => {
  it("treats linked, created and already linked as success", () => {
    for (const status of ["linked", "created", "already_linked"]) {
      expect(portalLinkOutcome(status)).toEqual({ linked: true });
    }
  });

  it("gives a plain message for every other status", () => {
    for (const status of [
      "staff_account",
      "linked_elsewhere",
      "ambiguous",
      "portal_not_enabled",
      "needs_staff_verification",
      "contact_not_verified",
      "missing_details",
      "unavailable",
      undefined,
    ]) {
      const outcome = portalLinkOutcome(status);
      expect(outcome.linked).toBe(false);
      expect(outcome.message && outcome.message.length).toBeGreaterThan(10);
    }
    expect(portalLinkOutcome("portal_not_enabled").message).toMatch(/not turned on portal access/);
  });
});

describe("summarizeBulkAccess", () => {
  const ref = (id: string) => [{ table: "patients", id }];

  it("counts confirmed, waiting and refused patients", () => {
    const summary = summarizeBulkAccess(
      ["p1", "p2", "p3"],
      [
        { id: "p1", portalEnabled: 1, portalPending: 0 },
        { id: "p2", portalEnabled: 1, portalPending: 1 },
        { id: "p3", portalEnabled: 0, portalPending: 0 },
      ],
      [
        { id: "c1", status: "applied", createdAt: 1, settledAt: 2, entityRefs: ref("p1") },
        { id: "c2", status: "pending", createdAt: 1, entityRefs: ref("p2") },
        {
          id: "c3",
          status: "rejected",
          createdAt: 1,
          settledAt: 2,
          rejectReason: "newer_decision_on_server",
          entityRefs: ref("p3"),
        },
      ],
      true,
    );
    expect(summary.confirmed).toBe(1);
    expect(summary.waiting).toBe(1);
    expect(summary.refused).toEqual([
      { patientId: "p3", message: expect.stringMatching(/kept/) },
    ]);
    expect(summary.deviceOnly).toBe(0);
  });

  it("counts everything as device-only without a server", () => {
    const summary = summarizeBulkAccess(["p1", "p2"], [{ id: "p1", portalEnabled: 1 }], [], false);
    expect(summary).toEqual({ confirmed: 0, waiting: 0, refused: [], deviceOnly: 2 });
  });

  it("treats a missing record or an unconfirmed 'on' as waiting", () => {
    const summary = summarizeBulkAccess(["gone"], [undefined], [], true);
    expect(summary.waiting).toBe(1);
  });
});

describe("summarizeCommandOutcomes", () => {
  const ref = (id: string) => [{ table: "patients", id }];

  it("uses the newest command per patient and skips patients without one", () => {
    const summary = summarizeCommandOutcomes(
      ["a", "b", "c", "d"],
      [
        { id: "1", status: "rejected", createdAt: 1, entityRefs: ref("a") },
        { id: "2", status: "applied", createdAt: 2, entityRefs: ref("a") },
        { id: "3", status: "waiting_permission", createdAt: 1, entityRefs: ref("b") },
        { id: "4", status: "rejected", createdAt: 1, rejectReason: "patient_merged", entityRefs: ref("c") },
      ],
    );
    expect(summary.applied).toBe(1);
    expect(summary.waiting).toBe(1);
    expect(summary.refused).toEqual([{ patientId: "c", message: expect.stringMatching(/merged/) }]);
  });
});
