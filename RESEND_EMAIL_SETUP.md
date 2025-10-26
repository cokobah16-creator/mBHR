# 📧 Setting Up Real Email Delivery with Resend

## ✅ What's Already Done

- ✅ Edge function deployed and ready
- ✅ Code supports Resend API integration
- ✅ Fallback to demo mode (console logging) if no API key
- ✅ Beautiful HTML email template created
- ✅ Security warnings included in emails

## 🚀 Your 5-Minute Setup Guide

### **Step 1: Sign Up for Resend (2 minutes)**

1. Go to: **https://resend.com**
2. Click **"Get Started"** or **"Sign Up"**
3. Sign up with:
   - Your email address, OR
   - GitHub account (faster)
4. Check your email and verify your account
5. Complete the quick onboarding

**Free Tier Benefits:**
- ✅ 100 emails/day
- ✅ 3,000 emails/month
- ✅ No credit card required
- ✅ Perfect for testing and small deployments

---

### **Step 2: Get Your API Key (1 minute)**

Once logged into Resend Dashboard:

1. Click **"API Keys"** in the left sidebar
2. Click **"Create API Key"** button
3. Configure:
   - **Name:** `mBHR Patient Portal`
   - **Permission:** Select **"Sending access"**
   - **Domain:** Leave as "All Domains" for now
4. Click **"Create"**
5. **COPY THE KEY NOW** (starts with `re_`) - You won't see it again!

Example key format: `re_123abc456def789ghi012jkl345mno678pqr`

---

### **Step 3: Add API Key to Supabase (2 minutes)**

#### **Method A: Supabase Dashboard** (Recommended - Easiest)

1. Open **Supabase Dashboard**: https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv
2. Go to **Settings** (⚙️ icon in left sidebar)
3. Click **"Edge Functions"** tab
4. Scroll down to **"Secrets"** section
5. Click **"Add a new secret"**
6. Enter:
   ```
   Name:  RESEND_API_KEY
   Value: [paste your API key here]
   ```
7. Click **"Add secret"**
8. ✅ Done! The edge function will automatically detect it

#### **Method B: Supabase CLI** (If installed)

```bash
# Navigate to your project directory
cd /path/to/mBHR

# Set the secret
npx supabase secrets set RESEND_API_KEY=re_your_actual_key_here

# Verify it was set (lists secret names only, not values)
npx supabase secrets list
```

---

### **Step 4: Configure Sender Email (Important!)**

Resend requires domain verification for custom sender addresses. You have two options:

#### **Option A: Use Resend Test Domain (Quick - For Testing)**

The edge function is already configured to use `onboarding@resend.dev` as the default sender. This works immediately with no setup!

**Emails will show as from:**
```
mBHR Patient Portal <onboarding@resend.dev>
```

✅ **No additional setup needed for testing!**

#### **Option B: Use Your Own Domain (Production)**

For professional emails from your own domain (e.g., `noreply@mbhr.health`):

1. In Resend Dashboard, go to **"Domains"**
2. Click **"Add Domain"**
3. Enter your domain (e.g., `mbhr.health`)
4. Follow the DNS verification steps:
   - Add the provided DNS records to your domain
   - Wait for verification (usually 5-10 minutes)
5. Once verified, add the sender email to Supabase:
   ```bash
   # Via CLI
   npx supabase secrets set SENDER_EMAIL=noreply@mbhr.health
   
   # Or via Dashboard
   # Settings → Edge Functions → Secrets → Add:
   # Name: SENDER_EMAIL
   # Value: noreply@mbhr.health
   ```

---

## ✨ Test It Out!

### **Test the Email Sending:**

1. Go to your mBHR app: `/patient/login`
2. Enter a **real email address** (one you can check)
3. Click **"Continue"**
4. **Check your email inbox!** 📬
5. You should receive an email with:
   - Professional HTML template
   - 6-digit OTP code
   - Security warnings
   - mBHR branding

### **What the Email Looks Like:**

