# Going Live Checklist

## You're Almost There!

Your application is already deployed and your edge functions are active. You just need to configure email sending.

## Step 1: Get Resend API Key

1. Go to https://resend.com/api-keys
2. Click "Create API Key"
3. Give it a name (e.g., "mBHR Production")
4. Copy the key (starts with `re_`)

## Step 2: Add Secrets to Supabase

### Via Supabase Dashboard (Recommended):

1. Go to your Supabase project: https://supabase.com/dashboard/project/_/settings/functions
2. Click **Edge Functions** → **Manage secrets**
3. Add these two secrets:
   - **Name:** `RESEND_API_KEY`
     **Value:** Your Resend API key (starts with `re_`)
   - **Name:** `SENDER_EMAIL`
     **Value:** `onboarding@resend.dev`

4. Click **Save**

### Via Command Line (Alternative):

```bash
# Login to Supabase if you haven't already
npx supabase login

# Link to your project
npx supabase link --project-ref YOUR_PROJECT_REF

# Set the secrets
npx supabase secrets set RESEND_API_KEY=re_your_actual_key_here
npx supabase secrets set SENDER_EMAIL=onboarding@resend.dev
```

## Step 3: Test It

1. Go to your patient portal login page
2. Try to register or login with email
3. You should receive an OTP code via email within seconds

## You're Live!

Your application is now fully functional and can send emails to real users using `onboarding@resend.dev` as the sender.

## Optional: Add Custom Domain Later

When you're ready to send emails from your own domain (e.g., `noreply@yourdomain.com`):

1. Add your domain in Resend dashboard
2. Add the DNS records Resend provides to your domain
3. Update the `SENDER_EMAIL` secret to your custom email address

For now, `onboarding@resend.dev` works perfectly and looks professional!

## Troubleshooting

- **No email received?** Check spam folder
- **Still not working?** Check Supabase Edge Function logs
- **Demo mode message?** The secrets haven't been set yet

## Support

Your edge functions are already deployed at:
- `send-otp-email` - For patient portal login codes
- `send-otp-sms` - For SMS notifications (if configured)
- `send-sms-reminder` - For appointment reminders (if configured)
