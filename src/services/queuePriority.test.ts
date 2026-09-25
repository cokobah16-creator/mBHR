import { describe, it, expect } from "vitest";
import {
  downgradeOptions,
  insertionPosition,
  isDowngrade,
  isEscalation,
  mayDowngradePriority,
  mayMoveQueue,
  normalisePriority,
  normaliseReason,
  orderAfterInsert,
  promotionPosition,
} from "./queuePriority";

describe("normalisePriority", () => {
  it("keeps known priorities and treats anything else as normal", () => {
    expect(normalisePriority("urgent")).toBe("urgent");
    expect(normalisePriority("low")).toBe("low");
    expect(normalisePriority(undefined)).toBe("normal");
    expect(normalisePriority("")).toBe("normal");
    expect(normalisePriority("URGENT")).toBe("normal");
  });
});

describe("isDowngrade / isEscalation", () => {
  it("orders urgent > normal > low", () => {
    expect(isDowngrade("urgent", "normal")).toBe(true);
    expect(isDowngrade("urgent", "low")).toBe(true);
    expect(isDowngrade("normal", "low")).toBe(true);
    expect(isDowngrade("normal", "urgent")).toBe(false);
    expect(isDowngrade("urgent", "urgent")).toBe(false);
    expect(isEscalation("normal", "urgent")).toBe(true);
    expect(isEscalation("urgent", "urgent")).toBe(false);
  });

  it("lists only lower priorities as downgrade options", () => {
    expect(downgradeOptions("urgent")).toEqual(["normal", "low"]);
    expect(downgradeOptions("normal")).toEqual(["low"]);
    expect(downgradeOptions("low")).toEqual([]);
  });
});

describe("insertionPosition", () => {
  it("puts normal and low at the end of the line", () => {
    const waiting = [
      { position: 1, priority: "urgent" },
      { position: 2, priority: "normal" },
    ];
    expect(insertionPosition(waiting, "normal")).toBe(3);
    expect(insertionPosition(waiting, "low")).toBe(3);
    expect(insertionPosition([], "normal")).toBe(1);
  });

  it("puts urgent ahead of every non-urgent ticket, after earlier urgent ones", () => {
    const waiting = [
      { position: 3, priority: "normal" },
      { position: 1, priority: "urgent" },
      { position: 2, priority: "urgent" },
      { position: 4 },
    ];
    expect(insertionPosition(waiting, "urgent")).toBe(3);
  });

  it("puts urgent first when nobody waiting is urgent, however long the line", () => {
    const waiting = Array.from({ length: 15 }, (_, i) => ({
      position: i + 1,
      priority: "normal",
    }));
    // The old heuristic counted every ticket at position <= 10 as urgent.
    expect(insertionPosition(waiting, "urgent")).toBe(1);
  });

  it("puts urgent at the end when everyone waiting is urgent", () => {
    const waiting = [
      { position: 1, priority: "urgent" },
      { position: 2, priority: "urgent" },
    ];
    expect(insertionPosition(waiting, "urgent")).toBe(3);
  });

  it("treats tickets with no stored priority as normal", () => {
    expect(insertionPosition([{ position: 1 }], "urgent")).toBe(1);
  });
});

