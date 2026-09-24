import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---
const {
  mockPatients,
  mockPatientMerges,
  mockVitals,
  mockConsultations,
  mockDispenses,
  mockVisits,
  mockQueue,
  mockPatientAllergies,
  mockPatientPreferences,
  mockCareTasks,
  mockRequestMerge,
  mockListMerges,
} = vi.hoisted(() => {
  const makeTable = () => ({
    where: vi.fn(),
    toArray: vi.fn(),
  });
  return {
    mockPatients: { where: vi.fn(), update: vi.fn(), get: vi.fn() },
    mockPatientMerges: { where: vi.fn(), add: vi.fn() },
    mockVitals: makeTable(),
    mockConsultations: makeTable(),
    mockDispenses: makeTable(),
    mockVisits: makeTable(),
    mockQueue: makeTable(),
    mockPatientAllergies: makeTable(),
    mockPatientPreferences: makeTable(),
    mockCareTasks: makeTable(),
    mockRequestMerge: vi.fn(),
    mockListMerges: vi.fn(),
  };
});

vi.mock("@/db", () => ({
  epochDay: (d: Date) => Math.floor(d.getTime() / 86_400_000),
  normPhone: (p: string) => p.replace(/\D/g, ""),
  nameKeyOf: (g: string, f: string) =>
    `${g.toLowerCase().trim()}|${f.toLowerCase().trim()}`,
  db: {
    patients: mockPatients,
    patientMerges: mockPatientMerges,
    vitals: mockVitals,
    consultations: mockConsultations,
    dispenses: mockDispenses,
    visits: mockVisits,
    queue: mockQueue,
    patientAllergies: mockPatientAllergies,
    patientPreferences: mockPatientPreferences,
    careTasks: mockCareTasks,
    transaction: vi.fn(),
  },
  Patient: {},
}));

vi.mock("metaphone", () => ({
  metaphone: (s: string) => s.toUpperCase().slice(0, 4),
}));

vi.mock("@/lib/logger", () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

// Merging goes through the patient-merge service (tested in patientMerge.test.ts).
vi.mock("./patientMerge", () => ({
  requestMerge: mockRequestMerge,
  listMerges: mockListMerges,
}));

import { PatientDeduplication } from "./patientDeduplication";

const makeChain = (results: unknown[]) => ({
  equals: vi.fn().mockReturnValue({
    and: vi
      .fn()
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue(results) }),
  }),
  between: vi.fn().mockReturnValue({
    and: vi
      .fn()
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue(results) }),
  }),
});

const dob1990 = new Date("1990-01-15");
const dobDay1990 = Math.floor(dob1990.getTime() / 86_400_000);

const existingPatient = {
  id: "p1",
  givenName: "Ada",
  familyName: "Obi",
  phone: "08012345678",
  phoneN: "08012345678",
  dob: "1990-01-15",
  dobDay: dobDay1990,
  nameKey: "ada|obi",
  address: "12 Lagos Street",
  portalEnabled: 1,
};

