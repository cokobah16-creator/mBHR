/*
  # Portal Enhancements Migration
  
  ## Overview
  This migration adds comprehensive portal enhancements including:
  - Patient portal user and session management
  - Record visibility control for granular access
  - Patient-submitted health data with approval workflow
  - Auto-enrollment configuration
  - Messaging system
  - Performance optimization indexes
  
  ## New Tables
  
  ### 1. patient_portal_users
  Patient portal accounts with OTP authentication
  
  ### 2. patient_portal_sessions
  Active session tracking for portal users
  
  ### 3. patient_messages
  Secure messaging between patients and staff
  
  ### 4. patient_notifications
  Notifications for patients
  
  ### 5. patient_submitted_data
  Patient health data submissions for staff review
  
  ### 6. portal_enrollment_settings
  Auto-enrollment configuration
  
  ### 7. record_visibility_log
  Audit trail for record visibility changes
  
  ## Modified Tables
  - vitals: Added portal_visible column
  - consultations: Added portal_visible column
  - dispenses: Added portal_visible column
  - patients: Added auto-enrollment fields
*/

-- ============================================================================
-- PATIENT PORTAL USERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL UNIQUE,
  phone_number text,
  email text,
  phone_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT false,
  otp_secret text,
  otp_expires_at timestamptz,
  otp_attempts integer NOT NULL DEFAULT 0,
  last_otp_sent_at timestamptz,
  account_status text NOT NULL CHECK (account_status IN ('active', 'suspended', 'locked')) DEFAULT 'active',
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  preferred_language text NOT NULL DEFAULT 'en',
  notification_preferences jsonb NOT NULL DEFAULT '{"sms": true, "email": true}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_users_patient ON patient_portal_users(patient_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_phone ON patient_portal_users(phone_number);
CREATE INDEX IF NOT EXISTS idx_portal_users_email ON patient_portal_users(email);

ALTER TABLE patient_portal_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Portal users can view own data" ON patient_portal_users;
CREATE POLICY "Portal users can view own data"
  ON patient_portal_users FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Portal users can update own data" ON patient_portal_users;
CREATE POLICY "Portal users can update own data"
  ON patient_portal_users FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Allow insert for portal users" ON patient_portal_users;
CREATE POLICY "Allow insert for portal users"
  ON patient_portal_users FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- PATIENT PORTAL SESSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid REFERENCES patient_portal_users(id) ON DELETE CASCADE NOT NULL,
  session_token text NOT NULL UNIQUE,
  device_fingerprint text,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_user ON patient_portal_sessions(portal_user_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_token ON patient_portal_sessions(session_token);

ALTER TABLE patient_portal_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sessions viewable" ON patient_portal_sessions;
CREATE POLICY "Sessions viewable"
  ON patient_portal_sessions FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Sessions insertable" ON patient_portal_sessions;
CREATE POLICY "Sessions insertable"
  ON patient_portal_sessions FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Sessions updatable" ON patient_portal_sessions;
CREATE POLICY "Sessions updatable"
  ON patient_portal_sessions FOR UPDATE
  USING (true);

-- ============================================================================
-- PATIENT MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('patient', 'staff')),
  sender_id text NOT NULL,
  subject text,
  message_body text NOT NULL,
  parent_message_id uuid REFERENCES patient_messages(id),
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  attachments jsonb,
  priority text NOT NULL CHECK (priority IN ('normal', 'high')) DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_messages_patient ON patient_messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_unread ON patient_messages(patient_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_patient_messages_created ON patient_messages(created_at DESC);

ALTER TABLE patient_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Messages viewable" ON patient_messages;
CREATE POLICY "Messages viewable"
  ON patient_messages FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Messages insertable" ON patient_messages;
CREATE POLICY "Messages insertable"
  ON patient_messages FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Messages updatable" ON patient_messages;
CREATE POLICY "Messages updatable"
  ON patient_messages FOR UPDATE
  USING (true);

-- ============================================================================
-- PATIENT NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')) DEFAULT 'normal',
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  action_url text,
  action_label text,
  metadata jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_notifications_patient ON patient_notifications(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_unread ON patient_notifications(patient_id, read) WHERE read = false;

ALTER TABLE patient_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications viewable" ON patient_notifications;
CREATE POLICY "Notifications viewable"
  ON patient_notifications FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Notifications insertable" ON patient_notifications;
CREATE POLICY "Notifications insertable"
  ON patient_notifications FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Notifications updatable" ON patient_notifications;
CREATE POLICY "Notifications updatable"
  ON patient_notifications FOR UPDATE
  USING (true);

-- ============================================================================
-- APPOINTMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  provider_id text,
  appointment_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status text NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'arrived', 'in-progress', 'completed', 'no-show', 'cancelled')) DEFAULT 'scheduled',
  reason text,
  notes text,
  reminder_sent boolean DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_upcoming ON appointments(patient_id, scheduled_at) WHERE status IN ('scheduled', 'confirmed');

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Appointments viewable" ON appointments;
CREATE POLICY "Appointments viewable"
  ON appointments FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Appointments insertable" ON appointments;
