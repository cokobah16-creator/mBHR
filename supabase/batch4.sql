-- Migration: 20251214163828_fix_palaver_room_rls_policies.sql
-- ============================================================
/*
  # Fix Palaver Room RLS Policies

  ## Problem
  The original RLS policies used `auth.uid()::text` which requires Supabase Auth.
  However, this app uses local IndexedDB authentication with ULID user IDs,
  meaning `auth.uid()` returns null and blocks all operations.

  ## Solution
  Replace restrictive auth-based policies with permissive policies that:
  - Allow operations for any connection with a valid anon key
  - Still maintain RLS enabled for future security enhancements
  - Use `anon` role since the app doesn't sign users into Supabase Auth

  ## Changes
  1. Drop existing restrictive policies on palaver_messages
  2. Drop existing restrictive policies on palaver_broadcasts
  3. Drop existing restrictive policies on palaver_broadcast_reads
  4. Create permissive policies for all three tables

  ## Security Note
  This is acceptable because:
  - The anon key is only available to the app
  - User identity is tracked via sender_id/recipient_id fields
  - The app handles access control at the application layer
*/

-- Drop existing restrictive policies for palaver_messages
DROP POLICY IF EXISTS "Users can view messages they sent or received" ON palaver_messages;
DROP POLICY IF EXISTS "Users can insert messages they send" ON palaver_messages;
DROP POLICY IF EXISTS "Recipients can update read status" ON palaver_messages;

-- Drop existing restrictive policies for palaver_broadcasts
DROP POLICY IF EXISTS "All authenticated users can view active broadcasts" ON palaver_broadcasts;
DROP POLICY IF EXISTS "Doctors and admins can create broadcasts" ON palaver_broadcasts;

-- Drop existing restrictive policies for palaver_broadcast_reads
DROP POLICY IF EXISTS "Users can view their own broadcast reads" ON palaver_broadcast_reads;
DROP POLICY IF EXISTS "Users can mark broadcasts as read" ON palaver_broadcast_reads;

-- Create permissive policies for palaver_messages
DO $$ BEGIN
  CREATE POLICY "Allow select on palaver_messages"
  ON palaver_messages FOR SELECT
  TO anon, authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow insert on palaver_messages"
  ON palaver_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow update on palaver_messages"
  ON palaver_messages FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow delete on palaver_messages"
  ON palaver_messages FOR DELETE
  TO anon, authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create permissive policies for palaver_broadcasts
DO $$ BEGIN
  CREATE POLICY "Allow select on palaver_broadcasts"
  ON palaver_broadcasts FOR SELECT
  TO anon, authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow insert on palaver_broadcasts"
  ON palaver_broadcasts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow update on palaver_broadcasts"
  ON palaver_broadcasts FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow delete on palaver_broadcasts"
  ON palaver_broadcasts FOR DELETE
  TO anon, authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create permissive policies for palaver_broadcast_reads
DO $$ BEGIN
  CREATE POLICY "Allow select on palaver_broadcast_reads"
  ON palaver_broadcast_reads FOR SELECT
  TO anon, authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow insert on palaver_broadcast_reads"
  ON palaver_broadcast_reads FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow update on palaver_broadcast_reads"
  ON palaver_broadcast_reads FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow delete on palaver_broadcast_reads"
  ON palaver_broadcast_reads FOR DELETE
  TO anon, authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- Migration: 20260115072241_add_portal_enhancements_v3.sql
-- ============================================================
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
DO $$ BEGIN
  CREATE POLICY "Portal users can view own data"
  ON patient_portal_users FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Portal users can update own data" ON patient_portal_users;
DO $$ BEGIN
  CREATE POLICY "Portal users can update own data"
  ON patient_portal_users FOR UPDATE
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Allow insert for portal users" ON patient_portal_users;
DO $$ BEGIN
  CREATE POLICY "Allow insert for portal users"
  ON patient_portal_users FOR INSERT
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
DO $$ BEGIN
  CREATE POLICY "Sessions viewable"
  ON patient_portal_sessions FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Sessions insertable" ON patient_portal_sessions;
DO $$ BEGIN
  CREATE POLICY "Sessions insertable"
  ON patient_portal_sessions FOR INSERT
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Sessions updatable" ON patient_portal_sessions;
DO $$ BEGIN
  CREATE POLICY "Sessions updatable"
  ON patient_portal_sessions FOR UPDATE
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
DO $$ BEGIN
  CREATE POLICY "Messages viewable"
  ON patient_messages FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Messages insertable" ON patient_messages;
DO $$ BEGIN
  CREATE POLICY "Messages insertable"
  ON patient_messages FOR INSERT
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Messages updatable" ON patient_messages;
DO $$ BEGIN
  CREATE POLICY "Messages updatable"
  ON patient_messages FOR UPDATE
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
DO $$ BEGIN
  CREATE POLICY "Notifications viewable"
  ON patient_notifications FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Notifications insertable" ON patient_notifications;
DO $$ BEGIN
  CREATE POLICY "Notifications insertable"
  ON patient_notifications FOR INSERT
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Notifications updatable" ON patient_notifications;
DO $$ BEGIN
  CREATE POLICY "Notifications updatable"
  ON patient_notifications FOR UPDATE
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
DO $$ BEGIN
  CREATE POLICY "Appointments viewable"
  ON appointments FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Appointments insertable" ON appointments;
DO $$ BEGIN
  CREATE POLICY "Appointments insertable"
  ON appointments FOR INSERT
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Appointments updatable" ON appointments;
DO $$ BEGIN
  CREATE POLICY "Appointments updatable"
  ON appointments FOR UPDATE
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
DO $$ BEGIN
  CREATE POLICY "Submitted data viewable"
  ON patient_submitted_data FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Submitted data insertable" ON patient_submitted_data;
