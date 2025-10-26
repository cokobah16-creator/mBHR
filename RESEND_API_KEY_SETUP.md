# Resend API Key Setup - Quick Guide

Your Resend API Key: `re_YFFHp3sb_M2aWRcQfak5dsr9MsvU1UPJu`

## ✅ Edge Functions Status
- ✅ **send-otp-email** - ACTIVE
- ✅ **send-otp-sms** - ACTIVE

Both functions are deployed and ready to use your API key!

---

## Option 1: Supabase Dashboard (Easiest - 2 Minutes)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/functions

2. **Navigate to Edge Functions Secrets**
   - You should see "Edge Functions" in the settings
   - Look for the "Secrets" section
   - Or go directly to: https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/edge-functions

3. **Add the Secret**
   - Click "Add a new secret" or "New secret"
   - Enter:
     ```
     Name:  RESEND_API_KEY
     Value: re_YFFHp3sb_M2aWRcQfak5dsr9MsvU1UPJu
     ```
   - Click "Save" or "Add secret"

4. **Wait 30-60 seconds** for the edge functions to reload with the new secret

5. **Test It!**
   - Go to: `/admin/email-diagnostics` in your mBHR app
   - Send a test email to yourself
   - Check your inbox (and spam folder)

---

## Option 2: Supabase CLI (If Installed)

If you have the Supabase CLI installed and linked to your project:

```bash
# Navigate to your project directory
cd /tmp/cc-agent/57742079/project

# Set the secret
npx supabase secrets set RESEND_API_KEY=re_YFFHp3sb_M2aWRcQfak5dsr9MsvU1UPJu

# Verify it was set (shows names only, not values)
npx supabase secrets list
```

Expected output:
```
NAME               DIGEST
RESEND_API_KEY     XXXXXXXXXXXX
```

---

## Option 3: Manual Environment Variable (Development Only)

For local development testing, you can temporarily add it to `.env.local`:

```bash
# Create .env.local file
echo "RESEND_API_KEY=re_YFFHp3sb_M2aWRcQfak5dsr9MsvU1UPJu" > .env.local
```

**Note:** This only works for local testing. Production edge functions need the secret set via dashboard/CLI.

---

## ✅ Verification Steps

### Step 1: Check Edge Function Logs
1. Go to: https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/functions/send-otp-email/logs
2. Look for new invocations after setting the secret
3. Should see successful email sends (status 200)

### Step 2: Test Email Sending
1. In your mBHR app, go to: `/admin/email-diagnostics`
2. Enter your email address
3. Click "Send Test Email"
4. Expected result:
   ```
   ✅ Success!
   Email sent successfully
   Check your inbox for the test email
   ```

### Step 3: Test Patient Portal Login
1. Go to: `/patient/login`
2. Enter your email address: (your email)
3. Click "Continue"
4. Check your email for OTP code
5. Should receive a professional email from "mBHR Patient Portal <onboarding@resend.dev>"
6. Enter the 6-digit code
7. Access patient portal dashboard

---

## 🔍 Troubleshooting

### "Demo mode: OTP logged to console"
**Cause:** Edge function doesn't have the API key yet

**Fix:**
1. Verify you added `RESEND_API_KEY` (exact spelling, case-sensitive)
2. Wait 60 seconds for edge functions to reload
3. Try again
4. Check Supabase Edge Function logs for errors

---

### Email Not Arriving
**Check:**
1. ✉️ **Spam folder** - Check there first!
2. 📧 **Email address** - No typos?
3. ⏱️ **Wait 1-2 minutes** - Delivery can be delayed
4. 📊 **Resend Dashboard** - https://resend.com/dashboard/emails
   - Check delivery status
   - Look for errors
5. 📋 **Supabase Logs** - Check edge function execution logs

---

### "Failed to send email"
**Possible causes:**

1. **Invalid API Key**
   - Verify: `re_YFFHp3sb_M2aWRcQfak5dsr9MsvU1UPJu`
   - No extra spaces when pasting
   - Check Resend dashboard that key is active

2. **Rate Limit**
   - Free tier: 3,000 emails/month
   - Check usage in Resend dashboard
   - Wait or upgrade plan

3. **Network Issue**
   - Check Supabase status: https://status.supabase.com
   - Try again in a few minutes

---

## 📧 What Happens Next

Once the secret is set:

1. **Immediate Effect**
   - Edge functions automatically detect the API key
   - Demo mode turns off
   - Real emails start sending

2. **Patient Portal**
   - OTP codes sent via email (not shown in UI)
   - Professional branded emails
   - 6-digit codes valid for 5 minutes

3. **Security**
   - API key never exposed to client
   - Secure server-side sending only
   - Rate limiting built-in

---

## 📊 Email Stats & Monitoring

### Resend Dashboard
- Track all emails sent
- See delivery rates
- Monitor bounce/spam reports
- Check API usage

### Supabase Logs
- Real-time edge function execution
- Error tracking
- Performance monitoring

---

## 🎉 Success Checklist

- [ ] Secret added to Supabase Edge Functions
- [ ] Waited 60 seconds for reload
- [ ] Tested at `/admin/email-diagnostics` - email received
- [ ] Tested patient portal login - OTP received
- [ ] Emails arriving in inbox (not spam)
- [ ] No "demo mode" messages in UI

---

## Quick Reference

**Your API Key:** `re_YFFHp3sb_M2aWRcQfak5dsr9MsvU1UPJu`

**Secret Name:** `RESEND_API_KEY` (exactly as shown, case-sensitive)

**Dashboard URL:** https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/edge-functions

**Test URL:** `/admin/email-diagnostics`

**Expected Sender:** mBHR Patient Portal <onboarding@resend.dev>

---

**Estimated Time to Complete:** 2-3 minutes

Just add the secret via the dashboard, wait 60 seconds, and test! The system is ready to start sending real emails immediately.
