# Patient Portal Technical Specification

**Project:** mBHR Patient Portal
**Version:** 1.0
**Date:** October 2025
**Status:** Implementation Phase

---

## 1. Executive Summary

The mBHR Patient Portal extends the existing Medical Bridge Health Reach platform to provide patients with secure, mobile-friendly access to their medical records, appointment management, and communication with their care team. The portal leverages the existing offline-first architecture and Supabase infrastructure while maintaining strict data security and privacy controls.

### Key Features
- OTP-based authentication (SMS/Email)
- Personal health record access
- Appointment scheduling and management
- Secure messaging with care team
- Medication reminders and tracking
- Lab results viewing
- Document uploads and management

---

## 2. Architecture Overview

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Patient Portal Layer                     │
├─────────────────────────────────────────────────────────────┤
│  - Patient Dashboard UI                                      │
│  - OTP Authentication                                        │
│  - Medical Records Viewer                                    │
│  - Appointment Scheduler                                     │
│  - Messaging Interface                                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Authentication Layer                       │
├─────────────────────────────────────────────────────────────┤
│  - OTP Generation & Validation                              │
│  - Session Management                                        │
│  - Rate Limiting                                            │
│  - Device Fingerprinting                                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Data Access Layer                       │
├─────────────────────────────────────────────────────────────┤
│  - Row Level Security (RLS)                                 │
│  - Read-Only Medical Data Views                             │
│  - Audit Logging                                            │
│  - Data Encryption                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Supabase Database                       │
├─────────────────────────────────────────────────────────────┤
│  - Patient Portal Tables                                    │
│  - Existing Clinical Tables (Read-Only)                     │
│  - Audit & Logging Tables                                   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

**Frontend:**
- React 18 + TypeScript
- React Router for navigation
- React Hook Form + Zod validation
- Tailwind CSS for styling
- Progressive Web App (PWA)

**Backend:**
- Supabase PostgreSQL database
- Supabase Edge Functions for OTP delivery
- Row Level Security (RLS) for data access control
- Supabase Realtime for notifications

**Authentication:**
- OTP via SMS (Twilio/Africa's Talking)
- OTP via Email (SendGrid/Supabase Email)
- JWT token-based sessions
- Device fingerprinting

**Offline Support:**
- IndexedDB via Dexie
- Service Worker caching
- Background sync
- Offline queue for actions

---

## 3. Database Schema

### 3.1 Patient Portal Tables

#### patient_portal_users
Stores patient portal account information.

```sql
CREATE TABLE patient_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL UNIQUE,
  phone_number text NOT NULL,
  email text,
  phone_verified boolean DEFAULT false,
  email_verified boolean DEFAULT false,
  otp_secret text,
  otp_expires_at timestamptz,
  otp_attempts integer DEFAULT 0,
  last_otp_sent_at timestamptz,
  account_status text CHECK (account_status IN ('active', 'suspended', 'locked')) DEFAULT 'active',
  failed_login_attempts integer DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  preferred_language text DEFAULT 'en',
  notification_preferences jsonb DEFAULT '{"sms": true, "email": true, "push": false}'::jsonb,
  consent_given boolean DEFAULT false,
  consent_given_at timestamptz,
  terms_accepted_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Indexes:**
- `idx_patient_portal_users_patient` on patient_id
- `idx_patient_portal_users_phone` on phone_number
- `idx_patient_portal_users_email` on email

#### patient_portal_sessions
Tracks active patient portal sessions.

```sql
CREATE TABLE patient_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid REFERENCES patient_portal_users(id) ON DELETE CASCADE NOT NULL,
  session_token text NOT NULL UNIQUE,
  device_fingerprint text,
  device_name text,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_activity_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);