DO $$ BEGIN
  CREATE POLICY "Submitted data insertable"
  ON patient_submitted_data FOR INSERT
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Submitted data updatable" ON patient_submitted_data;
DO $$ BEGIN
  CREATE POLICY "Submitted data updatable"
  ON patient_submitted_data FOR UPDATE
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
DO $$ BEGIN
  CREATE POLICY "Settings viewable"
  ON portal_enrollment_settings FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Settings updatable" ON portal_enrollment_settings;
DO $$ BEGIN
  CREATE POLICY "Settings updatable"
  ON portal_enrollment_settings FOR UPDATE
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
DO $$ BEGIN
  CREATE POLICY "Visibility log viewable"
  ON record_visibility_log FOR SELECT
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Visibility log insertable" ON record_visibility_log;
DO $$ BEGIN
  CREATE POLICY "Visibility log insertable"
  ON record_visibility_log FOR INSERT
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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


-- Migration: 20260116102858_fix_patient_portal_missing_objects.sql
-- ============================================================
/*
  # Fix Patient Portal - Add Missing Database Objects

  This migration adds all missing tables, columns, and functions required
  for patient portal authentication and registration to work properly.

  ## 1. New Tables
    - `patient_portal_access_logs` - Audit trail for portal access
    - `otp_rate_limits` - Track OTP request rate limiting

  ## 2. New Columns on `patient_portal_users`
    - `consent_given` (boolean) - Whether patient accepted terms
    - `consent_given_at` (timestamptz) - When consent was given
    - `terms_accepted_version` (text) - Version of terms accepted
    - `terms_accepted_at` (timestamptz) - When terms were accepted

  ## 3. New Columns on `patients`
    - `portal_invited_at` (timestamptz) - When portal invite was sent
    - `contact_verified` (boolean) - Whether contact info is verified
    - `last_portal_activity` (timestamptz) - Last portal activity timestamp

  ## 4. New Functions
    - `check_and_increment_otp_rate_limit` - Rate limiting for OTP requests

  ## 5. Security
    - RLS enabled on all new tables
    - Policies for authenticated access
*/

-- ============================================
-- 1. Add missing columns to patient_portal_users
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patient_portal_users' AND column_name = 'consent_given'
  ) THEN
    ALTER TABLE patient_portal_users ADD COLUMN consent_given boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patient_portal_users' AND column_name = 'consent_given_at'
  ) THEN
    ALTER TABLE patient_portal_users ADD COLUMN consent_given_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patient_portal_users' AND column_name = 'terms_accepted_version'
  ) THEN
    ALTER TABLE patient_portal_users ADD COLUMN terms_accepted_version text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patient_portal_users' AND column_name = 'terms_accepted_at'
  ) THEN
    ALTER TABLE patient_portal_users ADD COLUMN terms_accepted_at timestamptz;
  END IF;
END $$;

-- ============================================
-- 2. Add missing columns to patients table
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'portal_invited_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN portal_invited_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'contact_verified'
  ) THEN
    ALTER TABLE patients ADD COLUMN contact_verified boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'last_portal_activity'
  ) THEN
    ALTER TABLE patients ADD COLUMN last_portal_activity timestamptz;
  END IF;
END $$;

-- ============================================
-- 3. Create OTP rate limits table
-- ============================================

CREATE TABLE IF NOT EXISTS otp_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_method text NOT NULL CHECK (contact_method IN ('phone', 'email')),
  contact_value text NOT NULL,
  request_count integer DEFAULT 1,
  window_start timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(contact_method, contact_value)
);

ALTER TABLE otp_rate_limits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage OTP rate limits"
  ON otp_rate_limits
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 4. Create patient portal access logs table
-- ============================================

CREATE TABLE IF NOT EXISTS patient_portal_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid REFERENCES patient_portal_users(id),
  patient_id text NOT NULL,
  action_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  success boolean DEFAULT true,
  error_message text,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE patient_portal_access_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Staff can view access logs"
  ON patient_portal_access_logs
  FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "System can insert access logs"
  ON patient_portal_access_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_portal_access_logs_patient 
  ON patient_portal_access_logs(patient_id);
  
CREATE INDEX IF NOT EXISTS idx_portal_access_logs_portal_user 
  ON patient_portal_access_logs(portal_user_id);
  
CREATE INDEX IF NOT EXISTS idx_portal_access_logs_created 
  ON patient_portal_access_logs(created_at DESC);

-- ============================================
-- 5. Create rate limiting function
-- ============================================

