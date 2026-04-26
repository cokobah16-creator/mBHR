import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAdd, mockUpdate, mockDelete, mockGet, mockWhere } = vi.hoisted(
  () => ({
    mockAdd: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockGet: vi.fn(),
    mockWhere: vi.fn(),
  }),
);

vi.mock("../db", () => ({
  db: {
    patientAllergies: {
      add: mockAdd,
      update: mockUpdate,
      delete: mockDelete,
      get: mockGet,
      where: mockWhere,
    },
  },
  generateId: vi.fn().mockReturnValue("allergy-123"),
}));

import {
  createAllergy,
  updateAllergy,
  deactivateAllergy,
  reactivateAllergy,
  deleteAllergy,
  getPatientAllergies,
  getActiveAllergies,
  getAllergyById,
  getMedicationAllergies,
  getSevereAllergies,
  checkMedicationAllergy,
  hasActiveAllergies,
  getAllergyStats,
} from "./allergies";

const BASE_INPUT = {
  patientId: "p1",
  allergen: "Penicillin",
  allergyType: "medication" as const,
  severity: "severe" as const,
  createdBy: "nurse1",
};

function makeChain(items: unknown[], count?: number) {
  const chain = {
    filter: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(items),
    count: vi.fn().mockResolvedValue(count ?? items.length),
    first: vi.fn().mockResolvedValue(items[0] ?? undefined),
  };
  chain.filter.mockReturnValue(chain);
  return chain;
}

