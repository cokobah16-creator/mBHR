import { describe, it, expect } from "vitest";
import type { Appointment } from "@/services/appointments";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_META,
  StaffFacingError,
  addDays,
  availableActions,
  canManageAppointments,
  dayHeading,
  describeActionError,
  filterAppointments,
  groupByDay,
  hasActiveFilters,
  isCalendarView,
  isModeFilter,
  isStatusFilter,
  notesWithCancellation,
  parseDateInput,
  rangeForView,
  reminderInfo,
  startOfWeek,
  statusMeta,
  timeRangeLabel,
  toDateInputValue,
  toDateTimeInputValue,
} from "./appointmentModel";

function appt(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "a1",
    patientId: "p1",
    appointmentType: "Follow-up",
    scheduledAt: new Date(2026, 8, 23, 9, 0),
    durationMinutes: 30,
    status: "scheduled",
    createdBy: "u1",
    ...overrides,
  };
}

describe("status labels", () => {
  it("has a label and tone for every stored status", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(APPOINTMENT_STATUS_META[status].label).toBeTruthy();
    }
    expect(APPOINTMENT_STATUS_META.arrived.label).toBe("Checked in");
    expect(APPOINTMENT_STATUS_META["no-show"].tone).toBe("warning");
  });

  it("falls back to the raw value for an unknown status", () => {
    expect(statusMeta("weird")).toEqual({ label: "weird", tone: "neutral" });
  });
});

describe("canManageAppointments", () => {
  it("allows front-desk and clinical roles", () => {
    for (const role of ["volunteer", "nurse", "doctor", "admin"] as const) {
      expect(canManageAppointments(role)).toBe(true);
    }
  });

  it("keeps other roles read-only", () => {
    for (const role of ["pharmacist", "guest", "auditor"] as const) {
      expect(canManageAppointments(role)).toBe(false);
    }
    expect(canManageAppointments(undefined)).toBe(false);
    expect(canManageAppointments(null)).toBe(false);
  });
});

describe("availableActions", () => {
  it("offers confirm, edit and cancel for a future scheduled appointment", () => {
    expect(availableActions("scheduled", false)).toEqual([
      "confirm",
      "edit",
      "cancel",
    ]);
  });

  it("offers no-show only once the start time has passed", () => {
    expect(availableActions("confirmed", false)).not.toContain("no-show");
    expect(availableActions("confirmed", true)).toContain("no-show");
  });

  it("never checks in a televisit: a confirmed one goes straight to start", () => {
    expect(availableActions("confirmed", false, { televisit: true })).toEqual([
      "start",
      "edit",
      "cancel",
    ]);
    expect(
      availableActions("confirmed", true, { televisit: true }),
    ).not.toContain("check-in");
    expect(availableActions("confirmed", false)).toContain("check-in");
  });

  it("moves checked-in to start and in-progress to complete", () => {
    expect(availableActions("arrived", true)).toEqual(["start"]);
    expect(availableActions("in-progress", true)).toEqual(["complete"]);
  });

  it("offers nothing for finished appointments", () => {
    expect(availableActions("completed", true)).toEqual([]);
    expect(availableActions("cancelled", false)).toEqual([]);
    expect(availableActions("no-show", true)).toEqual([]);
  });
});

describe("reminderInfo", () => {
  it("never calls a recorded reminder sent", () => {
    const info = reminderInfo({
      reminderSent: true,
      reminderSentAt: new Date(2026, 8, 22, 14, 5),
    });
    expect(info.state).toBe("queued");
    expect(info.label).toBe("Reminder queued 22/09/2026 14:05");
    expect(info.label.toLowerCase()).not.toContain("sent");
    expect(info.detail).toMatch(/not tracked/);
  });

  it("reports a stored false as not sent", () => {
    expect(reminderInfo({ reminderSent: false }).label).toBe(
      "Reminder not sent",
    );
  });

  it("reports missing data as not recorded", () => {
    expect(reminderInfo({}).state).toBe("unknown");
  });
});

describe("dates", () => {
  it("starts weeks on Monday", () => {
    // Wednesday 23 September 2026
    const monday = startOfWeek(new Date(2026, 8, 23, 15, 0));
    expect(toDateInputValue(monday)).toBe("2026-09-21");
    // Sunday belongs to the week that started the previous Monday.
    expect(toDateInputValue(startOfWeek(new Date(2026, 8, 27)))).toBe(
      "2026-09-21",
    );
  });

  it("covers one day or seven days, end exclusive", () => {
    const anchor = new Date(2026, 8, 23, 15, 0);
    const day = rangeForView("day", anchor);
    expect(toDateInputValue(day.from)).toBe("2026-09-23");
    expect(day.to.getTime() - day.from.getTime()).toBe(24 * 3600 * 1000);
    const week = rangeForView("week", anchor);
    expect(toDateInputValue(week.from)).toBe("2026-09-21");
    expect(toDateInputValue(week.to)).toBe("2026-09-28");
  });

  it("parses date input values as local days", () => {
    const parsed = parseDateInput("2026-09-23");
    expect(parsed?.getDate()).toBe(23);
    expect(parsed?.getHours()).toBe(0);
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("23/09/2026")).toBeNull();
  });

  it("formats datetime-local values and time ranges", () => {
    const a = appt({ scheduledAt: new Date(2026, 8, 23, 9, 5) });
    expect(toDateTimeInputValue(a.scheduledAt)).toBe("2026-09-23T09:05");
    expect(timeRangeLabel(a)).toBe("09:05–09:35");
  });

  it("labels today and tomorrow", () => {
    const today = new Date(2026, 8, 23, 8, 0);
    expect(dayHeading(new Date(2026, 8, 23), today)).toMatch(/^Today · /);
    expect(dayHeading(addDays(today, 1), today)).toMatch(/^Tomorrow · /);
    expect(dayHeading(addDays(today, 5), today)).not.toMatch(/Today|Tomorrow/);
  });

  it("narrows view and filter values", () => {
    expect(isCalendarView("week")).toBe(true);
    expect(isCalendarView("month")).toBe(false);
    expect(isStatusFilter("no-show")).toBe(true);
    expect(isStatusFilter("open")).toBe(true);
    expect(isStatusFilter("requested")).toBe(false);
    expect(isModeFilter("televisit")).toBe(true);
    expect(isModeFilter("phone")).toBe(false);
  });
});