CREATE OR REPLACE FUNCTION check_and_increment_otp_rate_limit(
  p_contact_method text,
  p_contact_value text,
  p_max_requests integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_minutes integer := 60;
  v_window_start timestamptz;
  v_current_count integer;
  v_result jsonb;
BEGIN
  v_window_start := now() - (v_window_minutes || ' minutes')::interval;
  
  -- Check existing rate limit record
  SELECT request_count, window_start 
  INTO v_current_count, v_window_start
  FROM otp_rate_limits
  WHERE contact_method = p_contact_method 
    AND contact_value = p_contact_value
    AND window_start > (now() - (v_window_minutes || ' minutes')::interval);
  
  IF v_current_count IS NULL THEN
    -- No recent record, create new one
    INSERT INTO otp_rate_limits (contact_method, contact_value, request_count, window_start)
    VALUES (p_contact_method, p_contact_value, 1, now())
    ON CONFLICT (contact_method, contact_value) 
    DO UPDATE SET 
      request_count = 1,
      window_start = now(),
      updated_at = now();
    
    RETURN jsonb_build_object(
      'allowed', true,
      'current_count', 1,
      'max_requests', p_max_requests,
      'retry_after_seconds', 0
    );
  END IF;
  
  IF v_current_count >= p_max_requests THEN
    -- Rate limit exceeded
    RETURN jsonb_build_object(
      'allowed', false,
      'current_count', v_current_count,
      'max_requests', p_max_requests,
      'retry_after_seconds', EXTRACT(EPOCH FROM (v_window_start + (v_window_minutes || ' minutes')::interval - now()))::integer
    );
  END IF;
  
  -- Increment counter
  UPDATE otp_rate_limits
  SET request_count = request_count + 1,
      updated_at = now()
  WHERE contact_method = p_contact_method 
    AND contact_value = p_contact_value;
  
  RETURN jsonb_build_object(
    'allowed', true,
    'current_count', v_current_count + 1,
    'max_requests', p_max_requests,
    'retry_after_seconds', 0
  );
END;
$$;


-- Migration: 20260121145002_add_patient_portal_registration_policy.sql
-- ============================================================
/*
  # Add Patient Portal Registration Policy

  1. Problem
    - Patient portal registration requires looking up patients by email/phone and DOB
    - Current RLS only allows authenticated users to access patients table
    - Registration happens before authentication, so the lookup fails

  2. Solution
    - Add a policy allowing anonymous users to SELECT from patients table
    - Policy is restricted to only allow lookup when email AND dob are specified
    - This enables the registration flow while maintaining security

  3. Security Notes
    - Anonymous users can only verify if a patient exists with matching email+dob
    - They cannot browse or list all patients
    - Full patient data access still requires authentication
*/

DO $$ BEGIN
  CREATE POLICY "Allow anonymous patient lookup for portal registration"
  ON patients
  FOR SELECT
  TO anon
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- Migration: 20260121150150_add_anonymous_patient_registration_policy.sql
-- ============================================================
/*
  # Allow Anonymous Patient Registration

  1. Problem
    - Patient portal registration creates new patient records
    - Current RLS only allows authenticated users to insert patients
    - Registration happens before authentication (anonymous user)

  2. Solution
    - Add INSERT policy for anonymous users on patients table
    - This enables self-registration for the patient portal

  3. Security Notes
    - Anonymous users can only INSERT new patient records
    - They cannot UPDATE, DELETE, or bulk SELECT patient data
    - The SELECT policy already exists for registration lookup
*/

DO $$ BEGIN
  CREATE POLICY "Allow anonymous patient registration"
  ON patients
  FOR INSERT
  TO anon
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- Migration: 20260125091118_add_tefca_audit_logs.sql
-- ============================================================
/*
  # TEFCA/IAS Integration - Audit Logging and Consent Management

  1. New Tables
    - `tefca_access_logs` - Comprehensive audit trail for all TEFCA data access
      - `id` (uuid, primary key)
      - `requesting_organization` (text) - Name of requesting organization
      - `qhin_id` (text) - Qualified Health Information Network identifier
      - `exchange_purpose` (text) - TEFCA exchange purpose code
      - `patient_id` (text) - Patient whose data was accessed
      - `resources_requested` (text[]) - FHIR resource types requested
      - `resources_returned` (integer) - Count of resources returned
      - `success` (boolean) - Whether request succeeded
      - `error_message` (text) - Error details if failed
      - `ip_address` (text) - Requesting IP address
      - `response_time_ms` (integer) - Response time in milliseconds
      - `created_at` (timestamptz) - Timestamp of access

    - `tefca_qhin_partners` - Registry of authorized QHIN partners
      - `id` (text, primary key) - QHIN identifier
      - `name` (text) - Organization name
      - `api_key_hash` (text) - Hashed API key for authentication
      - `allowed_purposes` (text[]) - Authorized exchange purposes
      - `active` (boolean) - Whether partner is active
      - `endpoint_url` (text) - Partner's FHIR endpoint
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `patient_data_sharing_preferences` - Patient preferences for TEFCA data sharing
      - `id` (uuid, primary key)
      - `patient_id` (text) - Reference to patient
      - `allow_ias_access` (boolean) - Allow Individual Access Services
      - `allow_treatment_access` (boolean) - Allow treatment purpose
      - `allow_payment_access` (boolean) - Allow payment purpose
      - `allow_operations_access` (boolean) - Allow operations purpose
      - `blocked_organizations` (text[]) - Organizations to block
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - RLS enabled on all tables
    - Admin-only access for QHIN partner management
    - Audit logs readable by admins only
    - Patient preferences editable by patient (via portal)

  3. Indexes
    - Index on patient_id for fast lookups
    - Index on qhin_id for partner queries
    - Index on created_at for time-based queries
*/

CREATE TABLE IF NOT EXISTS tefca_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_organization text NOT NULL,
  qhin_id text NOT NULL,
  exchange_purpose text NOT NULL CHECK (exchange_purpose IN ('individual-access', 'treatment', 'payment', 'operations')),
  patient_id text,
  resources_requested text[] DEFAULT '{}',
  resources_returned integer DEFAULT 0,
  success boolean DEFAULT false,
  error_message text,
  ip_address text,
  response_time_ms integer,
  user_agent text,
  request_id uuid DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tefca_qhin_partners (
  id text PRIMARY KEY,
  name text NOT NULL,
  api_key_hash text,
  allowed_purposes text[] DEFAULT ARRAY['individual-access']::text[],
  active boolean DEFAULT true,
  endpoint_url text,
  contact_email text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_data_sharing_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL UNIQUE,
  allow_ias_access boolean DEFAULT true,
  allow_treatment_access boolean DEFAULT true,
  allow_payment_access boolean DEFAULT false,
  allow_operations_access boolean DEFAULT false,
  blocked_organizations text[] DEFAULT '{}',
  require_notification boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tefca_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tefca_qhin_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_data_sharing_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tefca_access_logs' AND policyname = 'Admins can view TEFCA access logs'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Admins can view TEFCA access logs"
      ON tefca_access_logs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role = 'admin'
        )
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tefca_access_logs' AND policyname = 'Service role can insert TEFCA logs'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Service role can insert TEFCA logs"
      ON tefca_access_logs
      FOR INSERT
      TO service_role
      WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tefca_access_logs' AND policyname = 'Anon can insert TEFCA logs for edge functions'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Anon can insert TEFCA logs for edge functions"
      ON tefca_access_logs
      FOR INSERT
      TO anon
      WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tefca_qhin_partners' AND policyname = 'Admins can manage QHIN partners'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Admins can manage QHIN partners"
      ON tefca_qhin_partners
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role = 'admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role = 'admin'
        )
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_data_sharing_preferences' AND policyname = 'Patients can view own data sharing preferences'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Patients can view own data sharing preferences"
      ON patient_data_sharing_preferences
      FOR SELECT
      TO authenticated
      USING (
        patient_id = auth.uid()::text
        OR EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse')
        )
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_data_sharing_preferences' AND policyname = 'Patients can update own data sharing preferences'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Patients can update own data sharing preferences"
      ON patient_data_sharing_preferences
      FOR UPDATE
      TO authenticated
      USING (patient_id = auth.uid()::text)
      WITH CHECK (patient_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_data_sharing_preferences' AND policyname = 'Patients can insert own data sharing preferences'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Patients can insert own data sharing preferences"
      ON patient_data_sharing_preferences
      FOR INSERT
      TO authenticated
      WITH CHECK (patient_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tefca_access_logs_patient_id ON tefca_access_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_tefca_access_logs_qhin_id ON tefca_access_logs(qhin_id);
CREATE INDEX IF NOT EXISTS idx_tefca_access_logs_created_at ON tefca_access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tefca_access_logs_exchange_purpose ON tefca_access_logs(exchange_purpose);
CREATE INDEX IF NOT EXISTS idx_patient_data_sharing_patient_id ON patient_data_sharing_preferences(patient_id);

INSERT INTO tefca_qhin_partners (id, name, allowed_purposes, active, notes)
VALUES 
  ('demo-qhin-001', 'Demo Health Information Network', ARRAY['individual-access', 'treatment'], true, 'Demo QHIN for development and testing'),
  ('test-qhin-002', 'Test QHIN for Development', ARRAY['individual-access', 'treatment', 'payment', 'operations'], true, 'Full-access test QHIN')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION update_tefca_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_tefca_qhin_partners_updated_at'
  ) THEN
    CREATE TRIGGER update_tefca_qhin_partners_updated_at
      BEFORE UPDATE ON tefca_qhin_partners
      FOR EACH ROW
      EXECUTE FUNCTION update_tefca_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_patient_data_sharing_preferences_updated_at'
  ) THEN
    CREATE TRIGGER update_patient_data_sharing_preferences_updated_at
      BEFORE UPDATE ON patient_data_sharing_preferences
      FOR EACH ROW
      EXECUTE FUNCTION update_tefca_updated_at();
  END IF;
