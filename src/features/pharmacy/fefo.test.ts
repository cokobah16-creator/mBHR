import { describe, it, expect } from "vitest";
import { allocateFEFO, isExpired } from "./fefo";

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
