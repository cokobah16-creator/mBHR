# 🚀 Quick Start: Enable Email Invitations

## Status: Everything is Ready! ✅

Your patient portal email system is **fully functional** and waiting for the final step: adding the email API key.

---

## One-Time Setup (5 Minutes)

### 1️⃣ Create Free Resend Account
👉 Go to: **https://resend.com**
- Click "Sign Up"
- Use email or GitHub
- Verify your email
- **Free:** 3,000 emails/month

### 2️⃣ Get Your API Key
In Resend Dashboard:
- Click "API Keys"
- Click "Create API Key"
- Name: `mBHR Patient Portal`
- Permission: `Sending access`
- **Copy the key** (starts with `re_`)

### 3️⃣ Add to Supabase
👉 Go to: **https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/functions**
- Scroll to "Secrets"
- Click "Add a new secret"
- Name: `RESEND_API_KEY`
- Value: [paste your `re_...` key]
- Click "Add secret"
- ⏱️ Wait 60 seconds

### 4️⃣ Test It
In your app:
- Go to `/admin/email-diagnostics`
- Click "Send Test Email"
- Check your inbox
- Should say "Email Sent Successfully" ✅

---

## Send Invitation to Kristopher

1. Go to `/patients`
2. Click "Kristopher Okobah"
3. Scroll to "Patient Portal Access"
4. Click "Resend Portal Invitation"
5. ✅ Email sent to `cokobah16@gmail.com`

---

## Test Login Flow

1. Open `/patient/login`
2. Enter: `cokobah16@gmail.com`
3. Click "Continue"
4. Check email for OTP
5. Enter OTP code
6. ✅ Redirects to patient dashboard

---

## Current Status

**System:**
- ✅ Edge Functions deployed
- ✅ Database tables created
- ✅ Patient portal routes configured
- ✅ Email templates ready
- ⏳ Waiting for API key

**Kristopher's Account:**
- ✅ Portal enabled
- ✅ Email: `cokobah16@gmail.com`
- ✅ Portal user created
- ✅ Ready to receive invitation

---

## Troubleshooting

### Email not arriving?
1. Check spam folder
2. Verify `RESEND_API_KEY` is set in Supabase
3. Wait 60 seconds after adding key
4. Check `/admin/email-diagnostics` for status

### Still in "Demo Mode"?
1. Verify secret name is exactly: `RESEND_API_KEY`
2. Check you pasted the full API key (starts with `re_`)
3. Wait 60 seconds and test again

### Need help?
📖 See `EMAIL_SETUP_GUIDE.md` for detailed instructions
📖 See `SEND_INVITATION_INSTRUCTIONS.md` for invitation steps

---

## What Happens Next

Once API key is added:

1. **All invitations** sent automatically via email
2. **No code changes** needed
3. **Professional emails** with mBHR branding
4. **Secure OTP** codes expire in 10 minutes
5. **3,000 free emails** per month

---

## Quick Links

- **Email Diagnostics:** `/admin/email-diagnostics`
- **Patient Login:** `/patient/login`
- **Patients List:** `/patients`
- **Resend Dashboard:** [https://resend.com/emails](https://resend.com/emails)
- **Supabase Settings:** [https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/functions](https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/functions)

---

**Ready to go!** Just add the API key and start sending invitations. 🎉