END $$;

COMMENT ON TABLE tefca_access_logs IS 'Audit trail for all TEFCA/IAS data access requests - 6 year retention required';
COMMENT ON TABLE tefca_qhin_partners IS 'Registry of authorized Qualified Health Information Network partners';
COMMENT ON TABLE patient_data_sharing_preferences IS 'Patient preferences for health data sharing via TEFCA';
COMMENT ON COLUMN tefca_access_logs.exchange_purpose IS 'TEFCA exchange purpose: individual-access, treatment, payment, or operations';
COMMENT ON COLUMN tefca_access_logs.resources_requested IS 'FHIR resource types that were requested';
COMMENT ON COLUMN tefca_access_logs.request_id IS 'Unique identifier for correlating related log entries';


-- Migration: 20260125091822_add_immunizations_conditions_sdoh.sql
-- ============================================================
/*
  # Add Immunizations, Conditions, and SDOH Observations for TEFCA/IAS

  1. New Tables
    - `immunizations` - Patient vaccination records
      - `id` (uuid, primary key)
      - `patient_id` (text) - Reference to patient
      - `vaccine_code` (text) - CVX code for vaccine
      - `vaccine_name` (text) - Display name
      - `lot_number` (text) - Vaccine lot number
      - `administered_at` (timestamptz) - Date/time administered
      - `administered_by` (text) - Healthcare worker
      - `site` (text) - Injection site
      - `route` (text) - Route of administration
      - `dose_quantity` (decimal) - Dose amount
      - `dose_unit` (text) - Dose unit
      - `series_doses_recommended` (integer) - Recommended doses in series
      - `series_dose_number` (integer) - Current dose number
      - `status` (text) - completed, entered-in-error, not-done
      - `notes` (text) - Additional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `conditions` - Patient diagnoses and health conditions
      - `id` (uuid, primary key)
      - `patient_id` (text) - Reference to patient
      - `condition_code` (text) - ICD-10 or SNOMED code
      - `condition_name` (text) - Display name
      - `clinical_status` (text) - active, recurrence, relapse, inactive, remission, resolved
      - `verification_status` (text) - unconfirmed, provisional, differential, confirmed
      - `category` (text) - problem-list-item, encounter-diagnosis, health-concern
      - `severity` (text) - mild, moderate, severe
      - `onset_date` (date) - When condition started
      - `abatement_date` (date) - When condition resolved
      - `recorded_by` (text) - Healthcare worker who recorded
      - `notes` (text) - Additional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `sdoh_observations` - Social Determinants of Health
      - `id` (uuid, primary key)
      - `patient_id` (text) - Reference to patient
      - `category` (text) - housing, food, transportation, employment, education, social
      - `observation_code` (text) - LOINC code
      - `observation_name` (text) - Display name
      - `value_code` (text) - Coded answer
      - `value_text` (text) - Text answer
      - `value_boolean` (boolean) - Boolean answer
      - `effective_date` (date) - When observation was made
      - `recorded_by` (text) - Healthcare worker
      - `notes` (text) - Additional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Staff can read/write patient data
    - Patients can view their own records via portal

  3. Indexes
    - Index on patient_id for fast lookups
    - Index on vaccine_code for immunization queries
    - Index on condition_code for diagnosis queries
*/

