import { describe, it, expect } from "vitest";
import { derivePatientFlow, currentFlowStage } from "./patientFlow";

const visit = {
  id: "v1",
  startedAt: new Date("2026-09-22T09:14:00"),
  status: "open" as const,
};

describe("derivePatientFlow", () => {
  it("marks every stage upcoming when there is no visit", () => {
    const steps = derivePatientFlow({ visit: null });
    expect(steps.map((s) => s.state)).toEqual([
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(currentFlowStage(steps)).toBeNull();
  });

  it("completes stages only from records attached to this visit", () => {
    const steps = derivePatientFlow({
      visit,
      vitals: [
        { visitId: "v1", takenAt: new Date("2026-09-22T09:31:00") },
        { visitId: "other", takenAt: new Date("2026-09-01T09:00:00") },
      ],
      consultations: [
        { visitId: "other", createdAt: new Date("2026-09-01T10:00:00") },
      ],
    });
    expect(steps[0].state).toBe("done");
    expect(steps[1].state).toBe("done");
    expect(steps[1].at?.getHours()).toBe(9);
    expect(steps[2].state).toBe("waiting");
    expect(steps[3].state).toBe("upcoming");
    expect(currentFlowStage(steps)).toBe("consult");
  });

  it("shows the in-service stage as current", () => {
    const steps = derivePatientFlow({
      visit,
      vitals: [{ visitId: "v1", takenAt: new Date() }],
      queueItem: {
        stage: "consult",
        status: "in_progress",
        updatedAt: new Date(),
      },
    });
    expect(steps[2].state).toBe("current");
  });

  it("finishes pharmacy when the queue closes it without a dispense", () => {
    const steps = derivePatientFlow({
      visit,
      vitals: [{ visitId: "v1", takenAt: new Date() }],
      consultations: [{ visitId: "v1", createdAt: new Date() }],
      queueItem: { stage: "pharmacy", status: "done", updatedAt: new Date() },
    });
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(currentFlowStage(steps)).toBeNull();
  });

  it("does not invent a current stage on a closed visit", () => {
    const steps = derivePatientFlow({
      visit: { ...visit, status: "closed" },
      vitals: [{ visitId: "v1", takenAt: new Date() }],
    });
    expect(steps.filter((s) => s.state === "current")).toHaveLength(0);
    expect(steps[2].state).toBe("upcoming");
  });
});
