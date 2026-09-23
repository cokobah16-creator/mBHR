import { describe, it, expect } from "vitest";
import {
  PORTAL_PROVIDER_NOT_CONFIGURED_ERROR,
  isPortalInvitationMessage,
} from "./portalInvitationQueue";

describe("isPortalInvitationMessage", () => {
  it("accepts portal invitations", () => {
    expect(isPortalInvitationMessage({ templateKey: "portal.invitation" })).toBe(
      true,
    );
  });

  it("leaves reminders queued by the messaging service alone", () => {
    for (const templateKey of [
      "followup.medication",
      "medication_reminder",
      "appointment.reminder",
      "custom",
    ]) {
      expect(isPortalInvitationMessage({ templateKey })).toBe(false);
    }
  });

  it("rejects missing or look-alike keys", () => {
    expect(isPortalInvitationMessage({})).toBe(false);
    expect(isPortalInvitationMessage({ templateKey: null })).toBe(false);
    expect(isPortalInvitationMessage({ templateKey: "" })).toBe(false);
    expect(isPortalInvitationMessage({ templateKey: "portal.invitation.x" })).toBe(
      false,
    );
  });
});

describe("PORTAL_PROVIDER_NOT_CONFIGURED_ERROR", () => {
  it("keeps the text the SMS outbox explains to staff", () => {
    // features/notifications/smsOutbox describeFailure matches this text.
    expect(PORTAL_PROVIDER_NOT_CONFIGURED_ERROR.toLowerCase()).toContain(
      "sms/email provider not configured",
    );
  });
});