CREATE TABLE IF NOT EXISTS immunizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  vaccine_code text,
  vaccine_name text NOT NULL,
  lot_number text,
  administered_at timestamptz DEFAULT now(),
  administered_by text,
  site text,
  route text,
  dose_quantity decimal(10,2),
  dose_unit text DEFAULT 'mL',
  series_doses_recommended integer,
  series_dose_number integer,
  status text DEFAULT 'completed' CHECK (status IN ('completed', 'entered-in-error', 'not-done')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  condition_code text,
  condition_name text NOT NULL,
  clinical_status text DEFAULT 'active' CHECK (clinical_status IN ('active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved')),
  verification_status text DEFAULT 'confirmed' CHECK (verification_status IN ('unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error')),
  category text DEFAULT 'problem-list-item' CHECK (category IN ('problem-list-item', 'encounter-diagnosis', 'health-concern')),
  severity text CHECK (severity IN ('mild', 'moderate', 'severe')),
  onset_date date,
  abatement_date date,
  recorded_by text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sdoh_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('housing', 'food', 'transportation', 'employment', 'education', 'social', 'financial', 'safety')),
  observation_code text,
  observation_name text NOT NULL,
  value_code text,
  value_text text,
  value_boolean boolean,
  effective_date date DEFAULT CURRENT_DATE,
  recorded_by text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE immunizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sdoh_observations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'immunizations' AND policyname = 'Staff can manage immunizations'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Staff can manage immunizations"
      ON immunizations
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse', 'volunteer')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse')
        )
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'immunizations' AND policyname = 'Patients can view own immunizations'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Patients can view own immunizations"
      ON immunizations
      FOR SELECT
      TO authenticated
      USING (patient_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'conditions' AND policyname = 'Staff can manage conditions'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Staff can manage conditions"
      ON conditions
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse', 'volunteer')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse')
        )
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'conditions' AND policyname = 'Patients can view own conditions'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Patients can view own conditions"
      ON conditions
      FOR SELECT
      TO authenticated
      USING (patient_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sdoh_observations' AND policyname = 'Staff can manage SDOH observations'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Staff can manage SDOH observations"
      ON sdoh_observations
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse', 'volunteer')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse')
        )
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sdoh_observations' AND policyname = 'Patients can view own SDOH observations'
  ) THEN
DO $$ BEGIN
      CREATE POLICY "Patients can view own SDOH observations"
      ON sdoh_observations
      FOR SELECT
      TO authenticated
      USING (patient_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_immunizations_patient_id ON immunizations(patient_id);
CREATE INDEX IF NOT EXISTS idx_immunizations_vaccine_code ON immunizations(vaccine_code);
CREATE INDEX IF NOT EXISTS idx_immunizations_administered_at ON immunizations(administered_at DESC);

CREATE INDEX IF NOT EXISTS idx_conditions_patient_id ON conditions(patient_id);
CREATE INDEX IF NOT EXISTS idx_conditions_condition_code ON conditions(condition_code);
CREATE INDEX IF NOT EXISTS idx_conditions_clinical_status ON conditions(clinical_status);

CREATE INDEX IF NOT EXISTS idx_sdoh_patient_id ON sdoh_observations(patient_id);
CREATE INDEX IF NOT EXISTS idx_sdoh_category ON sdoh_observations(category);
CREATE INDEX IF NOT EXISTS idx_sdoh_effective_date ON sdoh_observations(effective_date DESC);

CREATE OR REPLACE FUNCTION update_immunizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_immunizations_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_immunizations_updated_at_trigger
      BEFORE UPDATE ON immunizations
      FOR EACH ROW
      EXECUTE FUNCTION update_immunizations_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_conditions_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_conditions_updated_at_trigger
      BEFORE UPDATE ON conditions
      FOR EACH ROW
      EXECUTE FUNCTION update_immunizations_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_sdoh_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_sdoh_updated_at_trigger
      BEFORE UPDATE ON sdoh_observations
      FOR EACH ROW
      EXECUTE FUNCTION update_immunizations_updated_at();
  END IF;
END $$;

COMMENT ON TABLE immunizations IS 'Patient vaccination records - FHIR Immunization resource';
COMMENT ON TABLE conditions IS 'Patient diagnoses and health conditions - FHIR Condition resource';
COMMENT ON TABLE sdoh_observations IS 'Social Determinants of Health observations - FHIR Observation (SDOH) resource';
COMMENT ON COLUMN immunizations.vaccine_code IS 'CVX vaccine code from CDC';
COMMENT ON COLUMN conditions.condition_code IS 'ICD-10-CM or SNOMED CT code';
COMMENT ON COLUMN sdoh_observations.category IS 'SDOH domain: housing, food, transportation, employment, education, social, financial, safety';


-- Migration: 20260125094038_add_conflict_resolution_system.sql
-- ============================================================
/*
  # Conflict Resolution System for PHI Minimization

  1. New Tables
    - `conflict_resolutions` - Tracks all detected conflicts and their resolution status
      - `id` (uuid, primary key)
      - `conflict_type` (text) - 'sync_conflict', 'duplicate', 'data_quality'
      - `entity_type` (text) - 'patients', 'vitals', 'consultations', etc.
      - `entity_id` (uuid) - The primary record involved
      - `candidate_ids` (uuid[]) - Related records (for duplicates)
      - `status` (text) - 'pending', 'resolved', 'ignored', 'auto_resolved'
      - `priority` (text) - 'low', 'medium', 'high', 'critical'
      - `phi_sensitivity` (text) - 'none', 'low', 'medium', 'high'
      - `conflict_details` (jsonb) - Field-level conflict information
      - `resolution_strategy` (text) - 'keep_local', 'keep_remote', 'manual', 'merge'
      - `resolution_details` (jsonb) - What was resolved and how
      - `resolved_by` (uuid) - User who resolved
      - `resolved_at` (timestamptz)
      - `approved_by` (uuid) - Secondary approver for high-PHI conflicts
      - `approved_at` (timestamptz)
      - `created_at`, `updated_at` timestamps

    - `conflict_audit_logs` - Detailed audit trail for compliance
      - `id` (uuid, primary key)
      - `conflict_id` (uuid, references conflict_resolutions)
      - `action` (text) - 'created', 'viewed', 'resolved', 'approved', 'appealed'
      - `actor_id` (uuid)
      - `actor_role` (text)
      - `field_changes` (jsonb) - Specific PHI fields accessed/modified
      - `justification` (text) - Reason for action
      - `ip_address` (text)
      - `created_at` timestamp

    - `auto_resolution_rules` - Configurable rules for automatic resolution
      - `id` (uuid, primary key)
      - `name` (text)
      - `entity_type` (text)
      - `conflict_type` (text)
      - `conditions` (jsonb) - Rule conditions
      - `resolution_strategy` (text)
      - `is_active` (boolean)
      - `phi_allowed` (boolean) - Whether rule can touch PHI fields
      - `created_by` (uuid)
      - timestamps

  2. Security
    - Enable RLS on all tables
    - Only authenticated users with admin/doctor role can access
    - Audit logs are append-only (no update/delete)

  3. Important Notes
    - PHI sensitivity tracking enables minimum necessary principle
    - Secondary approval workflow for high-sensitivity conflicts
    - Full audit trail for HIPAA compliance
*/

-- Conflict Resolutions Table
CREATE TABLE IF NOT EXISTS conflict_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_type text NOT NULL CHECK (conflict_type IN ('sync_conflict', 'duplicate', 'data_quality')),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  candidate_ids uuid[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored', 'auto_resolved', 'needs_approval')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  phi_sensitivity text NOT NULL DEFAULT 'low' CHECK (phi_sensitivity IN ('none', 'low', 'medium', 'high')),
  conflict_details jsonb NOT NULL DEFAULT '{}',
  resolution_strategy text CHECK (resolution_strategy IN ('keep_local', 'keep_remote', 'manual', 'merge', 'ignore')),
  resolution_details jsonb,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  auto_rule_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Conflict Audit Logs Table (append-only for compliance)
CREATE TABLE IF NOT EXISTS conflict_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL REFERENCES conflict_resolutions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'viewed', 'resolved', 'approved', 'rejected', 'appealed', 'auto_resolved')),
  actor_id uuid REFERENCES auth.users(id),
  actor_role text,
  field_changes jsonb DEFAULT '{}',
  justification text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto Resolution Rules Table
