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
      console.warn("Twilio credentials not configured. Running in demo mode.");
      console.log(`OTP for ${phone}: ${otp}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: "Demo mode: OTP logged to console",
          demo: true
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

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Twilio API error:", errorData);
      console.warn("Falling back to demo mode due to Twilio error");
      console.log(`Demo Mode - SMS OTP for ${phone}: ${otp}`);
      return new Response(
        JSON.stringify({
          success: true,
          demo: true,
          message: "Demo mode: OTP logged to console (Twilio error)"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();
    console.log("SMS sent successfully:", data.sid);

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
    console.error("Error in send-otp-sms:", error);
    const { phone, otp } = await req.json().catch(() => ({ phone: 'unknown', otp: 'unknown' }));
    console.log(`Demo Mode (error fallback) - OTP for ${phone}: ${otp}`);
    return new Response(
      JSON.stringify({
        success: true,
        demo: true,
        message: "Demo mode: OTP logged to console (error fallback)"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
