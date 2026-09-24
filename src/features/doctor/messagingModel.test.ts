import { describe, it, expect } from "vitest";
import type { PalaverMessage } from "@/services/palaverRoom";
import type { PatientSecureMessage } from "@/services/patientSecureMessaging";
import {
  UNKNOWN_PATIENT_NAME,
  buildPalaverThreads,
  buildPatientThreads,
  canMessagePatients,
  canMessageStaff,
  canPostAnnouncements,
  describeMessagingError,
  errorName,
  formatClock,
  formatFullTimestamp,
  formatMessageTime,
  isMessagePriority,
  isTargetRole,
  priorityTone,
  replySubject,
  summariseConnection,
} from "./messagingModel";

const ME = "u-me";

function staffMsg(p: Partial<PalaverMessage> & { id: string }): PalaverMessage {
  return {
    sender_id: "u-a",
    sender_name: "Dr A",
    recipient_id: ME,
    recipient_name: "Me",
    subject: "Subject",
    body: "Body",
    priority: "normal",
    is_read: true,
    read_at: null,
    is_archived: false,
    parent_id: null,
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
    ...p,
  };
}

function patientMsg(
  p: Partial<PatientSecureMessage> & { id: string },
): PatientSecureMessage {
  return {
    patient_id: "p1",
    staff_id: null,
    subject: "Question",
    body: "Hello",
    from_patient: true,
    from_name: "Ada Obi",
    read: true,
    created_at: "2026-09-20T10:00:00Z",
    ...p,
  };
}

describe("time formatting", () => {
  const now = new Date(2026, 8, 23, 15, 0);

  it("shows only the clock time for today", () => {
    expect(formatMessageTime(new Date(2026, 8, 23, 9, 5), now)).toBe("09:05");
  });

  it("labels yesterday", () => {
    expect(formatMessageTime(new Date(2026, 8, 22, 18, 30), now)).toBe(
      "Yesterday 18:30",
    );
  });

  it("uses dd/mm/yyyy for older messages", () => {
    expect(formatMessageTime(new Date(2026, 7, 3, 7, 0), now)).toBe(
      "03/08/2026 07:00",
    );
  });

  it("handles month boundaries for yesterday", () => {
    const firstOfMonth = new Date(2026, 9, 1, 8, 0);
    expect(formatMessageTime(new Date(2026, 8, 30, 20, 15), firstOfMonth)).toBe(
      "Yesterday 20:15",
    );
  });

  it("returns empty strings for missing or invalid dates", () => {
    expect(formatMessageTime(null, now)).toBe("");
    expect(formatMessageTime("not a date", now)).toBe("");
    expect(formatClock(undefined)).toBe("");
    expect(formatFullTimestamp("")).toBe("");
  });

  it("gives a full timestamp for tooltips", () => {
    expect(formatFullTimestamp(new Date(2026, 0, 2, 13, 4))).toBe(
      "02/01/2026 at 13:04",
    );
  });
});

describe("priority and labels", () => {
  it("maps priority to badge tone; normal has none", () => {
    expect(priorityTone("critical")).toBe("critical");
    expect(priorityTone("urgent")).toBe("warning");
    expect(priorityTone("normal")).toBeNull();
    expect(priorityTone(undefined)).toBeNull();
  });

  it("guards select values", () => {
    expect(isMessagePriority("urgent")).toBe(true);
    expect(isMessagePriority("high")).toBe(false);
    expect(isTargetRole("all_clinical")).toBe(true);
    expect(isTargetRole("patients")).toBe(false);
    expect(isTargetRole("toString")).toBe(false);
  });

  it("prefixes reply subjects once", () => {
    expect(replySubject("BP review")).toBe("Re: BP review");
    expect(replySubject("Re: BP review")).toBe("Re: BP review");
    expect(replySubject("RE: BP review")).toBe("RE: BP review");
    expect(replySubject("")).toBe("Re: Message");
    expect(replySubject(undefined)).toBe("Re: Message");
  });
});

