# Edge Function Secrets Setup Guide

## Current Status: ✅ Working in Demo Mode

Once deployed, the edge functions work in demo mode. The behaviour below is that of the current `send-otp-email`; deploy it with the Database migrations workflow (`apply`) or `supabase functions deploy send-otp-email`. No secrets are required for testing!

### Demo Mode Features

This section is about email (`send-otp-email`).

- ✅ The function answers with `"success": true, "demo": true`
- ✅ No email is sent and no external API is called
- ✅ The logs say only that demo mode ran. They never contain the address, the code or the invitation's text
- ✅ Fine for development and testing

### How Demo Mode Works

When `RESEND_API_KEY` is not set:

1. A staff member signed in online sends a portal invitation from a patient record, or an admin sends the test on `/admin/email-diagnostics`. The function refuses anyone not signed in online, even in demo mode. A PIN unlock is not enough.
2. The function checks the request, then finds no Resend key
3. It sends nothing and returns success with the `demo: true` flag
4. It logs a demo mode notice with nothing that identifies the patient

No patient flow emails a sign-in code. Patients get an invitation with a registration link, register with their date of birth and a password, and log in at `/patient/login` with their email and password.

**To test demo mode:**

1. Sign in online as an admin, with your email and password
2. Go to `/admin/email-diagnostics`
3. Send a test email
4. The page says demo mode is on and no email was sent

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

1. Staff can turn on portal access and share registration links by hand
2. No email is sent, and no codes appear in the logs
3. Fine for UAT and development

### For Small Pilot (Week 1-2)

Recommended: **Resend only** ($0)

- Set up free Resend account
- Configure `RESEND_API_KEY`
- Send portal invitations by email. Patients with no email get an SMS invitation only once an SMS provider is set up too; until then staff share the registration link
- 3,000 emails/month free

### For Production Launch

Recommended: **Resend + Twilio** (~$15-20/month)

- Resend for portal invitation emails
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

What `send-otp-email` does today:

- Sends only for a staff member signed in online, with a role allowed to send that email
- At most 10 requests a minute from one IP address
- One plain recipient address per request

See `docs/deployment/EMAIL_SETUP_GUIDE.md` for who may call it and what it answers.

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
   - Send portal invitations by email first
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
- Email invitations only
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
