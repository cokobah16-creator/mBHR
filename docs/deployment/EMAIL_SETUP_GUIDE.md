# Email Setup Guide for Patient Portal Invitations

## Current Status

Patient portal email is sent by the `send-otp-email` Edge Function through Resend.

Until the `RESEND_API_KEY` secret is set, the function runs in **demo mode**: it sends no email and answers `{"success": true, "demo": true}`. It logs only that it ran in demo mode. It never logs the address, the code, the subject or the message.

When no email is sent, the patient record still gives staff a registration link to share by hand.

---

## Quick Diagnosis

### Access the Diagnostics Tool

1. Sign in online to your mBHR app as an admin, with your email and password. A PIN unlock is not enough: the function refuses callers who are not signed in online.
2. Navigate to: `/admin/email-diagnostics`
3. Click "Send Test Email" to verify current status
4. The tool will show if you're in demo mode or if emails are being sent

---

## Who Can Call the Function

`send-otp-email` sends email only for a staff member signed in online. The app calls it with `supabase.functions.invoke`, which sends the signed-in person's access token. After a PIN unlock there is no online sign-in, so the app sends the public anon key, and the function answers 401.

| Request body | Who may send it | Sent by |
|---|---|---|
| `{ "email", "subject", "message" }` (portal invitation) | volunteer, nurse, doctor, lead_clinician, admin | "Send portal invitation" on a patient record, and bulk enrolment at `/admin/portal-migration` |
| `{ "email", "otp" }` (sample sign-in code) | admin | The test on `/admin/email-diagnostics` |

The role is read from `app_users` on the server. A role in the token or the request is ignored. No patient-facing flow calls this function.

The function answers:

- **401 `not_authenticated`:** no online sign-in, an expired one, or the anon key.
- **403 `not_permitted`:** the role may not send this email, or the account is deactivated or missing from `app_users`.
- **400:** `email` is not one plain address, `otp` is not 4 to 8 digits, `subject` or `message` is missing, or the subject is longer than 200 characters or the message longer than 5000.
- **429 `rate_limited`:** more than 10 requests in a minute from one IP address.

Every value placed in the HTML email (the code and the message) is escaped, so it shows as text and cannot add HTML such as link tags, images or scripts. The plain-text part is sent as written.

To call it by hand, use the access token of a staff user signed in online, not the anon key:

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-otp-email \
  -H "Authorization: Bearer STAFF_USER_ACCESS_TOKEN" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "otp": "123456"}'
```

The `otp` request needs an admin's token.

---

## 5-Minute Setup: Enable Real Email Sending

### Step 1: Create a Free Resend Account (2 minutes)

1. **Go to:** [https://resend.com](https://resend.com)
2. **Click:** "Get Started" or "Sign Up"
3. **Sign up with:**
   - Your email address, OR
   - GitHub account (faster)
4. **Verify** your email
5. **Complete** the quick onboarding

**Free Tier Benefits:**

- ✅ 3,000 emails per month
- ✅ No credit card required
- ✅ Perfect for testing and small deployments

---

### Step 2: Generate Your API Key (1 minute)

1. **Log into** Resend Dashboard
2. **Click** "API Keys" in the left sidebar
3. **Click** "Create API Key" button
4. **Configure:**
   - Name: `mBHR Patient Portal`
   - Permission: `Sending access`
   - Domain: Leave as "All Domains"
5. **Click** "Create"
6. **COPY THE KEY NOW** (starts with `re_`) - You won't see it again!

**Example key format:** `re_123abc456def789ghi012jkl345mno678pqr`

---

### Step 3: Add API Key to Supabase (2 minutes)

#### Option A: Supabase Dashboard (Easiest)

1. **Open** [Supabase Dashboard](https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv)
2. **Go to** Settings (⚙️ icon in left sidebar)
3. **Click** "Edge Functions" tab
4. **Scroll down** to "Secrets" section
5. **Click** "Add a new secret"
6. **Enter:**
   ```
   Name:  RESEND_API_KEY
   Value: [paste your re_xxx key here]
   ```
7. **Click** "Add secret"
8. **Wait 30 seconds** for Edge Functions to reload
9. ✅ Done!

#### Option B: Supabase CLI (If installed)

```bash
# Navigate to your project directory
cd /path/to/mBHR

# Set the secret
npx supabase secrets set RESEND_API_KEY=re_your_actual_key_here

