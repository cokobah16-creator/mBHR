// Tests for the pure rules behind the queue-ticket sync participant
// (queueSync.ts). The participant itself talks to Dexie and Supabase; its
// decisions are made by these functions.
import { describe, it, expect } from "vitest";
import type { QueueRow } from "@/services/queueTickets";
import {
  confirmedTicketChanges,
  holdsToRelease,
  issueTicketArgs,
  leasedSeqOf,
  legacyRowUpdates,
  parseIssueResult,
  parseLeaseResult,
  pendingTicketGroups,
} from "./queueSyncModel";

function row(p: Partial<QueueRow> & { id: string }): QueueRow {
  return {
    patientId: "p1",
    stage: "vitals",
    position: 1,
    status: "waiting",
    updatedAt: new Date("2026-09-23T09:00:00Z"),
    ...p,
  } as QueueRow;
}

const pendingBase = {
  siteKey: "mobile-clinic",
  serviceDate: "2026-09-23",
  ticketPending: 1 as const,
};

describe("pendingTicketGroups", () => {
  it("groups the rows of one ticket and orders tickets oldest first", () => {
    const rows = [
      row({ id: "b1", patientId: "p2", ticketId: "t2", ticketNumber: "Q-002", ...pendingBase, queuedAt: new Date("2026-09-23T09:10:00Z") }),
      row({ id: "a1", ticketId: "t1", ticketNumber: "Q-001", ...pendingBase, queuedAt: new Date("2026-09-23T09:00:00Z"), status: "done" }),
      row({ id: "a2", ticketId: "t1", ticketNumber: "Q-001", ...pendingBase, queuedAt: new Date("2026-09-23T09:20:00Z") }),
      row({ id: "c1", patientId: "p3", ticketId: "t3", ticketNumber: "Q-003", siteKey: "mobile-clinic", serviceDate: "2026-09-23", ticketPending: 0 }),
    ];
    const groups = pendingTicketGroups(rows);
    expect(groups.map((g) => g.ticketId)).toEqual(["t1", "t2"]);
    expect(groups[0].rowIds.sort()).toEqual(["a1", "a2"]);
  });

  it("skips rows without a site, day or number", () => {
    expect(pendingTicketGroups([row({ id: "x", ticketId: "t", ticketPending: 1 })])).toEqual([]);
  });
});

describe("issueTicketArgs", () => {
  it("sends a leased number as its sequence", () => {
    const [g] = pendingTicketGroups([
      row({ id: "a", ticketId: "t1", ticketNumber: "Q-021", ...pendingBase }),
    ]);
    expect(issueTicketArgs(g, "dev_A")).toMatchObject({
      p_ticket_id: "t1",
      p_site_key: "mobile-clinic",
      p_service_date: "2026-09-23",
      p_patient_id: "p1",
      p_leased_seq: 21,
      p_provisional_label: null,
      p_device_id: "dev_A",
    });
  });

  it("sends a temporary number as a label to keep", () => {
    const [g] = pendingTicketGroups([
      row({ id: "a", ticketId: "t1", ticketNumber: "K7-003", ticketProvisional: 1, ...pendingBase }),
    ]);
    expect(issueTicketArgs(g, "dev_A")).toMatchObject({
      p_leased_seq: null,
      p_provisional_label: "K7-003",
    });
  });

  it("reads block numbers only from server-style labels", () => {
    expect(leasedSeqOf("Q-007")).toBe(7);
    expect(leasedSeqOf("Q-1204")).toBe(1204);
    expect(leasedSeqOf("K7-003")).toBeNull();
    expect(leasedSeqOf("Q-000")).toBeNull();
  });
});

