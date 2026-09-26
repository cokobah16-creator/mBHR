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
   - **Pricing Plan:** Free tier is enough to try the app. For production
     with patient data, use a plan with point-in-time recovery (Pro or
     higher); see 6.3 Backup Strategy
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

### 1.6 Bootstrap the first administrator only: create the login

> **Only for the first administrator, once.** This step and 1.7 are the only
> time a staff account is made in the Supabase dashboard. Everyone else,
> including training accounts, is added by an administrator on the app's
> **Users** screen (see [4.1](#41-add-staff-from-the-users-screen)). Staff
> created in the dashboard get no invitation, are not tracked by the Users
> screen and show up as problems in Account Health.

1. Go to **Authentication** → **Users** in Supabase dashboard
2. Click "Add user" → "Create new user"
3. Fill in:
   - **Email:** admin@yourdomain.com
   - **Password:** Generate strong password
   - **Auto Confirm User:** Yes ✅
4. Click "Create user"
5. Note the User ID (you'll need it next)

### 1.7 Bootstrap the first administrator only: grant admin access

This gives the login from 1.6 its staff record, as the permanent
administrator. Do not use it for anyone else.

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
4. Once the app is deployed (Step 2), sign in at the app with **Online**
   sign-in, using this email and password. The first online sign-in on each
   device asks you to choose a 6-digit PIN for offline use on that device.
   From then on, add every other staff member from **Users** (4.1).

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

**Moving from an old hostname (m-bhr.vercel.app to mbhr.app):**

Records saved in the browser (patients, the staff list, device PINs and
unsent changes) belong to one web address. `vercel.json` redirects page
addresses on `m-bhr.vercel.app` to `https://mbhr.app`, but does not redirect
paths with a file extension there (`/sw.js`, `/workbox-*.js`,
`/manifest.webmanifest`, `/index.html`, `/assets/*`, icons). An app installed
on the old address keeps updating to the current build, which shows the
"wrong address" warning. Do not widen that redirect to every path: a service
worker update check does not follow redirects, so installed apps would stay
on their old build. For each device still on the old address:

1. Sign in online there and run Sync until nothing is waiting to upload.
2. Then open `https://mbhr.app`, sign in online and set a device PIN there.

The app does not yet stop anyone moving while changes are unsent, so staff
must sync first.

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

### 4.1 Add staff from the Users screen

Every staff member, including training accounts, is added by an
administrator on the app's **Users** screen. The app creates their login and
staff record on the server and emails them an invitation. Nobody types SQL
and nobody chooses a password for someone else.

**Before you start**

- The `staff-admin` function is deployed: see
  [STAFF_ADMIN_FUNCTION.md](./STAFF_ADMIN_FUNCTION.md). Until it is, Users
  says "Staff account setup isn't available on this server yet" and Add
  Staff is switched off.
- Outgoing email is set up and the staff invitation email is installed: see
  [STAFF_INVITE_EMAIL.md](./STAFF_INVITE_EMAIL.md).
- You are signed in with **Online** sign-in as an administrator. A PIN
  unlock is not enough, and Add Staff needs an internet connection.

**Add a staff member**

1. Open **Users** and press **Add Staff**.
2. Enter their full name, their work email and their role. The roles offered
   are the ones the server allows (for example volunteer, nurse, doctor and
   pharmacist). Administrator accounts can't be added here yet.
3. Press **Send invitation**. There is no PIN or password field: the
   administrator never sets either.
4. They receive an email called "You've been added to mBHR". The link works
   once and expires after the time set in **Email OTP Expiration** (1 hour
   by default; `STAFF_INVITE_LIFETIME_SECONDS` must match it).
5. They open the link, press **Continue** and choose a password.
6. They sign in at the app with **Online** sign-in using that email and
   password. The first time they sign in online on each device, they choose
   a 6-digit PIN for offline use on that device. PINs never leave the device.

If the invitation email didn't go out (for example outgoing email isn't set
up yet), the account is still created: use **Resend invitation** on their
row once email works. If the screen says it couldn't confirm the account was
created, press **Send invitation** again: it won't create a duplicate.

For training, add one account per role with email addresses you control,
and disable them when training is over.

Facility, individual permissions and an offline-access switch aren't
available yet. What someone can do comes from their role.

**Statuses**

| Status | Meaning | What to do |
| --- | --- | --- |
| Invited | The invitation was sent and not used yet. "Link may have expired" means it is older than the link lifetime. | **Resend invitation** if they can't find it or it expired. |
| Active | They have set a password. "Never signed in" means they haven't signed in yet. | Nothing. **Reset password** emails them a link to choose a new one; their current password keeps working until they use it. |
| Setup required | "No login yet", "Invitation not sent" or "Password not set yet". | **Resend invitation**, or fix it from Account Health (below). |
| Disabled | An administrator disabled them. "Devices not updated yet" means their login is blocked but devices haven't been told yet; open **Login status** to check. "No staff role" means the staff record has no role that can sign in. "Turned off outside this screen" means the staff record was switched off some other way; Reactivate can't undo that, so ask whoever runs your server. | **Reactivate** to let them back in. A disabled administrator can't be reactivated from this screen yet. |
| This device only | A staff record that exists only on this device (made before staff accounts were created on the server). | Add them with **Add Staff** using their email, then use **Retire device-only record** or **Delete** on their old row. |
| Not checked | The server couldn't be asked (for example you are offline). | Try again when online. |

**Login status** on a row shows their email, when the invitation was sent,
when they set a password and when they last signed in online. **Edit**
changes a staff member's name and role. You can't change your own role or a
permanent administrator's; the screen shows the server's reason. To set or
reset someone's PIN on this device, use **Set PIN on this device** or
**Reset PIN on this device** on their row.

**Disable and Reactivate**

- **Disable** blocks their online sign-in straight away and removes their
  role until they are reactivated. Every device switches them off the next
  time it syncs, PIN sign-in included. If they are signed in right now, that
  can continue for a short while. When they try to sign in, the app tells
  them an administrator has disabled their account. You can't disable your
  own account or a permanent administrator. While administrator accounts
  can't be added here, disabling another administrator (or using **Edit** to
  give them another role) can't be undone from this screen: the screen warns
  you before you confirm.
- **Reactivate** gives them back the role they had. If the server doesn't
  know which role that was, it asks you to choose one. They are switched back
  on for the device you reactivate them from, even if they were switched off
  there by hand. Other devices where an administrator switched them off by
  hand ("Deactivate on this device") stay off until they are activated there.
- **Deactivate on this device** and **Activate on this device** only change
  this one device and never the server.
- **Delete** is only offered for records on this device only. Staff who have
  a server account are disabled, never deleted.

**Account Health**

The **Account health** panel under the list compares logins with staff
records and lists anything that doesn't match:

- A staff record that can't sign in online: **Create login** (type their full
  name to confirm, and the email they'll use). They get an invitation.
- A login with no staff record, so it can't open the staff app: **Create
  staff record** (type their email in full, choose a role, and tick "I know
  this person and they should have staff access"). Only do this for someone
  you know.
- Staff records that weren't created from the Users screen (listed for
  information when `STAFF_ADMIN_LAUNCHED_AT` is set). If you don't know the
  person, use **Disable** on their row.
- A login that was never confirmed can't be repaired: if they work here, add
  them with **Add Staff**.
- Patient portal logins are counted but need no action: they are not staff.

**Never create staff in the Supabase dashboard**

After the first administrator (1.6 and 1.7), never create, edit or delete
staff logins or `app_users` rows in the Supabase dashboard or the SQL
editor. Accounts made there get no invitation, aren't tracked by the Users
screen and show up in Account Health. Roles and administrator settings are
changed only on the server by the Users screen: a device never uploads a
staff member's role or administrator flags, so a role changed any other way
on a device does not reach the server.

A staff member who used to have a record on this device only and now signs
in online with the same email gets their server account: the old device
record is switched off on that device, and they choose a new PIN.

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
- The nightly GitHub Actions job (`.github/workflows/backup.yml`) writes a
  schema dump, a data dump (app tables), an `auth`/`storage` data dump and
  a roles dump to the private `backups` bucket. Restore steps:
  `docs/deployment/RESTORE_RUNBOOK.md`.
- That bucket is in the production project itself: keep a copy of the
  dumps outside the project too (recommended), or a lost project takes its
  backups with it.
- Supabase's own daily backups and point-in-time recovery depend on the
  plan (point-in-time recovery needs Pro or higher). Confirm in the
  dashboard what the production project has.

**Photo and document backups:**
- Files in Storage buckets (patient photos, portal documents) are **not**
  in any database dump; the dumps hold only the storage object list.
- Copy the buckets separately (for example `supabase storage cp -r` to a
  store outside the project) on a schedule.

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
