import { describe, it, expect } from "vitest";
import {
  buildDisplayBoard,
  diffNewCalls,
  announcementFor,
  isJustCalled,
  displayFreshness,
  toDisplayRow,
  MAX_NEXT_PER_STAGE,
  MAX_SERVING,
  JUST_CALLED_MS,
  STALE_AFTER_MINUTES,
  type DisplayQueueRow,
} from "./displayModel";
import type { QueueItem } from "@/db";

const T0 = new Date("2026-09-23T10:00:00").getTime();

function row(p: Partial<DisplayQueueRow> & { id: string }): DisplayQueueRow {
  return {
    stage: "vitals",
    status: "waiting",
    position: 1,
    updatedAt: new Date(T0),
    ...p,
  };
}

describe("toDisplayRow", () => {
  it("drops the patient id and anything not needed on a public screen", () => {
    const item = {
      id: "q1",
      patientId: "patient-123",
      stage: "vitals",
      position: 2,
      status: "waiting",
      priority: "urgent",
      createdBy: "user-9",
      ticketNumber: "Q-014",
      queuedAt: new Date(T0),
      assignedTo: "user-1",
      assignedName: "Nurse Ada",
      updatedAt: new Date(T0),
    } as QueueItem;
    const r = toDisplayRow(item);
    expect(Object.keys(r).sort()).toEqual(
      ["id", "position", "queuedAt", "stage", "status", "ticketNumber", "updatedAt"].sort(),
    );
    expect(JSON.stringify(r)).not.toContain("patient-123");
    expect(JSON.stringify(r)).not.toContain("Ada");
  });
});

describe("buildDisplayBoard", () => {
  it("lists tickets being served, most recently called first, with their destination", () => {
    const board = buildDisplayBoard([
      row({ id: "a", ticketNumber: "Q-001", status: "in_progress", stage: "consult", updatedAt: new Date(T0) }),
      row({ id: "b", ticketNumber: "Q-002", status: "in_progress", stage: "vitals", updatedAt: new Date(T0 + 60_000) }),
      row({ id: "c", ticketNumber: "Q-003", status: "done", stage: "vitals" }),
    ]);
    expect(board.serving.map((c) => [c.ticket, c.destination])).toEqual([
      ["Q-002", "Vitals"],
      ["Q-001", "Consultation"],
    ]);
    expect(board.activeCount).toBe(2);
  });

  it("orders the next tickets by queue position and caps each stage", () => {
    const rows = Array.from({ length: MAX_NEXT_PER_STAGE + 2 }, (_, i) =>
      row({ id: `w${i}`, ticketNumber: `Q-0${10 + i}`, position: MAX_NEXT_PER_STAGE + 2 - i }),
    );
    const board = buildDisplayBoard(rows);
    const vitals = board.next.find((g) => g.stage === "vitals")!;
    expect(vitals.tickets).toHaveLength(MAX_NEXT_PER_STAGE);
    expect(vitals.tickets[0]).toBe(`Q-0${10 + MAX_NEXT_PER_STAGE + 1}`);
    expect(vitals.more).toBe(2);
    expect(board.next.map((g) => g.stage)).toEqual([
      "registration",
      "vitals",
      "consult",
      "pharmacy",
    ]);
  });

  it("counts rows without a ticket number instead of inventing one", () => {
    const board = buildDisplayBoard([
      row({ id: "a", status: "in_progress" }),
      row({ id: "b", ticketNumber: "  " }),
      row({ id: "c", ticketNumber: "Q-020" }),
    ]);
    expect(board.serving).toHaveLength(0);
    expect(board.withoutTicket).toBe(2);
    expect(board.next.find((g) => g.stage === "vitals")!.tickets).toEqual(["Q-020"]);
  });

  it("caps the serving list and reports the overflow", () => {
    const rows = Array.from({ length: MAX_SERVING + 3 }, (_, i) =>
      row({ id: `s${i}`, ticketNumber: `Q-${100 + i}`, status: "in_progress", updatedAt: new Date(T0 + i * 1000) }),
    );
    const board = buildDisplayBoard(rows);
    expect(board.serving).toHaveLength(MAX_SERVING);
    expect(board.servingMore).toBe(3);
    expect(board.servingAll).toHaveLength(MAX_SERVING + 3);
  });

  it("does not re-announce a call that comes back into view after another finishes", () => {
    const rows = Array.from({ length: MAX_SERVING + 1 }, (_, i) =>
      row({ id: `s${i}`, ticketNumber: `Q-${100 + i}`, status: "in_progress", updatedAt: new Date(T0 + i * 1000) }),
    );
    const before = buildDisplayBoard(rows);
    // The oldest call (s0) does not fit on screen.
    expect(before.serving.map((c) => c.id)).not.toContain("s0");
    const { ids } = diffNewCalls(null, before.servingAll);
    // The newest call finishes, so s0 scrolls back into view.
    const after = buildDisplayBoard(rows.filter((r) => r.id !== `s${MAX_SERVING}`));
    expect(after.serving.map((c) => c.id)).toContain("s0");
    expect(diffNewCalls(ids, after.servingAll).fresh).toEqual([]);
  });

  it("uses the latest change across all rows, including completed ones", () => {
    const board = buildDisplayBoard([
      row({ id: "a", ticketNumber: "Q-001", updatedAt: new Date(T0) }),
      row({ id: "b", ticketNumber: "Q-002", status: "done", updatedAt: new Date(T0 + 5 * 60_000) }),
    ]);
    expect(board.lastChangeAt).toBe(T0 + 5 * 60_000);
  });

  it("ignores unknown stages and handles an empty queue", () => {
    const board = buildDisplayBoard([row({ id: "x", stage: "lab", ticketNumber: "Q-9" })]);
    expect(board.activeCount).toBe(0);
    expect(buildDisplayBoard([]).lastChangeAt).toBeNull();
  });
});