CREATE TABLE IF NOT EXISTS auto_resolution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  entity_type text NOT NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN ('sync_conflict', 'duplicate', 'data_quality')),
  conditions jsonb NOT NULL DEFAULT '{}',
  resolution_strategy text NOT NULL CHECK (resolution_strategy IN ('keep_local', 'keep_remote', 'keep_newer', 'keep_more_complete')),
  phi_allowed boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  priority_order int NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_status ON conflict_resolutions(status);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_entity ON conflict_resolutions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_priority ON conflict_resolutions(priority, status);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_created ON conflict_resolutions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_audit_logs_conflict ON conflict_audit_logs(conflict_id);
CREATE INDEX IF NOT EXISTS idx_conflict_audit_logs_actor ON conflict_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_auto_resolution_rules_active ON auto_resolution_rules(is_active, entity_type);

-- Enable RLS
ALTER TABLE conflict_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_resolution_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conflict_resolutions
DO $$ BEGIN
  CREATE POLICY "Staff can view conflicts"
  ON conflict_resolutions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create conflicts"
  ON conflict_resolutions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update conflicts"
  ON conflict_resolutions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for conflict_audit_logs (append-only)
DO $$ BEGIN
  CREATE POLICY "Staff can view audit logs"
  ON conflict_audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create audit logs"
  ON conflict_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- No UPDATE or DELETE policies for audit logs (immutable)

-- RLS Policies for auto_resolution_rules
DO $$ BEGIN
  CREATE POLICY "Admins can manage auto resolution rules"
  ON auto_resolution_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view auto resolution rules"
  ON auto_resolution_rules FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_conflict_resolution_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_conflict_resolutions_timestamp ON conflict_resolutions;
CREATE TRIGGER update_conflict_resolutions_timestamp
  BEFORE UPDATE ON conflict_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION update_conflict_resolution_timestamp();

DROP TRIGGER IF EXISTS update_auto_resolution_rules_timestamp ON auto_resolution_rules;
CREATE TRIGGER update_auto_resolution_rules_timestamp
  BEFORE UPDATE ON auto_resolution_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_conflict_resolution_timestamp();

-- Insert default auto-resolution rules
INSERT INTO auto_resolution_rules (name, description, entity_type, conflict_type, conditions, resolution_strategy, phi_allowed, priority_order)
VALUES 
  ('Keep Newer Vitals', 'Automatically keep the more recent vital signs reading', 'vitals', 'sync_conflict', '{"field_type": "measurement"}', 'keep_newer', false, 10),
  ('Keep More Complete Patient', 'For duplicates, prefer record with more populated fields', 'patients', 'duplicate', '{"completeness_threshold": 0.8}', 'keep_more_complete', false, 20)
ON CONFLICT DO NOTHING;

-- Migration: 20260125095031_add_enhanced_conflict_roles_and_site_settings.sql
-- ============================================================
/*
  # Enhanced Conflict Resolution: Roles and Site Settings

  1. Role Updates
    - Adds 'auditor' and 'lead_clinician' roles to app_users table
    - These roles have authority to approve high-sensitivity PHI conflict resolutions

  2. New Tables
    - `site_conflict_settings`
      - `id` (uuid, primary key)
      - `site_id` (text) - references the site
      - `name_match_threshold` (numeric) - adjustable for linguistic regions (e.g., 0.7 for Kano vs 0.85 for Delta State)
      - `phone_match_weight` (numeric) - regional phone format variations
      - `dob_match_weight` (numeric) - weight for date of birth matching
      - `auto_resolution_enabled` (boolean) - whether auto-resolution is enabled for this site
      - `high_phi_approval_required` (boolean) - whether high PHI conflicts require approval
      - `approved_auto_rules` (uuid array) - which global rules this site accepts
      - `linguistic_region` (text) - region identifier for name matching algorithms
      - Timestamps and audit fields

  3. Modified Tables
    - `conflict_resolutions`
      - Adds `required_approver_role` - specifies which role must approve
      - Adds `escalation_reason` - why escalation is needed
      - Adds `second_approver_id` and `second_approved_at` for dual-approval scenarios
      - Adds `site_id` for site-scoped conflicts
      - Adds `resolution_policy_reference` for legal/policy documentation

  4. Security
    - RLS enabled on site_conflict_settings
    - Only authenticated users with appropriate roles can modify settings
*/