describe("parseIssueResult / confirmedTicketChanges", () => {
  it("reads an applied answer", () => {
    expect(
      parseIssueResult({ outcome: "applied", ticket_id: "t9", ticket_number: "Q-021", provisional: false }),
    ).toEqual({ outcome: "applied", ticketId: "t9", ticketNumber: "Q-021", provisional: false });
  });

  it("reads a rejection and refuses unexpected shapes", () => {
    expect(parseIssueResult({ outcome: "rejected", reason: "patient_not_found" })).toEqual({
      outcome: "rejected",
      reason: "patient_not_found",
    });
    expect(parseIssueResult({ outcome: "applied" })).toBeNull();
    expect(parseIssueResult(null)).toBeNull();
  });

  it("confirms the same number without marking it changed", () => {
    const changes = confirmedTicketChanges(
      { ticketNumber: "Q-021" },
      { outcome: "applied", ticketId: "t1", ticketNumber: "Q-021", provisional: false },
    );
    expect(changes).toEqual({
      ticketId: "t1",
      ticketNumber: "Q-021",
      ticketProvisional: 0,
      ticketPending: 0,
    });
  });

  it("relabels to the server's ticket and remembers the number the patient was given", () => {
    const changes = confirmedTicketChanges(
      { ticketNumber: "K7-003" },
      { outcome: "applied", ticketId: "t-other-desk", ticketNumber: "Q-014", provisional: false },
    );
    expect(changes).toMatchObject({
      ticketId: "t-other-desk",
      ticketNumber: "Q-014",
      ticketPending: 0,
      ticketRelabelledFrom: "K7-003",
    });
  });

  it("keeps the first label given when a ticket changes twice", () => {
    const changes = confirmedTicketChanges(
      { ticketNumber: "Q-014", ticketRelabelledFrom: "K7-003" },
      { outcome: "applied", ticketId: "t", ticketNumber: "Q-015", provisional: false },
    );
    expect(changes.ticketRelabelledFrom).toBe("K7-003");
  });
});

describe("holdsToRelease", () => {
  it("releases rows whose transitions have all been sent", () => {
    const held = [
      { id: "q1", transitionPending: 1 as const },
      { id: "q2", transitionPending: 1 as const },
      { id: "q3", transitionPending: 0 as const },
    ];
    expect(holdsToRelease(held, [{ queueItemId: "q2" }])).toEqual(["q1"]);
  });
});

describe("legacyRowUpdates", () => {
  const ids = () => {
    let n = 0;
    return () => `new-${++n}`;
  };

  it("gives old rows their Lagos day and today's numbered rows one ticket per patient", () => {
    const rows = [
      row({ id: "a", ticketNumber: "Q-003", queuedAt: new Date("2026-09-23T08:00:00Z") }),
      row({ id: "b", ticketNumber: "Q-003", queuedAt: new Date("2026-09-23T09:00:00Z"), status: "done" }),
      row({ id: "c", patientId: "p2", ticketNumber: "Q-001", queuedAt: new Date("2026-09-20T08:00:00Z") }),
      row({ id: "d", patientId: "p3", siteKey: "s", serviceDate: "2026-09-23", ticketNumber: "Q-009" }),
    ];
    const updates = legacyRowUpdates(rows, "2026-09-23", "mobile-clinic", ids());
    expect(updates.map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(updates[0].changes).toMatchObject({
      serviceDate: "2026-09-23",
      siteKey: "mobile-clinic",
      ticketId: "new-1",
      ticketPending: 1,
      ticketProvisional: 1,
    });
    expect(updates[1].changes.ticketId).toBe("new-1");
    expect(updates[2].changes).toEqual({ serviceDate: "2026-09-20" });
  });
});

describe("parseLeaseResult", () => {
  it("reads a one-row answer", () => {
    expect(parseLeaseResult([{ lease_id: "l1", start_seq: 21, end_seq: 40 }])).toEqual({
      leaseId: "l1",
      startSeq: 21,
      endSeq: 40,
    });
  });

  it("refuses a malformed block", () => {
    expect(parseLeaseResult([{ lease_id: "l1", start_seq: 40, end_seq: 21 }])).toBeNull();
    expect(parseLeaseResult([])).toBeNull();
  });
});
