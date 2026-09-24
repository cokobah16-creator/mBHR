import { describe, it, expect } from "vitest";
import type { TicketLease } from "@/db";
import {
  devicePrefixFrom,
  expiredLeaseIds,
  findTodaysTicket,
  formatTicketNumber,
  isProvisionalLabel,
  provisionalLabel,
  remainingInLeases,
  serviceDateOf,
  siteKeyFromName,
  takeFromLeases,
  ticketSyncState,
  type QueueRow,
} from "./queueTickets";

function lease(p: Partial<TicketLease> & { id: string }): TicketLease {
  return {
    siteKey: "mobile-clinic",
    serviceDate: "2026-09-23",
    deviceId: "dev_A",
    startSeq: 1,
    endSeq: 20,
    nextSeq: 1,
    createdAt: 0,
    ...p,
  };
}

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

describe("serviceDateOf (Africa/Lagos day)", () => {
  it("puts 00:30 WAT on the new day although it is still the previous UTC day", () => {
    // 23:30 UTC on the 23rd is 00:30 on the 24th in Lagos (UTC+1).
    expect(serviceDateOf(new Date("2026-09-23T23:30:00Z"))).toBe("2026-09-24");
  });

  it("keeps 23:30 WAT on the same day", () => {
    expect(serviceDateOf(new Date("2026-09-23T22:30:00Z"))).toBe("2026-09-23");
  });

  it("changes day exactly at midnight WAT (23:00 UTC)", () => {
    expect(serviceDateOf(new Date("2026-09-23T22:59:59Z"))).toBe("2026-09-23");
    expect(serviceDateOf(new Date("2026-09-23T23:00:00Z"))).toBe("2026-09-24");
  });

  it("accepts timestamps and ISO strings", () => {
    const ms = Date.parse("2026-01-01T00:15:00Z");
    expect(serviceDateOf(ms)).toBe("2026-01-01");
    expect(serviceDateOf("2025-12-31T23:15:00Z")).toBe("2026-01-01");
  });
});

describe("siteKeyFromName", () => {
  it("normalises the site name so devices at the same camp agree", () => {
    expect(siteKeyFromName("Mobile Clinic", "Mobile Clinic")).toBe("mobile-clinic");
    expect(siteKeyFromName("  Ikeja  Outreach (Day 2) ", "x")).toBe("ikeja-outreach-day-2");
    expect(siteKeyFromName("Ọ̀yọ́ Camp", "x")).toBe("oyo-camp");
  });

  it("falls back to the default site name", () => {
    expect(siteKeyFromName(undefined, "Mobile Clinic")).toBe("mobile-clinic");
    expect(siteKeyFromName("!!!", "Mobile Clinic")).toBe("mobile-clinic");
  });

  it("caps the key length", () => {
    expect(siteKeyFromName("a".repeat(100), "x")).toHaveLength(64);
  });
});

describe("labels", () => {
  it("pads server numbers to three digits without truncating larger ones", () => {
    expect(formatTicketNumber(7)).toBe("Q-007");
    expect(formatTicketNumber(214)).toBe("Q-214");
    expect(formatTicketNumber(1204)).toBe("Q-1204");
  });

  it("builds temporary labels with the device prefix", () => {
    expect(provisionalLabel("K7", 3)).toBe("K7-003");
    expect(isProvisionalLabel("K7-003")).toBe(true);
    expect(isProvisionalLabel("Q-021")).toBe(false);
  });

  it("derives a stable two-character prefix that never starts a server number", () => {
    const a = devicePrefixFrom("dev_01HZX");
    expect(a).toMatch(/^[A-HJ-NPR-Z2-9]{2}$/);
    expect(devicePrefixFrom("dev_01HZX")).toBe(a);
    expect(a).not.toContain("Q");
    const many = new Set(
      Array.from({ length: 50 }, (_, i) => devicePrefixFrom(`dev_${i}`)),
    );
    expect(many.size).toBeGreaterThan(30);
  });
});