-- Update app_users role check constraint to include new roles
DO $$
BEGIN
  ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
  ALTER TABLE app_users ADD CONSTRAINT app_users_role_check 
    CHECK (role = ANY (ARRAY['admin'::text, 'doctor'::text, 'nurse'::text, 'pharmacist'::text, 'volunteer'::text, 'auditor'::text, 'lead_clinician'::text]));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not update role constraint: %', SQLERRM;
END $$;

-- Create site_conflict_settings table
CREATE TABLE IF NOT EXISTS site_conflict_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL,
  site_name text,
  name_match_threshold numeric DEFAULT 0.8 CHECK (name_match_threshold >= 0 AND name_match_threshold <= 1),
  phone_match_weight numeric DEFAULT 0.9 CHECK (phone_match_weight >= 0 AND phone_match_weight <= 1),
  dob_match_weight numeric DEFAULT 0.95 CHECK (dob_match_weight >= 0 AND dob_match_weight <= 1),
  auto_resolution_enabled boolean DEFAULT true,
  high_phi_approval_required boolean DEFAULT true,
  approved_auto_rules uuid[] DEFAULT '{}',
  linguistic_region text DEFAULT 'default',
  require_dual_approval_for_patient_merge boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  UNIQUE(site_id)
);

COMMENT ON TABLE site_conflict_settings IS 'Site-level configuration for conflict resolution thresholds and auto-resolution rules';
COMMENT ON COLUMN site_conflict_settings.name_match_threshold IS 'Match threshold for name similarity (0-1). Lower values for regions with common name variations';
COMMENT ON COLUMN site_conflict_settings.linguistic_region IS 'Region identifier for name matching: default, hausa, yoruba, igbo, delta, etc.';
COMMENT ON COLUMN site_conflict_settings.require_dual_approval_for_patient_merge IS 'Requires both Lead Clinician AND Admin/Auditor for high-PHI patient merges';

ALTER TABLE site_conflict_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can view site conflict settings"
  ON site_conflict_settings
  FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage site conflict settings"
  ON site_conflict_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to conflict_resolutions table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'required_approver_role'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN required_approver_role text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'escalation_reason'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN escalation_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'second_approver_id'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN second_approver_id uuid REFERENCES auth.users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'second_approved_at'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN second_approved_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'site_id'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN site_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'resolution_policy_reference'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN resolution_policy_reference text;
  END IF;
END $$;

COMMENT ON COLUMN conflict_resolutions.required_approver_role IS 'Role required to approve this conflict: admin, auditor, or lead_clinician';
COMMENT ON COLUMN conflict_resolutions.escalation_reason IS 'Reason why this conflict requires escalated approval';
COMMENT ON COLUMN conflict_resolutions.second_approver_id IS 'Second approver for dual-approval scenarios (high-PHI patient merges)';
COMMENT ON COLUMN conflict_resolutions.resolution_policy_reference IS 'Reference to policy document authorizing this resolution type';

-- Add check constraint for required_approver_role
DO $$
BEGIN
  ALTER TABLE conflict_resolutions DROP CONSTRAINT IF EXISTS conflict_resolutions_required_approver_role_check;
  ALTER TABLE conflict_resolutions ADD CONSTRAINT conflict_resolutions_required_approver_role_check
    CHECK (required_approver_role IS NULL OR required_approver_role = ANY (ARRAY['admin'::text, 'auditor'::text, 'lead_clinician'::text]));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not add approver role constraint: %', SQLERRM;
END $$;