describe("allergies service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createAllergy ────────────────────────────────────────────────────────────

  describe("createAllergy", () => {
    it("adds a new allergy and returns its id", async () => {
      mockAdd.mockResolvedValue(undefined);

      const id = await createAllergy(BASE_INPUT);

      expect(id).toBe("allergy-123");
      expect(mockAdd).toHaveBeenCalledOnce();
      const arg = mockAdd.mock.calls[0][0];
      expect(arg).toMatchObject({
        id: "allergy-123",
        patientId: "p1",
        allergen: "Penicillin",
        allergyType: "medication",
        severity: "severe",
        isActive: 1,
        _dirty: 1,
        createdBy: "nurse1",
      });
    });

    it("includes optional fields when provided", async () => {
      mockAdd.mockResolvedValue(undefined);

      await createAllergy({
        ...BASE_INPUT,
        reaction: "rash",
        notes: "confirmed",
      });

      const arg = mockAdd.mock.calls[0][0];
      expect(arg.reaction).toBe("rash");
      expect(arg.notes).toBe("confirmed");
    });
  });

  // ── updateAllergy ────────────────────────────────────────────────────────────

  describe("updateAllergy", () => {
    it("calls db.update with merged fields and _dirty=1", async () => {
      mockUpdate.mockResolvedValue(undefined);

      await updateAllergy("allergy-1", { severity: "mild" });

      expect(mockUpdate).toHaveBeenCalledWith(
        "allergy-1",
        expect.objectContaining({ severity: "mild", _dirty: 1 }),
      );
    });
  });

  // ── deactivateAllergy / reactivateAllergy ────────────────────────────────────

  describe("deactivateAllergy", () => {
    it("sets isActive=0 and _dirty=1", async () => {
      mockUpdate.mockResolvedValue(undefined);

      await deactivateAllergy("allergy-1");

      expect(mockUpdate).toHaveBeenCalledWith(
        "allergy-1",
        expect.objectContaining({ isActive: 0, _dirty: 1 }),
      );
    });
  });

  describe("reactivateAllergy", () => {
    it("sets isActive=1 and _dirty=1", async () => {
      mockUpdate.mockResolvedValue(undefined);

      await reactivateAllergy("allergy-1");

      expect(mockUpdate).toHaveBeenCalledWith(
        "allergy-1",
        expect.objectContaining({ isActive: 1, _dirty: 1 }),
      );
    });
  });

  // ── deleteAllergy ────────────────────────────────────────────────────────────

  describe("deleteAllergy", () => {
    it("calls db.delete with the allergyId", async () => {
      mockDelete.mockResolvedValue(undefined);

      await deleteAllergy("allergy-1");

      expect(mockDelete).toHaveBeenCalledWith("allergy-1");
    });
  });

  // ── getPatientAllergies ──────────────────────────────────────────────────────

  describe("getPatientAllergies", () => {
    it("returns active allergies by default", async () => {
      const active = [{ id: "a1", isActive: 1 }];
      const chain = makeChain(active);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await getPatientAllergies("p1");

      expect(result).toEqual(active);
      expect(chain.filter).toHaveBeenCalled();
    });

    it("returns all allergies when activeOnly=false", async () => {
      const all = [
        { id: "a1", isActive: 1 },
        { id: "a2", isActive: 0 },
      ];
      const chain = makeChain(all);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await getPatientAllergies("p1", false);

      expect(result).toEqual(all);
      expect(chain.filter).not.toHaveBeenCalled();
    });
  });

  // ── getAllergyById ───────────────────────────────────────────────────────────

  describe("getAllergyById", () => {
    it("returns the allergy record", async () => {
      const record = { id: "a1", allergen: "Penicillin" };
      mockGet.mockResolvedValue(record);

      const result = await getAllergyById("a1");

      expect(result).toEqual(record);
      expect(mockGet).toHaveBeenCalledWith("a1");
    });

    it("returns undefined for unknown id", async () => {
      mockGet.mockResolvedValue(undefined);
      const result = await getAllergyById("missing");
      expect(result).toBeUndefined();
    });
  });

  // ── getMedicationAllergies ───────────────────────────────────────────────────

  describe("getMedicationAllergies", () => {
    it("filters to medication type only", async () => {
      const medAllergies = [
        { id: "a1", allergyType: "medication", isActive: 1 },
      ];
      const chain = makeChain(medAllergies);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await getMedicationAllergies("p1");

      expect(result).toEqual(medAllergies);
      expect(chain.filter).toHaveBeenCalled();
    });
  });

  // ── getSevereAllergies ───────────────────────────────────────────────────────

  describe("getSevereAllergies", () => {
    it("returns severe and life-threatening active allergies", async () => {
      const severe = [{ id: "a1", severity: "severe", isActive: 1 }];
      const chain = makeChain(severe);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await getSevereAllergies("p1");

      expect(result).toEqual(severe);
    });
  });

  // ── checkMedicationAllergy ───────────────────────────────────────────────────

  describe("checkMedicationAllergy", () => {
    it("returns matching allergy when allergen substring matches", async () => {
      const penicillin = {
        id: "a1",
        allergen: "Penicillin",
        allergyType: "medication",
        isActive: 1,
      };
      const chain = makeChain([penicillin]);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await checkMedicationAllergy("p1", "penicillin");

      expect(result).toEqual(penicillin);
    });

    it("returns null when no match found", async () => {
      const chain = makeChain([
        {
          id: "a1",
          allergen: "Penicillin",
          allergyType: "medication",
          isActive: 1,
        },
      ]);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await checkMedicationAllergy("p1", "Aspirin");

      expect(result).toBeNull();
    });

    it("returns null when no medication allergies exist", async () => {
      const chain = makeChain([]);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await checkMedicationAllergy("p1", "Penicillin");

      expect(result).toBeNull();
    });
  });

  // ── hasActiveAllergies ───────────────────────────────────────────────────────

  describe("hasActiveAllergies", () => {
    it("returns true when count > 0", async () => {
      const chain = makeChain([], 2);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      expect(await hasActiveAllergies("p1")).toBe(true);
    });

    it("returns false when count === 0", async () => {
      const chain = makeChain([], 0);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      expect(await hasActiveAllergies("p1")).toBe(false);
    });
  });

  // ── getAllergyStats ──────────────────────────────────────────────────────────

  describe("getAllergyStats", () => {
    it("returns correct stats for mixed allergies", async () => {
      const allergies = [
        {
          id: "a1",
          allergyType: "medication",
          severity: "severe",
          isActive: 1,
        },
        { id: "a2", allergyType: "food", severity: "mild", isActive: 1 },
        {
          id: "a3",
          allergyType: "medication",
          severity: "life-threatening",
          isActive: 0,
        },
      ];
      const chain = makeChain(allergies);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const stats = await getAllergyStats("p1");

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.inactive).toBe(1);
      expect(stats.byType.medication).toBe(1);
      expect(stats.byType.food).toBe(1);
      expect(stats.bySeverity.severe).toBe(1);
      expect(stats.bySeverity.mild).toBe(1);
    });

    it("returns zero stats for empty list", async () => {
      const chain = makeChain([]);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const stats = await getAllergyStats("p1");

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.byType.medication).toBe(0);
    });
  });

  // ── getActiveAllergies ───────────────────────────────────────────────────────

  describe("getActiveAllergies", () => {
    it("delegates to where chain with filter", async () => {
      const active = [{ id: "a1", isActive: 1 }];
      const chain = makeChain(active);
      mockWhere.mockReturnValue({ equals: vi.fn().mockReturnValue(chain) });

      const result = await getActiveAllergies("p1");

      expect(result).toEqual(active);
    });
  });
});