```

**Indexes:**
- `idx_patient_portal_sessions_user` on portal_user_id
- `idx_patient_portal_sessions_token` on session_token
- `idx_patient_portal_sessions_expires` on expires_at

#### patient_portal_access_logs
Comprehensive audit trail for patient data access.

```sql
CREATE TABLE patient_portal_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid REFERENCES patient_portal_users(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  action_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  ip_address inet,
  user_agent text,
  success boolean DEFAULT true,
  error_message text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
```

**Indexes:**
- `idx_patient_portal_access_logs_user` on portal_user_id
- `idx_patient_portal_access_logs_patient` on patient_id
- `idx_patient_portal_access_logs_created` on created_at

#### patient_notifications
Notifications and alerts for patients.

```sql
CREATE TABLE patient_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  priority text CHECK (priority IN ('low', 'normal', 'high', 'urgent')) DEFAULT 'normal',
  read boolean DEFAULT false,
  read_at timestamptz,
  action_url text,
  action_label text,
  metadata jsonb,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

**Indexes:**
- `idx_patient_notifications_patient` on patient_id
- `idx_patient_notifications_read` on read
- `idx_patient_notifications_created` on created_at

#### patient_messages
Secure messaging between patients and care team.

```sql
CREATE TABLE patient_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  sender_type text CHECK (sender_type IN ('patient', 'staff')) NOT NULL,
  sender_id uuid NOT NULL,
  subject text,
  message_body text NOT NULL,
  parent_message_id uuid REFERENCES patient_messages(id) ON DELETE CASCADE,
  read boolean DEFAULT false,
  read_at timestamptz,
  attachments jsonb,
  priority text CHECK (priority IN ('normal', 'high')) DEFAULT 'normal',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Indexes:**
- `idx_patient_messages_patient` on patient_id
- `idx_patient_messages_parent` on parent_message_id
- `idx_patient_messages_created` on created_at

#### patient_appointment_requests
Patient-initiated appointment requests.

```sql
CREATE TABLE patient_appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  appointment_type text NOT NULL,
  preferred_date_1 date NOT NULL,
  preferred_time_1 text,
  preferred_date_2 date,
  preferred_time_2 text,
  preferred_date_3 date,
  preferred_time_3 text,
  reason text,
  notes text,
  status text CHECK (status IN ('pending', 'approved', 'scheduled', 'declined', 'cancelled')) DEFAULT 'pending',
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  scheduled_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Indexes:**
- `idx_patient_appointment_requests_patient` on patient_id
- `idx_patient_appointment_requests_status` on status
- `idx_patient_appointment_requests_created` on created_at

#### patient_documents
Patient-uploaded documents (insurance, forms, etc.).

```sql
CREATE TABLE patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  document_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by_patient boolean DEFAULT true,
  uploaded_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  description text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Indexes:**
- `idx_patient_documents_patient` on patient_id
- `idx_patient_documents_type` on document_type

#### patient_consent_records
Tracks patient consent for data sharing and access.

```sql
CREATE TABLE patient_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  consent_type text NOT NULL,
  consent_given boolean NOT NULL,
  consent_text text NOT NULL,
  consent_version text NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  revoked_at timestamptz
);
```

**Indexes:**
- `idx_patient_consent_records_patient` on patient_id
- `idx_patient_consent_records_type` on consent_type

### 3.2 Read-Only Views for Patients

#### patient_medical_history_view
Aggregated view of patient medical history.

```sql
CREATE VIEW patient_medical_history_view AS
SELECT
  p.id as patient_id,
  p.given_name,
  p.family_name,
  p.dob,
  p.sex,
  v.id as visit_id,
  v.started_at as visit_date,
  vt.height_cm,
  vt.weight_kg,
  vt.bmi,
  vt.temp_c,
  vt.pulse_bpm,
  vt.systolic,
  vt.diastolic,
  vt.spo2,
  c.soap_subjective,
  c.soap_objective,
  c.soap_assessment,
  c.soap_plan,
  c.provisional_dx,
  c.provider_name
