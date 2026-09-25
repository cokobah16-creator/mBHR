import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { allowedOrigins, corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import {
  authenticateStaff,
  getServiceClient,
  requireStaff,
} from "../_shared/security/staffAuth.ts";
import {
  checkSmsLimits,
  hashKey,
  PER_RECIPIENT_LIMIT,
  PER_USER_LIMIT,
} from "../_shared/security/smsRateLimit.ts";
import { validEmail, validId, validOtp } from "../_shared/security/recipient.ts";
import { escapeHtml } from "../_shared/security/html.ts";
import {
  OTP_SENDER_ROLES,
  routeEmailRequest,
} from "../_shared/security/emailRequest.ts";
import {
  invitationEmail,
  invitationOrigin,
  invitationRefusal,
  registrationLink,
} from "../_shared/security/portalInvitation.ts";
import {
  beginInvitation,
  finishInvitation,
} from "../_shared/security/portalInvitationDb.ts";

// Sends email through Resend (RESEND_API_KEY; demo mode without it).
//
// Two kinds of email:
// - A patient portal invitation { purpose: "portal_invitation", patientId,
//   appOrigin? }: only a signed-in staff member whose role holds
//   'portal_invite' (registration_lead, lead_clinician, admin). The database
//   (public.portal_invitation_begin) checks the role and the patient
//   (on the server, not merged away, portal access on), returns the stored
//   email address and records who sent the invitation; the outcome is
//   recorded after Resend answers (public.portal_invitation_finish). The
//   subject, text and link are built here from the patient record: the
//   caller cannot choose the address or the words. Neither checks the
//   patient's age yet: the app refuses an invitation for a patient under 18
//   (src/services/portalEnrollment.ts).
// - A verification code { email, otp }: a 4 to 8 digit code in a fixed
//   template. Only a signed-in administrator (OTP_SENDER_ROLES in
//   ../_shared/security/emailRequest.ts), checked before the address or the
//   code is looked at. Its one caller is the admin email check
//   (src/pages/admin/EmailDiagnostics.tsx, admin only in App.tsx). No
//   patient flow sends email codes: patient self-service OTP (requestOTP in
//   src/services/patientPortalAuth.ts) is a disabled stub.
// The old free-text mode ({ email, subject, message }) is refused: it let
// any caller send any text to any address.
//
// Who is calling is read from app_users (staffAuth.ts); a role in the token
// or the body is never trusted, and the anon key gets 401.
//
// Content: every value placed in an HTML body (the code, the patient's
// name) is escaped with ../_shared/security/html.ts. Text bodies stay plain.
//
// Requests: POST only (405 otherwise); 10 a minute per IP address, checked
// before sign-in (JSON 429 with Retry-After).
//
// Logs never contain an email address (in full or masked), a code, an
// invitation's text, or the caller's user id or role.

// requireStaff's own messages talk about SMS; these replace them. 403 also
// covers a deactivated account or one missing from app_users, so the
// message names the account, not only the role.
const AUTH_MESSAGES: Record<string, string> = {
  not_authenticated:
    "Sign in online with a staff account to send email. A PIN unlock is not enough.",
  not_permitted: "Your staff account cannot send this email.",
};

interface EmailRequest {
  email?: unknown;
  otp?: unknown;
  subject?: unknown;
  message?: unknown;
  purpose?: unknown;
  patientId?: unknown;
  /** The app's address, for the invitation link (used only if allowed). */
  appOrigin?: unknown;
}

type Reply = (
  status: number,
  body: Record<string, unknown>,
  extra?: Record<string, string>,
) => Response;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

const RESEND_URL = "https://api.resend.com/emails";

function fromAddress(): string {
  const senderEmail = Deno.env.get("SENDER_EMAIL");
  return `mBHR Patient Portal <${senderEmail || "onboarding@resend.dev"}>`;
}

/** Sends one email with Resend. Never throws. */
async function sendWithResend(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ ok: true; id: string | null } | { ok: false; status: number }> {
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, html, text }),
    });
    if (!response.ok) {
      // The error body can quote the address: log the status only.
      console.error("Resend API error: HTTP", response.status);
      return { ok: false, status: response.status };
    }
    const data = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return { ok: true, id: typeof data?.id === "string" ? data.id : null };
  } catch (error) {
    console.error("Resend request failed:", errorName(error));
    return { ok: false, status: 0 };
  }
}

