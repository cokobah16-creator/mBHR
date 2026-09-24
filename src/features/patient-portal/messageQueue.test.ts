import { describe, it, expect } from "vitest";
import {
  parseMessageQueue,
  queuedForPatient,
  withoutQueued,
  type QueuedMessage,
} from "./messageQueue";

function msg(id: string, patientId: string): QueuedMessage {
  return {
    id,
    subject: "Question",
    body: "Hello",
    from_patient: true,
    from_name: "You",
    created_at: "2026-03-12T10:00:00.000Z",
    read: false,
    patient_id: patientId,
  };
}

describe("parseMessageQueue", () => {
  it("returns an empty list for missing or corrupt data", () => {
    expect(parseMessageQueue(null)).toEqual([]);
    expect(parseMessageQueue("nope")).toEqual([]);
    expect(parseMessageQueue(JSON.stringify({ id: "x" }))).toEqual([]);
  });

  it("drops entries that are not messages", () => {
    const raw = JSON.stringify([msg("a", "p1"), { id: 3 }, null, "text"]);
    expect(parseMessageQueue(raw).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("queuedForPatient", () => {
  it("shows only this patient's messages, never unattributed ones", () => {
    const queue = [msg("a", "p1"), msg("b", "p2"), msg("c", "")];
    expect(queuedForPatient(queue, "p1").map((m) => m.id)).toEqual(["a"]);
    expect(queuedForPatient(queue, "")).toEqual([]);
  });
});

describe("withoutQueued", () => {
  it("removes one message by id", () => {
    const queue = [msg("a", "p1"), msg("b", "p1")];
    expect(withoutQueued(queue, "a").map((m) => m.id)).toEqual(["b"]);
  });
});
