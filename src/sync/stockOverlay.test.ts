// The ledger overlay (server balance + pending movements). The FEFO module
// re-exports it; fefo.test.ts covers the same rules from there.
import { describe, it, expect } from "vitest";
import { pendingDeltaByBatch, pendingDeltaByItem, shownQty } from "./stockOverlay";
import * as fefo from "@/features/pharmacy/fefo";

describe("stock overlay", () => {
  it("is the same code the FEFO module exports", () => {
    expect(fefo.pendingDeltaByBatch).toBe(pendingDeltaByBatch);
    expect(fefo.pendingDeltaByItem).toBe(pendingDeltaByItem);
    expect(fefo.shownQty).toBe(shownQty);
  });

  it("adds only pending movements to the server balance", () => {
    const moves = [
      { itemId: "amx", batchId: "b1", qtyDelta: -8, status: "pending" as const },
      { itemId: "amx", batchId: "b1", qtyDelta: 20, status: "confirmed" as const },
      { itemId: "amx", batchId: "b2", qtyDelta: 30, status: "pending" as const },
    ];
    expect(shownQty(10, pendingDeltaByBatch(moves).get("b1"))).toBe(2);
    expect(shownQty(40, pendingDeltaByItem(moves).get("amx"))).toBe(62);
  });
});
