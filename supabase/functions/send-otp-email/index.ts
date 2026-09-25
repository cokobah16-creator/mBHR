import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import {
  getServiceClient,
  requireStaff,
} from "../_shared/security/staffAuth.ts";
import { validEmailAddress, validOtp } from "../_shared/security/recipient.ts";
import { escapeHtml, textToHtml } from "../_shared/security/html.ts";

// Sends one patient portal email through Resend for a signed-in staff member.
//
// Two modes:
//   { email, subject, message }  portal invitation, sent by
//                                src/services/portalEnrollment.ts
//   { email, otp }               sample sign-in code, sent by the admin email
//                                delivery check
//                                (src/pages/admin/EmailDiagnostics.tsx)
//
// Who may call it. requireStaff reads the caller's role from app_users; a
// role in the token or the body is never trusted, and the anon key gets 401.
//
// - Message mode: INVITE_SENDER_ROLES. The app offers "Send portal
//   invitation" (src/components/PortalStatusCard.tsx) to roles with the
//   "register" permission. On the server the same roles hold "portal_manage"
//   (app_role_has_permission in
//   supabase/migrations/20260925100000_sync_authority_foundation.sql):
//   volunteer, nurse, doctor, lead_clinician and admin. Bulk enrolment
//   (src/pages/admin/PortalMigration.tsx) is admin-only, which is inside
//   that list. Pharmacist, auditor and guest cannot send invitations in the
//   app, so they cannot send them here.
// - OTP mode: OTP_SENDER_ROLES, admin only. Its one caller is the email
//   delivery check at /admin/email-diagnostics, which App.tsx limits to
//   admin. No patient flow sends email codes: patient self-service OTP
//   (requestOTP in src/services/patientPortalAuth.ts) is a disabled stub.
//   The code must be 4 to 8 digits.
//
// Content: every value placed in the HTML body is escaped (html.ts). The
// text body stays plain. The recipient must be one plain email address. The
// subject is one line of at most 200 characters, the message at most 5000.
//
// Rate limit: 10 requests a minute per IP address, checked before sign-in.
//
// Logs never contain the address, the code, the subject, the message or the
// caller.

const INVITE_SENDER_ROLES: readonly string[] = [
  "volunteer",
  "nurse",
  "doctor",
  "lead_clinician",
  "admin",
];

const OTP_SENDER_ROLES: readonly string[] = ["admin"];

const ANY_SENDER_ROLES: readonly string[] = [
  ...new Set([...INVITE_SENDER_ROLES, ...OTP_SENDER_ROLES]),
];

// requireStaff's own messages talk about SMS; these replace them. 403 also
// covers a deactivated account or one missing from app_users, so the
// message names the account, not only the role.
const AUTH_MESSAGES: Record<string, string> = {
  not_authenticated:
    "Sign in online with a staff account to send email. A PIN unlock is not enough.",
  not_permitted: "Your staff account cannot send this email.",
};

// The invitation from portalEnrollment.ts has a 33-character subject and a
// message of about 500 characters; these limits leave plenty of room.
const MAX_SUBJECT_CHARS = 200;
const MAX_MESSAGE_CHARS = 5000;

interface EmailRequest {
  email?: unknown;
  otp?: unknown;
  subject?: unknown;
  message?: unknown;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Resend's error name ("validation_error"), never its message text. */
async function resendErrorName(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { name?: unknown };
    const name = typeof body?.name === "string" ? body.name : "";
    return /^[A-Za-z_]{1,64}$/.test(name) ? name : "unknown";
  } catch {
    return "unknown";
  }
}

