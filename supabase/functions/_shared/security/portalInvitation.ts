// Patient portal invitations sent by edge functions.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// Who may send one is decided in the database, not here:
// public.portal_invitation_begin() (migration
// 20260925100600_registration_lead_portal_invite.sql) checks that the
// signed-in staff member's role holds 'portal_invite' (registration_lead,
// lead_clinician, admin), that the patient is on the server, not merged away
// and has portal access on, returns the stored phone or email to send to,
// and records the request in public.portal_invitation_events.
// public.portal_invitation_finish() records what happened to it.
//
// The text is built here from the stored patient record: the caller cannot
// choose the recipient or the words. HTML is escaped with ./html.ts, the
// one escaping rule the email functions share.

import { escapeHtml } from "./html.ts";

/** The purpose value the app sends for a portal invitation. */
export const PORTAL_INVITATION_PURPOSE = "portal_invitation";

/**
 * What a send-sms-reminder call is for:
 *   medication_reminder - a stored medication_reminders row (reminderId)
 *   patient_message     - staff text to a patient record (patientId), e.g.
 *                         televisit notices and appointment reminders
 *   portal_invitation   - a portal invitation (patientId), built on the
 *                         server; needs portal_invite, not an SMS sender role
 */
export type SmsPurpose =
  | "medication_reminder"
  | "patient_message"
  | typeof PORTAL_INVITATION_PURPOSE;

export type SmsPurposeResult =
  | { ok: true; purpose: SmsPurpose }
  | { ok: false; error: string; message: string };

/**
 * Works out and checks the purpose of a send-sms-reminder request from the
 * (already validated) ids. Callers that send no purpose (older app
 * versions) get the purpose their ids imply: a reminderId is a medication
 * reminder, a patientId alone is a patient message. A portal invitation
 * must say so explicitly.
 */
export function resolveSmsPurpose(input: {
  purpose: unknown;
  reminderId: string | null;
  patientId: string | null;
}): SmsPurposeResult {
  const { purpose, reminderId, patientId } = input;

  if (purpose === undefined || purpose === null || purpose === "") {
    return {
      ok: true,
      purpose: reminderId ? "medication_reminder" : "patient_message",
    };
  }

  if (purpose === "medication_reminder") {
    if (!reminderId) {
      return {
        ok: false,
        error: "reminder_required",
        message: "A medication reminder needs the reminderId of a stored reminder.",
      };
    }
    return { ok: true, purpose: "medication_reminder" };
  }

  if (purpose === "patient_message" || purpose === PORTAL_INVITATION_PURPOSE) {
    const invitation = purpose === PORTAL_INVITATION_PURPOSE;
    if (reminderId) {
      return {
        ok: false,
        error: "purpose_mismatch",
        message: invitation
          ? "A portal invitation is not a medication reminder: send the patientId only."
          : "A stored medication reminder is sent with purpose medication_reminder.",
      };
    }
    if (!patientId) {
      return {
        ok: false,
        error: "recipient_required",
        message: "Send a patientId. Contact details are looked up on the server.",
      };
    }
    return {
      ok: true,
      purpose: invitation ? PORTAL_INVITATION_PURPOSE : "patient_message",
    };
  }

  return { ok: false, error: "invalid_purpose", message: "Unknown purpose." };
}

/**
 * True for free text carrying the portal registration link: what older app
 * versions sent as a plain patient message to invite a patient. Such text
 * is refused as a patient message, so an invitation only goes out as a
 * checked and recorded portal invitation.
 */
export function isPortalInvitationText(text: unknown): boolean {
  return typeof text === "string" && /\/patient\/register\b/i.test(text);
}

/** Why the database refused an invitation (portal_invitation_begin). */
export type InvitationRefusal =
  | "invalid_channel"
  | "not_permitted"
  | "patient_not_found"
  | "patient_merged"
  | "portal_not_enabled"
  | "no_contact";

/** HTTP status and plain message for a refusal. Nothing was sent. */
export function invitationRefusal(
  reason: unknown,
  channel: "sms" | "email",
): { status: number; error: string; message: string } {
  switch (reason) {
    case "not_permitted":
      return {
        status: 403,
        error: "not_permitted",
        message:
          "Your role cannot send portal invitations. Registration leads, lead clinicians and admins can.",
      };
    case "patient_not_found":
      return {
        status: 404,
        error: "patient_not_found",
        message: "This patient is not on the server yet. Sync, then try again.",
      };
    case "patient_merged":
      return {
        status: 409,
        error: "patient_merged",
        message:
          "This record was merged into another one. Send the invitation from the record that was kept.",
      };
    case "portal_not_enabled":
      return {
        status: 409,
        error: "portal_not_enabled",
        message:
          "The server does not have portal access on for this patient. No invitation was sent.",
      };
    case "no_contact":
      return {
        status: 422,
        error: channel === "email" ? "no_email" : "no_phone",
        message:
          channel === "email"
            ? "The patient has no email address on the server."
            : "The patient has no phone number on the server.",
      };
    case "invalid_channel":
      return { status: 400, error: "invalid_channel", message: "Unknown channel." };
    default:
      return {
        status: 503,
        error: "invitation_check_failed",
        message: "The invitation could not be checked. Nothing was sent.",
      };
  }
}

