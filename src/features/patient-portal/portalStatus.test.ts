import { describe, it, expect } from "vitest";
import {
  appendUnique,
  appointmentRequestStatusInfo,
  appointmentStatusInfo,
  conditionStatusInfo,
  formatPortalDate,
  formatPortalTime,
  labHasResult,
  labStatusInfo,
  messageDeliveryInfo,
  pickNextAppointment,
  portalLabAdvice,
  portalLabInterpretationInfo,
  portalLabLoadNotice,
  upcomingAppointments,
  vitalStatusTone,
} from "./portalStatus";

describe("formatPortalDate", () => {
  it("returns an empty string for missing or invalid values", () => {
    expect(formatPortalDate(undefined)).toBe("");
    expect(formatPortalDate(null)).toBe("");
    expect(formatPortalDate("")).toBe("");
    expect(formatPortalDate("not a date")).toBe("");
  });

  it("keeps a bare calendar date on the same day", () => {
    const out = formatPortalDate("2026-03-12");
    expect(out).toContain("12");
    expect(out).toContain("2026");
    expect(out).not.toContain("11");
  });

  it("formats Date objects", () => {
    const out = formatPortalDate(new Date(2026, 0, 5, 9, 30));
    expect(out).toContain("5");
    expect(out).toContain("2026");
  });
});

describe("formatPortalTime", () => {
  it("uses a 24-hour clock with leading zeros", () => {
    expect(formatPortalTime(new Date(2026, 0, 5, 9, 5))).toBe("09:05");
    expect(formatPortalTime(null)).toBe("");
  });
});

describe("lab status", () => {
  it("only claims a review when the record says reviewed", () => {
    expect(labStatusInfo("reviewed").label).toMatch(/reviewed/i);
    expect(labStatusInfo("completed").label).not.toMatch(/review/i);
    expect(labStatusInfo("pending").label).not.toMatch(/review/i);
  });

  it("never colours a result status as good news", () => {
    expect(labStatusInfo("reviewed").tone).not.toBe("success");
    expect(labStatusInfo("completed").tone).not.toBe("success");
  });

  it("falls back for unknown statuses", () => {
    expect(labStatusInfo("weird")).toEqual({
      label: "Status not recorded",
      tone: "neutral",
    });
  });

  it("has a result once completed or reviewed", () => {
    expect(labHasResult("completed")).toBe(true);
    expect(labHasResult("reviewed")).toBe(true);
    expect(labHasResult("pending")).toBe(false);
    expect(labHasResult(undefined)).toBe(false);
  });

  it("treats a released result as reviewed, with a result", () => {
    expect(labStatusInfo("released").label).toBe("Reviewed by the clinic");
    expect(labStatusInfo("released").tone).not.toBe("success");
    expect(labHasResult("released")).toBe(true);
  });
});

describe("released lab result wording", () => {
  it("labels each recorded interpretation in plain words", () => {
    expect(portalLabInterpretationInfo("normal").label).toBe("In the usual range");
    expect(portalLabInterpretationInfo("abnormal").label).toBe("Outside the usual range");
    expect(portalLabInterpretationInfo("critical").tone).toBe("danger");
  });

  it("never shows a missing or unexpected interpretation as normal", () => {
    for (const value of [null, undefined, "", "unknown", "Normal"]) {
      const info = portalLabInterpretationInfo(value);
      expect(info.tone).not.toBe("success");
      expect(info.label).not.toMatch(/usual range/i);
      expect(portalLabAdvice(value).text).toMatch(/ask your clinician/i);
    }
  });

  it("tells the patient to act on a critical result", () => {
    const advice = portalLabAdvice("critical");
    expect(advice.tone).toBe("danger");
    expect(advice.text).toMatch(/contact the clinic/i);
  });

  it("explains every way the list can fail to load, and only offers retry for failures", () => {
    expect(portalLabLoadNotice("ok")).toBeNull();
    expect(portalLabLoadNotice("not_signed_in")?.title).toMatch(/sign in online/i);
    expect(portalLabLoadNotice("offline")?.retry).toBe(false);
    expect(portalLabLoadNotice("unavailable")?.retry).toBe(false);
    expect(portalLabLoadNotice("not_updated")?.retry).toBe(false);
    expect(portalLabLoadNotice("failed")).toMatchObject({ tone: "danger", retry: true });
  });
});

