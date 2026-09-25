import { describe, it, expect } from "vitest";
import {
  DEFAULT_APP_ORIGIN,
  invitationEmail,
  invitationOrigin,
  invitationRefusal,
  invitationSmsText,
  isPortalInvitationText,
  readInvitationBegin,
  registrationLink,
  resolveSmsPurpose,
} from "./portalInvitation";

describe("resolveSmsPurpose", () => {
  it("keeps older app versions working: ids imply the purpose", () => {
    expect(resolveSmsPurpose({ purpose: undefined, reminderId: "r1", patientId: null })).toEqual({
      ok: true,
      purpose: "medication_reminder",
    });
    expect(resolveSmsPurpose({ purpose: undefined, reminderId: "r1", patientId: "p1" })).toEqual({
      ok: true,
      purpose: "medication_reminder",
    });
    expect(resolveSmsPurpose({ purpose: null, reminderId: null, patientId: "p1" })).toEqual({
      ok: true,
      purpose: "patient_message",
    });
  });

  it("never treats a request as an invitation unless it says so", () => {
    for (const purpose of [undefined, null, ""]) {
      const result = resolveSmsPurpose({ purpose, reminderId: null, patientId: "p1" });
      expect(result).toEqual({ ok: true, purpose: "patient_message" });
    }
  });

  it("accepts an invitation for a patient", () => {
    expect(
      resolveSmsPurpose({ purpose: "portal_invitation", reminderId: null, patientId: "p1" }),
    ).toEqual({ ok: true, purpose: "portal_invitation" });
  });

  it("refuses an invitation that points at a stored medication reminder", () => {
    const result = resolveSmsPurpose({
      purpose: "portal_invitation",
      reminderId: "r1",
      patientId: "p1",
    });
    expect(result).toMatchObject({ ok: false, error: "purpose_mismatch" });
  });

  it("refuses an invitation without a patient", () => {
    expect(
      resolveSmsPurpose({ purpose: "portal_invitation", reminderId: null, patientId: null }),
    ).toMatchObject({ ok: false, error: "recipient_required" });
  });

  it("needs a stored reminder for a medication reminder", () => {
    expect(
      resolveSmsPurpose({ purpose: "medication_reminder", reminderId: null, patientId: "p1" }),
    ).toMatchObject({ ok: false, error: "reminder_required" });
    expect(
      resolveSmsPurpose({ purpose: "patient_message", reminderId: "r1", patientId: "p1" }),
    ).toMatchObject({ ok: false, error: "purpose_mismatch" });
  });

  it("refuses unknown purposes", () => {
    for (const purpose of ["invite", "PORTAL_INVITATION", 1, {}, true]) {
      expect(resolveSmsPurpose({ purpose, reminderId: null, patientId: "p1" })).toMatchObject({
        ok: false,
        error: "invalid_purpose",
      });
    }
  });
});

describe("isPortalInvitationText", () => {
  it("spots the registration link that older app versions sent as free text", () => {
    expect(
      isPortalInvitationText(
        "Hi Ada, your mBHR patient portal is ready. Register at: https://mbhr.app/patient/register?phone=0803 — use your phone number and date of birth.",
      ),
    ).toBe(true);
    expect(isPortalInvitationText("See https://mbhr.app/Patient/Register")).toBe(true);
  });

  it("leaves other patient messages alone", () => {
    expect(isPortalInvitationText("Your televisit is on 3 March at 10:00. Join: https://meet.example/abc")).toBe(false);
    expect(isPortalInvitationText("Log in at https://mbhr.app/patient/login to see your appointment.")).toBe(false);
    expect(isPortalInvitationText(undefined)).toBe(false);
    expect(isPortalInvitationText(42)).toBe(false);
  });
});

describe("invitationRefusal", () => {
  it("maps each database refusal to a status, and never says it was sent", () => {
    expect(invitationRefusal("not_permitted", "sms").status).toBe(403);
    expect(invitationRefusal("patient_not_found", "sms").status).toBe(404);
    expect(invitationRefusal("patient_merged", "sms").status).toBe(409);
    expect(invitationRefusal("portal_not_enabled", "email").status).toBe(409);
    expect(invitationRefusal("no_contact", "sms")).toMatchObject({ status: 422, error: "no_phone" });
    expect(invitationRefusal("no_contact", "email")).toMatchObject({ status: 422, error: "no_email" });
    expect(invitationRefusal("invalid_channel", "sms").status).toBe(400);
    expect(invitationRefusal("check_failed", "sms")).toMatchObject({
      status: 503,
      error: "invitation_check_failed",
    });
    expect(invitationRefusal(undefined, "sms").status).toBe(503);
  });
});

