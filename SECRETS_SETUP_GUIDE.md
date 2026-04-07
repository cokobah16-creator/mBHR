# Edge Function Secrets Setup Guide

## Current Status: ✅ Working in Demo Mode

The edge functions are **already deployed and working** in demo mode. No secrets are required for testing!

### Demo Mode Features

- ✅ Edge functions respond successfully
- ✅ OTP codes are logged to Supabase Edge Function logs
- ✅ No external API calls required
- ✅ Perfect for development and testing

### How Demo Mode Works

When secrets are not configured:

1. Patient requests OTP via phone or email
2. Edge function generates the OTP
3. Instead of sending SMS/Email, it logs: `OTP for [contact]: [code]`
4. Returns success response with `demo: true` flag
5. Developer views OTP in Supabase Function Logs

**To test demo mode:**

1. Go to patient portal: `/patient`
2. Click "Create Account" or "Login"
3. Enter phone/email
4. Check Supabase Dashboard → Edge Functions → Logs
5. Copy the OTP from logs
6. Paste into verification form

---

## Production Setup: Configuring Real OTP Delivery

When you're ready to send real SMS and emails, follow these steps:

### Option 1: SMS via Twilio (Recommended for Global)

#### 1. Create Twilio Account

```
Visit: https://www.twilio.com/try-twilio
- Sign up for free trial ($15 credit)
- Verify your email and phone
```

#### 2. Get Credentials

```
In Twilio Console:
1. Navigate to: Console Dashboard
2. Copy "Account SID"
3. Copy "Auth Token"
4. Go to Phone Numbers → Buy a Number
5. Copy your Twilio phone number (format: +1234567890)
```

#### 3. Set Secrets in Supabase

```bash
# Navigate to: Supabase Dashboard → Edge Functions → send-otp-sms

# Add these secrets:
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
```

#### Cost

- Free trial: $15 credit (~500 SMS messages)
- Production: $0.0075 per SMS for Nigeria
- Monthly: ~$1-2 for 200-300 messages

---

### Option 2: SMS via Africa's Talking (Recommended for Africa)

#### 1. Create Account

```
Visit: https://africastalking.com
- Sign up for account
- Verify your business
- Add credit (starts at $10)
```

#### 2. Get Credentials

```
In Dashboard:
1. Go to Settings → API Key
2. Copy your API Key
3. Copy your Username
```

#### 3. Update Edge Function

Replace the SMS function with Africa's Talking code:

```typescript
// In send-otp-sms/index.ts
const africasTalkingApiKey = Deno.env.get("AFRICAS_TALKING_API_KEY");
const africasTalkingUsername = Deno.env.get("AFRICAS_TALKING_USERNAME");

const formData = new URLSearchParams({
  username: africasTalkingUsername,
  to: phone,
  message: message,
});

const response = await fetch(
  "https://api.africastalking.com/version1/messaging",
  {
    method: "POST",
    headers: {
      apiKey: africasTalkingApiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  },
);
```

#### 4. Set Secrets

```bash
AFRICAS_TALKING_API_KEY=your_api_key_here
AFRICAS_TALKING_USERNAME=your_username
```

#### Cost

- Minimum credit: $10
- Nigeria SMS: ~$0.03 per message
- Monthly: ~$6-9 for 200-300 messages

---

### Email via Resend (Recommended)

#### 1. Create Resend Account

```
Visit: https://resend.com
- Sign up (free tier: 3,000 emails/month)
- Verify your email
```

#### 2. Get API Key

```
In Resend Dashboard:
1. Go to API Keys
2. Click "Create API Key"
3. Name it: "mBHR Production"
4. Copy the API key (starts with re_...)
```

#### 3. Configure Domain (Optional but Recommended)

```
For professional emails from your domain:
1. Add your domain in Resend
2. Add DNS records provided by Resend
3. Verify domain
4. Update "from" address in function
```

#### 4. Set Secret

