# Patient Portal Deployment Guide

**Project:** mBHR Patient Portal
**Version:** 1.0
**Date:** October 2025

---

## Overview

This guide covers the complete deployment process for the mBHR Patient Portal, including database setup, edge function deployment, environment configuration, and testing procedures.

---

## Prerequisites

Before deployment, ensure you have:

- [ ] Supabase project created and accessible
- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Access to Supabase project credentials
- [ ] SMS provider account (Twilio or Africa's Talking)
- [ ] Email provider account (Resend or SendGrid)
- [ ] Node.js 18+ and npm installed

---

## Phase 1: Database Setup

### Step 1: Run the Patient Portal Migration

The patient portal database schema is in `supabase/migrations/20251028000000_add_patient_portal.sql`.

**Option A: Using Supabase Dashboard**

1. Log in to your Supabase dashboard
2. Navigate to SQL Editor
3. Click "New Query"
4. Copy the entire contents of `20251028000000_add_patient_portal.sql`
5. Paste into the query editor
6. Click "Run"
7. Verify no errors in the output

**Option B: Using Supabase CLI**

```bash
# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Push migrations
supabase db push
```

### Step 2: Verify Database Tables

Run this query to verify all tables were created:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'patient_%'
ORDER BY table_name;
```

You should see:
- patient_portal_users
- patient_portal_sessions
- patient_portal_access_logs
- patient_notifications
- patient_messages
- patient_appointment_requests
- patient_documents
- patient_consent_records

### Step 3: Test RLS Policies

Create a test patient portal user and verify RLS policies are working:

```sql
-- Create test patient first (if needed)
INSERT INTO patients (given_name, family_name, dob, sex, phone)
VALUES ('Test', 'Patient', '1990-01-01', 'M', '+2348012345678')
RETURNING id;

-- Create test portal user
INSERT INTO patient_portal_users (patient_id, phone_number, account_status)
VALUES ('PATIENT_ID_FROM_ABOVE', '+2348012345678', 'active')
RETURNING *;
```

---

## Phase 2: Edge Functions Deployment

### Step 1: Configure Environment Variables

In your Supabase dashboard:

1. Navigate to Project Settings → Edge Functions
2. Add the following secrets:

**For SMS (Twilio):**
```bash
supabase secrets set TWILIO_ACCOUNT_SID=your_account_sid
supabase secrets set TWILIO_AUTH_TOKEN=your_auth_token
supabase secrets set TWILIO_PHONE_NUMBER=your_twilio_number
```

**For Email (Resend):**
```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
```

### Step 2: Deploy Edge Functions

**Deploy SMS OTP Function:**

```bash
cd supabase/functions/send-otp-sms
supabase functions deploy send-otp-sms
```

**Deploy Email OTP Function:**

```bash
cd supabase/functions/send-otp-email
supabase functions deploy send-otp-email
```

### Step 3: Test Edge Functions

**Test SMS Function:**

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-otp-sms \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+2348012345678", "otp": "123456"}'
```

**Test Email Function:**

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-otp-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "otp": "123456"}'
```

---

## Phase 3: Frontend Configuration

### Step 1: Update Environment Variables

Create or update `.env` file in your project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY

# Site Configuration
VITE_SITE_NAME="Med Bridge Health Reach"
VITE_ORGANIZATION="Dr. Isioma Okobah Foundation"

# Optional: Sentry Error Tracking
VITE_SENTRY_DSN=your_sentry_dsn
```

### Step 2: Build the Application

```bash
# Install dependencies
npm install

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Build for production
npm run build
```

### Step 3: Deploy to Hosting

**Option A: Netlify**

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist
```

**Option B: Vercel**

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

**Option C: Static Hosting (AWS S3, Azure, etc.)**

Upload the contents of the `dist` folder to your static hosting provider.

---

## Phase 4: Testing

### Test Checklist

#### Authentication Flow

- [ ] Navigate to `/patient/register`
- [ ] Enter valid phone and DOB matching patient record
- [ ] Verify OTP SMS is received
- [ ] Enter OTP code
- [ ] Confirm redirect to dashboard
- [ ] Log out
- [ ] Navigate to `/patient/login`
- [ ] Enter phone number
- [ ] Verify OTP SMS is received
- [ ] Enter OTP code
- [ ] Confirm login successful

#### Dashboard

- [ ] Verify patient name displays correctly
- [ ] Check upcoming appointments card
- [ ] Check messages card
- [ ] Check notifications card
- [ ] Verify recent vitals display if available
- [ ] Check active medications list
- [ ] Verify quick actions work

#### Medical History

- [ ] Navigate to medical history
- [ ] Verify visits are listed
- [ ] Click on a visit
- [ ] Verify all visit details display
- [ ] Check vitals section
- [ ] Check consultation notes section
- [ ] Check prescriptions section
- [ ] Navigate back to medical history

#### Appointments

- [ ] Click "Request Appointment"
- [ ] Fill out appointment request form
- [ ] Submit request
- [ ] Verify success message
- [ ] Check that request appears in pending appointments

#### Security

- [ ] Attempt to access `/patient/dashboard` without login - verify redirect
- [ ] Login with patient A's credentials
- [ ] Verify only patient A's data is visible
- [ ] Verify patient A cannot see patient B's data
- [ ] Check access logs in database show correct entries

---

## Phase 5: Monitoring

### Set Up Logging

Monitor these key metrics:

**Authentication:**
- Failed login attempts
- OTP delivery failures
- Account lockouts

**Performance:**
- Page load times
- API response times
- Database query performance

**Security:**
- Unusual access patterns
- Multiple devices for same patient
- Access from unusual locations

### Supabase Dashboard

Monitor in Supabase dashboard:
1. Database → Table Editor → Check data integrity
2. Authentication → Check session activity
3. Edge Functions → Monitor invocation count and errors
4. Logs → Review error logs

### Optional: Set Up Sentry

For error tracking:

```bash
npm install @sentry/react
```

Add to your `.env`:
```env
VITE_SENTRY_DSN=your_sentry_dsn
```

---

## Phase 6: User Onboarding

### Step 1: Create Patient Portal Accounts

For existing patients who want portal access:

1. Verify patient has valid phone number in system
2. Inform patient about portal availability
3. Direct them to `/patient/register`
4. Provide patient user guide

### Step 2: Staff Training

Train staff on:
- How patients register and login
- How to help patients with login issues
- How to review appointment requests
- How to respond to patient messages
- Security best practices

### Step 3: Communication

Communicate to patients:
- Portal is now available
- Benefits of using the portal
- Link to registration page
- Link to user guide
- Support contact information

---

## Troubleshooting

### Edge Functions Not Working

**Check:**
1. Environment variables are set correctly
2. Functions are deployed (check Supabase dashboard)
3. CORS headers are present in function responses
4. Check function logs for errors

**Fix:**
```bash
# View logs
supabase functions logs send-otp-sms --tail

