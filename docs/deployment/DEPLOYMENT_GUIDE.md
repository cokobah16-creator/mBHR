# mBHR Production Deployment Guide

**Version:** 1.0
**Last Updated:** October 23, 2025
**Estimated Time:** 2-4 hours for complete deployment

---

## 📋 Prerequisites

### Required Accounts
- [ ] Supabase account (free tier is sufficient to start)
- [ ] Netlify or Vercel account (free tier works)
- [ ] Domain name (optional but recommended)

### Required Tools
- [ ] Git installed
- [ ] Node.js 18+ installed
- [ ] npm or yarn installed
- [ ] Text editor (VS Code recommended)

### Required Knowledge
- Basic command line usage
- Basic understanding of environment variables
- Access to production server/hosting

---

## 🚀 Step 1: Supabase Setup (30 minutes)

### 1.1 Create Production Project

1. Go to https://supabase.com
2. Click "New Project"
3. Fill in project details:
   - **Name:** `mBHR Production` (or your preferred name)
   - **Database Password:** Generate a strong password (save it securely!)
   - **Region:** Choose closest to your deployment location
   - **Pricing Plan:** Start with Free tier
4. Click "Create new project"
5. Wait 2-3 minutes for project provisioning

### 1.2 Run Database Migrations

1. In Supabase dashboard, go to **SQL Editor**
2. Run migrations in order:

**Migration 1: Core Schema**
```sql
-- Copy content from: supabase/migrations/20250930025202_young_hat.sql
-- Paste into SQL Editor and click "Run"
```

**Migration 2: Enhanced Schema**
```sql
-- Copy content from: supabase/migrations/20250930030513_super_flower.sql
-- Paste into SQL Editor and click "Run"
```

**Migration 3: Complete Schema**
```sql
-- Copy content from: supabase/migrations/20250930060647_old_dream.sql
-- Paste into SQL Editor and click "Run"
```

**Migration 4: Additional Tables**
```sql
-- Copy content from: supabase/migrations/20250930125054_teal_coral.sql
-- Paste into SQL Editor and click "Run"
```

**Migration 5: Photo Storage**
```sql
-- Copy content from: supabase/migrations/20251023220000_add_photo_storage.sql
-- Paste into SQL Editor and click "Run"
```

### 1.3 Verify Database Setup

1. Go to **Table Editor** in Supabase dashboard
2. Verify these tables exist:
   - `app_users`
   - `patients`
   - `visits`
   - `vitals`
   - `consultations`
   - `dispenses`
   - `inventory`
   - `queue`

3. Check Row Level Security:
   - Click on each table
   - Verify "RLS enabled" badge is shown
   - Click "Policies" to see security policies

### 1.4 Set Up Storage Bucket

1. Go to **Storage** in Supabase dashboard
2. Verify `photos` bucket exists (created by migration)
3. Check bucket settings:
   - Public: Yes ✅
   - File size limit: 5MB
   - Allowed MIME types: image/jpeg, image/png
4. Test upload:
   - Click "Upload file"
   - Upload a test image
   - Verify it appears in bucket

### 1.5 Get API Credentials

1. Go to **Settings** → **API** in Supabase dashboard
2. Copy and save these values:
   - **Project URL:** `https://xxxxx.supabase.co`
   - **anon/public key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - **service_role key:** (keep secret! only for server-side operations)

### 1.6 Create Admin User

1. Go to **Authentication** → **Users** in Supabase dashboard
2. Click "Add user" → "Create new user"
3. Fill in:
   - **Email:** admin@yourdomain.com
   - **Password:** Generate strong password
   - **Auto Confirm User:** Yes ✅
