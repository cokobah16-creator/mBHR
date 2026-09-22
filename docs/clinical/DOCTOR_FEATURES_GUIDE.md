# Doctor Features Access Guide

## Where to Find Doctor Functions

### 1. **Main Dashboard** (`/dashboard`)

When you log in as a doctor, you'll see:

- **"Doctor Station"** as the FIRST quick action card (blue color)
- Click this to access your dedicated doctor consultation interface

### 2. **Side Navigation Menu**

Look for:

- **"Doctor Station"** link in the left sidebar navigation
- Only visible to users with doctor role or admin role

### 3. **Doctor Dashboard** (`/doctor/dashboard`)

#### What You'll See:

- **Real-time consultation queue** showing patients waiting for you
- **Patient cards** with:
  - Patient photo and basic info (name, age, sex, phone)
  - Latest vitals (BP, temperature, pulse, SpO2)
  - Abnormal vital signs flagged with color-coded alerts
  - Patient flags from other stations (urgent, recheck vitals, pharmacy queries)
  - Wait time for each patient
  - "Start Consultation" button
  - "View History" button

#### Performance Metrics (Top Right):

- Patients seen today
- Consultations completed
- Average consultation time

#### Smart Queue Features:

- Patients with urgent flags appear first
- High-risk vitals patients prioritized
- Patients sorted by wait time and priority
- Empty state when no patients waiting

#### Quick Actions (Bottom):

- Lab Orders
- Pharmacy
- All Patients
- Protocols (coming soon)

### 4. **Available Doctor Services**

The following backend services are ready for use:

#### Patient Flags (Inter-Station Communication)

- Create flags to request vitals recheck
- Query pharmacy about prescriptions
- Escalate cases to supervising doctor
- Mark lab orders as pending

#### Referrals

- Refer patients to specialists
- Send to hospital for advanced care
- Request lab work or imaging
- Schedule follow-up consultations
- Track referral status

#### Follow-Up Scheduling

- Schedule return visits for chronic patients
- Link to future outreach events
- Track follow-up completion
- Send reminders (future feature)

#### Prescription Templates

- Quick-add common medication combinations
- Protocol-based prescribing
- "Malaria Kit", "BP Protocol", etc.

#### Site Formulary

- View available medications at current site
- Check stock levels
- See alternative medications
- Controlled substance tracking

#### Analytics

- Real-time performance during events
- Post-event summary reports
- Comparison with team averages
- Diagnosis tracking

#### Protocols & Guidelines

- Clinical decision support
- Treatment algorithms
- Local disease information
- Contraindication checking

### 5. **Role Permissions**

Doctors can:

- ✅ Register patients
- ✅ Record vital signs
- ✅ Perform consultations (SOAP notes)
- ✅ Write prescriptions
- ✅ Create referrals
- ✅ Order lab tests
- ✅ Schedule appointments
- ✅ View all patient records
- ✅ Access doctor dashboard
- ✅ View analytics

Doctors cannot:

- ❌ Dispense medications (pharmacist only)
- ❌ Manage inventory directly (pharmacist only)
- ❌ Manage users (admin only)
- ❌ Export all system data (admin only)

### 6. **Multi-Tenant & Event Context**

The system automatically detects:

- Your current organization (e.g., DIOF)
- Active outreach event you're assigned to
- Site location (PHC facility)
- Your role and permissions

This ensures you only see:

- Patients at your current site
- Formulary for your location
- Team members at your event
- Relevant flags and communications

### 7. **Next Steps for Full Implementation**

Currently built but not yet in UI:

- Prescription builder with formulary integration
- Protocol library interface
- Outreach event planner for doctors
- Supervising doctor review workflow
- Cross-site patient history viewer
- Regional disease surveillance

### 8. **Quick Start for Doctors**

1. **Log in** with your doctor credentials
2. Click **"Doctor Station"** on main dashboard
3. See your **consultation queue**
4. Click **"Start Consultation"** on a patient
5. Review their vitals and flags
6. Complete SOAP notes
7. Write prescription (existing workflow)
8. Create referral if needed (new form available)
9. Move to next patient

### 9. **For Administrators**

To enable a user as a doctor:

1. Go to User Management
2. Set user role to "doctor"
3. They will automatically see Doctor Station links
4. Assign them to outreach events for full context

### 10. **Troubleshooting**

**Q: I don't see "Doctor Station" link**

- Check your user role is set to "doctor" or "admin"
- Refresh the page after role change

**Q: The queue is empty**

- Patients must be in "consult" stage to appear
- Check the main Queue page to move patients forward

**Q: I can't see patient flags**

- Flags require active outreach event context
- Other stations must create flags for you to see them

**Q: Analytics not showing**

- Analytics track per-event performance
- You must be assigned to an active outreach event

### 11. **Database Tables Created**

For developers, the following Supabase tables support doctor features:

- `organizations` - Multi-tenant org management
- `sites` - PHC locations
- `outreach_events` - Event scheduling and tracking
- `event_staff_assignments` - Staff roster management
- `patient_flags` - Inter-station communication
- `referrals` - Patient referral tracking
- `follow_up_schedules` - Return visit scheduling
- `prescription_templates` - Quick prescribing
- `site_formulary` - Location-specific medications
- `doctor_analytics` - Performance metrics
- `consultation_reviews` - Quality assurance
- `protocol_library` - Clinical guidelines

All tables have Row-Level Security (RLS) ensuring data isolation between organizations.