describe("leases", () => {
  const leases = [
    lease({ id: "l2", startSeq: 21, endSeq: 40, nextSeq: 21 }),
    lease({ id: "l1", startSeq: 1, endSeq: 20, nextSeq: 19 }),
    lease({ id: "other-device", deviceId: "dev_B", startSeq: 41, endSeq: 60, nextSeq: 41 }),
    lease({ id: "other-site", siteKey: "ikeja", startSeq: 1, endSeq: 20, nextSeq: 1 }),
    lease({ id: "yesterday", serviceDate: "2026-09-22", nextSeq: 1 }),
  ];

  it("counts only this device's unused numbers for the site and day", () => {
    expect(remainingInLeases(leases, "mobile-clinic", "2026-09-23", "dev_A")).toBe(2 + 20);
  });

  it("uses the lowest number first and advances the block", () => {
    const first = takeFromLeases(leases, "mobile-clinic", "2026-09-23", "dev_A");
    expect(first?.seq).toBe(19);
    expect(first?.lease).toMatchObject({ id: "l1", nextSeq: 20 });
  });

  it("returns null when every block is used up", () => {
    const used = [lease({ id: "l1", startSeq: 1, endSeq: 20, nextSeq: 21 })];
    expect(takeFromLeases(used, "mobile-clinic", "2026-09-23", "dev_A")).toBeNull();
    expect(remainingInLeases(used, "mobile-clinic", "2026-09-23", "dev_A")).toBe(0);
  });

  it("never hands two devices the same number", () => {
    // Two devices with separate server blocks issue offline in turn.
    let a = [lease({ id: "a", deviceId: "dev_A", startSeq: 1, endSeq: 5, nextSeq: 1 })];
    let b = [lease({ id: "b", deviceId: "dev_B", startSeq: 6, endSeq: 10, nextSeq: 6 })];
    const issued: number[] = [];
    for (let i = 0; i < 5; i++) {
      const fromA = takeFromLeases(a, "mobile-clinic", "2026-09-23", "dev_A")!;
      a = [fromA.lease];
      const fromB = takeFromLeases(b, "mobile-clinic", "2026-09-23", "dev_B")!;
      b = [fromB.lease];
      issued.push(fromA.seq, fromB.seq);
    }
    expect(new Set(issued).size).toBe(10);
    expect(takeFromLeases(a, "mobile-clinic", "2026-09-23", "dev_A")).toBeNull();
  });

  it("lists leases from earlier days for clean-up", () => {
    expect(expiredLeaseIds(leases, "2026-09-23")).toEqual(["yesterday"]);
  });
});

describe("findTodaysTicket", () => {
  it("reuses the patient's ticket for the same site and day", () => {
    const rows = [
      row({ id: "a", ticketId: "t1", ticketNumber: "Q-004", siteKey: "mobile-clinic", serviceDate: "2026-09-23", status: "done" }),
      row({ id: "b", patientId: "p2", ticketId: "t2", ticketNumber: "Q-005", siteKey: "mobile-clinic", serviceDate: "2026-09-23" }),
    ];
    expect(findTodaysTicket(rows, "p1", "mobile-clinic", "2026-09-23")).toMatchObject({
      ticketId: "t1",
      ticketNumber: "Q-004",
    });
  });

  it("does not reuse yesterday's ticket or another site's", () => {
    const rows = [
      row({ id: "a", ticketId: "t1", ticketNumber: "Q-004", siteKey: "mobile-clinic", serviceDate: "2026-09-22" }),
      row({ id: "b", ticketId: "t2", ticketNumber: "Q-009", siteKey: "ikeja", serviceDate: "2026-09-23" }),
    ];
    expect(findTodaysTicket(rows, "p1", "mobile-clinic", "2026-09-23")).toBeNull();
  });

  it("reuses a number from an older app version queued the same Lagos day", () => {
    const rows = [
      row({ id: "a", ticketNumber: "Q-002", queuedAt: new Date("2026-09-23T23:30:00Z") }),
    ];
    const found = findTodaysTicket(rows, "p1", "mobile-clinic", "2026-09-24");
    expect(found).toMatchObject({ ticketNumber: "Q-002" });
    expect(found?.ticketId).toBeUndefined();
  });

  it("carries the pending and temporary markers", () => {
    const rows = [
      row({ id: "a", ticketId: "t1", ticketNumber: "K7-001", ticketProvisional: 1, ticketPending: 1, siteKey: "s", serviceDate: "2026-09-23" }),
    ];
    expect(findTodaysTicket(rows, "p1", "s", "2026-09-23")).toMatchObject({
      ticketProvisional: 1,
      ticketPending: 1,
    });
  });
});

describe("ticketSyncState", () => {
  it("says nothing about the server when sync is not set up", () => {
    expect(ticketSyncState({ ticketPending: 1 }, false)).toBe("device_only");
  });

  it("separates temporary, unconfirmed, changed and confirmed numbers", () => {
    expect(ticketSyncState({ ticketPending: 1, ticketProvisional: 1 }, true)).toBe("provisional");
    expect(ticketSyncState({ ticketPending: 1, ticketProvisional: 0 }, true)).toBe("pending");
    expect(
      ticketSyncState({ ticketPending: 0, ticketNumber: "Q-021", ticketRelabelledFrom: "K7-003" }, true),
    ).toBe("changed");
    expect(ticketSyncState({ ticketPending: 0, ticketNumber: "Q-021" }, true)).toBe("confirmed");
  });
});
