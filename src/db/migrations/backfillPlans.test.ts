import { describe, it, expect } from "vitest";
import {
  MERGE_PATIENTS_RPC,
  PORTAL_ACCESS_RPC,
  planMergeBackfill,
  planPortalAccessBackfill,
} from "./backfillPlans";

describe("planPortalAccessBackfill", () => {
  const updatedAt = new Date("2026-09-01T10:00:00.000Z");

  it("queues an enable for each portal-enabled patient, sent by any portal manager", () => {
    const plans = planPortalAccessBackfill(
      [
        { id: "p1", portalEnabled: 1, updatedAt },
        { id: "p2", portalEnabled: 0, updatedAt },
        { id: "p3", updatedAt },
      ],
      [],
    );
    expect(plans).toEqual([
      {
        patientId: "p1",
        command: {
          rpc: PORTAL_ACCESS_RPC,
          args: {
            p_patient_id: "p1",
            p_enabled: true,
            p_reason: "backfill",
            p_client_at: "2026-09-01T10:00:00.000Z",
            p_requested_by: null,
            p_source: "backfill",
          },
          authorId: null,
          requiredPermission: "portal_manage",
          entityRefs: [{ table: "patients", id: "p1" }],
        },
      },
    ]);
  });

  it("never backfills a disable, a merged-away record or an already queued patient", () => {
    const plans = planPortalAccessBackfill(
      [
        { id: "p1", portalEnabled: 1, updatedAt, mergeInto: "p9" },
        { id: "p2", portalEnabled: 1, updatedAt },
        { id: "p3", portalEnabled: 1, updatedAt },
      ],
      [
        { rpc: PORTAL_ACCESS_RPC, entityRefs: [{ table: "patients", id: "p2" }] },
        { rpc: "other_rpc", entityRefs: [{ table: "patients", id: "p3" }] },
      ],
    );
    expect(plans.map((p) => p.patientId)).toEqual(["p3"]);
  });

  it("sends no client time when the record's time is unreadable", () => {
    const [plan] = planPortalAccessBackfill(
      [{ id: "p1", portalEnabled: 1, updatedAt: new Date("not a date") }],
      [],
    );
    expect(plan.command.args.p_client_at).toBeNull();
  });
});

describe("planMergeBackfill", () => {
  it("queues each unsent local merge with its day and author", () => {
    const plans = planMergeBackfill(
      [
        { id: "m1", winnerId: "w1", loserId: "l1", mergedBy: "u1", createdDay: 20_000 },
        { id: "m2", winnerId: "w2", loserId: "l2", mergedBy: "u1", createdDay: 20_001, commandId: "c-old" },
        { id: "m3", winnerId: "w3", loserId: "w3", mergedBy: "u1", createdDay: 20_002 },
      ],
      () => "cmd-1",
    );
    expect(plans).toEqual([
      {
        mergeId: "m1",
        loserId: "l1",
        command: {
          id: "cmd-1",
          rpc: MERGE_PATIENTS_RPC,
          args: {
            p_winner_id: "w1",
            p_loser_id: "l1",
            p_field_choices: {},
            p_requested_by: "u1",
            p_requested_at: new Date(20_000 * 86_400_000).toISOString(),
            p_source: "backfill",
          },
          authorId: null,
          requiredPermission: "merge_patients",
          entityRefs: [
            { table: "patients", id: "w1" },
            { table: "patients", id: "l1" },
            { table: "patient_merges", id: "m1" },
          ],
        },
      },
    ]);
  });
});
