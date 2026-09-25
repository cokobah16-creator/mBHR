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

// Strings notifyPatientTelevisitScheduled returns: its own checks, and the
// send-sms-reminder server's "code: message" errors.
describe("describeSmsFailure with server errors", () => {
  it("asks for an online sign-in when nobody is signed in online", () => {
    for (const error of [
      "Sign in online to send SMS",
      "not_authenticated: Sign in online with a staff account to send SMS.",
      "not_authenticated",
    ]) {
      const f = describeSmsFailure(error);
      expect(f.reason).toMatch(/^Sign in online with your staff account/);
      expect(f.reason).toMatch(/Nothing was sent/);
      expect(f.retryable).toBe(true);
    }
  });

  it("asks for an online sign-in when the gateway refuses an expired token", () => {
    for (const error of ["Invalid JWT", "JWT expired"]) {
      const f = describeSmsFailure(error);
      expect(f.reason).toMatch(/^Sign in online with your staff account/);
      expect(f.retryable).toBe(true);
    }
  });

  it("keeps a generic invalid number apart from the server's Nigerian check", () => {
    const legacy = describeSmsFailure("Invalid phone number");
    expect(legacy.reason).toMatch(/not a valid mobile number/);
    expect(legacy.reason).not.toMatch(/Nigerian/);
    expect(legacy.retryable).toBe(false);
  });

  it("says the role cannot send, without offering a retry", () => {
    for (const error of [
      "not_permitted: Your role cannot send SMS to patients.",
      "not_permitted",
    ]) {
      const f = describeSmsFailure(error);
      expect(f.reason).toMatch(/Your role cannot send SMS/);
      expect(f.reason).toMatch(/share the link another way/i);
      expect(f.retryable).toBe(false);
    }
  });

  it("asks for a sync when the patient is not on the server", () => {
    const f = describeSmsFailure(
      "patient_not_found: This patient is not on the server yet. Sync, then try again.",
    );
    expect(f.reason).toBe(
      "This patient is not on the server yet. Sync, then send again.",
    );
    expect(f.retryable).toBe(true);
  });

  it("explains an invalid stored number without echoing it", () => {
    for (const error of [
      "invalid_recipient: The stored phone number is not a valid Nigerian mobile number.",
      "invalid_recipient",
    ]) {
      const f = describeSmsFailure(error);
      expect(f.reason).toMatch(/not a valid Nigerian mobile number/);
      expect(f.reason).toMatch(/Correct it in the patient record/);
      expect(f.retryable).toBe(false);
    }
  });

  it("does not send twice when the server already records it as sent", () => {
    const f = describeSmsFailure(
      "already_sent: This reminder is already recorded as sent. It was not sent again.",
    );
    expect(f.reason).toMatch(/already records this message as sent/);
    expect(f.retryable).toBe(false);
  });

  it("does not call an unavailable send-limit check a send limit", () => {
    const f = describeSmsFailure(
      "rate_limit_unavailable: SMS sending is paused because the send limit could not be checked. Try again shortly.",
    );
    expect(f.reason).not.toMatch(/Too many/);
    expect(f.reason).toMatch(/nothing was sent/);
    expect(f.retryable).toBe(true);
  });

  it("treats server lookup failures as nothing sent, try again", () => {
    for (const error of [
      "staff_lookup_failed: Could not check your staff account. Try again shortly.",
      "lookup_failed",
    ]) {
      const f = describeSmsFailure(error);
      expect(f.reason).toMatch(/nothing was sent/);
      expect(f.retryable).toBe(true);
    }
  });

  it("still reports a real send limit as too many messages", () => {
    expect(describeSmsFailure("Rate limited (HTTP 429)").reason).toMatch(
      /^Too many messages/,
    );
  });

  it("tells a server record with no phone number apart from a local one", () => {
    const server = describeSmsFailure(
      "no_phone: The patient has no phone number on the server.",
    );
    expect(server.reason).toMatch(/record on the server has no phone number/);
    expect(server.retryable).toBe(true);
    const local = describeSmsFailure("Patient has no phone number");
    expect(local.reason).toMatch(/no phone number on record/);
    expect(local.retryable).toBe(false);
  });

  it("does not offer a retry for a message the server refused as too long", () => {
    const f = describeSmsFailure(
      "invalid_message: The message is empty or too long.",
    );
    expect(f.reason).toMatch(/empty or too long/);
    expect(f.retryable).toBe(false);
  });

  it("keeps missing SMS configuration on the server as not set up", () => {
    const f = describeSmsFailure(
      "sms_not_configured: No SMS provider configured. Set TERMII_API_KEY and TERMII_SENDER_ID (preferred), then redeploy.",
    );
    expect(f.reason).toMatch(/not set up/);
    expect(f.retryable).toBe(false);
  });

  it("offers Sign in online as a retry and not-permitted as a fresh send", () => {
    const at = new Date(2026, 8, 23, 10, 2);
    const signedOut = linkDeliveryFrom(
      { kind: "result", sent: false, error: "Sign in online to send SMS", to: "Ada" },
      at,
    );
    expect(sendLinkLabel(signedOut)).toBe("Retry SMS");
    const refused = linkDeliveryFrom(
      {
        kind: "result",
        sent: false,
        error: "not_permitted: Your role cannot send SMS to patients.",
        to: "Ada",
      },
      at,
    );
    expect(sendLinkLabel(refused)).toBe("Send link by SMS");
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
