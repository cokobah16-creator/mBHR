import { describe, it, expect } from "vitest";
import { PAEDIATRIC_CHECK_FLAG } from "@/utils/vitals";
import { countHighRiskPatients } from "./outreachReports";

describe("countHighRiskPatients", () => {
  const visitIds = new Set(["v1", "v2", "v3"]);

  it("does not count a reading holding only the paediatric-chart prompt", () => {
    expect(
      countHighRiskPatients(
        [{ patientId: "child", visitId: "v1", flags: [PAEDIATRIC_CHECK_FLAG] }],
        visitIds,
      ),
    ).toBe(0);
  });

  it("counts a child whose reading also has an abnormal flag", () => {
    expect(
      countHighRiskPatients(
        [{ patientId: "child", visitId: "v1", flags: ["low_spo2", PAEDIATRIC_CHECK_FLAG] }],
        visitIds,
      ),
    ).toBe(1);
  });

  it("counts each patient once and only for visits in scope", () => {
    expect(
      countHighRiskPatients(
        [
          { patientId: "a", visitId: "v1", flags: ["high_bp"] },
          { patientId: "a", visitId: "v2", flags: ["high_temp"] },
          { patientId: "b", visitId: "v3", flags: [] },
          { patientId: "c", visitId: "other", flags: ["low_spo2"] },
        ],
        visitIds,
      ),
    ).toBe(1);
  });
});
