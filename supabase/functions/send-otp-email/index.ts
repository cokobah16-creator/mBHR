import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";

interface EmailRequest {
  email: string;
  otp?: string;
  subject?: string;
  message?: string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const rl = await enforceRateLimit(req, {
    bucket: "edge_otp_email",
    keyStrategy: "ip",
    max: 10,
    windowSeconds: 60,
  });
  if (!rl.allowed && rl.response) {
    return new Response(rl.response.body, {
      status: rl.response.status,
      headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) },
    });
  }

  try {
    const { email, otp, subject, message }: EmailRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: "Email is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const isOtpMode = !!otp;
    const isMessageMode = !!(subject && message);

    if (!isOtpMode && !isMessageMode) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Either otp or subject+message are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // OTP-mode sends are internal-only: codes are minted by the portal-otp
    // function (service role). Accepting client-supplied codes would let any
    // caller email forged "verification codes" to arbitrary addresses.
    // Message mode (invitations) remains available to app callers.
    if (isOtpMode) {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const authHeader = req.headers.get("Authorization") || "";
      if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "OTP sends are internal. Request a code via portal-otp/issue.",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const senderEmail = Deno.env.get("SENDER_EMAIL");

    if (!resendApiKey) {
      console.warn("RESEND_API_KEY not configured. Running in demo mode.");
      if (isOtpMode) {
        console.log(`Demo Mode - Email OTP for ${email}: ${otp}`);
      } else {
        console.log(`Demo Mode - Invitation email to ${email}: ${subject}`);
      }
      console.log(
        "To enable real email delivery, add RESEND_API_KEY to Edge Function secrets",
      );

      return new Response(
        JSON.stringify({
          success: true,
          demo: true,
          message: "Demo mode: Check server logs",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const fromEmail = senderEmail || "onboarding@resend.dev";

    let emailSubject: string;
    let htmlBody: string;
    let textBody: string;

    if (isOtpMode) {
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
                <div class="otp-code">${otp}</div>
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
      const htmlMessage = message!.replace(/\n/g, "<br>");
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
              <div class="content">${htmlMessage}</div>
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
      const errorData = await response.text();
      console.error("Resend API error:", errorData);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send email" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await response.json();
    console.log("Email sent successfully:", data.id);

    return new Response(JSON.stringify({ success: true, messageId: data.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-otp-email:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