/** Purpose "portal_invitation" (see the header). */
async function sendInvitationEmail(
  req: Request,
  body: EmailRequest,
  reply: Reply,
): Promise<Response> {
  const service = getServiceClient();

  const auth = await authenticateStaff(req, service);
  if (!auth.ok) {
    return reply(auth.status, {
      success: false,
      error: auth.error,
      message:
        auth.status === 401
          ? "Sign in online with a staff account to send portal invitations."
          : auth.status === 403
            ? "Your account cannot send portal invitations."
            : auth.message,
    });
  }

  const patientId = validId(body.patientId);
  if (!patientId) {
    return reply(400, {
      success: false,
      error: body.patientId == null ? "recipient_required" : "invalid_patient_id",
      message: "Send a patientId. Email addresses are looked up on the server.",
    });
  }

  const begun = await beginInvitation(service, auth.userId, patientId, "email");
  if ("refused" in begun) {
    const refusal = invitationRefusal(begun.refused, "email");
    return reply(refusal.status, {
      success: false,
      error: refusal.error,
      message: refusal.message,
    });
  }
  const { grant } = begun;
  const finish = (
    outcome: "sent" | "not_sent",
    detail: string,
    provider: string | null = null,
    messageId: string | null = null,
  ) =>
    finishInvitation(service, grant.invitationId, outcome, detail, provider, messageId);

  const email = validEmail(grant.recipient);
  if (!email) {
    const invitationRecorded = await finish("not_sent", "invalid_recipient");
    return reply(422, {
      success: false,
      error: "invalid_recipient",
      message: "The stored email address is not valid.",
      invitationRecorded,
    });
  }

  // Fail closed: an invitation that cannot be counted is not sent.
  const limit = await checkSmsLimits(service, [
    { bucket: "email_invite_user", key: auth.userId, ...PER_USER_LIMIT },
    {
      bucket: "email_invite_recipient",
      key: await hashKey(email.toLowerCase()),
      ...PER_RECIPIENT_LIMIT,
    },
  ]);
  if (!limit.allowed) {
    if ("error" in limit) {
      const invitationRecorded = await finish("not_sent", "rate_limit_unavailable");
      return reply(503, {
        success: false,
        error: "rate_limit_unavailable",
        message: "Invitations are paused because the send limit could not be checked. Try again shortly.",
        invitationRecorded,
      });
    }
    const invitationRecorded = await finish("not_sent", "rate_limited");
    return reply(
      429,
      {
        success: false,
        error: "rate_limited",
        scope: limit.bucket === "email_invite_user" ? "user" : "recipient",
        retry_after_seconds: limit.retryAfter,
        message:
          limit.bucket === "email_invite_user"
            ? "Too many invitations sent from your account in the last minute."
            : "This patient has already been sent several invitations in the last hour.",
        invitationRecorded,
      },
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  const origin = invitationOrigin(
    body.appOrigin,
    Deno.env.get("PORTAL_APP_ORIGIN"),
    allowedOrigins(),
  );
  const content = invitationEmail(
    grant.givenName,
    registrationLink(origin, "email", email),
    `${origin}/patient/login`,
  );

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.warn(
      `RESEND_API_KEY not configured. Demo mode: portal invitation email not sent (invitation ${grant.invitationId}).`,
    );
    const invitationRecorded = await finish("not_sent", "demo_mode");
    return reply(200, {
      success: true,
      demo: true,
      invitationRecorded,
      message: "Demo mode: no email was sent",
    });
  }

  const sent = await sendWithResend(
    resendApiKey,
    email,
    content.subject,
    content.html,
    content.text,
  );
  if (!sent.ok) {
    const invitationRecorded = await finish("not_sent", "provider_rejected", "resend");
    return reply(502, {
      success: false,
      error: "Failed to send email",
      invitationRecorded,
    });
  }

  // No address, name or caller in the log: the invitation id leads to them
  // in public.portal_invitation_events for those allowed to read it.
  console.log(
    `Portal invitation email accepted by Resend - ID: ${sent.id ?? "n/a"}, Invitation: ${grant.invitationId}`,
  );
  const invitationRecorded = await finish("sent", "provider_accepted", "resend", sent.id);
  return reply(200, { success: true, messageId: sent.id, invitationRecorded });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const reply: Reply = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...jsonHeaders, ...extra },
    });

  if (req.method !== "POST") {
    return reply(405, { success: false, error: "method_not_allowed" });
  }

  const rl = await enforceRateLimit(req, {
    bucket: "edge_otp_email",
    keyStrategy: "ip",
    max: 10,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    const retryAfter = rl.retryAfter ?? 60;
    return reply(
      429,
      {
        success: false,
        error: "rate_limited",
        scope: "ip",
        retry_after_seconds: retryAfter,
      },
      { "Retry-After": String(retryAfter) },
    );
  }

  try {
    let body: EmailRequest;
    try {
      body = (await req.json()) as EmailRequest;
    } catch {
      return reply(400, { success: false, error: "The request body must be JSON" });
    }

    const route = routeEmailRequest(body);
    if (route.kind === "refused") {
      return reply(route.status, {
        success: false,
        error: route.error,
        ...(route.message ? { message: route.message } : {}),
      });
    }
    if (route.kind === "invitation") {
      return await sendInvitationEmail(req, body, reply);
    }

    // The verification code email: a signed-in administrator only, checked
    // before the address or the code is looked at.
    const auth = await requireStaff(req, getServiceClient(), OTP_SENDER_ROLES);
    if (!auth.ok) {
      return reply(auth.status, {
        success: false,
        error: auth.error,
        message: AUTH_MESSAGES[auth.error] ?? auth.message,
      });
    }

    if (body.otp === undefined || body.otp === null || body.otp === "") {
      return reply(400, { success: false, error: "An otp is required" });
    }

    const email = validEmail(body.email);
    if (!email) {
      return reply(400, { success: false, error: "Email is required" });
    }
    const otp = validOtp(body.otp);
    if (!otp) {
      return reply(400, {
        success: false,
        error: "invalid_otp",
        message: "A 4 to 8 digit code is required.",
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      // Nothing identifying: no address, code or caller.
      console.warn(
        "send-otp-email demo mode: RESEND_API_KEY is not set, so the sign-in code email was not sent.",
      );
      return reply(200, {
        success: true,
        demo: true,
        message: "Demo mode: RESEND_API_KEY is not set, so no email was sent.",
      });
    }

    const htmlBody = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
              .content { background-color: #f9fafb; padding: 30px; }
              .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center;
                          background-color: white; padding: 20px; border-radius: 8px;
                          margin: 20px 0; color: #2563eb; }
              .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
              .warning { background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header"><h1>mBHR Patient Portal</h1></div>
              <div class="content">
                <h2>Your Verification Code</h2>
                <p>Hello,</p>
                <p>You requested a verification code to access your mBHR Patient Portal account.
                   Please use the code below to complete your login:</p>
                <div class="otp-code">${escapeHtml(otp)}</div>
                <p>This code will expire in <strong>10 minutes</strong>.</p>
                <div class="warning">
                  <strong>Security Notice:</strong> Never share this code with anyone.
                  mBHR staff will never ask you for this code.
                </div>
                <p>If you didn't request this code, please ignore this email or contact our support team.</p>
              </div>
              <div class="footer">
                <p>Med Bridge Health Reach | Dr. Isioma Okobah Foundation</p>
                <p>This is an automated message. Please do not reply to this email.</p>
              </div>
            </div>
          </body>
        </html>`;
    const textBody = `Your mBHR verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nNever share this code with anyone. mBHR staff will never ask you for this code.\n\nIf you didn't request this code, please ignore this email.`;

    const sent = await sendWithResend(
      resendApiKey,
      email,
      "Your mBHR Verification Code",
      htmlBody,
      textBody,
    );
    if (!sent.ok) {
      return reply(500, { success: false, error: "Failed to send email" });
    }

    console.log("Email sent successfully:", sent.id ?? "n/a");
    return reply(200, { success: true, messageId: sent.id });
  } catch (error) {
    console.error("Error in send-otp-email:", errorName(error));
    return reply(500, {
      success: false,
      error: "The email could not be sent because of a server error.",
    });
  }
});
