import { describe, it, expect, vi, beforeEach } from "vitest";

const { visits, fetchServerVersion } = vi.hoisted(() => ({
  visits: { get: vi.fn(), update: vi.fn() },
  fetchServerVersion: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { visits },
  createAuditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), log: vi.fn(), info: vi.fn() },
}));

// Merges are not under test here.
vi.mock("@/services/patientMerge", () => ({ requestMerge: vi.fn() }));

vi.mock("@/sync/adapter", () => ({ fetchServerVersion }));

import { applyPlanOnDevice } from "./applyOnDevice";
import type { DevicePlan } from "./devicePlan";

const plan: DevicePlan = {
  kind: "update_record",
  table: "visits",
  recordId: "v1",
  changes: [
    {
      field: "status",
      label: "Status",
      side: "local",
      next: "closed",
      current: "open",
      changesValue: true,
      changedSinceReport: false,
    },
  ],
};
const actor = { id: "u1", role: "nurse" };

describe("applyPlanOnDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visits.update.mockResolvedValue(1);
    fetchServerVersion.mockResolvedValue(undefined);
  });

  it("records the server's updated_at the conflict was raised on, so the upload is not held back again", async () => {
    const result = await applyPlanOnDevice(
      plan,
      actor,
      "visits",
      "2026-09-20T10:00:00.123456+00:00",
    );

    expect(result).toMatchObject({ applied: true, fieldsChanged: 1 });
    expect(visits.update).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({
        status: "closed",
        _dirty: 1,
        _serverUpdatedAt: "2026-09-20T10:00:00.123456+00:00",
      }),
    );
  });

  it("leaves the stamp alone when the conflict carries none", async () => {
    await applyPlanOnDevice(plan, actor, "visits");

    const changes = visits.update.mock.calls[0][1] as Record<string, unknown>;
    expect(changes).toMatchObject({ status: "closed", _dirty: 1 });
    expect(changes).not.toHaveProperty("_serverUpdatedAt");
  });
});
