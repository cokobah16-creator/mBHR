# Portal Enrollment Quick Start Guide

## For Clinical Staff

### Enrolling a Patient During Registration

1. **Fill in Patient Information**
   - Enter patient's basic details (name, DOB, address, etc.)
   - Add either email address OR phone number (required for portal access)

2. **Enable Portal Access**
   - Portal enrollment section appears automatically when contact info is added
   - Check the box: ☑️ "Enable patient portal access"
   - Confirm you explained portal benefits to patient

3. **Send Invitation (Optional)**
   - Check ☑️ "Send invitation now" to immediately send OTP link
   - OR leave unchecked to send invitation later from patient details

4. **Complete Registration**
   - Click "Register Patient"
   - Patient record saved with portal enabled
   - Invitation queued/sent based on your selection

### Managing Portal Access for Existing Patient

1. **Open Patient Details**
   - Navigate to patient record
   - Find "Portal Access" card

2. **Portal Status Card Shows:**
   - Current status (Enabled/Disabled/Verified/Pending)
   - Contact method (email/SMS)
   - Last login time
   - Invitation history

3. **Available Actions:**
   - **Toggle**: Enable/Disable portal access
   - **Send/Resend**: Send portal invitation (60-second cooldown applies)
   - View countdown timer if recently sent

## For Administrators

### Viewing Portal Analytics

1. **Navigate to Portal Dashboard**
   - URL: `/admin/portal-dashboard`
   - View statistics:
     - Total patients vs Portal enabled
     - Verified users count
     - Pending verifications
     - Active users (last 30 days)
     - Total invitations sent

2. **Manage Patients**
   - Search patients by name
   - Filter by status (all/enabled/disabled/verified/pending)
   - Click patient name to view details
   - See invitation counts and activity

### Bulk Migration of Existing Patients

1. **Navigate to Migration Tool**
   - URL: `/admin/portal-migration`

2. **Filter Patients**
   - **Date Range**: Registration date (From/To)
   - **State**: Filter by patient's state
   - **Contact Method**: Email only, Phone only, or Any

3. **Select Patients**
   - Review filtered list
   - Check "Select All" or individual patients
   - Preview total selected

4. **Enable Portal Access**
   - Click "Enable Portal Access for Selected"
   - Optional: Check "Send invitations immediately"
   - Monitor progress bar

5. **Review Results**
   - See success/failure counts
   - View detailed error messages
   - Export results to CSV

## Technical Details

### Rate Limiting
- 60-second cooldown between invitation resends per patient
- Countdown timer displayed in UI
- Configurable via `VITE_INVITE_RATE_MS` environment variable

### Background Sync
- Automatically starts when app loads
- Processes invitation queue every 30 seconds
- Syncs portal activity from Supabase
- Works offline - queues operations for later

### Contact Requirements
- Portal requires at least one contact method:
  - Email address (preferred)
  - OR Phone number (SMS)
- Terms acceptance required before enabling

### Invitation Flow
**Immediate Send:**
- Staff checks "Send invitation now" during registration
- Invitation queued immediately
- Background worker sends within 30 seconds
- Patient receives OTP link via email/SMS

**Deferred Send:**
- Portal enabled without immediate invitation
- Staff can send later from patient details
- Click "Send Invitation" button
- Same background processing applies

### Patient Experience
1. Patient receives invitation via email/SMS
2. Clicks link to portal login page
3. Enters email/phone and requests OTP
4. Receives 6-digit OTP code
5. Logs in with OTP
6. First login verifies contact and activates account
7. Portal access granted

### Troubleshooting

**Portal section doesn't appear in registration form:**
- Ensure email OR phone is filled in
- Check browser console for errors

**Can't resend invitation:**
- Check rate limit countdown timer
- Wait 60 seconds since last send
- Verify patient has contact info

**Invitation not received:**
- Check dev mode logs (console shows OTP)
- Verify email/phone number is correct
- Check spam folder (email)
- Verify SMS service configured (production)

**Patient can't login:**
- Verify portal is enabled for patient
- Check contact information is correct
- Ensure OTP service is configured
- Check Supabase auth logs

### Configuration

**Environment Variables:**
```bash
# Rate limit for invitation resends (milliseconds)
VITE_INVITE_RATE_MS=60000  # Default: 60 seconds

# Supabase configuration (already set)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

**Sync Worker Customization:**
```typescript
// In App.tsx, change sync interval
startPortalSyncWorker(60)  // Sync every 60 seconds instead of 30
```

## Best Practices

### For Staff
1. ✅ Always explain portal benefits to patients before enabling
2. ✅ Verify contact information is accurate
3. ✅ Use immediate send for tech-savvy patients
4. ✅ Use deferred send if patient needs help setting up
5. ✅ Check portal status before calling patients about access issues

### For Administrators
1. ✅ Use bulk migration during low-activity periods
2. ✅ Filter by contact method to ensure successful delivery
3. ✅ Export results for record-keeping
4. ✅ Monitor dashboard weekly for adoption metrics
5. ✅ Follow up with patients who haven't verified within 1 week

### Security
1. 🔒 Never share OTP codes over insecure channels
2. 🔒 Verify patient identity before enabling portal
3. 🔒 Terms acceptance required for all enrollments
4. 🔒 Admin tools protected by role-based access
5. 🔒 All data synced securely to Supabase

## Support

**For technical issues:**
- Check browser console for errors
- Review background sync worker logs
- Verify Supabase connection status

**For user issues:**
- Verify contact information
- Check rate limit timers
- Review invitation history in patient details

**For bulk operations:**
- Start with small test batch (10-20 patients)
- Monitor progress closely
- Export and review results
- Address failures before proceeding

---

## Quick Reference Commands

```bash
# Run development server
npm run dev

# Run tests
npm run test:run

# Build for production
npm run build

# Check types
npm run typecheck
```

## URLs

- **Portal Dashboard**: `/admin/portal-dashboard`
- **Bulk Migration**: `/admin/portal-migration`
- **Patient Login**: `/patient/login`
- **Patient Registration**: `/patient/register`

