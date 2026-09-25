// Tests for the pharmacy ledger sync rules (pharmacySyncModel.ts): mapping
// downloads, the pending-delta overlay, and reading the server's answers.
import { describe, it, expect } from "vitest";
import {
  batchFromServer,
  dispenseLinesArg,
  isStaleBalance,
  itemFromServer,
  mapLocalItemsToServer,
  movementFromServer,
  parseBalances,
  parseDispenseResult,
  parseShortLines,
  pharmacySiteKey,
  prescriptionFromServer,
  handedOverRefusalStatus,
  prescriptionUploadRow,
  recomputeShown,
  refusedDispenseAction,
  rejectReasonText,
  remapLines,
  shouldUploadPrescription,
} from "./pharmacySyncModel";
import type { Prescription } from "@/db/mbhr";

const rx = (over: Partial<Prescription> = {}): Prescription => ({
  id: "rx1",
  visitId: "v1",
  patientId: "p1",
  prescriberId: "u1",
  createdAt: "2026-09-20T09:00:00.000Z",
  status: "open",
  lines: [{ itemId: "amx", dosage: "1 tab", frequency: "tds", durationDays: 5, qty: 15 }],
  ...over,
});

describe("recomputeShown (server balance + pending movements)", () => {
  it("adds pending movements to the server balance and reports only changes", () => {
    const out = recomputeShown(
      [
        { id: "amx", onHandQty: 100, serverQtyOnHand: 100 },
        { id: "pcm", onHandQty: 40, serverQtyOnHand: 40 },
      ],
      [
        { id: "b1", qtyOnHand: 60, serverQtyOnHand: 60 },
        { id: "b2", qtyOnHand: 40, serverQtyOnHand: 40 },
      ],
      [
        { itemId: "amx", batchId: "b1", qtyDelta: -15, status: "pending" },
        { itemId: "amx", batchId: "b1", qtyDelta: -100, status: "confirmed" },
      ],
    );
    expect(out.batches).toEqual([{ id: "b1", qty: 45 }]);
    expect(out.items).toEqual([{ id: "amx", qty: 85 }]);
  });

  it("puts the quantity back when a refused dispense's movement is removed", () => {
    // After rollback the pending movement is gone: shown = server balance.
    const out = recomputeShown(
      [{ id: "amx", onHandQty: 85, serverQtyOnHand: 100 }],
      [{ id: "b1", qtyOnHand: 45, serverQtyOnHand: 60 }],
      [],
    );
    expect(out.batches).toEqual([{ id: "b1", qty: 60 }]);
    expect(out.items).toEqual([{ id: "amx", qty: 100 }]);
  });

  it("leaves stock kept only on this device as counted", () => {
    const out = recomputeShown(
      [{ id: "old", onHandQty: 30, localOnly: 1 }],
      [{ id: "ob", qtyOnHand: 30, localOnly: 1 }],
      [{ itemId: "old", batchId: "ob", qtyDelta: -5, status: "pending" }],
    );
    expect(out).toEqual({ items: [], batches: [] });
  });

  it("shows a lot not yet on the server from its pending receipt", () => {
    const out = recomputeShown(
      [],
      [{ id: "new", qtyOnHand: 0 }],
      [{ itemId: "amx", batchId: "new", qtyDelta: 50, status: "pending" }],
    );
    expect(out.batches).toEqual([{ id: "new", qty: 50 }]);
  });
});

