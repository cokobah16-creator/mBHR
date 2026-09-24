import { describe, it, expect } from "vitest";
import {
  canManageQueue,
  nextStageOf,
  minutesSince,
  formatWait,
  ticketLabel,
  countByStage,
  splitStage,
  longestWaitMinutes,
  savedNote,
  isFlowStage,
  isTicketPriority,
  issueErrorMessage,
  ticketStateBadge,
  canMoveForward,
  moveForwardLabel,
  moveForwardDescription,
} from "./queueBoardModel";

const NOW = new Date("2026-09-23T12:00:00").getTime();
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000);

describe("canManageQueue", () => {
  it("follows the register permission in the role matrix", () => {
    expect(canManageQueue("nurse")).toBe(true);
    expect(canManageQueue("doctor")).toBe(true);
    expect(canManageQueue("volunteer")).toBe(true);
    expect(canManageQueue("admin")).toBe(true);
    expect(canManageQueue("pharmacist")).toBe(false);
    expect(canManageQueue("guest")).toBe(false);
    expect(canManageQueue("auditor")).toBe(false);
    expect(canManageQueue(undefined)).toBe(false);
  });
});

describe("stage helpers", () => {
  it("walks registration → vitals → consult → pharmacy → end", () => {
    expect(nextStageOf("registration")).toBe("vitals");
    expect(nextStageOf("vitals")).toBe("consult");
    expect(nextStageOf("consult")).toBe("pharmacy");
    expect(nextStageOf("pharmacy")).toBeNull();
  });

  it("recognises flow stages only", () => {
    expect(isFlowStage("consult")).toBe(true);
    expect(isFlowStage("lab")).toBe(false);
  });
});

describe("time and labels", () => {
  it("counts whole minutes and never goes negative", () => {
    expect(minutesSince(at(12.5), NOW)).toBe(12);
    expect(minutesSince(new Date(NOW + 60_000), NOW)).toBe(0);
    expect(minutesSince(undefined, NOW)).toBe(0);
    expect(minutesSince("not a date", NOW)).toBe(0);
  });

  it("formats waits in minutes, then hours", () => {
    expect(formatWait(5)).toBe("5 min");
    expect(formatWait(60)).toBe("1 h");
    expect(formatWait(95)).toBe("1 h 35 min");
  });

  it("prefers the ticket number and falls back to the queue position", () => {
    expect(ticketLabel({ ticketNumber: "Q-014", position: 3 })).toBe("Q-014");
    expect(ticketLabel({ ticketNumber: " ", position: 3 })).toBe("#003");
    expect(ticketLabel({ position: 12 })).toBe("#012");
  });

  it("describes where the save went", () => {
    expect(savedNote(false)).toBe("Saved on this device.");
    expect(savedNote(true)).toContain("Waiting to sync");
  });
});

describe("countByStage / splitStage", () => {
  const items = [
    { id: "1", stage: "vitals", status: "waiting", position: 2, updatedAt: at(5), queuedAt: at(40) },
    { id: "2", stage: "vitals", status: "waiting", position: 1, updatedAt: at(5), queuedAt: at(10) },
    { id: "3", stage: "vitals", status: "in_progress", position: 1, updatedAt: at(3) },
    { id: "4", stage: "vitals", status: "in_progress", position: 1, updatedAt: at(8) },
    { id: "5", stage: "vitals", status: "done", position: 1, updatedAt: at(30) },
    { id: "6", stage: "vitals", status: "done", position: 1, updatedAt: at(60 * 24) },
    { id: "7", stage: "consult", status: "waiting", position: 1, updatedAt: at(1) },
    { id: "8", stage: "lab", status: "waiting", position: 1, updatedAt: at(1) },
  ];

  it("counts waiting, in service and done today per stage", () => {
    const c = countByStage(items, NOW);
    expect(c.vitals).toEqual({ waiting: 2, inService: 2, doneToday: 1 });
    expect(c.consult).toEqual({ waiting: 1, inService: 0, doneToday: 0 });
    expect(c.registration).toEqual({ waiting: 0, inService: 0, doneToday: 0 });
  });

  it("orders waiting by position and in-service by call time", () => {
    const { waiting, inService } = splitStage(items, "vitals");
    expect(waiting.map((i) => i.id)).toEqual(["2", "1"]);
    expect(inService.map((i) => i.id)).toEqual(["4", "3"]);
  });

  it("measures the longest wait from when the ticket was queued", () => {
    const { waiting } = splitStage(items, "vitals");
    expect(longestWaitMinutes(waiting, NOW)).toBe(40);
    expect(longestWaitMinutes([], NOW)).toBe(0);
  });
});