# Verify it was set (lists names only, not values)
npx supabase secrets list
```

---

### Step 4: Test Email Delivery

1. **Sign in online** as an admin, then **go to:** `/admin/email-diagnostics` in your app
2. **Enter** your email address in the test field
3. **Click** "Send Test Email"
4. **Check** your email inbox (and spam folder!)
5. **Verify** you received a professional email with:
   - mBHR branding
   - 6-digit OTP code (123456)
   - Security warnings
   - Professional formatting

**If successful:** The diagnostic tool will show "Email Sent Successfully" instead of "Demo Mode Active"

---

### Step 5: Send Invitation to Kristopher

1. **Go to** `/patients` and find Kristopher
2. **Click** on his patient record
3. **Scroll to** "Patient Portal Access" section
4. **Click** "Resend Portal Invitation"
5. **Wait** for success message
6. **Email should arrive** at `cokobah16@gmail.com` within 30 seconds

---

## Email Configuration Options

### Option 1: Quick Start (Use Resend Test Domain)

**Best for:** Testing, development, immediate setup

The Edge Function is already configured to use `onboarding@resend.dev` as the default sender. This works immediately with no additional setup!

**Emails will show as from:**

```
mBHR Patient Portal <onboarding@resend.dev>
```

**Pros:**

- ✅ No domain setup required
- ✅ Works immediately after adding API key
- ✅ Perfect for testing

**Cons:**

- ⚠️ Generic sender address
- ⚠️ May have lower trust signals

---

### Option 2: Professional Setup (Use Your Own Domain)

**Best for:** Production deployment

For emails from your own domain (e.g., `noreply@mbhr.health`):

1. **In Resend Dashboard**, go to "Domains"
2. **Click** "Add Domain"
3. **Enter** your domain (e.g., `mbhr.health`)
4. **Follow DNS verification steps:**
   - Add the provided DNS records to your domain
   - Wait for verification (usually 5-10 minutes)
5. **Once verified**, add sender email to Supabase:

   ```bash
   # Via CLI
   npx supabase secrets set SENDER_EMAIL=noreply@mbhr.health

   # Or via Dashboard
   # Settings → Edge Functions → Secrets → Add:
   # Name: SENDER_EMAIL
   # Value: noreply@mbhr.health
   ```

**Emails will show as from:**

```
mBHR Patient Portal <noreply@mbhr.health>
```

---

## Troubleshooting

### Problem: "Demo mode: RESEND_API_KEY is not set, so no email was sent."

**Cause:** API key not detected by Edge Function

**Solution:**

1. Verify you added `RESEND_API_KEY` secret to Supabase
2. Check the secret name is exactly: `RESEND_API_KEY` (case-sensitive)
3. Wait 30-60 seconds for Edge Function to reload
4. Try sending test email again
5. Check Supabase Edge Function logs for any errors

---

### Problem: "The server refused the request"

**Cause:** The function only sends email for staff signed in online (401), and only for roles allowed to send that email (403).

**Solution:**

1. Sign out, then sign in online with your email and password. A PIN unlock is not enough.
2. For the test on `/admin/email-diagnostics`, use an admin account.
3. If it still says your account was not accepted, check that your `app_users` row has the right role and is active.

---

### Problem: "Failed to send email"

**Possible Causes & Solutions:**

#### 1. Invalid API Key

- Verify you copied the full key (starts with `re_`)
- Make sure no spaces were added when pasting
- Generate a new key if needed

#### 2. Domain Not Verified (if using custom domain)

- Check DNS records are correctly configured
- Wait for domain verification to complete
- Temporarily use `onboarding@resend.dev` for testing

#### 3. Rate Limit Exceeded

- Free tier: 3,000 emails per month
- Check Resend dashboard for usage
- Wait until next month or upgrade plan

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

## Monitoring & Logs

### View Sent Emails in Resend

1. **Go to** Resend Dashboard
2. **Click** "Emails" in left sidebar
3. **See all sent emails** with:
   - Delivery status (sent, delivered, bounced, etc.)
   - Recipient email address
   - Subject line
   - Timestamp
   - Opens and clicks (if tracking enabled)

### View Edge Function Logs in Supabase

1. **Go to** Supabase Dashboard
2. **Navigate to:** Edge Functions → send-otp-email
3. **Click** "Logs" tab
4. **See real-time logs** of:
   - Function invocations
   - Whether each email was accepted by Resend, with its Resend message ID
   - Demo mode notices
   - Resend errors, as the HTTP status and error name only

The logs never contain the recipient address, the code, the subject or the message. Use the Resend dashboard to see who an email went to.

---

## What the Email Looks Like

The sample sign-in code email sent by the test on `/admin/email-diagnostics` looks like this. Patients are not sent code emails; they get the invitation email with a registration link.

```
┌─────────────────────────────────────────────────┐
│  mBHR Patient Portal              (Blue header) │
├─────────────────────────────────────────────────┤
│                                                 │
│  Your Verification Code                         │
│                                                 │
│  Hello,                                         │
│                                                 │
│  You requested a verification code to access   │
│  your mBHR Patient Portal account. Please use  │
│  the code below to complete your login:        │
│                                                 │
│      ┌────────────────────┐                    │
│      │   1 2 3 4 5 6      │   (Large, blue)    │
│      └────────────────────┘                    │
│                                                 │
│  This code will expire in 10 minutes.          │
│                                                 │
│  ⚠️  Security Notice:                           │
│  Never share this code with anyone.             │
│  mBHR staff will never ask you for this code.  │
│                                                 │
│  If you didn't request this code, please       │
│  ignore this email or contact support.         │
│                                                 │
├─────────────────────────────────────────────────┤
│  Med Bridge Health Reach                        │
│  Dr. Isioma Okobah Foundation                   │
│                                                 │
│  This is an automated message.                  │
│  Please do not reply to this email.            │
└─────────────────────────────────────────────────┘
```

**Features:**

- Professional HTML template
- Clear, large OTP code
- Security warnings
- mBHR branding
- Mobile-responsive design
- Plain text fallback for older email clients

---

## Security Features

### Built-in Security

What `send-otp-email` does today:

- **Staff only:** a staff member signed in online, with a role allowed to send that email (see [Who Can Call the Function](#who-can-call-the-function)).
- **Rate limiting:** 10 requests a minute per IP address.
- **One recipient:** `email` must be one plain address. Lists and display names are refused.
- **Escaped content:** the code and the message are HTML-escaped in the HTML email.
- **Private logs:** no address, code, subject or message in the function logs.
- **Transport:** requests to Supabase and Resend use HTTPS.

### Best Practices

1. **API Key Security:**
   - ✅ Stored as Supabase secret (not in code)
   - ✅ Never committed to Git
   - ✅ Rotate every 90 days
   - ✅ Use separate keys for staging/production

2. **Monitoring:**
   - Set up alerts for high email volume (possible abuse)
   - Monitor failed delivery rates (API issues)
   - Watch for unusual patterns (security concerns)
   - Review Resend dashboard weekly

3. **Patient Education:**
   - Include security warnings in every email
   - Never ask patients for OTP codes over phone
   - Encourage patients to check sender address
   - Provide clear support contact information

---

## Cost & Scaling

### Free Tier (Resend)

**Included:**

- 3,000 emails per month
- API access
- Email tracking
- Webhooks
- Support

**Sufficient for:**

- Up to 100 active portal users
- ~30 new registrations per month
- Regular appointment reminders
- Testing and development

### Paid Tier (If Needed)

**Pro Plan: $20/month**

- 50,000 emails per month
- Everything in free tier
- Priority support
- Higher sending limits

**When to upgrade:**

- More than 100 active portal users
- More than 1,000 monthly portal invitations
- Need for advanced analytics
- Higher delivery guarantees

### Cost Optimization Tips

1. **Email First Strategy:**
   - Use email OTP as primary method
   - SMS as fallback for users without email
   - Saves ~90% on messaging costs

2. **Batch Operations:**
   - Send appointment reminders via email
   - Reserve SMS for urgent notifications
   - Use in-app notifications when possible

3. **Monitor Usage:**
   - Track OTP requests per day
   - Identify and block abuse patterns
   - Optimize based on usage patterns

---

## Success Checklist

Use this checklist to verify your setup:

- [ ] Created Resend account
- [ ] Generated API key (starts with `re_`)
- [ ] Added `RESEND_API_KEY` to Supabase secrets
- [ ] Waited 30-60 seconds for Edge Function reload
- [ ] Tested email delivery using diagnostics tool
- [ ] Received test email successfully
- [ ] Verified email template looks professional
- [ ] Sent invitation to Kristopher
- [ ] Kristopher received invitation email
- [ ] Tested registration from the invitation link

---

## Next Steps

Once email delivery is working:

1. **Test the Full Flow:**
   - Have Kristopher open the registration link in his invitation email
   - He finishes registering with his date of birth and a password
   - He logs in at `/patient/login` with his email and password
   - Patient login does not use an emailed code

2. **Enable Portal for Other Patients:**
   - Go to patient records
   - Enable portal access for patients with emails
   - Send invitations
   - Monitor delivery in Resend dashboard

3. **Consider Production Setup:**
   - Set up custom domain verification
   - Configure professional sender email
   - Set up monitoring and alerts
   - Document process for your team

---

## Support Resources

### Resend Support

- **Documentation:** [https://resend.com/docs](https://resend.com/docs)
- **Status Page:** [https://status.resend.com](https://status.resend.com)
- **Email Support:** support@resend.com

### Supabase Support

- **Edge Functions Docs:** [https://supabase.com/docs/guides/functions](https://supabase.com/docs/guides/functions)
- **Secrets Management:** [https://supabase.com/docs/guides/functions/secrets](https://supabase.com/docs/guides/functions/secrets)
- **Community:** [https://github.com/supabase/supabase/discussions](https://github.com/supabase/supabase/discussions)

### Common Issues

- Most problems are solved by checking Edge Function logs
- Verify secrets are spelled exactly right: `RESEND_API_KEY`
- Wait 30-60 seconds after adding secrets
- Check spam folder if emails don't arrive

---

## Summary

**Current Situation:**

- ✅ Everything is working correctly
- ✅ System is in safe demo mode
- ⚠️ Just needs API key to send real emails

**What You Need to Do:**

1. Sign up for free Resend account (2 min)
2. Copy API key (1 min)
3. Add to Supabase secrets (2 min)
4. Test and verify (1 min)

**Total Time:** ~5-10 minutes

**Result:**

- ✅ Portal invitation emails sent when staff signed in online send them
- ✅ 3,000 free emails per month
- ✅ Ready for production use

---

**Questions?** Use the Email Diagnostics tool at `/admin/email-diagnostics` to test and troubleshoot!