describe("diffNewCalls / announcementFor", () => {
  const call = (id: string, ticket: string) => ({
    id,
    ticket,
    stage: "vitals" as const,
    destination: "Vitals",
    calledAt: T0,
  });

  it("announces nothing on first load", () => {
    const { fresh, ids } = diffNewCalls(null, [call("a", "Q-001")]);
    expect(fresh).toEqual([]);
    expect([...ids]).toEqual(["a"]);
  });

  it("announces only calls that were not on screen before", () => {
    const { fresh } = diffNewCalls(new Set(["a"]), [call("b", "Q-002"), call("a", "Q-001")]);
    expect(fresh.map((c) => c.id)).toEqual(["b"]);
    expect(announcementFor(fresh)).toBe("Ticket Q-002, please go to Vitals.");
  });

  it("marks a call as just called for a short time only", () => {
    const c = call("a", "Q-001");
    expect(isJustCalled(c, T0 + 1000)).toBe(true);
    expect(isJustCalled(c, T0 + JUST_CALLED_MS + 1)).toBe(false);
  });

  it("does not keep a call stamped far in the future marked as just called", () => {
    const c = call("a", "Q-001");
    expect(isJustCalled(c, T0 - 30_000)).toBe(true);
    expect(isJustCalled(c, T0 - 60 * 60_000)).toBe(false);
  });
});

describe("displayFreshness", () => {
  const base = { online: true, syncEnabled: true, lastChangeAt: T0, activeCount: 3, now: T0 };

  it("reports offline first when the device shares data", () => {
    expect(displayFreshness({ ...base, online: false }).kind).toBe("offline");
  });

  it("does not claim offline matters for a device that never syncs", () => {
    expect(displayFreshness({ ...base, online: false, syncEnabled: false }).kind).toBe("local");
  });

  it("flags a queue with people in it that has not changed for a while", () => {
    const f = displayFreshness({ ...base, now: T0 + STALE_AFTER_MINUTES * 60_000 });
    expect(f.kind).toBe("stale");
    expect(f.tone).toBe("warning");
    expect(f.label).toBe(`No changes for ${STALE_AFTER_MINUTES} min`);
  });

  it("does not call an empty queue stale", () => {
    const f = displayFreshness({ ...base, activeCount: 0, now: T0 + 3 * 60 * 60_000 });
    expect(f.kind).toBe("online");
  });

  it("formats long gaps in hours", () => {
    const f = displayFreshness({ ...base, now: T0 + 75 * 60_000 });
    expect(f.label).toBe("No changes for 1 h 15 min");
  });
});
