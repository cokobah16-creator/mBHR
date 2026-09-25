// Which kind of email a send-otp-email request asks for.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// The route is decided from the request's shape only. Nothing about the
// address or the code is checked here: for a verification code the caller
// must first be a signed-in administrator (OTP_SENDER_ROLES, checked by
// send-otp-email with requireStaff), and only then are the address and the
// code validated.

import { PORTAL_INVITATION_PURPOSE } from "./portalInvitation.ts";

/** Who may send a verification code email: administrators only. */
export const OTP_SENDER_ROLES: readonly string[] = ["admin"];

export type EmailRoute =
  /** A server-built portal invitation (portal_invite, checked in the database). */
  | { kind: "invitation" }
  /** A verification code email (administrators only). */
  | { kind: "otp" }
  /** Refused before anything is sent. */
  | { kind: "refused"; status: 400; error: string; message?: string };

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Routes a parsed JSON body (see send-otp-email/index.ts). */
export function routeEmailRequest(body: unknown): EmailRoute {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      kind: "refused",
      status: 400,
      error: "invalid_request",
      message: "The request body must be a JSON object.",
    };
  }
  const request = body as Record<string, unknown>;

  if (request.purpose === PORTAL_INVITATION_PURPOSE) return { kind: "invitation" };
  if (request.purpose !== undefined && request.purpose !== null) {
    return { kind: "refused", status: 400, error: "invalid_purpose" };
  }

  if (!present(request.otp) && (request.subject !== undefined || request.message !== undefined)) {
    // The old free-text mode is gone: invitations are built on the server.
    return {
      kind: "refused",
      status: 400,
      error: "message_mode_removed",
      message:
        'Portal invitations are built by the server: send purpose "portal_invitation" and a patientId.',
    };
  }

  // Everything else asks for a code email, including a body with no code:
  // the administrator check comes first, then "An otp is required".
  return { kind: "otp" };
}
