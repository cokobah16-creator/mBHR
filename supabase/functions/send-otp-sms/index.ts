import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OTPRequest {
  phone: string;
  otp: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { phone, otp }: OTPRequest = await req.json();

    if (!phone || !otp) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone and OTP are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      const missing = [];
      if (!twilioAccountSid) missing.push("TWILIO_ACCOUNT_SID");
      if (!twilioAuthToken) missing.push("TWILIO_AUTH_TOKEN");
      if (!twilioPhoneNumber) missing.push("TWILIO_PHONE_NUMBER");

      return new Response(
        JSON.stringify({
          success: false,
          error: `Missing Twilio secrets: ${missing.join(", ")}`
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const message = `Your mBHR verification code is: ${otp}. This code will expire in 10 minutes. Do not share this code with anyone.`;

    const auth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;

    const formData = new URLSearchParams({
      To: phone,
      From: twilioPhoneNumber,
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

    const responseData = await response.json();

    if (!response.ok) {
      console.error("Twilio API error:", JSON.stringify(responseData));
      return new Response(
        JSON.stringify({
          success: false,
          error: responseData.message || "Twilio API error",
          code: responseData.code
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("SMS sent successfully:", responseData.sid);

    return new Response(
      JSON.stringify({
        success: true,
        messageId: responseData.sid
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in send-otp-sms:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