# Redeploy
supabase functions deploy send-otp-sms
```

### OTP Not Received

**Possible Causes:**
1. SMS provider credentials incorrect
2. Phone number format incorrect
3. SMS provider account out of credit
4. Rate limiting triggered

**Debug:**
```bash
# Check edge function logs
supabase functions logs send-otp-sms --tail

# Test with curl
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-otp-sms \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+2348012345678", "otp": "123456"}'
```

### RLS Policy Errors

**Symptoms:**
- Patients can't see their own data
- Patients see other patients' data
- "Policy violation" errors

**Fix:**
```sql
-- Check RLS is enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename LIKE 'patient_%';

-- Check policies exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename LIKE 'patient_%';

-- Re-apply policies if needed
-- Run the migration again or apply specific policies
```

### Session Expiry Issues

**Check:**
```sql
-- View active sessions
SELECT * FROM patient_portal_sessions
WHERE is_active = true
ORDER BY created_at DESC;

-- Cleanup expired sessions
UPDATE patient_portal_sessions
SET is_active = false
WHERE expires_at < now();
```

---

## Security Checklist

Before going live:

- [ ] All RLS policies enabled and tested
- [ ] Edge function CORS headers configured
- [ ] SMS/Email delivery tested
- [ ] Session timeout working (30 min idle)
- [ ] Account lockout working (5 failed attempts)
- [ ] Rate limiting on OTP requests (3 per hour)
- [ ] Audit logging capturing all access
- [ ] HTTPS enforced on all endpoints
- [ ] Environment variables secured
- [ ] No test accounts with weak credentials
- [ ] Database backups configured
- [ ] Monitoring and alerting set up

---

## Rollback Procedure

If you need to rollback:

### 1. Disable Patient Portal Routes

In `App.tsx`, comment out patient portal routes:

```typescript
// Temporarily disable patient portal
// <Route path="/patient/login" element={<PatientLogin />} />
// <Route path="/patient/register" element={<PatientRegister />} />
```

### 2. Disable Edge Functions

```bash
# Delete functions
supabase functions delete send-otp-sms
supabase functions delete send-otp-email
```

### 3. Rollback Database

```sql
-- Drop patient portal tables (in reverse order)
DROP TABLE IF EXISTS patient_consent_records CASCADE;
DROP TABLE IF EXISTS patient_documents CASCADE;
DROP TABLE IF EXISTS patient_appointment_requests CASCADE;
DROP TABLE IF EXISTS patient_messages CASCADE;
DROP TABLE IF EXISTS patient_notifications CASCADE;
DROP TABLE IF EXISTS patient_portal_access_logs CASCADE;
DROP TABLE IF EXISTS patient_portal_sessions CASCADE;
DROP TABLE IF EXISTS patient_portal_users CASCADE;
```

---

## Support

For deployment issues:

- Check Supabase documentation: https://supabase.com/docs
- Review project logs in Supabase dashboard
- Contact mBHR development team
- Check GitHub issues for known problems

---

## Maintenance

### Regular Tasks

**Daily:**
- Monitor error rates
- Check edge function invocation counts
- Review failed login attempts

**Weekly:**
- Review access logs for anomalies
- Check database performance
- Monitor session activity

**Monthly:**
- Review and archive old access logs (>90 days)
- Update dependencies
- Review security policies
- Analyze usage metrics

### Updates

When updating the patient portal:

1. Test in staging environment first
2. Notify patients of scheduled maintenance
3. Deploy during low-traffic hours
4. Monitor for errors after deployment
5. Have rollback plan ready

---

**Deployment Status Checklist**

- [ ] Phase 1: Database Setup Complete
- [ ] Phase 2: Edge Functions Deployed
- [ ] Phase 3: Frontend Built and Deployed
- [ ] Phase 4: Testing Complete
- [ ] Phase 5: Monitoring Configured
- [ ] Phase 6: User Onboarding Started

**Date Deployed:** ___________________

**Deployed By:** ___________________

**Notes:** ___________________