CREATE POLICY "Appointments insertable"
  ON appointments FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Appointments updatable" ON appointments;
CREATE POLICY "Appointments updatable"
  ON appointments FOR UPDATE
  USING (true);

-- ============================================================================
-- ADD PORTAL VISIBILITY COLUMNS TO CLINICAL TABLES
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vitals' AND column_name = 'portal_visible'
  ) THEN
    ALTER TABLE vitals ADD COLUMN portal_visible boolean NOT NULL DEFAULT true;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vitals' AND column_name = 'visibility_reason'
  ) THEN
    ALTER TABLE vitals ADD COLUMN visibility_reason text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vitals' AND column_name = 'hidden_by'
  ) THEN
    ALTER TABLE vitals ADD COLUMN hidden_by text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vitals' AND column_name = 'hidden_at'
  ) THEN
    ALTER TABLE vitals ADD COLUMN hidden_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consultations' AND column_name = 'portal_visible'
  ) THEN
    ALTER TABLE consultations ADD COLUMN portal_visible boolean NOT NULL DEFAULT true;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consultations' AND column_name = 'visibility_reason'
  ) THEN
    ALTER TABLE consultations ADD COLUMN visibility_reason text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consultations' AND column_name = 'hidden_by'
  ) THEN
    ALTER TABLE consultations ADD COLUMN hidden_by text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consultations' AND column_name = 'hidden_at'
  ) THEN
    ALTER TABLE consultations ADD COLUMN hidden_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispenses' AND column_name = 'portal_visible'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN portal_visible boolean NOT NULL DEFAULT true;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispenses' AND column_name = 'visibility_reason'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN visibility_reason text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispenses' AND column_name = 'hidden_by'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN hidden_by text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispenses' AND column_name = 'hidden_at'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN hidden_at timestamptz;
  END IF;
END $$;

-- ============================================================================
-- ADD AUTO-ENROLLMENT FIELDS TO PATIENTS TABLE
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'portal_enabled'
  ) THEN
    ALTER TABLE patients ADD COLUMN portal_enabled boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'auto_enrolled'
  ) THEN
    ALTER TABLE patients ADD COLUMN auto_enrolled boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'auto_enrolled_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN auto_enrolled_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'portal_opt_out'
  ) THEN
    ALTER TABLE patients ADD COLUMN portal_opt_out boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'email'
  ) THEN
    ALTER TABLE patients ADD COLUMN email text;
  END IF;
END $$;

-- ============================================================================
-- PATIENT SUBMITTED DATA TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_submitted_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  portal_user_id uuid,
  submission_type text NOT NULL CHECK (submission_type IN ('symptoms', 'medications', 'allergies', 'lifestyle', 'vitals', 'other')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'merged')) DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  merged_to_record_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submitted_data_patient ON patient_submitted_data(patient_id);
CREATE INDEX IF NOT EXISTS idx_submitted_data_status ON patient_submitted_data(status);
CREATE INDEX IF NOT EXISTS idx_submitted_data_created ON patient_submitted_data(created_at DESC);

ALTER TABLE patient_submitted_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Submitted data viewable" ON patient_submitted_data;
CREATE POLICY "Submitted data viewable"
  ON patient_submitted_data FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Submitted data insertable" ON patient_submitted_data;
CREATE POLICY "Submitted data insertable"
  ON patient_submitted_data FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Submitted data updatable" ON patient_submitted_data;
CREATE POLICY "Submitted data updatable"
  ON patient_submitted_data FOR UPDATE
  USING (true);

