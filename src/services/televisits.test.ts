import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import {
  TELEVISIT_APPOINTMENT_TYPE,
  TELEVISIT_DEFAULT_DURATION_MIN,
  canJoinTelevisit,
  cancelTelevisit,
  cancelTelevisitRequest,
  declineTelevisitRequest,
  generateMeetingLink,
  getPatientContact,
  getPatientTelevisitRequests,
  getPatientTelevisits,
  getPendingTelevisitRequests,
  getUpcomingTelevisits,
  isTelevisitServiceAvailable,
  loadPatientNames,
  notifyPatientTelevisitScheduled,
  preferredSlotToTime,
  requestTelevisit,
  scheduleTelevisit,
  televisitJoinOpensAt,
  updateTelevisitStatus,
  type PatientContact,
  type Televisit,
} from "./televisits";

const h = vi.hoisted(() => {
  const results: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const methods = [
    "insert",
    "update",
    "select",
    "eq",
    "in",
    "gte",
    "lte",
    "order",
    "or",
    "limit",
    "single",
    "maybeSingle",
  ];

  function makeBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {};
    for (const method of methods) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const queue = results[table];
      const next =
        queue && queue.length > 0 ? queue.shift() : { data: null, error: null };
      return Promise.resolve(next).then(resolve, reject);
    };
    return builder;
  }

  // from() must not return a thenable itself (the spy would try to settle it),
  // so the root object hands off to the awaitable builder on the first call.
  function makeRoot(table: string): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    const builder = makeBuilder(table);
    for (const method of methods) {
      root[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    return root;
  }

  const from = vi.fn((table: string) => makeRoot(table));
  const patientGet = vi.fn();

  return { results, calls, from, patientGet };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: h.from },
}));

vi.mock("@/config/env", () => ({
  env: {
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_ANON_KEY: "anon-key",
    VITE_TELEVISIT_BASE_URL: "https://meet.jit.si/",
  },
}));

vi.mock("@/db", () => ({
  db: { patients: { get: h.patientGet } },
}));

function callsFor(table: string, method: string) {
  return h.calls.filter((c) => c.table === table && c.method === method);
}

const SCHEDULED_AT = new Date("2026-09-10T10:00:00Z");
const minutesFromStart = (n: number) =>
  new Date(SCHEDULED_AT.getTime() + n * 60000);

const baseVisit = {
  scheduledAt: SCHEDULED_AT,
  durationMinutes: 20,
  status: "scheduled" as const,
};

