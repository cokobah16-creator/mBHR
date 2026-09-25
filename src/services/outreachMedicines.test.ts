import { describe, it, expect } from "vitest";
import { tallyMedicines } from "./outreachMedicines";

describe("tallyMedicines", () => {
  it("counts a prescription dispense once when it is in both databases", () => {
    const main = [
      { id: "v1", itemName: "Paracetamol 500mg", qty: 10 },
      // Downloaded copy of a prescription dispense made on this device.
      { id: "d1", itemName: "Amoxicillin 250mg", qty: 21 },
    ];
    const pharmacy = [
      { id: "d1", itemName: "Amoxicillin 250mg", qty: 21 },
      { id: "d2", itemName: "Amoxicillin 250mg", qty: 15 },
    ];
    expect(tallyMedicines(main, pharmacy)).toEqual([
      { name: "Amoxicillin 250mg", unitsDispensed: 36, events: 2 },
      { name: "Paracetamol 500mg", unitsDispensed: 10, events: 1 },
    ]);
  });

  it("labels missing names and ignores missing quantities", () => {
    expect(tallyMedicines([{ id: "a", itemName: " ", qty: undefined }], [])).toEqual([
      { name: "Unknown", unitsDispensed: 0, events: 1 },
    ]);
  });

  it("keeps the top entries by units", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, itemName: `M${i}`, qty: i }));
    expect(tallyMedicines(rows, [], 2).map((m) => m.name)).toEqual(["M4", "M3"]);
  });
});