describe("orderAfterInsert", () => {
  it("inserts the new id and keeps the others in order", () => {
    const waiting = [
      { id: "c", position: 3 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ];
    expect(orderAfterInsert(waiting, "n", 2)).toEqual(["a", "n", "b", "c"]);
    expect(orderAfterInsert(waiting, "n", 1)).toEqual(["n", "a", "b", "c"]);
    expect(orderAfterInsert(waiting, "n", 99)).toEqual(["a", "b", "c", "n"]);
  });

  it("moves an existing id rather than duplicating it", () => {
    const waiting = [
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ];
    expect(orderAfterInsert(waiting, "b", 1)).toEqual(["b", "a"]);
  });
});

describe("promotionPosition (Move to front / long-wait escalation)", () => {
  const line = (...ps: Array<[string, string | undefined]>) =>
    ps.map(([id, priority], i) => ({ id, position: i + 1, priority }));

  it("never moves a normal ticket ahead of waiting urgent tickets", () => {
    const waiting = line(["u1", "urgent"], ["u2", "urgent"], ["n1", "normal"], ["n2", "normal"]);
    // n2 goes right behind the last urgent ticket, ahead of n1.
    expect(promotionPosition(waiting, "n2")).toBe(3);
  });

  it("moves an urgent ticket to the very front", () => {
    const waiting = line(["n1", "normal"], ["u1", "urgent"], ["u2", "urgent"]);
    expect(promotionPosition(waiting, "u2")).toBe(1);
  });

  it("lets a normal ticket pass normal and low tickets when nobody urgent waits", () => {
    const waiting = line(["n1", "normal"], ["l1", "low"], ["n2", undefined]);
    expect(promotionPosition(waiting, "n2")).toBe(1);
  });

  it("keeps a low ticket behind normal ones", () => {
    const waiting = line(["n1", "normal"], ["l1", "low"], ["l2", "low"]);
    expect(promotionPosition(waiting, "l2")).toBe(2);
    // Already right behind the last normal ticket: nothing to do.
    const mixed = line(["n1", "normal"], ["l1", "low"], ["n2", "normal"], ["l2", "low"]);
    expect(promotionPosition(mixed, "l2")).toBeNull();
  });

  it("returns null when the ticket is already as far forward as it may go", () => {
    expect(promotionPosition(line(["u1", "urgent"], ["n1", "normal"]), "n1")).toBeNull();
    expect(promotionPosition(line(["n1", "normal"]), "n1")).toBeNull();
    expect(promotionPosition(line(["n1", "normal"]), "missing")).toBeNull();
  });

  it("stops behind an urgent ticket even when an older order put a normal one ahead of it", () => {
    // Line saved by an older app version: n1 ahead of an urgent ticket.
    const waiting = line(["n1", "normal"], ["u1", "urgent"], ["n2", "normal"], ["n3", "normal"]);
    expect(promotionPosition(waiting, "n3")).toBe(3);
    expect(promotionPosition(waiting, "n2")).toBeNull();
  });
});

describe("permissions", () => {
  it("lets queue staff move tickets at every stage", () => {
    for (const stage of ["registration", "vitals", "consult", "pharmacy"] as const) {
      expect(mayMoveQueue("volunteer", stage)).toBe(true);
      expect(mayMoveQueue("nurse", stage)).toBe(true);
    }
  });

  it("lets a pharmacist move tickets only at pharmacy", () => {
    expect(mayMoveQueue("pharmacist", "pharmacy")).toBe(true);
    expect(mayMoveQueue("pharmacist", "vitals")).toBe(false);
  });

  it("refuses guests, auditors and no role", () => {
    expect(mayMoveQueue("guest", "registration")).toBe(false);
    expect(mayMoveQueue("auditor", "consult")).toBe(false);
    expect(mayMoveQueue(undefined, "vitals")).toBe(false);
  });

  it("allows only consult holders to downgrade priority", () => {
    expect(mayDowngradePriority("doctor")).toBe(true);
    expect(mayDowngradePriority("lead_clinician")).toBe(true);
    expect(mayDowngradePriority("admin")).toBe(true);
    expect(mayDowngradePriority("nurse")).toBe(false);
    expect(mayDowngradePriority("volunteer")).toBe(false);
    expect(mayDowngradePriority(null)).toBe(false);
  });
});

describe("normaliseReason", () => {
  it("trims and treats blank as empty", () => {
    expect(normaliseReason("  Reassessed  ")).toBe("Reassessed");
    expect(normaliseReason("   ")).toBe("");
    expect(normaliseReason(undefined)).toBe("");
  });
});