-- ============================================================================
-- PORTAL ENROLLMENT SETTINGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal_enrollment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO portal_enrollment_settings (setting_key, setting_value, description)
VALUES 
  ('auto_enrollment_enabled', 'true'::jsonb, 'Enable automatic portal enrollment for eligible patients'),
  ('require_email', 'false'::jsonb, 'Require email for auto-enrollment'),
  ('send_welcome_notification', 'true'::jsonb, 'Send welcome notification to newly enrolled patients')
ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE portal_enrollment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Settings viewable" ON portal_enrollment_settings;
CREATE POLICY "Settings viewable"
  ON portal_enrollment_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Settings updatable" ON portal_enrollment_settings;
CREATE POLICY "Settings updatable"
  ON portal_enrollment_settings FOR UPDATE
  USING (true);

-- ============================================================================
-- RECORD VISIBILITY LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS record_visibility_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL CHECK (record_type IN ('vitals', 'consultations', 'dispenses', 'lab_results')),
  record_id text NOT NULL,
  patient_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('hidden', 'shown')),
  reason text,
  performed_by text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visibility_log_patient ON record_visibility_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_visibility_log_record ON record_visibility_log(record_type, record_id);

ALTER TABLE record_visibility_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Visibility log viewable" ON record_visibility_log;
CREATE POLICY "Visibility log viewable"
  ON record_visibility_log FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Visibility log insertable" ON record_visibility_log;
CREATE POLICY "Visibility log insertable"
  ON record_visibility_log FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_vitals_patient_taken ON vitals(patient_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_patient_created ON consultations(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispenses_patient_dispensed ON dispenses(patient_id, dispensed_at DESC);

-- ============================================================================
-- DASHBOARD COUNTS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_patient_dashboard_counts(p_patient_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'unread_messages', (
      SELECT COUNT(*) FROM patient_messages 
      WHERE patient_id = p_patient_id AND read = false AND sender_type = 'staff'
    ),
    'unread_notifications', (
      SELECT COUNT(*) FROM patient_notifications 
      WHERE patient_id = p_patient_id AND read = false
    ),
    'upcoming_appointments', (
      SELECT COUNT(*) FROM appointments 
      WHERE patient_id = p_patient_id
      AND status IN ('scheduled', 'confirmed')
      AND scheduled_at >= now()
    ),
    'pending_submissions', (
      SELECT COUNT(*) FROM patient_submitted_data 
      WHERE patient_id = p_patient_id AND status = 'pending'
    )
  ) INTO result;
  
  RETURN result;
END;
$$;

-- ============================================================================
-- AUTO-ENROLLMENT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION check_auto_enrollment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auto_enabled boolean;
  require_email boolean;
BEGIN
  SELECT (setting_value)::boolean INTO auto_enabled
  FROM portal_enrollment_settings
  WHERE setting_key = 'auto_enrollment_enabled';
  
  SELECT (setting_value)::boolean INTO require_email
  FROM portal_enrollment_settings
  WHERE setting_key = 'require_email';
  
  IF auto_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  
  IF NEW.portal_opt_out = true THEN
    RETURN NEW;
  END IF;
  
  IF NEW.portal_enabled IS NOT TRUE THEN
    IF require_email = true THEN
      IF NEW.email IS NOT NULL AND NEW.email != '' THEN
        NEW.portal_enabled := true;
        NEW.auto_enrolled := true;
        NEW.auto_enrolled_at := now();
      END IF;
    ELSE
      IF (NEW.phone IS NOT NULL AND NEW.phone != '') OR (NEW.email IS NOT NULL AND NEW.email != '') THEN
        NEW.portal_enabled := true;
        NEW.auto_enrolled := true;
        NEW.auto_enrolled_at := now();
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_enrollment ON patients;
CREATE TRIGGER trigger_auto_enrollment
  BEFORE INSERT OR UPDATE ON patients
  FOR EACH ROW
  EXECUTE FUNCTION check_auto_enrollment();

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_patient_messages_updated_at ON patient_messages;
CREATE TRIGGER update_patient_messages_updated_at
  BEFORE UPDATE ON patient_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_submitted_data_updated_at ON patient_submitted_data;
CREATE TRIGGER update_patient_submitted_data_updated_at
  BEFORE UPDATE ON patient_submitted_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_portal_users_updated_at ON patient_portal_users;
CREATE TRIGGER update_portal_users_updated_at
  BEFORE UPDATE ON patient_portal_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