describe("condition status", () => {
  it("maps each stored status to a plain label", () => {
    expect(conditionStatusInfo("active").label).toBe("Current");
    expect(conditionStatusInfo("managed").label).toBe("Being managed");
    expect(conditionStatusInfo("resolved").label).toBe("Resolved");
    expect(conditionStatusInfo(null).label).toBe("Status not recorded");
  });
});

describe("appointment statuses", () => {
  it("labels requests without promising a booking", () => {
    expect(appointmentRequestStatusInfo("pending").label).toMatch(/waiting/i);
    expect(appointmentRequestStatusInfo("scheduled").label).toBe("Booked");
    expect(appointmentRequestStatusInfo("declined").tone).toBe("danger");
  });

  it("labels appointments", () => {
    expect(appointmentStatusInfo("no-show")).toEqual({
      label: "Missed",
      tone: "warning",
    });
    expect(appointmentStatusInfo("in-progress").label).toBe("In progress");
  });
});

describe("pickNextAppointment", () => {
  const now = new Date(2026, 5, 1, 12).getTime();
  const at = (d: number) => new Date(2026, 5, d, 10);

  it("returns the soonest future scheduled or confirmed appointment", () => {
    const next = pickNextAppointment(
      [
        { id: "a", scheduledAt: at(10), status: "scheduled" },
        { id: "b", scheduledAt: at(3), status: "confirmed" },
        { id: "c", scheduledAt: at(2), status: "cancelled" },
        { id: "d", scheduledAt: new Date(2026, 4, 30), status: "scheduled" },
      ],
      now,
    );
    expect(next?.id).toBe("b");
  });

  it("lists every upcoming appointment soonest first", () => {
    const list = upcomingAppointments(
      [
        { id: "a", scheduledAt: at(10), status: "confirmed" },
        { id: "b", scheduledAt: at(3), status: "scheduled" },
        { id: "c", scheduledAt: at(4), status: "no-show" },
      ],
      now,
    );
    expect(list.map((a) => a.id)).toEqual(["b", "a"]);
  });

  it("returns undefined when nothing is upcoming", () => {
    expect(
      pickNextAppointment([{ scheduledAt: at(3), status: "completed" }], now),
    ).toBeUndefined();
  });
});

describe("messageDeliveryInfo", () => {
  it("never calls an unsent message sent", () => {
    const info = messageDeliveryInfo({
      fromPatient: true,
      read: true,
      local: true,
    });
    expect(info.label).toBe("Not sent");
    expect(info.tone).toBe("warning");
  });

  it("only says seen when the clinic marked it read", () => {
    expect(messageDeliveryInfo({ fromPatient: true, read: false }).label).toBe(
      "Sent, not opened yet",
    );
    expect(messageDeliveryInfo({ fromPatient: true, read: true }).label).toBe(
      "Seen by the clinic team",
    );
  });

  it("marks unread clinic messages as new", () => {
    expect(messageDeliveryInfo({ fromPatient: false, read: false }).label).toBe(
      "New",
    );
  });
});

describe("vitalStatusTone", () => {
  it("maps the existing flags to badge tones", () => {
    expect(vitalStatusTone("normal")).toBe("success");
    expect(vitalStatusTone("monitor")).toBe("warning");
    expect(vitalStatusTone("attention")).toBe("danger");
  });
});

describe("appendUnique", () => {
  it("appends new items and skips duplicates", () => {
    const out = appendUnique(
      [{ id: "1" }, { id: "2" }],
      [{ id: "2" }, { id: "3" }],
      (x) => x.id,
    );
    expect(out.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
});