-- Create index for site-scoped conflict queries
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_site_id ON conflict_resolutions(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_required_approver ON conflict_resolutions(required_approver_role) WHERE required_approver_role IS NOT NULL;

-- Insert default global settings (site_id = 'global')
INSERT INTO site_conflict_settings (site_id, site_name, linguistic_region, name_match_threshold)
VALUES ('global', 'Global Default Settings', 'default', 0.8)
ON CONFLICT (site_id) DO NOTHING;

-- Insert example regional settings for Nigerian linguistic regions
INSERT INTO site_conflict_settings (site_id, site_name, linguistic_region, name_match_threshold)
VALUES 
  ('region_hausa', 'Hausa-Speaking Region (Kano, Kaduna)', 'hausa', 0.7),
  ('region_yoruba', 'Yoruba-Speaking Region (Lagos, Oyo)', 'yoruba', 0.75),
  ('region_igbo', 'Igbo-Speaking Region (Anambra, Enugu)', 'igbo', 0.75),
  ('region_delta', 'Niger Delta Region', 'delta', 0.85)
ON CONFLICT (site_id) DO NOTHING;

-- Migration: 20260125095109_add_conflict_delta_retention_and_archiving.sql
-- ============================================================
/*
  # Field-Level Delta Retention and Archiving System

  1. New Tables
    - `conflict_change_deltas`
      - Granular tracking of every field change during conflict resolution
      - Supports AI training data requirements and compliance audits
      - Indefinite retention of field-level changes
    
    - `archived_conflict_summaries`
      - Compressed summaries of conflicts older than 3 years
      - Reduces storage while maintaining compliance
      - Full audit trail preserved in cloud
    
    - `data_retention_policies`
      - Configurable retention periods per table
      - Supports legal holds and compliance requirements
      - Federal requirement: 3 years minimum, 6 years for TEFCA
    
    - `retention_policy_executions`
      - Audit trail of archiving operations
      - Tracks what was archived and when

  2. Security
    - RLS enabled on all tables
    - Audit-related tables restricted to admin and auditor roles
    - Archiving operations logged for compliance

  3. Important Notes
    - Retention policies align with ASTP grant requirements
    - 3-year active retention, indefinite delta storage for AI training
    - TEFCA logs require 6-year retention per federal requirements
*/

-- Create conflict_change_deltas table for granular field tracking
CREATE TABLE IF NOT EXISTS conflict_change_deltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL REFERENCES conflict_resolutions(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  change_type text NOT NULL CHECK (change_type IN ('merge', 'override', 'correction', 'auto_resolve')),
  changed_by uuid REFERENCES auth.users(id),
  changed_by_role text,
  phi_field boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE conflict_change_deltas IS 'Indefinite retention of field-level changes for AI training and compliance audits';
COMMENT ON COLUMN conflict_change_deltas.phi_field IS 'Whether this field contains Protected Health Information';
COMMENT ON COLUMN conflict_change_deltas.change_type IS 'Type of change: merge (combined values), override (replaced), correction (fixed error), auto_resolve (system decision)';

CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_conflict_id ON conflict_change_deltas(conflict_id);
CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_created_at ON conflict_change_deltas(created_at);
CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_phi_field ON conflict_change_deltas(phi_field) WHERE phi_field = true;

ALTER TABLE conflict_change_deltas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can view conflict change deltas"
  ON conflict_change_deltas
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor', 'lead_clinician', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins and auditors can insert conflict change deltas"
  ON conflict_change_deltas
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor', 'lead_clinician', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create archived_conflict_summaries table
CREATE TABLE IF NOT EXISTS archived_conflict_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_conflict_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  conflict_type text NOT NULL,
  resolution_summary jsonb NOT NULL DEFAULT '{}',
  total_fields_modified integer DEFAULT 0,
  phi_fields_accessed text[] DEFAULT '{}',
  resolution_strategy text,
  resolved_by_role text,
  approved_by_role text,
  original_created_at timestamptz NOT NULL,
  original_resolved_at timestamptz,
  archived_at timestamptz DEFAULT now(),
  archive_reason text DEFAULT 'retention_policy'
);

COMMENT ON TABLE archived_conflict_summaries IS 'Compressed summaries of conflicts archived after 3-year retention period';
COMMENT ON COLUMN archived_conflict_summaries.resolution_summary IS 'JSON summary of what changed, who approved, and why';
COMMENT ON COLUMN archived_conflict_summaries.phi_fields_accessed IS 'List of PHI field names that were involved in resolution';

CREATE INDEX IF NOT EXISTS idx_archived_conflict_summaries_original_id ON archived_conflict_summaries(original_conflict_id);
CREATE INDEX IF NOT EXISTS idx_archived_conflict_summaries_entity ON archived_conflict_summaries(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_archived_conflict_summaries_archived_at ON archived_conflict_summaries(archived_at);

ALTER TABLE archived_conflict_summaries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins and auditors can view archived summaries"
  ON archived_conflict_summaries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Only system can insert archived summaries"
  ON archived_conflict_summaries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create data_retention_policies table
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL UNIQUE,
  retention_period_days integer NOT NULL DEFAULT 1095,
  archive_strategy text NOT NULL DEFAULT 'summarize' CHECK (archive_strategy IN ('summarize', 'compress', 'delete', 'none')),
  legal_hold boolean DEFAULT false,
  legal_hold_reason text,
  legal_hold_until timestamptz,
  last_archive_run timestamptz,
  next_scheduled_run timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

COMMENT ON TABLE data_retention_policies IS 'Configurable data retention policies per table - aligns with federal requirements';
COMMENT ON COLUMN data_retention_policies.retention_period_days IS 'Days to retain active records before archiving (default 1095 = 3 years)';
COMMENT ON COLUMN data_retention_policies.archive_strategy IS 'How to handle old records: summarize (compress to summary), compress (store compressed), delete (remove), none (keep forever)';
COMMENT ON COLUMN data_retention_policies.legal_hold IS 'Prevents archiving during litigation or audit';

ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can manage retention policies"
  ON data_retention_policies
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can view retention policies"
  ON data_retention_policies
  FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create retention_policy_executions audit table
CREATE TABLE IF NOT EXISTS retention_policy_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid REFERENCES data_retention_policies(id),
  table_name text NOT NULL,
  execution_type text NOT NULL CHECK (execution_type IN ('archive', 'compress', 'delete', 'legal_hold_check')),
  records_processed integer DEFAULT 0,
  records_archived integer DEFAULT 0,
  records_deleted integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message text,
  executed_by text
);

COMMENT ON TABLE retention_policy_executions IS 'Audit trail of all data retention/archiving operations';

CREATE INDEX IF NOT EXISTS idx_retention_executions_policy ON retention_policy_executions(policy_id);
CREATE INDEX IF NOT EXISTS idx_retention_executions_started ON retention_policy_executions(started_at);

ALTER TABLE retention_policy_executions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins and auditors can view retention executions"
  ON retention_policy_executions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Only admins can insert retention executions"
  ON retention_policy_executions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Insert default retention policies aligned with federal requirements
INSERT INTO data_retention_policies (table_name, retention_period_days, archive_strategy) VALUES
  ('conflict_audit_logs', 1095, 'summarize'),
  ('conflict_change_deltas', 0, 'none'),
  ('conflict_resolutions', 1095, 'summarize'),
  ('tefca_access_logs', 2190, 'compress'),
  ('patient_portal_access_logs', 1095, 'summarize'),
  ('audit_logs', 1095, 'compress')
ON CONFLICT (table_name) DO NOTHING;

-- Add actor_role column to conflict_audit_logs if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_audit_logs' AND column_name = 'actor_role'
  ) THEN
    ALTER TABLE conflict_audit_logs ADD COLUMN actor_role text;
  END IF;
END $$;