FROM patients p
LEFT JOIN visits v ON p.id = v.patient_id
LEFT JOIN vitals vt ON v.id = vt.visit_id
LEFT JOIN consultations c ON v.id = c.visit_id
WHERE v.status = 'closed'
ORDER BY v.started_at DESC;
```

---

## 4. Authentication Flow

### 4.1 OTP Registration Process

```
1. Patient enters phone number/email
2. System validates format and checks for existing account
3. Generate 6-digit OTP code
4. Send OTP via SMS/Email (Supabase Edge Function)
5. Patient enters OTP code
6. System validates OTP (correct code, not expired, attempts < 5)
7. Link to existing patient record (by phone/DOB match)
8. Create patient_portal_users record
9. Generate session token (JWT)
10. Return session token to client
11. Store session in patient_portal_sessions table
```

### 4.2 OTP Login Process

```
1. Patient enters phone number/email
2. System looks up patient_portal_users record
3. Check account status (not locked/suspended)
4. Generate 6-digit OTP code
5. Send OTP via preferred channel
6. Patient enters OTP code
7. Validate OTP (correct, not expired, attempts < 5)
8. Reset failed_login_attempts on success
9. Update last_login_at timestamp
10. Generate new session token
11. Create session record
12. Return session token to client
```

### 4.3 Session Management

- **Session Duration:** 24 hours of activity
- **Idle Timeout:** 30 minutes of inactivity
- **Token Refresh:** Automatic on activity
- **Concurrent Sessions:** Max 3 devices per patient
- **Session Invalidation:** On logout, password change, or security event

### 4.4 Security Measures

- **Rate Limiting:** 3 OTP requests per hour per phone number
- **OTP Expiry:** 10 minutes from generation
- **Max Attempts:** 5 failed OTP attempts = 1 hour lockout
- **Device Fingerprinting:** Track suspicious login patterns
- **IP Tracking:** Monitor for unusual locations
- **Audit Logging:** Log all authentication events

---

## 5. Row Level Security (RLS) Policies

### 5.1 Patient Portal Users Table

```sql
-- Patients can only view their own portal user record
CREATE POLICY "Patients can view own portal account"
  ON patient_portal_users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Patients can update their own notification preferences
CREATE POLICY "Patients can update own preferences"
  ON patient_portal_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Staff can view patient portal accounts
CREATE POLICY "Staff can view patient portal accounts"
  ON patient_portal_users FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse')
    )
  );
```

### 5.2 Patient Medical Records Access

```sql
-- Patients can only view their own medical records
CREATE POLICY "Patients can view own medical records"
  ON visits FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Similar policies for vitals, consultations, dispenses, lab_results, etc.
```

### 5.3 Patient Messages

```sql
-- Patients can view messages to/from them
CREATE POLICY "Patients can view own messages"
  ON patient_messages FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can send messages
CREATE POLICY "Patients can send messages"
  ON patient_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND sender_type = 'patient'
    AND sender_id = auth.uid()
  );