describe("televisits service", () => {
  beforeEach(() => {
    h.calls.length = 0;
    for (const key of Object.keys(h.results)) delete h.results[key];
    h.from.mockClear();
    h.patientGet.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("generateMeetingLink", () => {
    it("builds a room under the base URL without a trailing slash", () => {
      const link = generateMeetingLink();
      expect(link.startsWith("https://meet.jit.si/mbhr-")).toBe(true);
      expect(link).toMatch(/^https:\/\/meet\.jit\.si\/mbhr-[0-9a-f-]{36}$/);
    });

    it("generates a different room each time", () => {
      expect(generateMeetingLink()).not.toBe(generateMeetingLink());
    });
  });

  describe("canJoinTelevisit", () => {
    it("is closed 11 minutes before the start", () => {
      expect(canJoinTelevisit(baseVisit, minutesFromStart(-11))).toBe(false);
    });

    it("opens 10 minutes before the start", () => {
      expect(canJoinTelevisit(baseVisit, minutesFromStart(-10))).toBe(true);
    });

    it("is open during the visit", () => {
      expect(canJoinTelevisit(baseVisit, minutesFromStart(5))).toBe(true);
    });

    it("stays open 29 minutes after the scheduled end", () => {
      expect(canJoinTelevisit(baseVisit, minutesFromStart(20 + 29))).toBe(true);
    });

    it("closes 31 minutes after the scheduled end", () => {
      expect(canJoinTelevisit(baseVisit, minutesFromStart(20 + 31))).toBe(
        false,
      );
    });

    it("is closed for cancelled or completed visits", () => {
      expect(
        canJoinTelevisit(
          { ...baseVisit, status: "cancelled" },
          minutesFromStart(5),
        ),
      ).toBe(false);
      expect(
        canJoinTelevisit(
          { ...baseVisit, status: "completed" },
          minutesFromStart(5),
        ),
      ).toBe(false);
    });
  });

  describe("televisitJoinOpensAt", () => {
    it("is 10 minutes before the scheduled time", () => {
      expect(televisitJoinOpensAt(baseVisit).getTime()).toBe(
        minutesFromStart(-10).getTime(),
      );
    });
  });

  describe("preferredSlotToTime", () => {
    it("maps named slots to clock times", () => {
      expect(preferredSlotToTime("morning")).toBe("09:00");
      expect(preferredSlotToTime("afternoon")).toBe("13:00");
      expect(preferredSlotToTime("evening")).toBe("17:00");
    });

    it("defaults to the morning slot", () => {
      expect(preferredSlotToTime(undefined)).toBe("09:00");
      expect(preferredSlotToTime("whenever")).toBe("09:00");
    });
  });

  describe("isTelevisitServiceAvailable", () => {
    it("is available when supabase is configured", () => {
      expect(isTelevisitServiceAvailable()).toBe(true);
    });
  });

  describe("requestTelevisit", () => {
    it("inserts a televisit request and returns its id", async () => {
      h.results.patient_appointment_requests = [
        { data: { id: "req-1" }, error: null },
      ];

      const id = await requestTelevisit({
        patientId: "p1",
        reason: "Cough for 3 days",
        preferredDate: "2026-09-12",
        preferredTime: "morning",
      });

      expect(id).toBe("req-1");
      expect(h.from).toHaveBeenCalledWith("patient_appointment_requests");
      const insert = callsFor("patient_appointment_requests", "insert")[0];
      expect(insert.args[0]).toMatchObject({
        patient_id: "p1",
        appointment_type: TELEVISIT_APPOINTMENT_TYPE,
        visit_mode: "televisit",
        preferred_date_1: "2026-09-12",
        preferred_time_1: "morning",
        reason: "Cough for 3 days",
        notes: null,
        status: "pending",
      });
    });

    it("throws when the insert fails", async () => {
      h.results.patient_appointment_requests = [
        { data: null, error: new Error("insert failed") },
      ];

      await expect(
        requestTelevisit({
          patientId: "p1",
          reason: "x",
          preferredDate: "2026-09-12",
        }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("scheduleTelevisit", () => {
    const row = {
      id: "appt-1",
      patient_id: "p1",
      provider_id: "doc-1",
      scheduled_at: "2026-09-12T09:00:00.000Z",
      duration_minutes: 20,
      status: "scheduled",
      meeting_link: "https://meet.jit.si/mbhr-room",
      created_by: "doc-1",
      created_at: "2026-09-10T08:00:00.000Z",
    };

    it("inserts a televisit appointment with a meeting link", async () => {
      h.results.appointments = [{ data: row, error: null }];

      const visit = await scheduleTelevisit({
        patientId: "p1",
        providerId: "doc-1",
        scheduledAt: new Date("2026-09-12T09:00:00Z"),
        createdBy: "doc-1",
      });

      expect(h.from).toHaveBeenCalledWith("appointments");
      const insert = callsFor("appointments", "insert")[0];
      const payload = insert.args[0] as Record<string, unknown>;
      expect(payload.visit_mode).toBe("televisit");
      expect(payload.appointment_type).toBe(TELEVISIT_APPOINTMENT_TYPE);
      expect(payload.status).toBe("scheduled");
      expect(payload.duration_minutes).toBe(TELEVISIT_DEFAULT_DURATION_MIN);
      expect(String(payload.meeting_link)).toMatch(
        /^https:\/\/meet\.jit\.si\/mbhr-/,
      );

      expect(visit.id).toBe("appt-1");
      expect(visit.meetingLink).toBe(row.meeting_link);
      expect(visit.scheduledAt.toISOString()).toBe(row.scheduled_at);
      expect(callsFor("patient_appointment_requests", "update")).toHaveLength(
        0,
      );
    });

    it("marks the originating request as scheduled", async () => {
      h.results.appointments = [{ data: row, error: null }];
      h.results.patient_appointment_requests = [{ data: null, error: null }];

      await scheduleTelevisit({
        patientId: "p1",
        providerId: "doc-1",
        scheduledAt: new Date("2026-09-12T09:00:00Z"),
        createdBy: "doc-1",
        requestId: "req-1",
      });

      const update = callsFor("patient_appointment_requests", "update")[0];
      expect(update.args[0]).toMatchObject({
        status: "scheduled",
        scheduled_appointment_id: "appt-1",
        reviewed_by: "doc-1",
      });
      const eq = callsFor("patient_appointment_requests", "eq")[0];
      expect(eq.args).toEqual(["id", "req-1"]);
    });

    it("still returns the visit when the request update fails", async () => {
      h.results.appointments = [{ data: row, error: null }];
      h.results.patient_appointment_requests = [
        { data: null, error: new Error("request update failed") },
      ];

      const visit = await scheduleTelevisit({
        patientId: "p1",
        providerId: "doc-1",
        scheduledAt: new Date("2026-09-12T09:00:00Z"),
        createdBy: "doc-1",
        requestId: "req-1",
      });

      expect(visit.id).toBe("appt-1");
      expect(callsFor("patient_appointment_requests", "update")).toHaveLength(
        1,
      );
    });

    it("throws when the appointment insert fails", async () => {
      h.results.appointments = [
        { data: null, error: new Error("insert failed") },
      ];

      await expect(
        scheduleTelevisit({
          patientId: "p1",
          providerId: "doc-1",
          scheduledAt: new Date("2026-09-12T09:00:00Z"),
          createdBy: "doc-1",
          requestId: "req-1",
        }),
      ).rejects.toThrow("insert failed");
      expect(callsFor("patient_appointment_requests", "update")).toHaveLength(
        0,
      );
    });
  });

  describe("declineTelevisitRequest", () => {
    it("updates the request with a declined status", async () => {
      await declineTelevisitRequest("req-1", "doc-1", "No slots this week");

      const update = callsFor("patient_appointment_requests", "update")[0];
      expect(update.args[0]).toMatchObject({
        status: "declined",
        reviewed_by: "doc-1",
        review_notes: "No slots this week",
      });
      const eq = callsFor("patient_appointment_requests", "eq")[0];
      expect(eq.args).toEqual(["id", "req-1"]);
    });
  });

  describe("getPendingTelevisitRequests", () => {
    it("maps rows to TelevisitRequest", async () => {
      h.results.patient_appointment_requests = [
        {
          data: [
            {
              id: "req-1",
              patient_id: "p1",
              preferred_date_1: "2026-09-12",
              preferred_time_1: "afternoon",
              reason: "Follow-up",
              notes: null,
              status: "pending",
              reviewed_by: null,
              reviewed_at: null,
              review_notes: null,
              scheduled_appointment_id: null,
              created_at: "2026-09-10T08:00:00.000Z",
            },
          ],
          error: null,
        },
      ];

      const requests = await getPendingTelevisitRequests();

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        id: "req-1",
        patientId: "p1",
        preferredDate: "2026-09-12",
        preferredTime: "afternoon",
        reason: "Follow-up",
        status: "pending",
      });
      expect(requests[0].notes).toBeUndefined();
      expect(requests[0].reviewedAt).toBeUndefined();
      expect(requests[0].createdAt.toISOString()).toBe(
        "2026-09-10T08:00:00.000Z",
      );

      const eqArgs = callsFor("patient_appointment_requests", "eq").map(
        (c) => c.args,
      );
      expect(eqArgs).toContainEqual(["visit_mode", "televisit"]);
      expect(eqArgs).toContainEqual(["status", "pending"]);
    });
  });

  describe("getPatientTelevisitRequests", () => {
    it("lists the patient's televisit requests newest first", async () => {
      h.results.patient_appointment_requests = [
        {
          data: [
            {
              id: "req-2",
              patient_id: "p1",
              preferred_date_1: "2026-09-14",
              preferred_time_1: null,
              reason: "Rash",
              notes: null,
              status: "cancelled",
              reviewed_by: null,
              reviewed_at: null,
              review_notes: null,
              scheduled_appointment_id: null,
              created_at: "2026-09-11T08:00:00.000Z",
            },
            {
              id: "req-1",
              patient_id: "p1",
              preferred_date_1: "2026-09-12",
              preferred_time_1: "morning",
              reason: "Cough",
              notes: "Worse at night",
              status: "scheduled",
              reviewed_by: "doc-1",
              reviewed_at: "2026-09-10T09:00:00.000Z",
              review_notes: null,
              scheduled_appointment_id: "appt-1",
              created_at: "2026-09-10T08:00:00.000Z",
            },
          ],
          error: null,
        },
      ];

      const requests = await getPatientTelevisitRequests("p1");

      expect(requests.map((r) => r.id)).toEqual(["req-2", "req-1"]);
      expect(requests[1]).toMatchObject({
        patientId: "p1",
        preferredTime: "morning",
        notes: "Worse at night",
        status: "scheduled",
        reviewedBy: "doc-1",
        scheduledAppointmentId: "appt-1",
      });
      expect(requests[1].reviewedAt?.toISOString()).toBe(
        "2026-09-10T09:00:00.000Z",
      );
      expect(requests[0].preferredTime).toBeUndefined();

      const eqArgs = callsFor("patient_appointment_requests", "eq").map(
        (c) => c.args,
      );
      expect(eqArgs).toContainEqual(["patient_id", "p1"]);
      expect(eqArgs).toContainEqual(["visit_mode", "televisit"]);
      const order = callsFor("patient_appointment_requests", "order")[0];
      expect(order.args).toEqual(["created_at", { ascending: false }]);
    });

    it("throws when the query fails", async () => {
      h.results.patient_appointment_requests = [
        { data: null, error: new Error("select failed") },
      ];

      await expect(getPatientTelevisitRequests("p1")).rejects.toThrow(
        "select failed",
      );
    });
  });

  describe("cancelTelevisitRequest", () => {
    it("sets the request status to cancelled", async () => {
      h.results.patient_appointment_requests = [
        { data: [{ id: "req-1" }], error: null },
      ];

      await cancelTelevisitRequest("req-1");

      const update = callsFor("patient_appointment_requests", "update")[0];
      expect(update.args[0]).toEqual({ status: "cancelled" });
      const eq = callsFor("patient_appointment_requests", "eq")[0];
      expect(eq.args).toEqual(["id", "req-1"]);
      expect(callsFor("patient_appointment_requests", "select")).toHaveLength(
        1,
      );
    });

    it("rejects when no row was updated", async () => {
      h.results.patient_appointment_requests = [{ data: [], error: null }];

      await expect(cancelTelevisitRequest("req-1")).rejects.toThrow(
        "Request not found or cannot be cancelled",
      );
    });

    it("rejects when the update fails", async () => {
      h.results.patient_appointment_requests = [
        { data: null, error: new Error("update failed") },
      ];

      await expect(cancelTelevisitRequest("req-1")).rejects.toThrow(
        "update failed",
      );
    });
  });

  describe("getPatientTelevisits", () => {
    it("lists only the patient's televisits, latest first", async () => {
      h.results.appointments = [
        {
          data: [
            {
              id: "appt-1",
              patient_id: "p1",
              provider_id: "doc-1",
              scheduled_at: "2026-09-12T09:00:00.000Z",
              duration_minutes: null,
              status: "scheduled",
              reason: null,
              notes: null,
              meeting_link: "https://meet.jit.si/mbhr-room",
              created_by: "doc-1",
              created_at: null,
            },
          ],
          error: null,
        },
      ];

      const visits = await getPatientTelevisits("p1");

      expect(visits).toHaveLength(1);
      expect(visits[0]).toMatchObject({
        id: "appt-1",
        patientId: "p1",
        providerId: "doc-1",
        status: "scheduled",
        meetingLink: "https://meet.jit.si/mbhr-room",
        durationMinutes: TELEVISIT_DEFAULT_DURATION_MIN,
      });
      expect(visits[0].reason).toBeUndefined();
      expect(visits[0].createdAt).toBeUndefined();

      const eqArgs = callsFor("appointments", "eq").map((c) => c.args);
      expect(eqArgs).toContainEqual(["patient_id", "p1"]);
      expect(eqArgs).toContainEqual(["visit_mode", "televisit"]);
      const order = callsFor("appointments", "order")[0];
      expect(order.args).toEqual(["scheduled_at", { ascending: false }]);
    });
  });

  describe("updateTelevisitStatus", () => {
    it("updates the appointment status", async () => {
      await updateTelevisitStatus("appt-1", "in-progress");

      const update = callsFor("appointments", "update")[0];
      expect(update.args[0]).toEqual({ status: "in-progress" });
      const eq = callsFor("appointments", "eq")[0];
      expect(eq.args).toEqual(["id", "appt-1"]);
    });

    it("throws when the update fails", async () => {
      h.results.appointments = [
        { data: null, error: new Error("update failed") },
      ];

      await expect(
        updateTelevisitStatus("appt-1", "completed"),
      ).rejects.toThrow("update failed");
    });
  });

  describe("cancelTelevisit", () => {
    it("cancels without touching notes when no reason is given", async () => {
      await cancelTelevisit("appt-1");

      const update = callsFor("appointments", "update")[0];
      expect(update.args[0]).toEqual({ status: "cancelled" });
      const eq = callsFor("appointments", "eq")[0];
      expect(eq.args).toEqual(["id", "appt-1"]);
    });

    it("stores the reason in notes", async () => {
      await cancelTelevisit("appt-1", "Patient unavailable");

      const update = callsFor("appointments", "update")[0];
      expect(update.args[0]).toEqual({
        status: "cancelled",
        notes: "Patient unavailable",
      });
    });
  });

  describe("loadPatientNames", () => {
    it("maps snake_case patient rows to full names", async () => {
      h.results.patients = [
        {
          data: [
            { id: "p1", given_name: "Ada", family_name: "Obi" },
            { id: "p2", given_name: "Bola", family_name: null },
          ],
          error: null,
        },
      ];

      const names = await loadPatientNames(["p1", "p2", "p1"]);

      expect(names.get("p1")).toBe("Ada Obi");
      expect(names.get("p2")).toBe("Bola");
      const inCall = callsFor("patients", "in")[0];
      expect(inCall.args).toEqual(["id", ["p1", "p2"]]);
      expect(h.from).toHaveBeenCalledTimes(1);
    });

    it("falls back to camelCase columns when the snake_case query fails", async () => {
      h.results.patients = [
        { data: null, error: new Error("column given_name does not exist") },
        {
          data: [{ id: "p1", givenName: "Ada", familyName: "Obi" }],
          error: null,
        },
      ];

      const names = await loadPatientNames(["p1"]);

      expect(names.get("p1")).toBe("Ada Obi");
      const selects = callsFor("patients", "select").map((c) => c.args[0]);
      expect(selects).toEqual([
        "id,given_name,family_name",
        "id,givenName,familyName",
      ]);
    });

    it("returns an empty map for no ids without querying", async () => {
      await expect(loadPatientNames([])).resolves.toEqual(new Map());
      expect(h.from).not.toHaveBeenCalled();
    });
  });

  describe("getUpcomingTelevisits", () => {
    it("filters by provider only when one is given", async () => {
      h.results.appointments = [
        { data: [], error: null },
        { data: [], error: null },
      ];

      await getUpcomingTelevisits();
      expect(
        callsFor("appointments", "eq").some((c) => c.args[0] === "provider_id"),
      ).toBe(false);

      await getUpcomingTelevisits("doc-1");
      expect(callsFor("appointments", "eq").map((c) => c.args)).toContainEqual([
        "provider_id",
        "doc-1",
      ]);
      expect(callsFor("appointments", "eq").map((c) => c.args)).toContainEqual([
        "visit_mode",
        "televisit",
      ]);
    });
  });

  describe("getPatientContact", () => {
    it("prefers the local Dexie patient", async () => {
      h.patientGet.mockResolvedValue({
        id: "p1",
        givenName: "Ada",
        familyName: "Obi",
        phone: "+2348012345678",
      });

      const contact = await getPatientContact("p1");

      expect(contact).toEqual({
        id: "p1",
        fullName: "Ada Obi",
        phone: "+2348012345678",
        preferredLanguage: undefined,
      });
      expect(h.from).not.toHaveBeenCalled();
    });

    it("falls back to Supabase when not found locally", async () => {
      h.patientGet.mockResolvedValue(undefined);
      h.results.patients = [
        {
          data: {
            id: "p1",
            given_name: "Ada",
            family_name: "Obi",
            phone: null,
          },
          error: null,
        },
      ];

      const contact = await getPatientContact("p1");

      expect(contact?.fullName).toBe("Ada Obi");
      expect(contact?.phone).toBeUndefined();
      expect(h.from).toHaveBeenCalledWith("patients");
    });
  });

  describe("notifyPatientTelevisitScheduled", () => {
    const visit: Televisit = {
      id: "appt-1",
      patientId: "p1",
      scheduledAt: SCHEDULED_AT,
      durationMinutes: 20,
      status: "scheduled",
      meetingLink: "https://meet.jit.si/mbhr-room",
    };
    const patient: PatientContact = {
      id: "p1",
      fullName: "Ada Obi",
      phone: "+2348012345678",
    };

    it("does not send when the patient has no phone", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await notifyPatientTelevisitScheduled(
        visit,
        { ...patient, phone: null },
        "Dr. Bello",
      );

      expect(result).toEqual({
        sent: false,
        error: "Patient has no phone number",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts to the send-sms-reminder edge function", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await notifyPatientTelevisitScheduled(
        visit,
        patient,
        "Dr. Bello",
      );

      expect(result).toEqual({ sent: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://example.supabase.co/functions/v1/send-sms-reminder",
      );
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer anon-key",
        "Content-Type": "application/json",
      });
      const body = JSON.parse(String(init.body)) as {
        to: string;
        message: string;
      };
      expect(body.to).toBe("+2348012345678");
      expect(body.message).toContain("https://meet.jit.si/mbhr-room");
      expect(body.message).toContain("Dr. Bello");
    });

    it("returns sent:false when the request fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

      const result = await notifyPatientTelevisitScheduled(visit, patient);

      expect(result).toEqual({ sent: false, error: "boom" });
    });

    it("returns sent:false when the edge function reports failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ success: false, error: "Termii rejected" }),
        }),
      );

      const result = await notifyPatientTelevisitScheduled(visit, patient);

      expect(result).toEqual({ sent: false, error: "Termii rejected" });
    });
  });
});