describe("invitationOrigin", () => {
  const allowed = ["https://mbhr.app", "https://staging.mbhr.app"];

  it("uses PORTAL_APP_ORIGIN when it is set", () => {
    expect(invitationOrigin("https://staging.mbhr.app", "https://clinic.example.org/", allowed)).toBe(
      "https://clinic.example.org",
    );
  });

  it("uses the app's address only when it is an allowed origin", () => {
    expect(invitationOrigin("https://staging.mbhr.app", null, allowed)).toBe(
      "https://staging.mbhr.app",
    );
    expect(invitationOrigin("https://evil.example.com", null, allowed)).toBe(DEFAULT_APP_ORIGIN);
    expect(invitationOrigin("https://staging.mbhr.app", undefined, null)).toBe(DEFAULT_APP_ORIGIN);
  });

  it("ignores values that are not a bare origin", () => {
    expect(invitationOrigin("https://staging.mbhr.app/phish", null, allowed)).toBe(DEFAULT_APP_ORIGIN);
    expect(invitationOrigin("javascript:alert(1)", null, allowed)).toBe(DEFAULT_APP_ORIGIN);
    expect(invitationOrigin(42, "not a url", allowed)).toBe(DEFAULT_APP_ORIGIN);
  });
});

describe("invitation text", () => {
  it("pre-fills the stored contact in the registration link", () => {
    expect(registrationLink("https://mbhr.app", "sms", "0803 123 4567")).toBe(
      "https://mbhr.app/patient/register?phone=0803%20123%204567",
    );
    expect(registrationLink("https://mbhr.app", "email", "ada+1@example.org")).toBe(
      "https://mbhr.app/patient/register?email=ada%2B1%40example.org",
    );
  });

  it("builds the SMS from the patient's first name", () => {
    expect(invitationSmsText("Ada", "https://mbhr.app/patient/register?phone=1")).toBe(
      "Hi Ada, your mBHR patient portal is ready. Register at: https://mbhr.app/patient/register?phone=1 — use your phone number and date of birth.",
    );
    expect(invitationSmsText(null, "L")).toMatch(/^Hello, your mBHR patient portal is ready/);
    expect(invitationSmsText("  ", "L")).toMatch(/^Hello,/);
  });

  it("escapes the name in the HTML email", () => {
    const email = invitationEmail("<b>Ada</b>", "https://mbhr.app/r", "https://mbhr.app/patient/login");
    expect(email.subject).toBe("Your mBHR Patient Portal is Ready");
    expect(email.text).toContain("Hi <b>Ada</b>,");
    expect(email.html).toContain("Hi &lt;b&gt;Ada&lt;/b&gt;,");
    expect(email.html).not.toContain("<b>Ada</b>");
    expect(email.text).toContain("https://mbhr.app/r");
    expect(email.text).toContain("Already registered? Log in here: https://mbhr.app/patient/login");
  });
});

describe("readInvitationBegin", () => {
  it("reads an allowed answer", () => {
    expect(
      readInvitationBegin({
        allowed: true,
        invitation_id: "i1",
        patient_id: "p1",
        given_name: "Ada",
        recipient: " 08031234567 ",
        actor_role: "registration_lead",
      }),
    ).toEqual({
      grant: {
        invitationId: "i1",
        patientId: "p1",
        givenName: "Ada",
        recipient: "08031234567",
        actorRole: "registration_lead",
      },
    });
  });

  it("passes on a refusal and distrusts odd answers", () => {
    expect(readInvitationBegin({ allowed: false, reason: "not_permitted" })).toEqual({
      refused: "not_permitted",
    });
    expect(readInvitationBegin(null)).toEqual({ refused: "invalid_response" });
    expect(readInvitationBegin({ allowed: true, invitation_id: "i1", patient_id: "p1" })).toEqual({
      refused: "invalid_response",
    });
    expect(readInvitationBegin({ allowed: "true", recipient: "x" })).toEqual({
      refused: "invalid_response",
    });
  });
});
