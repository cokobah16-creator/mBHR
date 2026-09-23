import { describe, it, expect } from "vitest";
import {
  billStatusDisplay,
  formatFileSize,
  formatNaira,
  referralPriorityDisplay,
  referralStatusDisplay,
} from "./displayStatus";

describe("billStatusDisplay", () => {
  it("only shows success for a stored paid status", () => {
    expect(billStatusDisplay("paid").tone).toBe("success");
    expect(billStatusDisplay("partial").tone).toBe("warning");
    expect(billStatusDisplay("pending").tone).toBe("info");
    expect(billStatusDisplay("overdue").tone).toBe("danger");
    expect(billStatusDisplay("mystery").tone).toBe("neutral");
  });
});

describe("referral displays", () => {
  it("maps status and priority to tone + text", () => {
    expect(referralStatusDisplay("pending")).toEqual({
      tone: "warning",
      label: "Not booked yet",
    });
    expect(referralStatusDisplay("completed").tone).toBe("success");
    expect(referralPriorityDisplay("emergency").tone).toBe("danger");
    expect(referralPriorityDisplay("routine").label).toBe("Routine");
  });
});

describe("formatNaira", () => {
  it("shows the naira sign and grouping", () => {
    const s = formatNaira(1500);
    expect(s).toContain("₦");
    expect(s).toContain("1,500");
  });

  it("treats non-numbers as zero", () => {
    expect(formatNaira(Number.NaN)).toContain("0");
  });
});

describe("formatFileSize", () => {
  it("picks a readable unit", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