describe("televisits service without Supabase", () => {
  let mod: typeof import("./televisits");

  beforeEach(async () => {
    h.calls.length = 0;
    h.from.mockClear();
    h.patientGet.mockReset();
    vi.resetModules();
    vi.doMock("@/lib/supabase", () => ({ supabase: null }));
    mod = await import("./televisits");
  });

  afterAll(() => {
    vi.doUnmock("@/lib/supabase");
    vi.resetModules();
  });

  it("reports the service as unavailable", () => {
    expect(mod.isTelevisitServiceAvailable()).toBe(false);
  });

  it("returns empty results from reads", async () => {
    await expect(mod.getPendingTelevisitRequests()).resolves.toEqual([]);
    await expect(mod.getPatientTelevisitRequests("p1")).resolves.toEqual([]);
    await expect(mod.getPatientTelevisits("p1")).resolves.toEqual([]);
    await expect(mod.getUpcomingTelevisits("doc-1")).resolves.toEqual([]);
    await expect(mod.loadPatientNames(["p1"])).resolves.toEqual(new Map());
    expect(h.from).not.toHaveBeenCalled();
  });

  it("returns null contact when the patient is not cached locally", async () => {
    h.patientGet.mockResolvedValue(undefined);

    await expect(mod.getPatientContact("p1")).resolves.toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("rejects writes with a clear error", async () => {
    await expect(
      mod.requestTelevisit({
        patientId: "p1",
        reason: "x",
        preferredDate: "2026-09-12",
      }),
    ).rejects.toThrow("Supabase is not configured");
    await expect(
      mod.scheduleTelevisit({
        patientId: "p1",
        providerId: "doc-1",
        scheduledAt: new Date("2026-09-12T09:00:00Z"),
        createdBy: "doc-1",
      }),
    ).rejects.toThrow("Supabase is not configured");
    await expect(mod.cancelTelevisitRequest("req-1")).rejects.toThrow(
      "Supabase is not configured",
    );
    await expect(mod.declineTelevisitRequest("req-1", "doc-1")).rejects.toThrow(
      "Supabase is not configured",
    );
    await expect(
      mod.updateTelevisitStatus("appt-1", "confirmed"),
    ).rejects.toThrow("Supabase is not configured");
    await expect(mod.cancelTelevisit("appt-1")).rejects.toThrow(
      "Supabase is not configured",
    );
    expect(h.from).not.toHaveBeenCalled();
  });
});