function plainText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text ? text : null;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const reply = (
    status: number,
    body: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) =>
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
    const service = getServiceClient();

    // 1. Who is calling?
    const auth = await requireStaff(req, service, ANY_SENDER_ROLES);
    if (!auth.ok) {
      return reply(auth.status, {
        success: false,
        error: auth.error,
        message: AUTH_MESSAGES[auth.error] ?? auth.message,
      });
    }

    // 2. What are they asking for?
    let body: EmailRequest;
    try {
      body = (await req.json()) as EmailRequest;
    } catch {
      return reply(400, {
        success: false,
        error: "invalid_request",
        message: "The request body must be JSON.",
      });
    }
    if (!body || typeof body !== "object") {
      return reply(400, {
        success: false,
        error: "invalid_request",
        message: "The request body must be a JSON object.",
      });
    }

    const email = validEmailAddress(body.email);
    if (!email) {
      return reply(400, {
        success: false,
        error: "invalid_email",
        message: "Send one email address, like name@example.com.",
      });
    }

    const isOtpMode =
      body.otp !== undefined && body.otp !== null && body.otp !== "";
    let otp: string | null = null;
    let subject: string | null = null;
    let message: string | null = null;

    if (isOtpMode) {
      if (!OTP_SENDER_ROLES.includes(auth.role)) {
        return reply(403, {
          success: false,
          error: "not_permitted",
          message: "Only an administrator can send a sign-in code email.",
        });
      }
      otp = validOtp(body.otp);
      if (!otp) {
        return reply(400, {
          success: false,
          error: "invalid_otp",
          message: "A 4 to 8 digit code is required.",
        });
      }
    } else {
      if (!INVITE_SENDER_ROLES.includes(auth.role)) {
        return reply(403, {
          success: false,
          error: "not_permitted",
          message: AUTH_MESSAGES.not_permitted,
        });
      }
      const rawSubject = plainText(body.subject);
      // A subject is one line.
      subject = rawSubject ? rawSubject.replace(/\s*[\r\n]+\s*/g, " ") : null;
      message = plainText(body.message);
      if (!subject || !message) {
        return reply(400, {
          success: false,
          error: "content_required",
          message: "Send either otp, or both subject and message.",
        });
      }
      if (
        subject.length > MAX_SUBJECT_CHARS ||
        message.length > MAX_MESSAGE_CHARS
      ) {
        return reply(400, {
          success: false,
          error: "content_too_long",
          message: `The subject can be up to ${MAX_SUBJECT_CHARS} characters and the message up to ${MAX_MESSAGE_CHARS}.`,
        });
      }
    }

    const mode = otp ? "sign-in code" : "invitation";
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const senderEmail = Deno.env.get("SENDER_EMAIL");

    if (!resendApiKey) {
      // Nothing identifying: no address, code, subject, message or caller.
      console.warn(
        `send-otp-email demo mode: RESEND_API_KEY is not set, so the ${mode} email was not sent.`,
      );
      return reply(200, {
        success: true,
        demo: true,
        message: "Demo mode: RESEND_API_KEY is not set, so no email was sent.",
      });
    }

    const fromEmail = senderEmail || "onboarding@resend.dev";

    let emailSubject: string;
    let htmlBody: string;
    let textBody: string;

    if (otp) {
      emailSubject = "Your mBHR Verification Code";
      htmlBody = `
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
      textBody = `Your mBHR verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nNever share this code with anyone. mBHR staff will never ask you for this code.\n\nIf you didn't request this code, please ignore this email.`;
    } else {
      emailSubject = subject!;
      htmlBody = `
        <!DOCTYPE html>
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
              <div class="content">${textToHtml(message)}</div>
              <div class="footer">
                <p>Med Bridge Health Reach | Dr. Isioma Okobah Foundation</p>
                <p>This is an automated message. Please do not reply to this email.</p>
              </div>
            </div>
          </body>
        </html>`;
      textBody = message!;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `mBHR Patient Portal <${fromEmail}>`,
        to: [email],
        subject: emailSubject,
        html: htmlBody,
        text: textBody,
      }),
    });

    if (!response.ok) {
      // Resend's message text can quote the address, so log only the status
      // and the error name.
      console.error(
        `send-otp-email: Resend refused the ${mode} email: HTTP ${response.status} (${await resendErrorName(response)})`,
      );
      return reply(500, { success: false, error: "Failed to send email" });
    }

    const data = (await response.json()) as { id?: unknown };
    const messageId = typeof data?.id === "string" ? data.id : undefined;
    console.log(
      `send-otp-email: ${mode} email accepted by Resend, ID: ${messageId ?? "n/a"}`,
    );

    return reply(200, { success: true, messageId });
  } catch (error) {
    console.error("Error in send-otp-email:", errorName(error));
    return reply(500, { success: false, error: "internal_error" });
  }
});
