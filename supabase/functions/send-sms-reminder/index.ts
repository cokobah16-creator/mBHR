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
  provider?: string;
  error?: string;
  demo?: boolean;
}

async function sendViaTwilio(to: string, message: string): Promise<SMSResponse> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const phoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !phoneNumber) {
    return { success: false, error: "Twilio credentials not configured" };
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
    return { success: false, error: "Twilio delivery failed", provider: "twilio" };
  }

  const data = await response.json();
  return { success: true, messageId: data.sid, provider: "twilio" };
}

async function sendViaAfricasTalking(to: string, message: string): Promise<SMSResponse> {
  const apiKey = Deno.env.get("AT_API_KEY");
  const username = Deno.env.get("AT_USERNAME");
  const senderId = Deno.env.get("AT_SENDER_ID") || "mBHR";

  if (!apiKey || !username) {
    return { success: false, error: "Africa's Talking credentials not configured" };
  }

  const url = username === "sandbox"
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";

  const formData = new URLSearchParams({
    username: username,
    to: to,
    message: message,
    from: senderId,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "apiKey": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("Africa's Talking API error:", errorData);
    return { success: false, error: "Africa's Talking delivery failed", provider: "africastalking" };
  }

  const data = await response.json();
  const recipients = data.SMSMessageData?.Recipients || [];
  
  if (recipients.length > 0 && recipients[0].status === "Success") {
    return { 
      success: true, 
      messageId: recipients[0].messageId, 
      provider: "africastalking" 
    };
  }

  return { 
    success: false, 
    error: recipients[0]?.status || "Unknown error", 
    provider: "africastalking" 
  };
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

    const preferredProvider = Deno.env.get("SMS_PROVIDER") || "twilio";
    let result: SMSResponse;

    if (preferredProvider === "africastalking") {
      result = await sendViaAfricasTalking(to, message);
      if (!result.success && result.error?.includes("not configured")) {
        result = await sendViaTwilio(to, message);
      }
    } else {
      result = await sendViaTwilio(to, message);
      if (!result.success && result.error?.includes("not configured")) {
        result = await sendViaAfricasTalking(to, message);
      }
    }

    if (!result.success && result.error?.includes("not configured")) {
      console.warn("No SMS provider configured. Running in demo mode.");
      console.log(`SMS Demo - To: ${to}, Message: ${message}`);
      result = { success: true, demo: true, provider: "demo" };
    }

    console.log(`SMS ${result.success ? "sent" : "failed"} - Provider: ${result.provider}, To: ${to}, ReminderId: ${reminderId || "N/A"}`);

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 500,
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