describe("issueErrorMessage", () => {
  it("explains a duplicate ticket without showing the raw error", () => {
    const msg = issueErrorMessage(new Error("Patient is already in queue at consult stage"));
    expect(msg).toContain("consultation queue");
    expect(msg).not.toContain("stage");
  });

  it("never echoes record ids from the service error", () => {
    const msg = issueErrorMessage(new Error("Patient 3f2a-secret-id not found"));
    expect(msg).not.toContain("3f2a-secret-id");
    expect(msg).toContain("not found on this device");
  });

  it("falls back to a retry message that does not claim nothing was saved", () => {
    const generic = issueErrorMessage("boom");
    expect(generic).toContain("may not have been saved");
    expect(generic).toContain("try again");
    expect(issueErrorMessage(new Error("QuotaExceededError"))).toBe(generic);
  });
});

describe("isTicketPriority", () => {
  it("accepts only the queue priorities", () => {
    expect(["urgent", "normal", "low"].every(isTicketPriority)).toBe(true);
    expect(isTicketPriority("high")).toBe(false);
  });
});

describe("ticketStateBadge", () => {
  it("shows nothing for a confirmed number or without cloud sync", () => {
    expect(ticketStateBadge({ ticketNumber: "Q-021", ticketPending: 0 }, true)).toBeNull();
    expect(ticketStateBadge({ ticketNumber: "K7-001", ticketPending: 1, ticketProvisional: 1 }, false)).toBeNull();
  });

  it("names temporary, unconfirmed and changed numbers in words", () => {
    expect(ticketStateBadge({ ticketPending: 1, ticketProvisional: 1 }, true)).toMatchObject({
      tone: "warning",
      label: "Temporary number",
    });
    expect(ticketStateBadge({ ticketPending: 1, ticketProvisional: 0 }, true)).toMatchObject({
      tone: "info",
      label: "Not confirmed yet",
    });
    expect(
      ticketStateBadge({ ticketNumber: "Q-014", ticketRelabelledFrom: "K7-003" }, true),
    ).toMatchObject({ tone: "warning", label: "Changed from K7-003" });
  });
});

describe("move forward", () => {
  const waiting = [
    { id: "u1", position: 1, priority: "urgent" },
    { id: "n1", position: 2, priority: "normal" },
    { id: "n2", position: 3, priority: "normal" },
  ];

  it("offers the move only when the ticket can pass someone of its own priority or lower", () => {
    expect(canMoveForward(waiting, "n2")).toBe(true);
    expect(canMoveForward(waiting, "n1")).toBe(false);
    expect(canMoveForward(waiting, "u1")).toBe(false);
  });

  it("says urgent tickets stay ahead", () => {
    expect(moveForwardLabel("urgent")).toBe("Move to front");
    expect(moveForwardLabel("normal")).toBe("Move up");
    expect(moveForwardDescription("Ticket Q-003", "normal")).toMatch(/urgent tickets stay ahead/i);
    // The accessible name starts with the visible text (label in name).
    expect(moveForwardDescription("Ticket Q-003", "normal").startsWith("Move up")).toBe(true);
    expect(moveForwardDescription("Ticket Q-003", "urgent").startsWith("Move to front")).toBe(true);
  });
});
