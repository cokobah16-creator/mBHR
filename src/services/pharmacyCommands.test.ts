// Tests for the rules behind the pharmacy commands (pharmacyCommandsModel.ts).
import { describe, it, expect } from "vitest";
import {
  buildOptimisticDispense,
  countAdjustment,
  dispenseMode,
  dispenseMovementId,
  planCoversAllLines,
  receiveProblem,
} from "./pharmacyCommandsModel";
import { allocateFEFO } from "@/features/pharmacy/fefo";

const line = (itemId: string, qty: number) => ({
  itemId,
  dosage: "1",
  frequency: "bd",
  durationDays: 5,
  qty,
});

describe("dispenseMode", () => {
  const items = [
    { id: "srv", localOnly: 0 as const },
    { id: "loc", localOnly: 1 as const },
  ];
  it("uses the server ledger when every medicine is server-backed", () => {
    expect(dispenseMode([line("srv", 1)], items)).toBe("ledger");
  });
  it("changes stock kept only on this device directly", () => {
    expect(dispenseMode([line("loc", 1)], items)).toBe("local");
  });
  it("refuses a mix, or an unknown medicine", () => {
    expect(dispenseMode([line("srv", 1), line("loc", 1)], items)).toBe("mixed");
    expect(dispenseMode([line("gone", 1)], items)).toBe("missing");
    expect(dispenseMode([], items)).toBe("missing");
  });
});

describe("buildOptimisticDispense", () => {
  const now = new Date("2026-09-22T10:00:00");
  const lots = [
    { id: "b2", itemId: "amx", lotNumber: "L2", expiryDate: "2026-10-31", qtyOnHand: 10 },
    { id: "b3", itemId: "amx", lotNumber: "L3", expiryDate: "2027-03-01", qtyOnHand: 100 },
  ];
  let n = 0;
  const newId = () => `id${++n}`;

  it("writes one dispense and one pending ledger movement per lot, all lines", () => {
    n = 0;
    const plan = [
      { itemId: "amx", qty: 15, allocations: allocateFEFO(lots, "amx", 15, now).allocations },
    ];
    expect(planCoversAllLines(plan)).toBe(true);
    const built = buildOptimisticDispense({
      prescription: { id: "rx1", patientId: "p1" },
      plan,
      commandId: "c1",
      actorId: "u1",
      at: "2026-09-22T10:00:00.000Z",
      newId,
      localOnly: false,
    });
    expect(built.dispenses.map((d) => [d.batchId, d.qty, d.pending, d.commandId])).toEqual([
      ["b2", 10, 1, "c1"],
      ["b3", 5, 1, "c1"],
    ]);
    expect(built.movements.map((m) => [m.batchId, m.qtyDelta, m.status, m.reason])).toEqual([
      ["b2", -10, "pending", "dispense"],
      ["b3", -5, "pending", "dispense"],
    ]);
    // Movement ids match the server's, so a download replaces them.
    expect(built.movements[0].id).toBe(dispenseMovementId(built.dispenses[0].id));
    expect(built.byItem.get("amx")).toBe(15);
    expect(built.byBatch.get("b2")).toBe(10);
    // The command carries the device's lots as hints with the same dispense ids.
    expect(built.lines[0].allocations.map((a) => a.dispenseId)).toEqual(built.dispenses.map((d) => d.id));
  });

  it("writes no ledger movement for stock kept only on this device", () => {
    const built = buildOptimisticDispense({
      prescription: { id: "rx1", patientId: "p1" },
      plan: [{ itemId: "amx", qty: 3, allocations: [{ batchId: "b2", lotNumber: "L2", expiryDate: "", qty: 3 }] }],
      commandId: "c1",
      actorId: "u1",
      at: "t",
      newId,
      localOnly: true,
    });
    expect(built.movements).toEqual([]);
    expect(built.dispenses[0]).toMatchObject({ localOnly: 1, qty: 3 });
    expect(built.dispenses[0].commandId).toBeUndefined();
  });

  it("does not allow partial dispensing of any line", () => {
    const short = allocateFEFO(lots, "amx", 200, now);
    expect(planCoversAllLines([{ itemId: "amx", qty: 200, allocations: short.allocations }])).toBe(false);
    expect(planCoversAllLines([])).toBe(false);
  });
});

describe("countAdjustment", () => {
  it("records the difference between the count and what is shown", () => {
    expect(countAdjustment(40, 45)).toBe(-5);
    expect(countAdjustment(50, 45)).toBe(5);
    expect(countAdjustment(45, 45)).toBe(0);
    expect(countAdjustment(Number.NaN, 45)).toBe(0);
  });
});

describe("receiveProblem", () => {
  it("requires a lot number, a whole positive quantity and a valid expiry date", () => {
    expect(receiveProblem({ lotNumber: "L1", qty: 10, expiryDate: "2027-01-01" })).toBeNull();
    expect(receiveProblem({ lotNumber: " ", qty: 10, expiryDate: "2027-01-01" })).toMatch(/lot number/);
    expect(receiveProblem({ lotNumber: "L1", qty: 0, expiryDate: "2027-01-01" })).toMatch(/at least 1/);
    expect(receiveProblem({ lotNumber: "L1", qty: 2.5, expiryDate: "2027-01-01" })).toMatch(/whole/);
    expect(receiveProblem({ lotNumber: "L1", qty: 2, expiryDate: "nope" })).toMatch(/valid expiry/);
  });
});