describe("downloads", () => {
  it("maps a server medicine and keeps the shown quantity for recompute", () => {
    const item = itemFromServer(
      {
        id: "amx",
        med_name: "Amoxicillin",
        form: "capsule",
        strength: "500 mg",
        unit: "capsules",
        on_hand_qty: 90,
        reorder_threshold: 20,
        is_controlled: false,
        is_active: true,
        row_version: 7,
        updated_at: "2026-09-22T10:00:00Z",
      },
      undefined,
    );
    expect(item).toMatchObject({
      id: "amx",
      medName: "Amoxicillin",
      serverQtyOnHand: 90,
      onHandQty: 90,
      rowVersion: 7,
      localOnly: 0,
      pendingRegister: 0,
      isActive: true,
    });
    expect(itemFromServer({ med_name: "x" }, undefined)).toBeNull();
  });

  it("maps a lot", () => {
    expect(
      batchFromServer({ id: "b1", item_id: "amx", lot_number: "L1", expiry_date: "2027-01-01", qty_on_hand: "12" }),
    ).toMatchObject({ id: "b1", itemId: "amx", serverQtyOnHand: 12, qtyOnHand: 12, localOnly: 0 });
  });

  it("keeps this device's status while its dispense is waiting for the server", () => {
    const local = rx({ status: "dispensed", pendingCommandId: "c1", dispensedAt: "2026-09-22T10:00:00Z" });
    const merged = prescriptionFromServer({ id: "rx1", status: "open", lines: local.lines }, local, "now");
    expect(merged?.status).toBe("dispensed");
    expect(merged?.pendingCommandId).toBe("c1");
  });

  it("never reopens a handed-over dispense the server refused", () => {
    const local = rx({ status: "dispensed", handoverRefused: 1, lastRejectReason: "permission_denied" });
    const merged = prescriptionFromServer({ id: "rx1", status: "open", lines: local.lines }, local, "now");
    expect(merged?.status).toBe("dispensed");
    expect(merged?.handoverRefused).toBe(1);
    // A server status other than open (cancelled, dispensed) still applies.
    expect(prescriptionFromServer({ id: "rx1", status: "void" }, local, "now")?.status).toBe("void");
  });

  it("takes the server's status otherwise (dispensed on another device)", () => {
    const merged = prescriptionFromServer(
      { id: "rx1", status: "dispensed", dispensed_at: "2026-09-22T11:00:00Z", row_version: 3 },
      rx(),
      "now",
    );
    expect(merged).toMatchObject({ status: "dispensed", rowVersion: 3, _dirty: 0, localOnly: 0 });
    expect(prescriptionFromServer({ id: "rx1", status: "weird" }, rx(), "now")?.status).toBe("open");
  });

  it("rejects movements with an unknown reason or no quantity", () => {
    expect(movementFromServer({ id: "m", item_id: "a", qty_delta: -3, reason: "dispense" })).toMatchObject({
      status: "confirmed",
      qtyDelta: -3,
    });
    expect(movementFromServer({ id: "m", item_id: "a", qty_delta: -3, reason: "theft" })).toBeNull();
    expect(movementFromServer({ id: "m", item_id: "a", reason: "adjust" })).toBeNull();
  });
});

describe("uploads and commands", () => {
  it("uploads new prescriptions as open, never with a local status", () => {
    expect(prescriptionUploadRow(rx({ status: "dispensed" })).status).toBe("open");
    expect(shouldUploadPrescription(rx({ _dirty: 1 }))).toBe(true);
    expect(shouldUploadPrescription(rx({ _dirty: 1, status: "dispensed" }))).toBe(false);
    expect(shouldUploadPrescription(rx({ _dirty: 1, localOnly: 1 }))).toBe(false);
    expect(shouldUploadPrescription(rx({ _dirty: 0 }))).toBe(false);
  });

  it("sends the device's lot choice as a hint with its dispense ids", () => {
    expect(
      dispenseLinesArg([
        {
          itemId: "amx",
          qty: 15,
          allocations: [
            { dispenseId: "d1", batchId: "b2", qty: 10 },
            { dispenseId: "d2", batchId: "b3", qty: 5 },
          ],
        },
      ]),
    ).toEqual([
      {
        item_id: "amx",
        qty: 15,
        dispense_ids: ["d1", "d2"],
        hint: [
          { batch_id: "b2", qty: 10 },
          { batch_id: "b3", qty: 5 },
        ],
      },
    ]);
  });
});

