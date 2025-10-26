# Resend API Setup Guide

This guide will help you configure email delivery for the patient portal OTP system.

## Current Status

The patient portal is fully functional and working in **demo mode**. OTP codes are being generated but not sent via email. Instead, they are displayed in the UI for testing.

To enable real email delivery, you need to add your Resend API key to Supabase.

---

## Quick Setup (5 Minutes)

### Step 1: Get Your Resend API Key

You mentioned you already have a Resend account. Great! Now:

1. Log into your Resend Dashboard: https://resend.com/dashboard
2. Click **"API Keys"** in the left sidebar
3. Click **"Create API Key"** button
4. Configure:
   - **Name:** `mBHR Patient Portal`
   - **Permission:** Select **"Sending access"**
   - **Domain:** Leave as "All Domains"
5. Click **"Create"**
6. **COPY THE KEY NOW** (starts with `re_`) - You won't see it again!

Example key format: `re_123abc456def789ghi012jkl345mno678pqr`

---

### Step 2: Add API Key to Supabase

#### Option A: Supabase Dashboard (Recommended - Easiest)

1. Open **Supabase Dashboard**: https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv
2. Go to **Settings** (⚙️ icon in left sidebar)
3. Click **"Edge Functions"** tab
4. Scroll down to **"Secrets"** section
5. Click **"Add a new secret"**
6. Enter:
   ```
   Name:  RESEND_API_KEY
   Value: [paste your re_xxx key here]
   ```
7. Click **"Add secret"**
8. **Wait 30-60 seconds** for Edge Functions to reload
9. ✅ Done!

#### Option B: Supabase CLI (If you have it installed)

```bash
# Navigate to your project directory
cd /path/to/mBHR

# Set the secret
npx supabase secrets set RESEND_API_KEY=re_your_actual_key_here

# Verify it was set (lists names only, not values)
npx supabase secrets list
```

---

### Step 3: Test Email Delivery

1. Go to: `/admin/email-diagnostics` in your mBHR app
2. Enter your email address in the test field
3. Click **"Send Test Email"**
4. Check your email inbox (and spam folder!)
5. Verify you received a professional email with:
   - mBHR branding
   - 6-digit OTP code
   - Security warnings
   - Professional formatting

**If successful:** The diagnostic tool will show "Email Sent Successfully" instead of "Demo Mode Active"

---

### Step 4: Verify Patient Portal Login

1. Go to `/patient/login`
2. Enter an email address (yours for testing)
3. Click **"Continue"**
4. Check your email for the OTP code
5. Enter the code to complete login
6. Verify access to patient portal dashboard

---

## Email Configuration

### Sender Address

The system is currently configured to use `onboarding@resend.dev` as the sender address. This works immediately with no additional setup!

**Emails will show as from:**
```
mBHR Patient Portal <onboarding@resend.dev>
```

### Using Your Own Domain (Optional - For Production)

For professional emails from your own domain (e.g., `noreply@mbhr.health`):

1. In Resend Dashboard, go to **"Domains"**
2. Click **"Add Domain"**
3. Enter your domain (e.g., `mbhr.health`)
4. Follow the DNS verification steps:
   - Add the provided DNS records to your domain
   - Wait for verification (usually 5-10 minutes)
5. Once verified, add the sender email to Supabase:

**Via Dashboard:**
- Settings → Edge Functions → Secrets → Add:
- Name: `SENDER_EMAIL`
- Value: `noreply@mbhr.health`

**Via CLI:**
```bash
npx supabase secrets set SENDER_EMAIL=noreply@mbhr.health
```

---

## Troubleshooting

### Problem: "Demo mode: OTP logged to console"

**Cause:** API key not detected by Edge Function

**Solution:**
1. Verify you added `RESEND_API_KEY` secret to Supabase
2. Check the secret name is exactly: `RESEND_API_KEY` (case-sensitive)
3. Wait 30-60 seconds for Edge Function to reload
4. Try the login flow again
5. Check Supabase Edge Function logs for any errors

---

### Problem: Email not arriving

**Check:**
1. ✉️ **Spam/Junk folder** - Check there first!
2. 📧 **Email address correct** - Verify no typos
3. ⏱️ **Wait 1-2 minutes** - Delivery can take time
4. 📝 **Resend Dashboard** - Check delivery status:
   - Go to: Resend Dashboard → Emails
   - Look for your test email
   - Check status and any error messages
5. 📋 **Supabase Logs** - Check Edge Function logs:
   - Go to: Dashboard → Edge Functions → send-otp-email → Logs
   - Look for successful sends or error messages

---

### Problem: "Failed to send email"

**Possible Causes & Solutions:**

#### 1. Invalid API Key
- Verify you copied the full key (starts with `re_`)
- Make sure no spaces were added when pasting
- Generate a new key if needed

#### 2. Rate Limit Exceeded
- Free tier: 3,000 emails per month
- Check Resend dashboard for usage
- Wait until next month or upgrade plan

---

## Session Management

### Session Durations Configured

**Staff Users:**
- Duration: 12 hours with activity-based extension
- Idle Timeout: 30 minutes of inactivity
- Warning: 5 minutes before expiration
- Maximum: 24 hours absolute

**Patient Portal Users:**
- Duration: 4 hours with activity-based extension
- Idle Timeout: 30 minutes of inactivity
- Warning: 5 minutes before expiration
- Maximum: 8 hours absolute

### Session Features

✅ **Automatic Refresh** - Sessions extend while user is active
✅ **Warning Dialogs** - Users get 5-minute warning before expiration
✅ **Activity Tracking** - Mouse, keyboard, scroll, and touch events extend session
✅ **Graceful Expiration** - Clear messages and redirect to login
✅ **Security First** - Healthcare-appropriate session timeouts

---

## What's Included in This Update

### Session Management
- ✅ Staff session manager with 12-hour duration
- ✅ Patient session manager with 4-hour duration
- ✅ Automatic session refresh before expiration
- ✅ Activity tracking to extend active sessions
- ✅ Warning dialogs 5 minutes before expiration
- ✅ Session status indicator in header (when < 10 minutes remaining)
- ✅ Graceful logout on session expiration

### Email Delivery
- ✅ Resend API integration ready
- ✅ Just needs API key added to Supabase secrets
- ✅ Professional HTML email templates
- ✅ Demo mode for testing without API key
- ✅ Diagnostics tool at `/admin/email-diagnostics`

---

## Support

### Resend Support
- **Documentation:** https://resend.com/docs
- **Status Page:** https://status.resend.com
- **Email Support:** support@resend.com

### Supabase Support
- **Edge Functions Docs:** https://supabase.com/docs/guides/functions
- **Secrets Management:** https://supabase.com/docs/guides/functions/secrets
- **Community:** https://github.com/supabase/supabase/discussions

---

## Summary

**To enable email delivery:**
1. Get your Resend API key from the dashboard
2. Add it as `RESEND_API_KEY` secret in Supabase
3. Wait 30-60 seconds
4. Test at `/admin/email-diagnostics`

**Total Time:** ~5 minutes

**Session management is already active** and working for both staff and patient users!

---

**Questions?** Test the email delivery at `/admin/email-diagnostics` after adding your API key.