```

---

## 6. API Endpoints

### 6.1 Authentication Endpoints

**POST /api/patient/register**
- Request OTP for registration
- Body: `{ phone: string, email?: string }`
- Returns: `{ success: boolean, message: string }`

**POST /api/patient/verify-registration**
- Verify OTP and create account
- Body: `{ phone: string, otp: string, dob: string }`
- Returns: `{ sessionToken: string, patient: PatientProfile }`

**POST /api/patient/login**
- Request OTP for login
- Body: `{ phone: string }`
- Returns: `{ success: boolean, message: string }`

**POST /api/patient/verify-login**
- Verify OTP and create session
- Body: `{ phone: string, otp: string }`
- Returns: `{ sessionToken: string, patient: PatientProfile }`

**POST /api/patient/logout**
- Invalidate current session
- Headers: `Authorization: Bearer {sessionToken}`
- Returns: `{ success: boolean }`

### 6.2 Medical Records Endpoints

**GET /api/patient/profile**
- Get patient profile information
- Returns: `{ patient: PatientProfile }`

**GET /api/patient/visits**
- Get visit history
- Query: `?limit=20&offset=0&from=date&to=date`
- Returns: `{ visits: Visit[], total: number }`

**GET /api/patient/visits/:id**
- Get detailed visit information
- Returns: `{ visit: VisitDetail }`

**GET /api/patient/medications**
- Get medication history
- Returns: `{ medications: Medication[] }`

**GET /api/patient/lab-results**
- Get lab results
- Returns: `{ results: LabResult[] }`

**GET /api/patient/vitals**
- Get vitals history
- Returns: `{ vitals: Vital[] }`

### 6.3 Appointment Endpoints

**GET /api/patient/appointments**
- Get upcoming and past appointments
- Returns: `{ appointments: Appointment[] }`

**POST /api/patient/appointments/request**
- Request new appointment
- Body: `{ appointmentType, preferredDates, reason }`
- Returns: `{ request: AppointmentRequest }`

**PUT /api/patient/appointments/:id/cancel**
- Cancel appointment
- Returns: `{ success: boolean }`

### 6.4 Messaging Endpoints

**GET /api/patient/messages**
- Get message inbox
- Returns: `{ messages: Message[] }`

**POST /api/patient/messages**
- Send message to care team
- Body: `{ subject, messageBody, priority }`
- Returns: `{ message: Message }`

**PUT /api/patient/messages/:id/read**
- Mark message as read
- Returns: `{ success: boolean }`

---

## 7. Security and Compliance

### 7.1 Data Protection

- **Encryption at Rest:** All sensitive data encrypted in database
- **Encryption in Transit:** TLS 1.3 for all API calls
- **Data Minimization:** Only expose necessary patient data
- **Data Retention:** Logs retained for 90 days, then archived
- **Data Deletion:** Support for patient data deletion requests

### 7.2 Access Control

- **Authentication Required:** All endpoints require valid session token
- **Row Level Security:** Database-level access control
- **Audit Logging:** All data access logged with timestamp and IP
- **Session Management:** Automatic timeout and token rotation
- **Device Tracking:** Monitor and alert on suspicious devices

### 7.3 Privacy Compliance

- **Consent Management:** Track and enforce patient consent
- **Data Export:** Provide patient data in machine-readable format
- **Data Portability:** Support for data transfer to other providers
- **Privacy Policy:** Clear terms displayed and tracked
- **Opt-Out Options:** Patients can disable notifications/messages

### 7.4 HIPAA-Like Requirements

- **Access Controls:** Role-based access with minimum necessary principle
- **Audit Controls:** Comprehensive logging of all PHI access
- **Integrity Controls:** Data validation and checksums
- **Transmission Security:** Encrypted communications
- **Breach Notification:** System for detecting and reporting breaches

---

## 8. User Experience

### 8.1 Patient Dashboard Layout

```
┌──────────────────────────────────────────────────────┐
│  [Logo]  Patient Portal        [Notifications] [☰]   │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Welcome back, [Patient Name]                        │
│                                                       │
│  ┌─────────────────┐  ┌─────────────────┐          │
│  │  Next Appt      │  │  Messages       │          │
│  │  Mar 15, 10am   │  │  3 unread       │          │
│  └─────────────────┘  └─────────────────┘          │
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  Recent Vitals                               │   │
│  │  BP: 120/80  |  HR: 72  |  Temp: 98.6°F    │   │
│  └──────────────────────────────────────────────┘   │
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  Medications (2)                             │   │
│  │  • Lisinopril 10mg - Take once daily        │   │
│  │  • Metformin 500mg - Take twice daily       │   │
│  └──────────────────────────────────────────────┘   │
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  Quick Actions                               │   │
│  │  [Request Appointment] [Send Message]        │   │
│  │  [View Lab Results]    [Refill Rx]          │   │
│  └──────────────────────────────────────────────┘   │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### 8.2 Mobile Optimization

- **Touch Targets:** Minimum 44x44px for all interactive elements
- **Responsive Design:** Adapts to screen sizes 320px - 1920px
- **Offline Mode:** Full functionality without internet connection
- **Progressive Web App:** Installable on home screen
- **Fast Loading:** Initial load < 3 seconds on 3G
- **Minimal Data Usage:** Optimized images and API responses

### 8.3 Accessibility

- **Screen Reader Support:** ARIA labels on all elements
- **Keyboard Navigation:** Tab order and focus indicators
- **Color Contrast:** WCAG AA compliance (4.5:1 minimum)
- **Text Scaling:** Supports up to 200% zoom
- **Alternative Text:** All images have descriptive alt text
- **Language Support:** English, Hausa, Yoruba, Igbo, Pidgin

---

## 9. Performance Requirements

### 9.1 Response Times