```
┌─────────────────────────────────────┐
│  mBHR Patient Portal                │  (Blue header)
├─────────────────────────────────────┤
│                                     │
│  Your Verification Code             │
│                                     │
│  Hello,                             │
│                                     │
│  You requested a verification code  │
│  to access your mBHR Patient Portal │
│  account. Please use the code below:│
│                                     │
│      ┌───────────────┐              │
│      │   1 2 3 4 5 6 │              │  (Large, blue)
│      └───────────────┘              │
│                                     │
│  This code expires in 10 minutes.   │
│                                     │
│  ⚠️  Security Notice:                │
│  Never share this code with anyone. │
│                                     │
└─────────────────────────────────────┘
```

---

## 🔍 Troubleshooting

### **Problem: "Demo mode: OTP logged to console"**

**Cause:** API key not detected

**Solution:**
1. Verify you added `RESEND_API_KEY` to Supabase secrets
2. Check the secret name is exactly: `RESEND_API_KEY` (case-sensitive)
3. Wait 30 seconds for edge function to reload
4. Try the login flow again

---

### **Problem: "Failed to send email"**

**Possible Causes & Solutions:**

1. **Invalid API Key**
   - Verify you copied the full key (starts with `re_`)
   - Generate a new key and update the secret

2. **Domain Not Verified** (if using custom domain)
   - Check DNS records are correctly configured
   - Wait for domain verification to complete
   - Use `onboarding@resend.dev` for testing

3. **Rate Limit Exceeded**
   - Free tier: 100 emails/day
   - Wait until next day or upgrade plan

---

### **Problem: Email not arriving**

**Check:**
1. ✉️ **Spam/Junk folder** - Check there first!
2. 📧 **Email address correct** - Verify no typos
3. ⏱️ **Wait a minute** - Delivery can take 30-60 seconds
4. 📝 **Supabase logs** - Check Edge Functions logs for errors:
   - Go to: Dashboard → Edge Functions → send-otp-email → Logs
   - Look for successful sends or error messages

---

## 📊 Monitoring & Logs

### **View Sent Emails in Resend:**

1. Go to Resend Dashboard
2. Click **"Emails"** in left sidebar
3. See all sent emails with:
   - Delivery status
   - Recipient
   - Subject
   - Timestamp
   - Opens/clicks (if tracked)

### **View Edge Function Logs in Supabase:**

1. Go to Supabase Dashboard
2. Navigate to: **Edge Functions** → **send-otp-email**
3. Click **"Logs"** tab
4. See real-time logs of:
   - API calls
   - Success/failure messages
   - Error details
   - OTP codes (in demo mode)

---

## 🎉 Success Checklist

- [ ] Signed up for Resend account
- [ ] Created and copied API key (starts with `re_`)
- [ ] Added `RESEND_API_KEY` secret to Supabase
- [ ] (Optional) Configured custom sender domain
- [ ] Tested login flow with real email
- [ ] Received OTP email successfully
- [ ] Verified email template looks professional

---

## 💡 Pro Tips

### **For Testing:**
- Use `onboarding@resend.dev` sender (no domain setup needed)
- Send test emails to your personal email
- Check both inbox and spam folders

### **For Production:**
- Verify your own domain for professional sender address
- Monitor delivery rates in Resend dashboard
- Set up email tracking for opens/clicks
- Consider upgrading Resend plan if you exceed 100 emails/day

### **Security Best Practices:**
- ✅ API key is stored as Supabase secret (not in code)
- ✅ OTP codes expire in 10 minutes
- ✅ Rate limiting prevents abuse (via database)
- ✅ Email includes security warnings

---

## 🆘 Need Help?

**Resend Support:**
- Documentation: https://resend.com/docs
- Status Page: https://status.resend.com
- Support: support@resend.com

**Supabase Support:**
- Documentation: https://supabase.com/docs/guides/functions/secrets
- Community: https://github.com/supabase/supabase/discussions

**Common Issues:**
- Most problems are solved by checking the Edge Function logs
- Verify secrets are spelled exactly right: `RESEND_API_KEY`
- Wait 30-60 seconds after adding secrets for them to take effect

---

## 📈 Current Status

✅ **Edge Function:** Deployed and ready
✅ **Email Template:** Professional HTML design created
✅ **Demo Mode:** Working (logs OTP to console)
✅ **Production Mode:** Ready once you add API key

**Next Step:** Add `RESEND_API_KEY` to Supabase and test! 🚀

---

**Estimated Setup Time:** 5 minutes
**Difficulty Level:** Easy ⭐
**Cost:** Free (100 emails/day)