```bash
# In Supabase Dashboard → Edge Functions → send-otp-email
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

#### Cost

- Free tier: 3,000 emails/month
- More than enough for most medical outreach programs
- Pro plan: $20/month for 50,000 emails (if needed later)

---

## Quick Start Guide

### For Testing (Now - Free)

✅ **No setup needed!** Just use demo mode:

1. Patient portal works immediately
2. Check Supabase logs for OTP codes
3. Perfect for UAT and development

### For Small Pilot (Week 1-2)

Recommended: **Resend only** ($0)

- Set up free Resend account
- Configure `RESEND_API_KEY`
- Use email OTP only
- 3,000 emails/month free

### For Production Launch

Recommended: **Resend + Twilio** (~$15-20/month)

- Resend for email OTP
- Twilio for SMS OTP
- Covers ~500 patients/month
- Scale as needed

---

## Testing Your Setup

### 1. Test Demo Mode (Current)

```bash
# No secrets needed!
curl -X POST https://your-project.supabase.co/functions/v1/send-otp-sms \
  -H "Content-Type: application/json" \
  -d '{"phone":"+2348012345678","otp":"123456"}'

# Check response - should see: "demo": true
# Check Supabase logs for the OTP
```

### 2. Test With Real Credentials

```bash
# After setting secrets, same request:
curl -X POST https://your-project.supabase.co/functions/v1/send-otp-sms \
  -H "Content-Type: application/json" \
  -d '{"phone":"+2348012345678","otp":"123456"}'

# Should receive actual SMS
# Response won't have "demo" flag
```

---

## Security Best Practices

### 1. Secret Management

- ✅ Never commit secrets to Git
- ✅ Use Supabase Dashboard to set secrets
- ✅ Rotate API keys every 90 days
- ✅ Use separate keys for staging/production

### 2. Rate Limiting

Already implemented in the code:

- Max 3 OTP requests per 15 minutes
- Account lockout after 5 failed attempts
- Prevents abuse and reduces costs

### 3. Monitoring

Set up alerts for:

- High SMS/email volume (possible abuse)
- Failed delivery rates (API issues)
- Unusual patterns (security concerns)

---

## Troubleshooting

### "Demo mode" message appears in production

**Cause:** Secrets not set correctly
**Fix:** Verify secrets in Supabase Dashboard → Edge Functions → Environment Variables

### SMS not received

**Check:**

1. Phone number format: Must include country code (+234...)
2. Twilio account funded
3. Check Twilio logs for delivery status
4. Verify recipient can receive SMS from international numbers

### Email not received

**Check:**

1. Spam folder
2. Email address valid
3. Resend account verified
4. Check Resend dashboard for delivery status

### Function logs show errors

**Common issues:**

1. Invalid API credentials - Double-check secrets
2. Rate limiting - Wait and try again
3. Account not funded - Add credit to provider

---

## Cost Optimization Tips

1. **Email First Strategy**
   - Use email OTP as primary method
   - SMS as fallback for users without email
   - Saves ~90% on messaging costs

2. **Batch Operations**
   - Send appointment reminders via email
   - Reserve SMS for urgent notifications
   - Use in-app notifications when possible

3. **Monitor Usage**
   - Track OTP requests per day
   - Identify and block abuse
   - Optimize based on patterns

4. **Provider Selection**
   - Nigeria: Africa's Talking often cheaper
   - Global: Twilio more reliable
   - Email: Resend free tier sufficient

---

## Migration Path

### Phase 1: Testing (Current - Free)

- ✅ Use demo mode
- ✅ Test all flows
- ✅ Train staff
- ✅ UAT with 5-10 patients

### Phase 2: Soft Launch (Week 1 - $0-10)

- Set up Resend (free)
- Email OTP only
- 20-50 patients
- Collect feedback

### Phase 3: Production (Week 2+ - $15-30/month)

- Add Twilio/Africa's Talking
- Enable SMS OTP
- Full patient onboarding
- Scale as needed

---

## Support

### Get Help With:

**Twilio:**

- Docs: https://www.twilio.com/docs/sms
- Support: support@twilio.com

**Africa's Talking:**

- Docs: https://developers.africastalking.com
- Support: support@africastalking.com

**Resend:**

- Docs: https://resend.com/docs
- Support: support@resend.com

**Edge Functions:**

- Check Supabase Dashboard logs
- Review function code
- Test with curl commands

---

## Summary

🎉 **You can start testing NOW without any setup!**

The patient portal works immediately in demo mode. When you're ready for production:

1. **Minimal Setup:** Just Resend ($0/month)
2. **Recommended Setup:** Resend + Twilio ($15-20/month)
3. **Full Setup:** Add Africa's Talking for better African coverage

No urgency to configure these - demo mode is perfect for initial testing and user acceptance testing!
