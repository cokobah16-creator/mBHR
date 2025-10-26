# How to Send Portal Invitation to Kristopher

## Method 1: Using the Patient Detail Page (Easiest)

1. **Log into mBHR** as an admin user
2. **Navigate to:** `/patients`
3. **Search for:** "Kristopher"
4. **Click** on his patient card
5. **Scroll down** to find the "Patient Portal Access" section
6. **Click** the button: "Send Portal Invitation" or "Resend Portal Invitation"
7. **Wait** for the success toast notification
8. **Email will be sent** to: `cokobah16@gmail.com`

---

## Method 2: Using Email Diagnostics Tool

1. **Navigate to:** `/admin/email-diagnostics`
2. **Enter email:** `cokobah16@gmail.com`
3. **Click:** "Send Test Email"
4. This sends a test OTP (123456) to verify the email system works
5. Once verified, use Method 1 to send the actual portal invitation

---

## Method 3: Using Browser Console (Advanced)

If you need to manually trigger the invitation:

1. **Open Browser Console** (F12 or Right-click → Inspect → Console)
2. **Paste this code:**

```javascript
// Import the portal enrollment service
import { sendPortalInvitation } from './src/services/portalEnrollment'

// Send invitation to Kristopher (patient ID: test_patient_001)
const result = await sendPortalInvitation('test_patient_001')

if (result.success) {
  console.log('✅ Invitation sent successfully!')
  if (result.demoOTP) {
    console.log('🔧 Demo OTP:', result.demoOTP)
  }
} else {
  console.error('❌ Failed to send invitation:', result.error)
}
```

---

## What Happens When Invitation is Sent

1. **System checks:**
   - Portal is enabled for patient ✅
   - Patient has email address ✅
   - Rate limiting allows sending ✅

2. **OTP Generation:**
   - 6-digit random code generated
   - Hashed and stored in database
   - Expires in 10 minutes

3. **Email Delivery:**
   - **With API Key:** Email sent via Resend to `cokobah16@gmail.com`
   - **Without API Key (Demo):** OTP logged to Supabase Edge Function logs

4. **Database Updated:**
   - `last_otp_sent_at` timestamp recorded
   - Invitation count incremented
   - Status set to "queued" or "sent"

---

## Verifying the Invitation was Sent

### Check in the App

1. Go to Kristopher's patient detail page
2. Look at "Patient Portal Access" section
3. You should see:
   - "Last Invitation: [timestamp]"
   - "Invitation Status: Sent"
   - Invitation count: 1+

### Check Email Inbox

1. Open email client for `cokobah16@gmail.com`
2. Look for email from "mBHR Patient Portal"
3. Subject: "Your mBHR Verification Code"
4. **Check spam folder if not in inbox!**

### Check Supabase Logs (If in Demo Mode)

1. Go to: [Supabase Dashboard](https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/functions/send-otp-email/logs)
2. Look for recent function invocations
3. Find log entry showing: `OTP for cokobah16@gmail.com: [6-digit code]`
4. Copy the OTP code to test login

### Check Resend Dashboard (If API Key Configured)

1. Go to: [Resend Dashboard](https://resend.com/emails)
2. Look for recent email to `cokobah16@gmail.com`
3. Check delivery status
4. View email preview if available

---

## Testing the Login Flow

Once invitation is sent:

1. **Open** `/patient/login` in a browser
2. **Enter email:** `cokobah16@gmail.com`
3. **Click** "Continue"
4. **System will:**
   - Check if account exists ✅
   - Generate new OTP
   - Send email (or log to console in demo mode)
5. **Check email** for OTP code
6. **Enter OTP** in the verification form
7. **Click** "Verify"
8. **Should redirect** to `/patient/dashboard`

---

## Troubleshooting

### Email Not Received

**Check:**
1. ✉️ Spam/junk folder
2. 📧 Email address is correct (no typos)
3. ⏱️ Wait 1-2 minutes (delivery can be delayed)
4. 🔑 RESEND_API_KEY is configured in Supabase
5. 📋 Check Supabase Edge Function logs for errors

**If still not working:**
1. Use Email Diagnostics tool to test
2. Verify API key is correct
3. Check Resend dashboard for delivery status
4. Try sending to a different email address

### "Account Not Found" Error

**Cause:** Portal user account doesn't exist

**Solution:**
1. Go to patient detail page
2. Make sure "Portal Access" is enabled
3. System should automatically create portal user
4. Try sending invitation again

### "Rate Limit Exceeded" Error

**Cause:** Too many OTP requests in short time

**Solution:**
1. Wait 60 seconds
2. Try sending invitation again
3. Rate limit: 1 request per minute per user

### "Demo Mode" Message in Diagnostics

**Cause:** RESEND_API_KEY not configured

**Solution:**
1. Follow Step 2 in main instructions
2. Add API key to Supabase secrets
3. Wait 60 seconds
4. Test again

---

## Expected Timeline

| Action | Expected Time |
|--------|--------------|
| Configure Resend account | 2 minutes |
| Add API key to Supabase | 1 minute |
| Edge Functions reload | 30-60 seconds |
| Test email delivery | 1 minute |
| Send invitation | 5 seconds |
| Email delivery | 10-60 seconds |
| **Total Time** | **~5-10 minutes** |

---

## Success Indicators

You'll know everything is working when:

1. ✅ Email Diagnostics shows "Email Sent Successfully"
2. ✅ Test email arrives in inbox
3. ✅ Portal invitation email arrives for Kristopher
4. ✅ Kristopher can login with OTP from email
5. ✅ Kristopher sees patient dashboard after login

---

## Quick Reference

**Kristopher's Details:**
- Name: Kristopher Okobah
- Email: `cokobah16@gmail.com`
- Phone: `+2341234567890`
- Patient ID: `test_patient_001`
- Portal Status: Enabled

**Important URLs:**
- Email Diagnostics: `/admin/email-diagnostics`
- Patient Login: `/patient/login`
- Patient List: `/patients`
- Supabase Dashboard: [https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv](https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv)
- Resend Dashboard: [https://resend.com/emails](https://resend.com/emails)

---

**Need help?** Check the full `EMAIL_SETUP_GUIDE.md` for detailed troubleshooting!