describe("groupByDay", () => {
  it("groups by local day in time order", () => {
    const groups = groupByDay([
      appt({ id: "c", scheduledAt: new Date(2026, 8, 24, 8, 0) }),
      appt({ id: "b", scheduledAt: new Date(2026, 8, 23, 14, 0) }),
      appt({ id: "a", scheduledAt: new Date(2026, 8, 23, 9, 0) }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-23", "2026-09-24"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("filterAppointments", () => {
  const rows = [
    appt({ id: "1", patientId: "p1", status: "scheduled" }),
    appt({
      id: "2",
      patientId: "p2",
      status: "completed",
      appointmentType: "Televisit",
      visitMode: "televisit",
    }),
    appt({ id: "3", patientId: "p3", status: "cancelled", reason: "Wound" }),
  ];
  const names: Record<string, string> = {
    p1: "Ada Obi",
    p2: "Musa Bello",
    p3: "Ngozi Eze",
  };
  const options = {
    isTelevisit: (a: Appointment) => a.visitMode === "televisit",
    nameOf: (id: string) => names[id] ?? id,
  };

  it("returns everything with default filters", () => {
    expect(
      filterAppointments(
        rows,
        { status: "all", mode: "all", query: "" },
        options,
      ),
    ).toHaveLength(3);
  });

  it("filters open statuses", () => {
    const out = filterAppointments(
      rows,
      { status: "open", mode: "all", query: "" },
      options,
    );
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });

  it("filters by visit type", () => {
    const video = filterAppointments(
      rows,
      { status: "all", mode: "televisit", query: "" },
      options,
    );
    expect(video.map((r) => r.id)).toEqual(["2"]);
    const inPerson = filterAppointments(
      rows,
      { status: "all", mode: "in_person", query: "" },
      options,
    );
    expect(inPerson.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("searches patient name, type and reason", () => {
    const byName = filterAppointments(
      rows,
      { status: "all", mode: "all", query: "musa" },
      options,
    );
    expect(byName.map((r) => r.id)).toEqual(["2"]);
    const byReason = filterAppointments(
      rows,
      { status: "all", mode: "all", query: "wound" },
      options,
    );
    expect(byReason.map((r) => r.id)).toEqual(["3"]);
  });

  it("reports whether any filter is active", () => {
    expect(hasActiveFilters({ status: "all", mode: "all", query: " " })).toBe(
      false,
    );
    expect(hasActiveFilters({ status: "open", mode: "all", query: "" })).toBe(
      true,
    );
  });
});

describe("notesWithCancellation", () => {
  it("keeps existing notes and appends the reason", () => {
    expect(notesWithCancellation("Bring card", " Travelled ")).toBe(
      "Bring card\nCancelled: Travelled",
    );
  });

  it("returns undefined when no reason is given", () => {
    expect(notesWithCancellation("Bring card", "  ")).toBeUndefined();
  });

  it("works without existing notes", () => {
    expect(notesWithCancellation(undefined, "Rebooked")).toBe(
      "Cancelled: Rebooked",
    );
  });
});

describe("describeActionError", () => {
  const fallback = "Not saved. Try again.";

  it("shows staff-facing errors as written", () => {
    expect(
      describeActionError(new StaffFacingError("Offline."), fallback),
    ).toBe("Offline.");
  });

  it("passes through known service messages with a full stop", () => {
    expect(
      describeActionError(
        new Error("The provider already has an appointment in that time slot"),
        fallback,
      ),
    ).toBe("The provider already has an appointment in that time slot.");
  });

  it("hides raw database errors", () => {
    expect(
      describeActionError(
        new Error(
          'insert violates foreign key constraint "appointments_patient_id_fkey"',
        ),
        fallback,
      ),
    ).toBe(fallback);
    expect(describeActionError({ code: "42501" }, fallback)).toBe(fallback);
  });

  it("explains network failures", () => {
    expect(
      describeActionError(new TypeError("Failed to fetch"), fallback),
    ).toMatch(/internet connection/);
  });
});
