import { describe, it, expect } from "vitest";
import {
  allocateFEFO,
  isExpired,
  pendingDeltaByBatch,
  pendingDeltaByItem,
  shownQty,
  type MovementLike,
} from "./fefo";

const now = new Date("2026-09-22T10:00:00");
const lots = [
  { id: "b3", itemId: "amx", lotNumber: "L3", expiryDate: "2027-03-01", qtyOnHand: 100 },
  { id: "b1", itemId: "amx", lotNumber: "L1", expiryDate: "2026-09-01", qtyOnHand: 50 }, // expired
  { id: "b2", itemId: "amx", lotNumber: "L2", expiryDate: "2026-10-31", qtyOnHand: 10 },
  { id: "p1", itemId: "pcm", lotNumber: "P1", expiryDate: "2026-12-01", qtyOnHand: 40 },
];

describe("allocateFEFO", () => {
  it("never allocates from an expired lot even when it expires first", () => {
    const r = allocateFEFO(lots, "amx", 5, now);
    expect(r.allocations).toEqual([
      { batchId: "b2", lotNumber: "L2", expiryDate: "2026-10-31", qty: 5 },
    ]);
    expect(r.expired.map((l) => l.id)).toEqual(["b1"]);
  });

  it("spans lots in expiry order when one lot is not enough", () => {
    const r = allocateFEFO(lots, "amx", 15, now);
    expect(r.allocations.map((a) => [a.lotNumber, a.qty])).toEqual([
      ["L2", 10],
      ["L3", 5],
    ]);
    expect(r.shortfall).toBe(0);
  });

  it("reports a shortfall instead of under-dispensing silently", () => {
    const r = allocateFEFO(lots, "amx", 200, now);
    expect(r.shortfall).toBe(90);
  });

  it("treats a lot expiring today as still usable", () => {
    expect(isExpired("2026-09-22", now)).toBe(false);
    expect(isExpired("2026-09-21", now)).toBe(true);
    expect(isExpired("not a date", now)).toBe(true);
  });
});

describe("allocateFEFO edge cases", () => {
  it("skips empty and negative lots (over-committed on this device)", () => {
    const r = allocateFEFO(
      [
        { id: "z", itemId: "amx", lotNumber: "Z", expiryDate: "2026-10-01", qtyOnHand: 0 },
        { id: "n", itemId: "amx", lotNumber: "N", expiryDate: "2026-10-02", qtyOnHand: -3 },
        { id: "ok", itemId: "amx", lotNumber: "OK", expiryDate: "2027-01-01", qtyOnHand: 4 },
      ],
      "amx",
      4,
      now,
    );
    expect(r.allocations.map((a) => a.batchId)).toEqual(["ok"]);
    expect(r.shortfall).toBe(0);
  });

  it("never allocates a fraction or a negative quantity", () => {
    expect(allocateFEFO(lots, "amx", 2.7, now).allocations[0].qty).toBe(2);
    expect(allocateFEFO(lots, "amx", -5, now).allocations).toEqual([]);
  });
});

describe("ledger overlay", () => {
  const moves: MovementLike[] = [
    { itemId: "amx", batchId: "b2", qtyDelta: -4, status: "pending" },
    { itemId: "amx", batchId: "b2", qtyDelta: -2, status: "pending" },
    { itemId: "amx", batchId: "b3", qtyDelta: 50, status: "pending" },
    // Confirmed movements are already inside the server balance.
    { itemId: "amx", batchId: "b2", qtyDelta: -100, status: "confirmed" },
    { itemId: "pcm", qtyDelta: 7, status: "pending" },
  ];

  it("sums only pending movements per lot", () => {
    const byBatch = pendingDeltaByBatch(moves);
    expect(byBatch.get("b2")).toBe(-6);
    expect(byBatch.get("b3")).toBe(50);
    expect(byBatch.has("pcm")).toBe(false);
  });

  it("sums pending movements per medicine, including ones without a lot", () => {
    const byItem = pendingDeltaByItem(moves);
    expect(byItem.get("amx")).toBe(44);
    expect(byItem.get("pcm")).toBe(7);
  });

  it("shows server balance plus pending changes, without clamping", () => {
    expect(shownQty(10, -6)).toBe(4);
    expect(shownQty(undefined, 50)).toBe(50); // lot not on the server yet
    expect(shownQty(3, -8)).toBe(-5); // over-committed: shown, not hidden
    expect(shownQty(12, undefined)).toBe(12);
    expect(shownQty(Number.NaN, Number.NaN)).toBe(0);
  });

  it("two devices dispensing the same lot: each shows its own pending use until the server answers", () => {
    // Server holds 10. Device A dispensed 8 offline; device B dispensed 8 offline.
    const a = shownQty(10, pendingDeltaByBatch([{ itemId: "x", batchId: "L", qtyDelta: -8, status: "pending" }]).get("L"));
    const b = shownQty(10, pendingDeltaByBatch([{ itemId: "x", batchId: "L", qtyDelta: -8, status: "pending" }]).get("L"));
    expect([a, b]).toEqual([2, 2]);
    // A's command applied first: server now 2. B pulls it while its own is still pending.
    expect(shownQty(2, -8)).toBe(-6);
  });
});