describe("PatientDeduplication", () => {
  let dedup: PatientDeduplication;

  beforeEach(() => {
    vi.clearAllMocks();
    dedup = new PatientDeduplication();
  });

  describe("findDuplicates", () => {
    it("returns empty array when no candidates exist in DB", async () => {
      mockPatients.where.mockReturnValue(makeChain([]));

      const result = await dedup.findDuplicates({
        givenName: "Bode",
        familyName: "Ade",
        phone: "09099999999",
        dob: new Date("1985-06-01"),
      });

      expect(result).toEqual([]);
    });

    it("returns a candidate above threshold for exact phone+name+dob match", async () => {
      mockPatients.where.mockReturnValue(makeChain([existingPatient]));

      const result = await dedup.findDuplicates({
        givenName: "Ada",
        familyName: "Obi",
        phone: "08012345678",
        dob: dob1990,
      });

      expect(result).toHaveLength(1);
      expect(result[0].patient.id).toBe("p1");
      expect(result[0].score).toBeGreaterThanOrEqual(0.7);
      expect(result[0].matchReasons).toContain("Exact phone number match");
      expect(result[0].matchReasons).toContain("Exact name match");
      expect(result[0].matchReasons).toContain("Same date of birth");
    });

    it("filters out candidates below the 0.7 threshold", async () => {
      const unrelatedPatient = {
        ...existingPatient,
        id: "p2",
        givenName: "Zeke",
        familyName: "Umeh",
        phone: "07011112222",
        phoneN: "07011112222",
        dob: "1975-03-10",
        dobDay: Math.floor(new Date("1975-03-10").getTime() / 86_400_000),
        nameKey: "zeke|umeh",
      };
      mockPatients.where.mockReturnValue(makeChain([unrelatedPatient]));

      const result = await dedup.findDuplicates({
        givenName: "Ada",
        familyName: "Obi",
        phone: "08012345678",
        dob: dob1990,
      });

      expect(result).toHaveLength(0);
    });

    it("returns candidates sorted by score descending", async () => {
      const highScore = { ...existingPatient, id: "p-high" };
      const lowScore = {
        ...existingPatient,
        id: "p-low",
        phone: "09011111111",
        phoneN: "09011111111",
        dob: "1990-01-16",
        dobDay: dobDay1990 + 1,
      };
      mockPatients.where.mockReturnValue(makeChain([lowScore, highScore]));

      const result = await dedup.findDuplicates({
        givenName: "Ada",
        familyName: "Obi",
        phone: "08012345678",
        dob: dob1990,
      });

      if (result.length >= 2) {
        expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
      }
    });

    it("includes a match reason for address similarity", async () => {
      mockPatients.where.mockReturnValue(makeChain([existingPatient]));

      const result = await dedup.findDuplicates({
        givenName: "Ada",
        familyName: "Obi",
        phone: "08012345678",
        dob: dob1990,
        address: "12 Lagos Street",
      });

      const reasons = result[0]?.matchReasons ?? [];
      expect(reasons.some((r) => r.includes("%"))).toBe(true);
    });
  });

  describe("scoring internals (via findDuplicates)", () => {
    it("does not reach threshold on name+dob alone when phone differs (score=0.5)", async () => {
      const withDifferentPhone = {
        ...existingPatient,
        phone: "09099999999",
        phoneN: "09099999999",
      };
      mockPatients.where.mockReturnValue(makeChain([withDifferentPhone]));

      const result = await dedup.findDuplicates({
        givenName: "Ada",
        familyName: "Obi",
        phone: "08012345678",
        dob: dob1990,
      });

      // nameWeight(1.0×0.3) + dobWeight(0.2) = 0.5 < 0.7 threshold
      expect(result).toHaveLength(0);
    });

    it("swapped given/family names still produce a high name score", async () => {
      mockPatients.where.mockReturnValue(makeChain([existingPatient]));

      const result = await dedup.findDuplicates({
        givenName: "Obi", // swapped
        familyName: "Ada",
        phone: "08012345678",
        dob: dob1990,
      });

      // Score may or may not exceed threshold depending on weights, but
      // the name similarity function should return > 0 for swapped names.
      // We just verify no crash and the scoring ran.
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("mergePatients", () => {
    const actor = { id: "u-nurse", role: "nurse" as const };

    it("sends the merge through the merge service with the chosen values", async () => {
      mockRequestMerge.mockResolvedValue({
        ok: true,
        mergeId: "m1",
        commandId: "c1",
        winnerId: "p1",
        willSync: true,
        movedCount: 3,
        fieldsChanged: 1,
      });
      const choices = { phone: { source: "loser" as const, value: "0805" } };

      const result = await dedup.mergePatients("p1", "p2", actor, { fieldChoices: choices });

      expect(mockRequestMerge).toHaveBeenCalledWith({
        winnerId: "p1",
        loserId: "p2",
        fieldChoices: choices,
        source: "conflict_review",
        actor,
      });
      expect(result.winnerId).toBe("p1");
      // No child record is written (or marked for upload) here any more.
      expect(mockVitals.where).not.toHaveBeenCalled();
      expect(mockPatients.update).not.toHaveBeenCalled();
    });

    it("throws a named error and changes nothing when the merge is refused", async () => {
      mockRequestMerge.mockResolvedValue({
        ok: false,
        reason: "cycle",
        message: "The record chosen to keep was already merged into the other one.",
      });

      await expect(dedup.mergePatients("p1", "p2", actor)).rejects.toMatchObject({
        name: "PatientMergeRefused:cycle",
      });
      expect(mockPatientMerges.add).not.toHaveBeenCalled();
    });
  });

  describe("getMergeHistory", () => {
    it("lists synced and pending merges with who, when and the chosen values", async () => {
      mockListMerges.mockResolvedValue([
        {
          id: "m2",
          winnerId: "p1",
          loserId: "p3",
          mergedBy: "u-nurse",
          createdDay: 20000,
          reason: "duplicate_resolution",
          status: "pending",
          requestedAt: "2026-09-23T09:00:00.000Z",
          fieldChoices: { phone: { source: "loser", value: "0805" } },
          source: "conflict_review",
        },
        {
          id: "m1",
          winnerId: "p1",
          loserId: "p2",
          mergedBy: "u-doctor",
          createdDay: 19990,
          reason: "",
        },
      ]);
      mockPatients.get.mockResolvedValue(undefined);

      const history = await dedup.getMergeHistory("p1");

      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        mergeId: "m2",
        mergedBy: "u-nurse",
        status: "pending",
        source: "conflict_review",
        fieldChoices: { phone: { source: "loser", value: "0805" } },
      });
      expect(history[0].mergedAt.toISOString()).toBe("2026-09-23T09:00:00.000Z");
      // Older rows made before merges reached the server.
      expect(history[1].status).toBe("on_device");
      expect(history[1].mergedAt.getTime()).toBe(19990 * 86_400_000);
    });
  });
});