4. Click "Create user"
5. Note the User ID (you'll need it next)

### 1.7 Grant Admin Access

1. Go to **SQL Editor**
2. Run this query (replace `USER_ID` with actual ID from step 1.6):

```sql
INSERT INTO app_users (id, full_name, role, admin_access, admin_permanent)
VALUES (
  'USER_ID_HERE',
  'System Administrator',
  'admin',
  true,
  true
);
```

3. Verify in **Table Editor** → `app_users` that the admin user appears

---

## 🌐 Step 2: Frontend Deployment (30 minutes)

### 2.1 Prepare Environment Variables

1. In your project root, copy `.env.example` to `.env.production`:
```bash
cp .env.example .env.production
```

2. Edit `.env.production` with your Supabase credentials:
```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
```

### 2.1a Optional: Set Up Sentry Error Tracking (15 minutes)

Sentry provides real-time error tracking and monitoring for production applications.

1. **Create Sentry Account:**
   - Go to https://sentry.io/signup/
   - Sign up for free account (up to 5,000 errors/month free)
   - Create a new project
   - Select "React" as the platform

2. **Get Your DSN:**
   - After creating the project, copy the DSN
   - It looks like: `https://xxxxx@xxxxx.ingest.sentry.io/xxxxx`

3. **Add to Environment Variables:**
   - Add `VITE_SENTRY_DSN=your-dsn-here` to `.env.production`
   - The application will automatically detect and enable Sentry

4. **Configure Sentry Settings (already done in code):**
   - Error tracking: Enabled
   - Performance monitoring: 10% sample rate
   - Session replay: 10% sample rate (with privacy masking)
   - Privacy: All text masked, all media blocked

5. **Verify Integration:**
   - Deploy your application
   - Trigger a test error (throw new Error('test'))
   - Check Sentry dashboard for the error

**Note:** Sentry is optional. If you don't provide a DSN, the application will work normally without error tracking.

### 2.2 Option A: Deploy to Netlify

1. Install Netlify CLI:
```bash
npm install -g netlify-cli
```

2. Login to Netlify:
```bash
netlify login
```

3. Initialize site:
```bash
netlify init
```

4. Configure build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`

5. Add environment variables in Netlify dashboard:
   - Go to Site settings → Environment variables
   - Add `VITE_SUPABASE_URL`
   - Add `VITE_SUPABASE_ANON_KEY`
   - Add `VITE_SENTRY_DSN` (optional, for error tracking)

6. Deploy:
```bash
netlify deploy --prod
```

### 2.3 Option B: Deploy to Vercel

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy:
```bash
vercel --prod
```

4. Add environment variables in Vercel dashboard:
   - Go to Project Settings → Environment Variables
   - Add `VITE_SUPABASE_URL`
   - Add `VITE_SUPABASE_ANON_KEY`
   - Add `VITE_SENTRY_DSN` (optional, for error tracking)
   - Redeploy to apply changes

### 2.4 Configure Custom Domain (Optional)

**For Netlify:**
1. Go to Site settings → Domain management
2. Click "Add custom domain"
3. Follow DNS configuration instructions

**For Vercel:**
1. Go to Project Settings → Domains
2. Add your domain
3. Configure DNS records as shown

### 2.5 Enable HTTPS

Both Netlify and Vercel automatically provision SSL certificates via Let's Encrypt. No action needed!

---

## 📱 Step 3: PWA Installation (15 minutes)

### 3.1 Test PWA Functionality

1. Open your deployed site in Chrome/Edge
2. Open DevTools (F12)
3. Go to Application tab → Service Workers
4. Verify service worker is registered
5. Go to Application tab → Manifest
6. Verify manifest.json loads correctly

### 3.2 Install on Mobile Devices

**Android (Chrome):**
1. Open site in Chrome
2. Tap menu (⋮) → "Install app" or "Add to Home screen"
3. Follow prompts
4. App icon appears on home screen

**iOS (Safari):**
1. Open site in Safari
2. Tap Share button
3. Tap "Add to Home Screen"
4. Name the app
5. Tap "Add"

**Desktop (Chrome/Edge):**
1. Look for install icon in address bar
2. Click "Install"
3. App opens in standalone window

### 3.3 Test Offline Functionality

1. Open installed PWA
2. Login with admin credentials
3. Enable airplane mode
4. Navigate through app
5. Register a test patient
6. Verify data saves locally
7. Disable airplane mode
8. Wait for auto-sync
9. Verify data appears in Supabase

---

## 👥 Step 4: User Training (4 hours)

### 4.1 Create Training Accounts

For each role, create test accounts:

```sql
-- Community Health Worker
INSERT INTO app_users (id, full_name, role, admin_access)
VALUES (
  gen_random_uuid(),
  'CHW Training Account',
  'chw',
  false
);

-- Nurse
INSERT INTO app_users (id, full_name, role, admin_access)
VALUES (
  gen_random_uuid(),
  'Nurse Training Account',
  'nurse',
  false
);

-- Doctor
INSERT INTO app_users (id, full_name, role, admin_access)
VALUES (
  gen_random_uuid(),
  'Doctor Training Account',
  'doctor',
  false
);

-- Pharmacist
INSERT INTO app_users (id, full_name, role, admin_access)
VALUES (
  gen_random_uuid(),
  'Pharmacist Training Account',
  'pharmacist',
  false
);
```

### 4.2 Training Session Structure

**Session 1: Introduction (30 min)**
- App overview and purpose
- PWA installation on devices
- Login process
- Offline capabilities demo

**Session 2: Patient Registration (45 min)**
- Finding existing patients
- Registering new patients
- Taking patient photos
- Understanding dedupe alerts

**Session 3: Clinical Workflow (1 hour)**
- Recording vital signs
- Understanding auto-flagging
- Documenting SOAP notes
- Writing prescriptions

**Session 4: Pharmacy (45 min)**
- Dispensing medications
- FEFO inventory management
- Batch expiry tracking
- Stock alerts

**Session 5: Queue Management (30 min)**
- Using queue board
- Moving patients between stages
- Public display feature

**Session 6: Sync & Troubleshooting (30 min)**
- Understanding sync status
- Resolving conflicts
- Handling offline scenarios
- Getting help

### 4.3 Training Materials

Use the guides in:
- `docs/USER_GUIDE.md` (to be created)
- `docs/QUICK_REFERENCE.md` (to be created)
- `docs/TROUBLESHOOTING.md` (to be created)

---

## 🔍 Step 5: Testing & Validation (1 hour)

### 5.1 Smoke Testing Checklist

**Authentication:**
- [ ] Can login with admin account
- [ ] Can login with CHW account
- [ ] Can login with doctor account
- [ ] Can login with pharmacist account
- [ ] Can logout successfully

**Patient Management:**
- [ ] Can register new patient with photo
- [ ] Can search for existing patient
- [ ] Dedupe detection works
- [ ] Patient detail page loads
- [ ] Patient history displays

**Clinical Workflow:**
- [ ] Can record vital signs
- [ ] Auto-flagging works (high BP, etc.)
- [ ] Can document SOAP notes
- [ ] Can write prescriptions
- [ ] Queue board updates

**Pharmacy:**
- [ ] Can dispense medications
- [ ] FEFO expiry dates work
- [ ] Stock levels update
- [ ] Low stock alerts appear

**Offline Functionality:**
- [ ] Works in airplane mode
- [ ] Data saves locally
- [ ] Auto-syncs when online
- [ ] Conflict resolution works

**Performance:**
- [ ] Pages load quickly (<2s)
- [ ] Large lists scroll smoothly
- [ ] Photos compress properly
- [ ] Sync completes without errors

### 5.2 Load Testing (Optional)

1. Create 100 test patients using seed script
2. Navigate patient list (test virtual scrolling)
3. Search patients (test query performance)
4. Sync 50+ pending operations
5. Monitor performance in DevTools

---

## 📊 Step 6: Monitoring Setup (30 minutes)

### 6.1 Supabase Monitoring

1. Go to **Reports** in Supabase dashboard
2. Monitor:
   - Database size
   - API requests
   - Storage usage
   - Active connections

3. Set up alerts:
   - Database size > 80% of quota
   - API requests > 80% of quota

### 6.2 Application Monitoring (Optional)

**Option A: Built-in Browser DevTools**
- Use Console for errors
- Use Network tab for API calls
- Use Application tab for PWA status

**Option B: Sentry (Recommended for production)**
```bash
npm install @sentry/react
```

Configure in `src/main.tsx`:
```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "YOUR_SENTRY_DSN",
  environment: "production",
  tracesSampleRate: 0.1,
});
```

### 6.3 Backup Strategy

**Database Backups:**
- Supabase automatically backs up daily
- Point-in-time recovery available on paid plans
- Manual backup: SQL Editor → Export schema/data

**Photo Backups:**
- Supabase Storage included in database backups
- Consider separate S3 backup for photos
- Export bucket via Supabase CLI

---

## 🛠️ Step 7: Troubleshooting Common Issues

### Issue: Build fails with TypeScript errors
**Solution:**
```bash
npm run typecheck
# Fix any reported errors
npm run build
```

### Issue: Supabase connection fails
**Solution:**
1. Verify environment variables are set correctly
2. Check Supabase project is running
3. Verify anon key hasn't been revoked
4. Check browser console for specific error

### Issue: Photos don't upload
**Solution:**
1. Verify storage bucket exists
2. Check RLS policies on storage.objects
3. Verify user is authenticated
4. Check file size < 5MB
5. Check MIME type is image/jpeg or image/png

### Issue: Sync conflicts constantly
**Solution:**
1. Check system clocks are synchronized
2. Verify only one user per device
3. Review conflict resolution choices
4. Clear local database if corrupted

### Issue: PWA won't install
**Solution:**
1. Verify HTTPS is enabled
2. Check manifest.json is valid
3. Verify service worker registers
4. Clear browser cache and retry

### Issue: App slow on older devices
**Solution:**
1. Check virtual scrolling is working
2. Verify images are compressed
3. Reduce precached files if needed
4. Consider removing gamification on low-end devices

---

## 🔒 Security Checklist

- [ ] All environment variables are secure
- [ ] service_role key never exposed to client
- [ ] RLS enabled on all tables
- [ ] RLS policies tested for each role
- [ ] Storage bucket policies configured
- [ ] HTTPS enabled
- [ ] Passwords are strong (12+ characters)
- [ ] Regular security updates planned

---

## 📈 Post-Deployment Monitoring

### Week 1: Daily Checks
- [ ] Monitor error rates in console
- [ ] Check sync success rates
- [ ] Review user feedback
- [ ] Verify data integrity
- [ ] Monitor storage usage

### Week 2-4: Weekly Checks
- [ ] Review performance metrics
- [ ] Check database size growth
- [ ] Monitor API usage
- [ ] Review support tickets
- [ ] Plan improvements

### Monthly: Full Review
- [ ] Analyze usage patterns
- [ ] Review feature adoption
- [ ] Plan new features
- [ ] Update documentation
- [ ] Security audit

---

## 🎓 Training Resources

### For Administrators
- System configuration
- User management
- Backup and recovery
- Monitoring and alerts
- Troubleshooting guide

### For Clinical Staff
- Patient registration
- Vital signs entry
- SOAP notes
- Prescriptions
- Queue management

### For Pharmacists
- Dispensing workflow
- FEFO inventory
- Stock management
- Expiry monitoring
- Reports

### For CHWs
- Patient search
- Basic registration
- Vitals entry
- Queue updates
- Offline operation

---

## 📞 Support Contacts

### Technical Issues
- **Supabase Support:** support@supabase.io
- **Deployment Issues:** Your hosting provider support
- **Application Bugs:** Create GitHub issue or contact dev team

### Training & Usage
- **User Guides:** See `docs/` folder
- **Video Tutorials:** [Link to videos]
- **Quick Reference:** See `QUICK_REFERENCE.md`

---

## ✅ Deployment Complete!

Once all steps are complete, your mBHR application is production-ready and serving users!

**Next Steps:**
1. Train pilot users
2. Monitor initial usage
3. Collect feedback
4. Iterate and improve
5. Scale to additional sites

**Success Metrics:**
- Zero data loss incidents
- <1% sync error rate
- <2s page load times
- >95% user satisfaction
- Daily active usage

---

*This deployment guide will be continuously updated based on field experience and feedback.*