/** The app address used in links, without a trailing slash. */
export const DEFAULT_APP_ORIGIN = "https://mbhr.app";

function cleanOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Where the invitation's links point. PORTAL_APP_ORIGIN (configured) wins;
 * otherwise the app's own address when it is one of ALLOWED_ORIGINS
 * (trusted: it is also the CORS allowlist); otherwise https://mbhr.app.
 * A caller cannot point patients at another site.
 */
export function invitationOrigin(
  requested: unknown,
  configured: string | null | undefined,
  allowedOrigins: readonly string[] | null,
): string {
  const fixed = cleanOrigin(configured);
  if (fixed) return fixed;
  const asked = cleanOrigin(requested);
  if (asked && allowedOrigins?.includes(asked)) return asked;
  return DEFAULT_APP_ORIGIN;
}

/** Registration link with the stored contact pre-filled. */
export function registrationLink(
  origin: string,
  channel: "sms" | "email",
  recipient: string,
): string {
  const key = channel === "email" ? "email" : "phone";
  return `${origin}/patient/register?${key}=${encodeURIComponent(recipient)}`;
}

/** First name for a greeting: trimmed, at most 60 characters, or null. */
function greetingName(givenName: unknown): string | null {
  if (typeof givenName !== "string") return null;
  const name = givenName.replace(/\s+/g, " ").trim().slice(0, 60);
  return name || null;
}

/** The invitation SMS (same words the app used to send). */
export function invitationSmsText(givenName: unknown, link: string): string {
  const name = greetingName(givenName);
  return (
    `${name ? `Hi ${name}` : "Hello"}, your mBHR patient portal is ready. ` +
    `Register at: ${link} — use your phone number and date of birth.`
  );
}

/** The invitation email: subject, plain text and HTML (name escaped). */
export function invitationEmail(
  givenName: unknown,
  link: string,
  loginLink: string,
): { subject: string; text: string; html: string } {
  const name = greetingName(givenName);
  const text =
    `${name ? `Hi ${name}` : "Hello"},\n\n` +
    `Your patient portal has been set up by your healthcare provider.\n\n` +
    `Click the link below to create your account — your email will be pre-filled:\n\n` +
    `${link}\n\n` +
    `You will be asked to enter your date of birth to complete registration.\n\n` +
    `Already registered? Log in here: ${loginLink}\n\n` +
    `Med Bridge Health Reach`;
  const content = escapeHtml(text).replace(/\n/g, "<br>");
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
      .content { background-color: #f9fafb; padding: 30px; }
      .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header"><h1>mBHR Patient Portal</h1></div>
      <div class="content">${content}</div>
      <div class="footer">
        <p>Med Bridge Health Reach | Dr. Isioma Okobah Foundation</p>
        <p>This is an automated message. Please do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>`;
  return { subject: "Your mBHR Patient Portal is Ready", text, html };
}

/** The begin() answer when the invitation may go out. */
export interface InvitationGrant {
  invitationId: string;
  patientId: string;
  givenName: string | null;
  recipient: string;
  actorRole: string;
}

/**
 * Reads portal_invitation_begin()'s JSON answer. `grant` when allowed,
 * otherwise the refusal reason (unknown shapes are "invalid_response").
 */
export function readInvitationBegin(
  data: unknown,
): { grant: InvitationGrant } | { refused: string } {
  if (!data || typeof data !== "object") return { refused: "invalid_response" };
  const row = data as Record<string, unknown>;
  if (row.allowed !== true) {
    return { refused: typeof row.reason === "string" ? row.reason : "invalid_response" };
  }
  if (
    typeof row.invitation_id !== "string" ||
    typeof row.patient_id !== "string" ||
    typeof row.recipient !== "string" ||
    !row.recipient.trim()
  ) {
    return { refused: "invalid_response" };
  }
  return {
    grant: {
      invitationId: row.invitation_id,
      patientId: row.patient_id,
      givenName: typeof row.given_name === "string" ? row.given_name : null,
      recipient: row.recipient.trim(),
      actorRole: typeof row.actor_role === "string" ? row.actor_role : "",
    },
  };
}