describe("server answers", () => {
  it("reads a dispense result", () => {
    const r = parseDispenseResult({
      outcome: "applied",
      status: "dispensed",
      allocations: [
        { dispense_id: "d1", item_id: "amx", batch_id: "b2", qty: 10 },
        { dispense_id: "bad", item_id: "amx", batch_id: "b2", qty: 0 },
      ],
      items: [{ id: "amx", on_hand_qty: 85, row_version: 4 }],
      batches: [{ id: "b2", qty_on_hand: 0, row_version: 9 }],
      uncovered: [{ item_id: "amx", qty: 5 }],
    });
    expect(r.status).toBe("dispensed");
    expect(r.allocations).toHaveLength(1);
    expect(r.items).toEqual([{ id: "amx", qty: 85, rowVersion: 4 }]);
    expect(r.batches).toEqual([{ id: "b2", qty: 0, rowVersion: 9 }]);
    expect(r.uncovered).toEqual([{ itemId: "amx", qty: 5 }]);
  });

  it("tolerates a missing or malformed result", () => {
    expect(parseDispenseResult(null)).toEqual({
      status: undefined,
      dispensedAt: undefined,
      allocations: [],
      items: [],
      batches: [],
      uncovered: [],
    });
    expect(parseBalances({ items: [{ id: "x" }], batches: "no" })).toEqual({ items: [], batches: [] });
  });

  it("keeps units handed over offline beyond stock as a dispense with no lot", () => {
    const r = parseDispenseResult({
      outcome: "applied",
      status: "dispensed",
      offline: true,
      allocations: [
        { dispense_id: "d1", item_id: "amx", batch_id: "b2", qty: 15 },
        { dispense_id: "c1:1:1", item_id: "amx", batch_id: null, qty: 5 },
      ],
      uncovered: [{ item_id: "amx", qty: 5 }],
    });
    expect(r.allocations).toEqual([
      { dispenseId: "d1", itemId: "amx", batchId: "b2", qty: 15 },
      { dispenseId: "c1:1:1", itemId: "amx", batchId: "", qty: 5 },
    ]);
    expect(r.allocations.reduce((sum, a) => sum + a.qty, 0)).toBe(20);
  });

  it("reads the server's balances sent back with an insufficient_stock refusal", () => {
    expect(
      parseBalances({
        outcome: "rejected",
        reason: "insufficient_stock",
        lines: [{ item_id: "amx", requested: 20, available: 15 }],
        items: [{ id: "amx", on_hand_qty: 15, row_version: 8 }],
        batches: [
          { id: "b1", qty_on_hand: 0, row_version: 4 },
          { id: "b2", qty_on_hand: 15, row_version: 4 },
        ],
      }),
    ).toEqual({
      items: [{ id: "amx", qty: 15, rowVersion: 8 }],
      batches: [
        { id: "b1", qty: 0, rowVersion: 4 },
        { id: "b2", qty: 15, rowVersion: 4 },
      ],
    });
  });

  it("ignores a stored answer older than the balance already downloaded", () => {
    expect(isStaleBalance(9, 8)).toBe(true);
    expect(isStaleBalance(9, 9)).toBe(false);
    expect(isStaleBalance(9, 10)).toBe(false);
    expect(isStaleBalance(undefined, 3)).toBe(false);
    expect(isStaleBalance(4, undefined)).toBe(false);
  });

  it("reads the available quantity from an insufficient_stock refusal", () => {
    expect(
      parseShortLines({ outcome: "rejected", reason: "insufficient_stock", lines: [{ item_id: "amx", requested: 15, available: 8 }] }),
    ).toEqual([{ itemId: "amx", requested: 15, available: 8 }]);
  });

  it("explains refusals in plain words, without codes", () => {
    expect(rejectReasonText("insufficient_stock")).toMatch(/not have enough/);
    expect(rejectReasonText("lines_mismatch")).toMatch(/do not match the prescription/);
    expect(rejectReasonText("prescription_not_found")).toMatch(/no record/);
    expect(rejectReasonText("something_new")).toBe("The server refused this change.");
  });
});

describe("refused dispenses", () => {
  it("undoes a dispense the pharmacist was told not to hand over", () => {
    for (const reason of ["insufficient_stock", "prescription_void", "already_dispensed", "permission_denied"]) {
      expect(refusedDispenseAction(reason, false)).toBe("undo");
    }
  });

  it("resends a handed-over dispense refused for stock as handed over", () => {
    expect(refusedDispenseAction("insufficient_stock", true)).toBe("resend_offline");
  });

  it("keeps a handed-over dispense refused for any other reason", () => {
    for (const reason of ["prescription_void", "already_dispensed", "permission_denied", "lines_mismatch"]) {
      expect(refusedDispenseAction(reason, true)).toBe("keep_handed_over");
    }
  });

  it("does not reopen a handed-over prescription", () => {
    expect(handedOverRefusalStatus("permission_denied")).toBe("dispensed");
    expect(handedOverRefusalStatus("already_dispensed")).toBe("dispensed");
    expect(handedOverRefusalStatus("prescription_void")).toBe("void");
  });
});

describe("opening stock and discard", () => {
  it("matches local medicines to the server's by name, form and strength", () => {
    const map = mapLocalItemsToServer(
      [
        { id: "local-amx", medName: " amoxicillin ", form: "Capsule", strength: "500  mg" },
        { id: "local-x", medName: "Unknown", form: "tablet", strength: "1 mg" },
      ],
      [{ id: "srv-amx", medName: "Amoxicillin", form: "capsule", strength: "500 mg" }],
    );
    expect(map.get("local-amx")).toBe("srv-amx");
    expect(map.has("local-x")).toBe(false);
    expect(map.get("srv-amx")).toBe("srv-amx");
  });

  it("remaps prescription lines and counts lines without a match", () => {
    const out = remapLines(
      [
        { itemId: "local-amx", dosage: "", frequency: "", durationDays: 1, qty: 1 },
        { itemId: "local-x", dosage: "", frequency: "", durationDays: 1, qty: 1 },
      ],
      new Map([["local-amx", "srv-amx"]]),
    );
    expect(out.lines.map((l) => l.itemId)).toEqual(["srv-amx", "local-x"]);
    expect(out.changed).toBe(true);
    expect(out.unmatched).toBe(1);
  });

  it("derives the same site key as queue tickets", () => {
    expect(pharmacySiteKey("Ikeja  Outreach — Day 2", "Mobile Clinic")).toBe("ikeja-outreach-day-2");
    expect(pharmacySiteKey("", "Mobile Clinic")).toBe("mobile-clinic");
    expect(pharmacySiteKey("***", "")).toBe("site");
  });
});
