import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAdd, mockUpdate, mockDelete, mockWhere } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    patientPreferences: {
      add: mockAdd,
      update: mockUpdate,
      delete: mockDelete,
      where: mockWhere,
    },
  },
  generateId: vi.fn().mockReturnValue("pref-123"),
}));

import {
  createOrUpdatePreference,
  updatePreference,
  getPatientPreference,
  deletePreference,
  getPreferredLanguage,
  getCommunicationChannel,
  shouldSendAppointmentReminders,
  shouldSendMedicationReminders,
  hasPreferences,
  getPreferenceSummary,
  toggleAppointmentReminders,
  toggleMedicationReminders,
} from "./preferences";

function makeChain(firstItem: unknown, count = 0) {
  return {
    equals: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(firstItem),
      count: vi.fn().mockResolvedValue(count),
    }),
  };
}

const EXISTING_PREF = {
  id: "pref-existing",
  patientId: "p1",
  preferredLanguage: "Hausa",
  communicationChannel: "sms" as const,
  appointmentReminders: 1 as const,
  medicationReminders: 0 as const,
};

describe("preferences service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createOrUpdatePreference ─────────────────────────────────────────────────

  describe("createOrUpdatePreference", () => {
    it("creates a new preference when none exists", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));
      mockAdd.mockResolvedValue(undefined);

      const id = await createOrUpdatePreference({
        patientId: "p1",
        preferredLanguage: "Yoruba",
      });

      expect(id).toBe("pref-123");
      expect(mockAdd).toHaveBeenCalledOnce();
      const arg = mockAdd.mock.calls[0][0];
      expect(arg).toMatchObject({
        id: "pref-123",
        patientId: "p1",
        preferredLanguage: "Yoruba",
        appointmentReminders: 1,
        medicationReminders: 1,
        _dirty: 1,
      });
    });

    it("updates existing preference and returns its id", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF, 1));
      mockUpdate.mockResolvedValue(undefined);

      const id = await createOrUpdatePreference({
        patientId: "p1",
        preferredLanguage: "English",
      });

      expect(id).toBe("pref-existing");
      expect(mockUpdate).toHaveBeenCalledWith(
        "pref-existing",
        expect.objectContaining({ preferredLanguage: "English", _dirty: 1 }),
      );
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it("defaults reminders to 1 (on) when not specified", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));
      mockAdd.mockResolvedValue(undefined);

      await createOrUpdatePreference({ patientId: "p2" });

      const arg = mockAdd.mock.calls[0][0];
      expect(arg.appointmentReminders).toBe(1);
      expect(arg.medicationReminders).toBe(1);
    });
  });

  // ── updatePreference ─────────────────────────────────────────────────────────

  describe("updatePreference", () => {
    it("updates existing preference fields", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF, 1));
      mockUpdate.mockResolvedValue(undefined);

      await updatePreference("p1", { communicationChannel: "whatsapp" });

      expect(mockUpdate).toHaveBeenCalledWith(
        "pref-existing",
        expect.objectContaining({
          communicationChannel: "whatsapp",
          _dirty: 1,
        }),
      );
    });

    it("throws when preference not found", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));

      await expect(
        updatePreference("p-missing", { preferredLanguage: "Igbo" }),
      ).rejects.toThrow("Patient preferences not found");
    });
  });

  // ── getPatientPreference ─────────────────────────────────────────────────────

  describe("getPatientPreference", () => {
    it("returns existing preference", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF, 1));

      const result = await getPatientPreference("p1");

      expect(result).toEqual(EXISTING_PREF);
    });

    it("returns undefined when no preference", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));

      const result = await getPatientPreference("p-none");

      expect(result).toBeUndefined();
    });
  });

  // ── deletePreference ─────────────────────────────────────────────────────────

  describe("deletePreference", () => {
    it("deletes existing preference by id", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF, 1));
      mockDelete.mockResolvedValue(undefined);

      await deletePreference("p1");

      expect(mockDelete).toHaveBeenCalledWith("pref-existing");
    });

    it("does nothing when preference does not exist", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));

      await deletePreference("p-none");

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  // ── getPreferredLanguage ─────────────────────────────────────────────────────

  describe("getPreferredLanguage", () => {
    it("returns language string when set", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF));

      expect(await getPreferredLanguage("p1")).toBe("Hausa");
    });

    it("returns null when no preference exists", async () => {
      mockWhere.mockReturnValue(makeChain(undefined));

      expect(await getPreferredLanguage("p-none")).toBeNull();
    });
  });

  // ── getCommunicationChannel ──────────────────────────────────────────────────

  describe("getCommunicationChannel", () => {
    it("returns channel when set", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF));

      expect(await getCommunicationChannel("p1")).toBe("sms");
    });

    it("returns null when preference missing", async () => {
      mockWhere.mockReturnValue(makeChain(undefined));

      expect(await getCommunicationChannel("p-none")).toBeNull();
    });
  });

  // ── reminder flags ───────────────────────────────────────────────────────────

  describe("shouldSendAppointmentReminders", () => {
    it("returns true when appointmentReminders=1", async () => {
      mockWhere.mockReturnValue(
        makeChain({ ...EXISTING_PREF, appointmentReminders: 1 }),
      );
      expect(await shouldSendAppointmentReminders("p1")).toBe(true);
    });

    it("returns false when appointmentReminders=0", async () => {
      mockWhere.mockReturnValue(
        makeChain({ ...EXISTING_PREF, appointmentReminders: 0 }),
      );
      expect(await shouldSendAppointmentReminders("p1")).toBe(false);
    });

    it("returns false when no preference", async () => {
      mockWhere.mockReturnValue(makeChain(undefined));
      expect(await shouldSendAppointmentReminders("p-none")).toBe(false);
    });
  });

  describe("shouldSendMedicationReminders", () => {
    it("returns false when medicationReminders=0", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF));
      expect(await shouldSendMedicationReminders("p1")).toBe(false);
    });

    it("returns true when medicationReminders=1", async () => {
      mockWhere.mockReturnValue(
        makeChain({ ...EXISTING_PREF, medicationReminders: 1 }),
      );
      expect(await shouldSendMedicationReminders("p1")).toBe(true);
    });
  });

  // ── hasPreferences ───────────────────────────────────────────────────────────

  describe("hasPreferences", () => {
    it("returns true when count > 0", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF, 1));
      expect(await hasPreferences("p1")).toBe(true);
    });

    it("returns false when count === 0", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));
      expect(await hasPreferences("p-none")).toBe(false);
    });
  });

  // ── getPreferenceSummary ─────────────────────────────────────────────────────

  describe("getPreferenceSummary", () => {
    it("returns full summary when preference exists", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF));

      const summary = await getPreferenceSummary("p1");

      expect(summary.hasPreferences).toBe(true);
      expect(summary.language).toBe("Hausa");
      expect(summary.channel).toBe("sms");
      expect(summary.reminders.appointments).toBe(true);
      expect(summary.reminders.medications).toBe(false);
    });

    it("returns default summary when no preference", async () => {
      mockWhere.mockReturnValue(makeChain(undefined));

      const summary = await getPreferenceSummary("p-none");

      expect(summary.hasPreferences).toBe(false);
      expect(summary.language).toBeNull();
      expect(summary.channel).toBeNull();
      expect(summary.reminders.appointments).toBe(true);
      expect(summary.reminders.medications).toBe(true);
    });
  });

  // ── toggleAppointmentReminders ───────────────────────────────────────────────

  describe("toggleAppointmentReminders", () => {
    it("flips 1 → 0", async () => {
      mockWhere.mockReturnValue(
        makeChain({ ...EXISTING_PREF, appointmentReminders: 1 }),
      );
      mockUpdate.mockResolvedValue(undefined);

      await toggleAppointmentReminders("p1");

      expect(mockUpdate).toHaveBeenCalledWith(
        "pref-existing",
        expect.objectContaining({ appointmentReminders: 0, _dirty: 1 }),
      );
    });

    it("flips 0 → 1", async () => {
      mockWhere.mockReturnValue(
        makeChain({ ...EXISTING_PREF, appointmentReminders: 0 }),
      );
      mockUpdate.mockResolvedValue(undefined);

      await toggleAppointmentReminders("p1");

      expect(mockUpdate).toHaveBeenCalledWith(
        "pref-existing",
        expect.objectContaining({ appointmentReminders: 1 }),
      );
    });

    it("creates preference with appointmentReminders=0 when none exists", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));
      mockAdd.mockResolvedValue(undefined);

      await toggleAppointmentReminders("p-new");

      expect(mockAdd).toHaveBeenCalledOnce();
      expect(mockAdd.mock.calls[0][0].appointmentReminders).toBe(0);
    });
  });

  // ── toggleMedicationReminders ────────────────────────────────────────────────

  describe("toggleMedicationReminders", () => {
    it("flips 0 → 1 (EXISTING_PREF has medicationReminders=0)", async () => {
      mockWhere.mockReturnValue(makeChain(EXISTING_PREF));
      mockUpdate.mockResolvedValue(undefined);

      await toggleMedicationReminders("p1");

      expect(mockUpdate).toHaveBeenCalledWith(
        "pref-existing",
        expect.objectContaining({ medicationReminders: 1 }),
      );
    });

    it("creates preference with medicationReminders=0 when none exists", async () => {
      mockWhere.mockReturnValue(makeChain(undefined, 0));
      mockAdd.mockResolvedValue(undefined);

      await toggleMedicationReminders("p-new");

      expect(mockAdd).toHaveBeenCalledOnce();
      expect(mockAdd.mock.calls[0][0].medicationReminders).toBe(0);
    });
  });
});
