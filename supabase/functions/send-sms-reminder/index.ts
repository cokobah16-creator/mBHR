import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SMSRequest {
  to: string;
  message: string;
  reminderId?: string;
}

interface SMSResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  demo?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { to, message, reminderId }: SMSRequest = await req.json();

    if (!to || !message) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone number and message are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const phoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!accountSid || !authToken || !phoneNumber) {
      console.warn("Twilio credentials not configured. Running in demo mode.");
      console.log(`SMS Demo - To: ${to}, Message: ${message}, ReminderId: ${reminderId || "N/A"}`);

      return new Response(
        JSON.stringify({
          success: true,
          demo: true,
          message: "Demo mode: Check server logs for SMS"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const auth = btoa(`${accountSid}:${authToken}`);
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const formData = new URLSearchParams({
      To: to,
      From: phoneNumber,
      Body: message,
    });

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Twilio API error:", errorData);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to send SMS"
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();
    console.log(`SMS sent successfully - To: ${to}, SID: ${data.sid}, ReminderId: ${reminderId || "N/A"}`);

    return new Response(
      JSON.stringify({
        success: true,
        messageId: data.sid
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in send-sms-reminder:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
