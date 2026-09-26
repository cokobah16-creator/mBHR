import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import {
  isPatientCancellable,
  patientRequestStatusInfo,
  toPatientRequestStatus,
  type PatientRequestStatus,
} from "./requestStatus";

const ALL: PatientRequestStatus[] = [
  "submitted",
  "underReview",
  "approved",
  "scheduled",
  "completed",
  "declined",
  "cancelled",
  "unknown",
];

describe("patient request status", () => {
  it("never reads a sent request as confirmed", () => {
    expect(toPatientRequestStatus("pending")).toBe("submitted");
    expect(patientRequestStatusInfo("pending").tone).not.toBe("success");
  });

  it("maps stored spellings regardless of case", () => {
    expect(toPatientRequestStatus("APPROVED")).toBe("approved");
    expect(toPatientRequestStatus(" canceled ")).toBe("cancelled");
    expect(toPatientRequestStatus("rejected")).toBe("declined");
  });

  it("shows unknown values as 'not recorded', never the raw value", () => {
    expect(toPatientRequestStatus("weird_enum")).toBe("unknown");
    expect(toPatientRequestStatus(null)).toBe("unknown");
    expect(patientRequestStatusInfo("weird_enum").labelKey).toBe(
      "portal.request.status.unknown",
    );
  });

  it("has English words for every status", () => {
    for (const s of ALL) {
      const info = patientRequestStatusInfo(s === "underReview" ? "under_review" : s);
      expect(i18n.exists(info.labelKey, { lng: "en" })).toBe(true);
      expect(i18n.exists(info.nextKey, { lng: "en" })).toBe(true);
    }
  });

  it("lets the patient cancel only requests nobody has acted on", () => {
    expect(isPatientCancellable("pending")).toBe(true);
    expect(isPatientCancellable("approved")).toBe(false);
    expect(isPatientCancellable("scheduled")).toBe(false);
  });
});