describe("buildPalaverThreads", () => {
  it("groups sent and received messages by colleague, oldest first", () => {
    const threads = buildPalaverThreads(
      [
        staffMsg({ id: "1", created_at: "2026-09-20T10:00:00Z" }),
        staffMsg({
          id: "2",
          sender_id: ME,
          sender_name: "Me",
          recipient_id: "u-a",
          recipient_name: "Dr A",
          created_at: "2026-09-20T11:00:00Z",
        }),
        staffMsg({
          id: "3",
          sender_id: "u-b",
          sender_name: "Nurse B",
          created_at: "2026-09-20T09:00:00Z",
        }),
      ],
      ME,
    );
    expect(threads.map((t) => t.otherId)).toEqual(["u-a", "u-b"]);
    expect(threads[0].messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(threads[0].latest.id).toBe("2");
    expect(threads[0].otherName).toBe("Dr A");
  });

  it("counts only unread messages received by the user", () => {
    const [t] = buildPalaverThreads(
      [
        staffMsg({ id: "1", is_read: false }),
        staffMsg({ id: "2", is_read: false }),
        staffMsg({
          id: "3",
          sender_id: ME,
          recipient_id: "u-a",
          is_read: false,
        }),
      ],
      ME,
    );
    expect(t.unreadCount).toBe(2);
  });

  it("puts unread first, highest unread priority first, then newest", () => {
    const threads = buildPalaverThreads(
      [
        staffMsg({
          id: "old-read",
          sender_id: "u-read",
          created_at: "2026-09-21T12:00:00Z",
        }),
        staffMsg({
          id: "urgent",
          sender_id: "u-urgent",
          is_read: false,
          priority: "urgent",
          created_at: "2026-09-19T08:00:00Z",
        }),
        staffMsg({
          id: "critical",
          sender_id: "u-critical",
          is_read: false,
          priority: "critical",
          created_at: "2026-09-18T08:00:00Z",
        }),
        staffMsg({
          id: "normal",
          sender_id: "u-normal",
          is_read: false,
          created_at: "2026-09-20T08:00:00Z",
        }),
      ],
      ME,
    );
    expect(threads.map((t) => t.otherId)).toEqual([
      "u-critical",
      "u-urgent",
      "u-normal",
      "u-read",
    ]);
    expect(threads[0].topUnreadPriority).toBe("critical");
    expect(threads[3].topUnreadPriority).toBeNull();
  });
});

describe("buildPatientThreads", () => {
  it("groups by patient and takes the name from the patient's latest message", () => {
    const [t] = buildPatientThreads([
      patientMsg({ id: "1", from_name: "Ada O.", created_at: "2026-09-20T09:00:00Z" }),
      patientMsg({ id: "2", from_name: "Ada Obi", created_at: "2026-09-20T10:00:00Z" }),
    ]);
    expect(t.patient_name).toBe("Ada Obi");
    expect(t.nameKnown).toBe(true);
    expect(t.messages.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("falls back to a local name, then to a placeholder, never a staff name", () => {
    const staffOnly = patientMsg({
      id: "s",
      patient_id: "p2",
      from_patient: false,
      from_name: "Dr Staff",
    });
    const [withLocal] = buildPatientThreads(
      [staffOnly],
      new Map([["p2", "Bola Ade"]]),
    );
    expect(withLocal.patient_name).toBe("Bola Ade");
    const [unknown] = buildPatientThreads([staffOnly]);
    expect(unknown.patient_name).toBe(UNKNOWN_PATIENT_NAME);
    expect(unknown.nameKnown).toBe(false);
  });

  it("orders unread, then awaiting reply, then the rest", () => {
    const threads = buildPatientThreads([
      // replied: latest is from staff
      patientMsg({ id: "a1", patient_id: "replied", created_at: "2026-09-22T09:00:00Z" }),
      patientMsg({
        id: "a2",
        patient_id: "replied",
        from_patient: false,
        from_name: "Dr",
        created_at: "2026-09-22T10:00:00Z",
      }),
      // awaiting reply, already read
      patientMsg({ id: "b", patient_id: "awaiting", created_at: "2026-09-21T09:00:00Z" }),
      // unread, oldest
      patientMsg({
        id: "c",
        patient_id: "unread",
        read: false,
        created_at: "2026-09-01T09:00:00Z",
      }),
    ]);
    expect(threads.map((t) => t.patient_id)).toEqual([
      "unread",
      "awaiting",
      "replied",
    ]);
    expect(threads[0].unread_count).toBe(1);
    expect(threads[1].awaitingReply).toBe(true);
    expect(threads[2].awaitingReply).toBe(false);
  });

  it("does not count unread staff messages as unread for staff", () => {
    const [t] = buildPatientThreads([
      patientMsg({ id: "1", from_patient: false, read: false, from_name: "Dr" }),
    ]);
    expect(t.unread_count).toBe(0);
  });
});

describe("summariseConnection", () => {
  it("says plainly when messaging is not configured", () => {
    const s = summariseConnection({ configured: false, online: true, live: "live" });
    expect(s.kind).toBe("not_configured");
    expect(s.canSend).toBe(false);
  });

  it("reports offline before anything else", () => {
    const s = summariseConnection({ configured: true, online: false, live: "live" });
    expect(s.kind).toBe("offline");
    expect(s.canSend).toBe(false);
    expect(s.detail).toMatch(/wait/);
  });

  it("does not claim to show loaded messages when none were loaded", () => {
    const none = summariseConnection({
      configured: true,
      online: false,
      live: "off",
      loaded: false,
    });
    expect(none.detail).not.toMatch(/Showing messages/);
    expect(none.detail).toMatch(/No messages have been loaded/);
    const some = summariseConnection({
      configured: true,
      online: false,
      live: "off",
      loaded: true,
    });
    expect(some.detail).toMatch(/Showing messages loaded before/);
  });

  it("states the polling backstop even when live updates are on", () => {
    const s = summariseConnection({
      configured: true,
      online: true,
      live: "live",
      pollSeconds: 30,
    });
    expect(s.detail).toContain("30 seconds");
  });

  it("only claims live updates when subscribed", () => {
    expect(summariseConnection({ configured: true, online: true, live: "live" }).label).toBe(
      "Live updates on",
    );
    const off = summariseConnection({
      configured: true,
      online: true,
      live: "off",
      pollSeconds: 45,
    });
    expect(off.label).toBe("Live updates off");
    expect(off.detail).toContain("45 seconds");
    expect(
      summariseConnection({ configured: true, online: true, live: "connecting" }).kind,
    ).toBe("connecting");
  });
});

describe("errors", () => {
  it("never repeats the server message", () => {
    const text = describeMessagingError(
      { code: "XX000", message: 'Failing row contains (Ada Obi, "chest pain")' },
      "send the message",
      true,
    );
    expect(text).not.toContain("Ada");
    expect(text).toBe("Could not send the message. Try again in a moment.");
  });

  it("explains offline, permissions, missing links and no-op changes", () => {
    expect(describeMessagingError(new Error("x"), "load messages", false)).toMatch(
      /offline/,
    );
    expect(
      describeMessagingError({ code: "42501" }, "delete the message", true),
    ).toMatch(/did not allow/);
    expect(
      describeMessagingError(
        { message: "new row violates row-level security policy" },
        "send the message",
        true,
      ),
    ).toMatch(/did not allow/);
    expect(
      describeMessagingError({ code: "23503" }, "send the message", true),
    ).toMatch(/Sync this device/);
    expect(
      describeMessagingError({ code: "23503" }, "delete the message", true),
    ).toMatch(/Archive it instead/);
    expect(
      describeMessagingError({ reason: "no_rows" }, "archive the message", true),
    ).toMatch(/Nothing was changed/);
    expect(
      describeMessagingError({ reason: "not_configured" }, "send the message", true),
    ).toMatch(/not set up/);
    expect(
      describeMessagingError(new TypeError("Failed to fetch"), "send the message", true),
    ).toMatch(/Could not reach/);
  });

  it("logs names or codes only", () => {
    expect(errorName(new TypeError("Ada Obi"))).toBe("TypeError");
    expect(errorName({ code: "PGRST116", message: "Ada Obi" })).toBe("PGRST116");
    expect(errorName("Ada Obi")).toBe("unknown");
  });
});

describe("permissions", () => {
  it("lets clinical and admin roles message staff, not guests or auditors", () => {
    expect(canMessageStaff("doctor")).toBe(true);
    expect(canMessageStaff("nurse")).toBe(true);
    expect(canMessageStaff("pharmacist")).toBe(true);
    expect(canMessageStaff("volunteer")).toBe(true);
    expect(canMessageStaff("admin")).toBe(true);
    expect(canMessageStaff("guest")).toBe(false);
    expect(canMessageStaff("auditor")).toBe(false);
    expect(canMessageStaff(undefined)).toBe(false);
  });

  it("limits announcements to doctors, lead clinicians and admins", () => {
    expect(canPostAnnouncements("doctor")).toBe(true);
    expect(canPostAnnouncements("lead_clinician")).toBe(true);
    expect(canPostAnnouncements("admin")).toBe(true);
    expect(canPostAnnouncements("nurse")).toBe(false);
    expect(canPostAnnouncements("pharmacist")).toBe(false);
  });

  it("limits patient messaging to roles that consult", () => {
    expect(canMessagePatients("doctor")).toBe(true);
    expect(canMessagePatients("admin")).toBe(true);
    expect(canMessagePatients("nurse")).toBe(false);
    expect(canMessagePatients("volunteer")).toBe(false);
    expect(canMessagePatients(null)).toBe(false);
  });
});
