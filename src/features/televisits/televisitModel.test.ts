import { describe, it, expect } from "vitest";
import {
  TELEVISIT_STATUS_META,
  describeSmsFailure,
  joinWindowLabel,
  joinWindowOf,
  linkDeliveryFrom,
  sendLinkLabel,
  televisitStatusMeta,
} from "./televisitModel";

const start = new Date(2026, 8, 23, 10, 0);
const opensAt = new Date(2026, 8, 23, 9, 50);

describe("televisit status labels", () => {
  it("shows completed visits as ended and arrived as waiting", () => {
    expect(TELEVISIT_STATUS_META.completed.label).toBe("Ended");
    expect(TELEVISIT_STATUS_META.arrived.label).toBe("Patient waiting");
    expect(televisitStatusMeta("unknown").label).toBe("unknown");
  });
});

describe("joinWindowOf", () => {
  it("is open whenever the service says the visit can be joined", () => {
    expect(joinWindowOf("scheduled", true, opensAt, start)).toBe("open");
  });

  it("is not yet open before the window", () => {
    expect(
      joinWindowOf("confirmed", false, opensAt, new Date(2026, 8, 23, 9, 0)),
    ).toBe("not-yet");
  });

  it("is closed after the window for a visit nobody closed", () => {
    expect(
      joinWindowOf("scheduled", false, opensAt, new Date(2026, 8, 23, 12, 0)),
    ).toBe("closed");
  });

  it("does not apply to finished visits", () => {
    expect(joinWindowOf("completed", false, opensAt, start)).toBe("none");
    expect(joinWindowOf("cancelled", false, opensAt, start)).toBe("none");
    expect(joinWindowLabel("none", opensAt)).toBeNull();
  });

  it("labels the opening time", () => {
    expect(joinWindowLabel("not-yet", opensAt)?.label).toBe("Join opens 09:50");
    expect(joinWindowLabel("closed", opensAt)?.tone).toBe("warning");
  });
});

describe("describeSmsFailure", () => {
  it("explains a missing phone number without offering a retry", () => {
    const f = describeSmsFailure("Patient has no phone number");
    expect(f.reason).toMatch(/no phone number/);
    expect(f.retryable).toBe(false);
  });

  it("never echoes an invalid phone number back", () => {
    const f = describeSmsFailure("Invalid phone number: +2348012345678");
    expect(f.reason).not.toContain("234");
    expect(f.retryable).toBe(false);
  });

  it("treats demo mode as not sent", () => {
    const f = describeSmsFailure(
      "SMS demo mode is on: the message was logged, not sent",
    );
    expect(f.reason).toMatch(/not sent/);
    expect(f.retryable).toBe(false);
  });

  it("explains missing SMS configuration", () => {
    expect(describeSmsFailure("SMS service not configured").retryable).toBe(
      false,
    );
    expect(describeSmsFailure("sms_not_configured").reason).toMatch(
      /not set up/,
    );
  });

  it("offers a retry for connection problems and rate limits", () => {
    expect(describeSmsFailure("Device is offline")).toMatchObject({
      retryable: true,
    });
    expect(describeSmsFailure("Failed to fetch").reason).toMatch(
      /Could not reach/,
    );
    expect(describeSmsFailure("Rate limited (HTTP 429)").reason).toMatch(
      /Wait a minute/,
    );
  });

  it("hides raw provider errors behind a plain reason", () => {
    const f = describeSmsFailure("Termii rejected: sender id not approved");
    expect(f.reason).not.toMatch(/Termii/);
    expect(f.retryable).toBe(true);
  });
});

describe("linkDeliveryFrom", () => {
  const at = new Date(2026, 8, 23, 10, 2);

  it("is sent only when the send call succeeded", () => {
    expect(
      linkDeliveryFrom({ kind: "result", sent: true, to: "Ada Obi" }, at),
    ).toEqual({ state: "sent", at, to: "Ada Obi" });
    const failed = linkDeliveryFrom(
      { kind: "result", sent: false, error: "boom", to: "Ada Obi" },
      at,
    );
    expect(failed.state).toBe("failed");
  });

  it("fails without a retry when the contact is missing", () => {
    const d = linkDeliveryFrom({ kind: "no-contact" }, at);
    expect(d).toMatchObject({ state: "failed", retryable: false });
  });
});

describe("sendLinkLabel", () => {
  const at = new Date();
  it("names the next step", () => {
    expect(sendLinkLabel(undefined)).toBe("Send link by SMS");
    expect(sendLinkLabel({ state: "sending" })).toBe("Sending SMS…");
    expect(sendLinkLabel({ state: "sent", at, to: "Ada" })).toBe(
      "Send SMS again",
    );
    expect(
      sendLinkLabel({ state: "failed", at, reason: "x", retryable: true }),
    ).toBe("Retry SMS");
  });
});