- **OTP Generation:** < 2 seconds
- **Login:** < 1 second after OTP verification
- **Dashboard Load:** < 2 seconds
- **Medical Records Load:** < 1 second
- **Search Results:** < 500ms
- **Message Send:** < 1 second

### 9.2 Scalability

- **Concurrent Users:** Support 10,000 active patients
- **API Rate Limits:** 100 requests per minute per user
- **Database Queries:** All queries optimized with indexes
- **Caching:** Redis cache for frequently accessed data
- **CDN:** Static assets served via CDN

### 9.3 Availability

- **Uptime Target:** 99.9% (8.7 hours downtime per year)
- **Offline Mode:** Full read access without internet
- **Backup Schedule:** Daily automated backups
- **Disaster Recovery:** RPO < 24 hours, RTO < 4 hours

---

## 10. Implementation Timeline

### Phase 1: Foundation (Week 1-2)
- Database schema creation
- OTP authentication system
- Basic patient dashboard
- RLS policies implementation

### Phase 2: Core Features (Week 3-4)
- Medical records viewer
- Appointment request system
- Messaging interface
- Document uploads

### Phase 3: Integration (Week 5)
- Connect to existing mBHR features
- Sync between staff and patient views
- Notification system
- Offline functionality

### Phase 4: Testing & Security (Week 6)
- Security audit and penetration testing
- Performance testing
- User acceptance testing
- Accessibility audit

### Phase 5: Deployment (Week 7)
- Pilot deployment with 50 patients
- Staff training
- Documentation finalization
- Production rollout

---

## 11. Monitoring and Analytics

### 11.1 Key Metrics

- **User Engagement:** Daily/weekly active users
- **Feature Usage:** Most accessed features
- **Session Duration:** Average time spent in portal
- **Error Rates:** Failed logins, API errors
- **Performance:** Page load times, API response times

### 11.2 Security Monitoring

- **Failed Login Attempts:** Alert on > 5 attempts
- **Unusual Access Patterns:** Geographic anomalies
- **Data Access:** Track PHI access by patient
- **Session Anomalies:** Multiple concurrent sessions

### 11.3 Health Checks

- **Database Status:** Connection pool, query performance
- **API Availability:** Endpoint health checks
- **OTP Delivery:** SMS/email delivery success rates
- **Storage Usage:** Database and file storage metrics

---

## 12. Support and Maintenance

### 12.1 Patient Support

- **Help Documentation:** In-app help articles
- **FAQ Section:** Common questions and answers
- **Support Contact:** Phone and email support
- **Video Tutorials:** Step-by-step guides
- **Live Chat:** Optional real-time support

### 12.2 Technical Maintenance

- **Security Updates:** Monthly security patches
- **Feature Updates:** Quarterly feature releases
- **Bug Fixes:** Hotfix process for critical issues
- **Database Maintenance:** Weekly optimization
- **Backup Verification:** Monthly restore tests

---

## 13. Risk Mitigation

### 13.1 Security Risks

- **Unauthorized Access:** Mitigated by OTP + device fingerprinting
- **Data Breach:** Mitigated by encryption + RLS + audit logging
- **Session Hijacking:** Mitigated by token rotation + HTTPS
- **Brute Force:** Mitigated by rate limiting + account lockout

### 13.2 Operational Risks

- **System Downtime:** Mitigated by offline mode + redundancy
- **Data Loss:** Mitigated by daily backups + replication
- **Performance Degradation:** Mitigated by monitoring + auto-scaling
- **SMS Delivery Failure:** Mitigated by email fallback + retry logic

---

## Appendix A: Glossary

- **OTP:** One-Time Password
- **RLS:** Row Level Security
- **PWA:** Progressive Web App
- **PHI:** Protected Health Information
- **HIPAA:** Health Insurance Portability and Accountability Act
- **JWT:** JSON Web Token
- **API:** Application Programming Interface

## Appendix B: References

- mBHR Core Platform Documentation
- WCAG 2.1 Accessibility Guidelines
- OWASP Security Best Practices
- Supabase Documentation
- React Best Practices

---

**Document Version History:**
- v1.0 (Oct 2025): Initial specification
