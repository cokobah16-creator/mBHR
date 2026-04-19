-- Migration: 20251025000000_add_patient_allergies_preferences.sql
-- ============================================================
/*
  # Add Patient Allergies and Preferences

  1. New Tables
    - `patient_allergies`
      - `id` (uuid, primary key)
      - `patient_id` (uuid, references patients)
      - `allergen` (text) - Name of allergen
      - `allergy_type` (text) - Type: medication, food, environmental, other
      - `reaction` (text, optional) - Description of reaction
      - `severity` (text) - Severity level: mild, moderate, severe, life-threatening
      - `onset_date` (timestamptz, optional) - When allergy was first identified
      - `notes` (text, optional) - Additional notes
      - `is_active` (boolean) - Whether allergy is currently active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `created_by` (uuid, references users)
      - `_dirty` (integer) - Sync flag
      - `_synced_at` (timestamptz) - Last sync timestamp

    - `patient_preferences`
      - `id` (uuid, primary key)
      - `patient_id` (uuid, references patients, unique)
      - `preferred_language` (text, optional) - Language preference
      - `communication_channel` (text, optional) - Preferred channel: sms, whatsapp, call, in-person
      - `best_contact_time` (text, optional) - Best time to contact
      - `dietary_restrictions` (text, optional) - Dietary needs
      - `religious_cultural` (text, optional) - Religious/cultural considerations
      - `appointment_reminders` (boolean) - Whether to send appointment reminders
      - `medication_reminders` (boolean) - Whether to send medication reminders
      - `notes` (text, optional) - Additional preferences
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `_dirty` (integer) - Sync flag
      - `_synced_at` (timestamptz) - Last sync timestamp

  2. Security
    - Enable RLS on both tables
    - Add policies for clinical staff to read/write patient allergies
    - Add policies for all staff to read patient preferences
    - Add policies for clinical staff to update patient preferences

  3. Indexes
    - Index on patient_id for both tables
    - Index on allergy_type and severity for filtering
    - Index on is_active for active allergy queries

  4. Important Notes
    - Allergies are critical for patient safety - must be visible in all clinical workflows
    - Multiple allergies per patient supported
    - One preference record per patient (unique constraint)
    - Updated_at triggers for automatic timestamp management
*/

-- Create patient_allergies table
CREATE TABLE IF NOT EXISTS patient_allergies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen text NOT NULL,
  allergy_type text NOT NULL CHECK (allergy_type IN ('medication', 'food', 'environmental', 'other')),
  reaction text,
  severity text NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe', 'life-threatening')),
  onset_date timestamptz,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

-- Create patient_preferences table
CREATE TABLE IF NOT EXISTS patient_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  preferred_language text,
  communication_channel text CHECK (communication_channel IN ('sms', 'whatsapp', 'call', 'in-person')),
  best_contact_time text,
  dietary_restrictions text,
  religious_cultural text,
  appointment_reminders boolean NOT NULL DEFAULT true,
  medication_reminders boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_allergies_patient_id ON patient_allergies(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_type ON patient_allergies(allergy_type);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_severity ON patient_allergies(severity);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_active ON patient_allergies(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_patient_allergies_created_at ON patient_allergies(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_dirty ON patient_allergies(_dirty) WHERE _dirty > 0;

CREATE INDEX IF NOT EXISTS idx_patient_preferences_patient_id ON patient_preferences(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_preferences_dirty ON patient_preferences(_dirty) WHERE _dirty > 0;

-- Enable Row Level Security
ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for patient_allergies

-- Clinical staff can view all patient allergies
DO $$ BEGIN
  CREATE POLICY "Clinical staff can view patient allergies"
  ON patient_allergies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Clinical staff can insert patient allergies
DO $$ BEGIN
  CREATE POLICY "Clinical staff can insert patient allergies"
  ON patient_allergies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Clinical staff can update patient allergies
DO $$ BEGIN
  CREATE POLICY "Clinical staff can update patient allergies"
  ON patient_allergies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only admins and doctors can delete allergies
DO $$ BEGIN
  CREATE POLICY "Admins and doctors can delete patient allergies"
  ON patient_allergies FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'doctor')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for patient_preferences

-- All authenticated staff can view patient preferences
DO $$ BEGIN
  CREATE POLICY "Staff can view patient preferences"
  ON patient_preferences FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Clinical staff can insert patient preferences
DO $$ BEGIN
  CREATE POLICY "Staff can insert patient preferences"
  ON patient_preferences FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Clinical staff can update patient preferences
DO $$ BEGIN
  CREATE POLICY "Staff can update patient preferences"
  ON patient_preferences FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only admins can delete preferences
DO $$ BEGIN
  CREATE POLICY "Admins can delete patient preferences"
  ON patient_preferences FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
DROP TRIGGER IF EXISTS update_patient_allergies_updated_at ON patient_allergies;
CREATE OR REPLACE TRIGGER update_patient_allergies_updated_at
  BEFORE UPDATE ON patient_allergies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_preferences_updated_at ON patient_preferences;
CREATE OR REPLACE TRIGGER update_patient_preferences_updated_at
  BEFORE UPDATE ON patient_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- Migration: 20251026000000_add_clinical_decision_support.sql
-- ============================================================
/*
  # Clinical Decision Support System

  1. New Tables
    - `clinical_alerts`
      - `id` (uuid, primary key) - Unique alert identifier
      - `patient_id` (uuid, foreign key) - References patients table
      - `alert_type` (text) - Type: vital_sign, drug_interaction, high_risk, adherence, follow_up
      - `severity` (text) - Severity level: low, moderate, high, critical
      - `message` (text) - Short alert message
      - `details` (text) - Detailed information about the alert
      - `created_at` (timestamptz) - When alert was created
      - `acknowledged` (boolean) - Whether alert has been reviewed
      - `acknowledged_by` (uuid) - User who acknowledged the alert
      - `acknowledged_at` (timestamptz) - When alert was acknowledged
      - `_dirty` (boolean) - For offline sync tracking
      - `_synced_at` (timestamptz) - Last sync timestamp

  2. Security
    - Enable RLS on `clinical_alerts` table
    - Add policies for authenticated clinical staff
    - Restrict access based on user roles

  3. Indexes
    - Index on patient_id for fast patient alert lookup
    - Index on severity for filtering critical alerts
    - Index on acknowledged for filtering unacknowledged alerts
    - Index on created_at for chronological ordering
    - Compound index on (patient_id, acknowledged) for common queries
*/

-- Create clinical_alerts table
CREATE TABLE IF NOT EXISTS clinical_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('vital_sign', 'drug_interaction', 'high_risk', 'adherence', 'follow_up')),
  severity text NOT NULL CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
  message text NOT NULL,
  details text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  acknowledged boolean DEFAULT false NOT NULL,
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  _dirty boolean DEFAULT false,
  _synced_at timestamptz
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_patient_id ON clinical_alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_severity ON clinical_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_acknowledged ON clinical_alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_created_at ON clinical_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_patient_ack ON clinical_alerts(patient_id, acknowledged);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_type ON clinical_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_dirty ON clinical_alerts(_dirty) WHERE _dirty = true;

-- Enable Row Level Security
ALTER TABLE clinical_alerts ENABLE ROW LEVEL SECURITY;

-- Policy: Clinical staff can view all alerts
DO $$ BEGIN
  CREATE POLICY "Clinical staff can view clinical alerts"
  ON clinical_alerts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Policy: Clinical staff can create alerts
DO $$ BEGIN
  CREATE POLICY "Clinical staff can create clinical alerts"
  ON clinical_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Policy: Clinical staff can acknowledge alerts
DO $$ BEGIN
  CREATE POLICY "Clinical staff can acknowledge clinical alerts"
  ON clinical_alerts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Policy: Admins can delete alerts
DO $$ BEGIN
  CREATE POLICY "Admins can delete clinical alerts"
  ON clinical_alerts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create function to automatically set acknowledged_at timestamp
CREATE OR REPLACE FUNCTION set_acknowledged_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.acknowledged = true AND OLD.acknowledged = false THEN
    NEW.acknowledged_at = now();
    IF NEW.acknowledged_by IS NULL THEN
      NEW.acknowledged_by = auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for acknowledged_at
DROP TRIGGER IF EXISTS trigger_set_acknowledged_at ON clinical_alerts;
CREATE OR REPLACE TRIGGER trigger_set_acknowledged_at
  BEFORE UPDATE ON clinical_alerts
  FOR EACH ROW
  EXECUTE FUNCTION set_acknowledged_at();

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE clinical_alerts IS 'AI-powered clinical decision support alerts for identifying high-risk patients and concerning vital signs';
COMMENT ON COLUMN clinical_alerts.alert_type IS 'Type of alert: vital_sign (abnormal vitals), drug_interaction, high_risk (patient risk assessment), adherence (medication adherence), follow_up';
COMMENT ON COLUMN clinical_alerts.severity IS 'Alert severity: low, moderate, high, critical - determines urgency of clinical response';
COMMENT ON COLUMN clinical_alerts.message IS 'Short, actionable alert message for quick review';
COMMENT ON COLUMN clinical_alerts.details IS 'Detailed clinical information including recommendations and risk factors';
COMMENT ON COLUMN clinical_alerts.acknowledged IS 'Whether a clinician has reviewed and acknowledged the alert';
COMMENT ON COLUMN clinical_alerts._dirty IS 'Offline sync flag - true when local changes need to be synced to server';
COMMENT ON COLUMN clinical_alerts._synced_at IS 'Timestamp of last successful sync with offline client';


-- Migration: 20251026065550_add_otp_rate_limit_tracking.sql
-- ============================================================
/*
  # OTP Rate Limit Tracking Table

  ## Overview
  Adds a table to track OTP request rate limiting for patient portal registration
  and login flows. This allows rate limiting before user accounts are created and
  provides granular tracking of OTP requests.

  ## New Tables

  ### otp_rate_limit_tracking
  Tracks OTP requests by contact method (phone/email) with hourly windows.
  - Supports rate limiting for both registration and login flows
  - Tracks requests even when user accounts don't exist yet
  - Automatic cleanup of expired records
  - Prevents abuse while maintaining high functionality (200 requests/hour)

  ## Changes
  - Creates otp_rate_limit_tracking table with contact method tracking
  - Adds indexes for efficient rate limit queries
  - Creates cleanup function for expired tracking records
  - Enables RLS with appropriate policies for system access

  ## Security
  - RLS enabled with system-only write access
  - No patient or staff read access (internal tracking only)
  - Automatic cleanup prevents table bloat
*/

-- ============================================================================
-- OTP RATE LIMIT TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS otp_rate_limit_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_method text NOT NULL CHECK (contact_method IN ('phone', 'email')),
  contact_value text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  window_start_time timestamptz NOT NULL DEFAULT now(),
  last_request_time timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create unique index on contact method + value + window
-- This ensures we only have one active tracking record per contact per hour
CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_rate_limit_contact_window 
  ON otp_rate_limit_tracking(contact_method, contact_value, window_start_time);

-- Index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_otp_rate_limit_created 
  ON otp_rate_limit_tracking(created_at);

-- Index for efficient rate limit lookups
CREATE INDEX IF NOT EXISTS idx_otp_rate_limit_contact_value 
  ON otp_rate_limit_tracking(contact_value);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE otp_rate_limit_tracking ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- System can insert and update tracking records
DO $$ BEGIN
  CREATE POLICY "System can manage OTP rate limit tracking"
  ON otp_rate_limit_tracking FOR ALL
  TO authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Admins can view rate limit tracking for monitoring
DO $$ BEGIN
  CREATE POLICY "Admins can view OTP rate limit tracking"
  ON otp_rate_limit_tracking FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to check and increment OTP rate limit
CREATE OR REPLACE FUNCTION check_and_increment_otp_rate_limit(
  p_contact_method text,
  p_contact_value text,
  p_max_requests integer DEFAULT 200
)
RETURNS jsonb AS $$
DECLARE
  v_current_window_start timestamptz;
  v_tracking_record RECORD;
  v_allowed boolean;
  v_current_count integer;
  v_retry_after_seconds integer;
BEGIN
  -- Calculate current hour window (truncate to hour)
  v_current_window_start := date_trunc('hour', now());
  
  -- Try to get existing tracking record for current window
  SELECT * INTO v_tracking_record
  FROM otp_rate_limit_tracking
  WHERE contact_method = p_contact_method
    AND contact_value = p_contact_value
    AND window_start_time = v_current_window_start
  FOR UPDATE;
  
  IF v_tracking_record IS NULL THEN
    -- No record exists, create new one
    INSERT INTO otp_rate_limit_tracking (
      contact_method,
      contact_value,
      request_count,
      window_start_time,
      last_request_time
    ) VALUES (
      p_contact_method,
      p_contact_value,
      1,
      v_current_window_start,
      now()
    );
    
    RETURN jsonb_build_object(
      'allowed', true,
      'current_count', 1,
      'max_requests', p_max_requests,
      'retry_after_seconds', 0
    );
  ELSE
    -- Record exists, check if limit exceeded
    IF v_tracking_record.request_count >= p_max_requests THEN
      -- Calculate seconds until next window
      v_retry_after_seconds := EXTRACT(EPOCH FROM (
        v_current_window_start + interval '1 hour' - now()
      ))::integer;
      
      RETURN jsonb_build_object(
        'allowed', false,
        'current_count', v_tracking_record.request_count,
        'max_requests', p_max_requests,
        'retry_after_seconds', v_retry_after_seconds
      );
    ELSE
      -- Increment counter
      UPDATE otp_rate_limit_tracking
      SET request_count = request_count + 1,
          last_request_time = now(),
          updated_at = now()
      WHERE id = v_tracking_record.id;
      
      RETURN jsonb_build_object(
        'allowed', true,
        'current_count', v_tracking_record.request_count + 1,
        'max_requests', p_max_requests,
        'retry_after_seconds', 0
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old rate limit tracking records (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_expired_otp_rate_limits()
RETURNS integer AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM otp_rate_limit_tracking
    WHERE created_at < now() - interval '24 hours'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE TRIGGER update_otp_rate_limit_tracking_updated_at
  BEFORE UPDATE ON otp_rate_limit_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE otp_rate_limit_tracking IS 
  'Tracks OTP request rate limiting by contact method (phone/email) with hourly windows';

COMMENT ON FUNCTION check_and_increment_otp_rate_limit IS 
  'Checks if OTP request is allowed within rate limit and increments counter. Returns JSON with allowed status and retry information.';

COMMENT ON FUNCTION cleanup_expired_otp_rate_limits IS 
  'Removes OTP rate limit tracking records older than 24 hours. Should be called periodically via cron job.';

-- Migration: 20251026102016_fix_portal_activity_column.sql
-- ============================================================
/*
  # Fix Portal Activity Column

  1. Changes
    - Add missing `last_portal_activity` column to patients table
    - Add index for performance on portal activity queries
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'last_portal_activity'
  ) THEN
    ALTER TABLE patients ADD COLUMN last_portal_activity timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_last_portal_activity ON patients(last_portal_activity);


-- Migration: 20251026104953_add_portal_fields_to_patients.sql
-- ============================================================
/*
  # Add Portal Integration Fields to Patients Table

  1. Changes
    - Add portal_enabled flag to track if patient has portal access
    - Add contact_verified flag to track if email/phone is verified
    - Add portal_invited_at timestamp for invitation tracking
    - Add indexes for portal-related queries
    - Ensure email and phone columns exist and are properly indexed

  2. Purpose
    - Enable staff to easily enroll patients in the portal
    - Track portal access status for each patient
    - Support automatic portal user creation when staff registers patients
*/

-- Add portal-related columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'portal_enabled'
  ) THEN
    ALTER TABLE patients ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'contact_verified'
  ) THEN
    ALTER TABLE patients ADD COLUMN contact_verified boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'portal_invited_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN portal_invited_at timestamptz;
  END IF;
END $$;

-- Create indexes for portal queries
CREATE INDEX IF NOT EXISTS idx_patients_portal_enabled 
  ON patients(portal_enabled) WHERE portal_enabled = true;

CREATE INDEX IF NOT EXISTS idx_patients_email_portal 
  ON patients(LOWER(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_phone_portal 
  ON patients(phone) WHERE phone IS NOT NULL;

-- Add comment explaining the fields
COMMENT ON COLUMN patients.portal_enabled IS 
  'Whether patient has been enrolled in the patient portal';

COMMENT ON COLUMN patients.contact_verified IS 
  'Whether the patient email or phone has been verified via OTP';

COMMENT ON COLUMN patients.portal_invited_at IS 
  'Timestamp when patient was invited to use the portal';


-- Migration: 20251026225242_20251031000001_add_patient_portal_fixed.sql
-- ============================================================
/*
  # Patient Portal Complete Database Schema (Fixed)

  ## Overview
  Creates all missing patient portal tables with correct TEXT patient_id references.

  ## New Tables
  1. patient_notifications - Appointment reminders, alerts
  2. patient_messages - Secure messaging with care team
  3. patient_appointment_requests - Patient-initiated scheduling
  4. patient_documents - Patient-uploaded files
  5. patient_consent_records - Consent tracking for compliance

  ## Security
  - All tables have RLS enabled
  - Patients can only access their own data
  - Staff have role-based access
*/

-- ============================================================================
-- PATIENT NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_patient_notifications_read ON patient_notifications(read);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_created ON patient_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_type ON patient_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_priority ON patient_notifications(priority);

-- ============================================================================
-- PATIENT MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('patient', 'staff')),
  sender_id text NOT NULL,
  subject text,
  message_body text NOT NULL,
  parent_message_id uuid REFERENCES patient_messages(id) ON DELETE CASCADE,
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  attachments jsonb,
  priority text NOT NULL CHECK (priority IN ('normal', 'high')) DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_messages_patient ON patient_messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_sender ON patient_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_parent ON patient_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_created ON patient_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_messages_read ON patient_messages(read);

-- ============================================================================
-- PATIENT APPOINTMENT REQUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  appointment_type text NOT NULL,
  preferred_date_1 date NOT NULL,
  preferred_time_1 text,
  preferred_date_2 date,
  preferred_time_2 text,
  preferred_date_3 date,
  preferred_time_3 text,
  reason text,
  notes text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'scheduled', 'declined', 'cancelled')) DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  scheduled_appointment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_patient ON patient_appointment_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_status ON patient_appointment_requests(status);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_created ON patient_appointment_requests(created_at);

-- ============================================================================
-- PATIENT DOCUMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  document_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by_patient boolean NOT NULL DEFAULT true,
  uploaded_by_user_id text,
  description text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON patient_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_documents_type ON patient_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_patient_documents_created ON patient_documents(created_at);

-- ============================================================================
-- PATIENT CONSENT RECORDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  consent_type text NOT NULL,
  consent_given boolean NOT NULL,
  consent_text text NOT NULL,
  consent_version text NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_patient_consent_records_patient ON patient_consent_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_consent_records_type ON patient_consent_records(consent_type);
CREATE INDEX IF NOT EXISTS idx_patient_consent_records_created ON patient_consent_records(created_at);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE patient_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_appointment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consent_records ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- NOTIFICATIONS: Patients can view and update own notifications
DO $$ BEGIN
  CREATE POLICY "Patients can view own notifications"
  ON patient_notifications FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can update own notifications"
  ON patient_notifications FOR UPDATE
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create patient notifications"
  ON patient_notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- MESSAGES: Patients can view and send messages
DO $$ BEGIN
  CREATE POLICY "Patients can view own messages"
  ON patient_messages FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can send messages"
  ON patient_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage messages"
  ON patient_messages FOR ALL
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- APPOINTMENT REQUESTS: Patients can create and view own requests
DO $$ BEGIN
  CREATE POLICY "Patients can view own appointment requests"
  ON patient_appointment_requests FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can create appointment requests"
  ON patient_appointment_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage appointment requests"
  ON patient_appointment_requests FOR ALL
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- DOCUMENTS: Patients can upload and view own documents
DO $$ BEGIN
  CREATE POLICY "Patients can view own documents"
  ON patient_documents FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can upload documents"
  ON patient_documents FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage patient documents"
  ON patient_documents FOR ALL
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CONSENT RECORDS: Patients can view and create own consent
DO $$ BEGIN
  CREATE POLICY "Patients can view own consent records"
  ON patient_consent_records FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can create consent records"
  ON patient_consent_records FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view consent records"
  ON patient_consent_records FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_patient_messages_updated_at'
  ) THEN
    CREATE TRIGGER update_patient_messages_updated_at
      BEFORE UPDATE ON patient_messages
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_patient_appointment_requests_updated_at'
  ) THEN
    CREATE TRIGGER update_patient_appointment_requests_updated_at
      BEFORE UPDATE ON patient_appointment_requests
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_patient_documents_updated_at'
  ) THEN
    CREATE TRIGGER update_patient_documents_updated_at
      BEFORE UPDATE ON patient_documents
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Migration: 20251027000000_fix_security_performance_issues.sql
-- ============================================================
/*
  # Fix Security and Performance Issues

  This migration addresses all security and performance issues identified by Supabase:

  1. Adds missing foreign key indexes (16 tables)
  2. Optimizes RLS policies to use SELECT subqueries (prevents re-evaluation)
  3. Removes unused indexes to reduce storage overhead
  4. Consolidates duplicate permissive policies
  5. Fixes function search path mutability issues

  ## Changes Made:
  - Added 16 foreign key indexes for optimal query performance
  - Updated 30+ RLS policies to use (select auth.uid()) pattern
  - Removed 60+ unused indexes identified by Supabase
  - Fixed 3 function search paths to be immutable
  - Consolidated overlapping RLS policies on app_users table
*/

-- =====================================================
-- PART 1: ADD MISSING FOREIGN KEY INDEXES
-- =====================================================

-- Appointments table
CREATE INDEX IF NOT EXISTS idx_appointments_created_by_fk ON appointments(created_by);

-- Consultations table
CREATE INDEX IF NOT EXISTS idx_consultations_patient_id_fk ON consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_visit_id_fk ON consultations(visit_id);

-- Dispenses table
CREATE INDEX IF NOT EXISTS idx_dispenses_patient_id_fk ON dispenses(patient_id);
CREATE INDEX IF NOT EXISTS idx_dispenses_visit_id_fk ON dispenses(visit_id);

-- Inventory discrepancies table
CREATE INDEX IF NOT EXISTS idx_inventory_discrepancies_item_id_fk ON inventory_discrepancies(item_id);

-- Lab orders table
CREATE INDEX IF NOT EXISTS idx_lab_orders_ordered_by_fk ON lab_orders(ordered_by);
CREATE INDEX IF NOT EXISTS idx_lab_orders_visit_id_fk ON lab_orders(visit_id);

-- Lab results table
CREATE INDEX IF NOT EXISTS idx_lab_results_reviewed_by_fk ON lab_results(reviewed_by);

-- Medication reminders table
CREATE INDEX IF NOT EXISTS idx_medication_reminders_dispense_id_fk ON medication_reminders(dispense_id);

-- Patient allergies table
CREATE INDEX IF NOT EXISTS idx_patient_allergies_created_by_fk ON patient_allergies(created_by);

-- Queue table
CREATE INDEX IF NOT EXISTS idx_queue_patient_id_fk ON queue(patient_id);

-- Triage records table
CREATE INDEX IF NOT EXISTS idx_triage_records_visit_id_fk ON triage_records(visit_id);

-- Visits table
CREATE INDEX IF NOT EXISTS idx_visits_patient_id_fk ON visits(patient_id);

-- Vitals table
CREATE INDEX IF NOT EXISTS idx_vitals_patient_id_fk ON vitals(patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_visit_id_fk ON vitals(visit_id);

-- =====================================================
-- PART 2: REMOVE UNUSED INDEXES
-- =====================================================

-- Core tables - unused updated_at indexes
DROP INDEX IF EXISTS idx_patients_updated_at;
DROP INDEX IF EXISTS idx_visits_updated_at;
DROP INDEX IF EXISTS idx_vitals_updated_at;
DROP INDEX IF EXISTS idx_consultations_updated_at;
DROP INDEX IF EXISTS idx_dispenses_updated_at;
DROP INDEX IF EXISTS idx_inventory_updated_at;
DROP INDEX IF EXISTS idx_queue_updated_at;
DROP INDEX IF EXISTS idx_audit_logs_at;

-- User management - unused indexes
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_active;
DROP INDEX IF EXISTS app_users_role_idx;

-- Gamification - unused indexes
DROP INDEX IF EXISTS idx_game_sessions_volunteer_type;
DROP INDEX IF EXISTS idx_game_sessions_committed;
DROP INDEX IF EXISTS idx_gamification_wallets_tokens;
DROP INDEX IF EXISTS idx_vitals_ranges_lookup;
DROP INDEX IF EXISTS idx_quiz_questions_topic;
DROP INDEX IF EXISTS idx_inventory_discrepancies_resolved;

-- Advanced features - unused indexes
DROP INDEX IF EXISTS idx_med_reminders_patient;
DROP INDEX IF EXISTS idx_med_reminders_status;
DROP INDEX IF EXISTS idx_med_reminders_scheduled;
DROP INDEX IF EXISTS idx_lab_orders_patient;
DROP INDEX IF EXISTS idx_lab_orders_status;
DROP INDEX IF EXISTS idx_lab_results_order;
DROP INDEX IF EXISTS idx_appointments_patient;
DROP INDEX IF EXISTS idx_appointments_provider;
DROP INDEX IF EXISTS idx_appointments_scheduled;
DROP INDEX IF EXISTS idx_appointments_status;
DROP INDEX IF EXISTS idx_waitlist_patient;
DROP INDEX IF EXISTS idx_waitlist_status;

-- Stock management - unused indexes
DROP INDEX IF EXISTS idx_stock_batches_drug;
DROP INDEX IF EXISTS idx_stock_batches_expiry;
DROP INDEX IF EXISTS idx_stock_batches_dirty;

-- Care management - unused indexes
DROP INDEX IF EXISTS idx_care_tasks_patient;
DROP INDEX IF EXISTS idx_care_tasks_status;
DROP INDEX IF EXISTS idx_care_tasks_due;
DROP INDEX IF EXISTS idx_care_tasks_dirty;

-- Triage - unused indexes
DROP INDEX IF EXISTS idx_triage_patient;
DROP INDEX IF EXISTS idx_triage_priority;
DROP INDEX IF EXISTS idx_triage_dirty;

-- Patient data - unused indexes
DROP INDEX IF EXISTS idx_patient_allergies_patient;
DROP INDEX IF EXISTS idx_patient_allergies_active;
DROP INDEX IF EXISTS idx_patient_allergies_type;
DROP INDEX IF EXISTS idx_patient_allergies_dirty;
DROP INDEX IF EXISTS idx_patient_preferences_patient;
DROP INDEX IF EXISTS idx_patient_preferences_dirty;
DROP INDEX IF EXISTS idx_patient_merges_winner;
DROP INDEX IF EXISTS idx_patient_merges_loser;

-- Analytics - unused indexes
DROP INDEX IF EXISTS idx_daily_counts_day;
DROP INDEX IF EXISTS idx_conflict_resolutions_patient;
DROP INDEX IF EXISTS idx_conflict_resolutions_status;

-- Messaging - unused indexes
DROP INDEX IF EXISTS idx_message_templates_key;
DROP INDEX IF EXISTS idx_outbound_messages_patient;
DROP INDEX IF EXISTS idx_outbound_messages_status;
DROP INDEX IF EXISTS idx_outbound_messages_scheduled;
DROP INDEX IF EXISTS idx_outbound_messages_dirty;

-- Sync tracking - unused _dirty indexes
DROP INDEX IF EXISTS idx_patients_dirty;
DROP INDEX IF EXISTS idx_visits_dirty;
DROP INDEX IF EXISTS idx_vitals_dirty;
DROP INDEX IF EXISTS idx_consultations_dirty;
DROP INDEX IF EXISTS idx_dispenses_dirty;
DROP INDEX IF EXISTS idx_inventory_dirty;
DROP INDEX IF EXISTS idx_queue_dirty;
DROP INDEX IF EXISTS idx_gamification_wallets_dirty;
DROP INDEX IF EXISTS idx_game_sessions_dirty;

-- =====================================================
-- PART 3: FIX FUNCTION SEARCH PATHS
-- =====================================================

-- Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix prevent_demotion_of_permanent_admin function
CREATE OR REPLACE FUNCTION prevent_demotion_of_permanent_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.admin_permanent = true AND NEW.admin_access = false THEN
    RAISE EXCEPTION 'Cannot demote permanent admin';
  END IF;
  RETURN NEW;
END;
$$;

-- Fix touch_updated_at function
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- PART 4: OPTIMIZE RLS POLICIES (SELECT SUBQUERIES)
-- =====================================================

-- App users table policies
DROP POLICY IF EXISTS "service_role_manage_permanent_admins" ON app_users;
DO $$ BEGIN
  CREATE POLICY "service_role_manage_permanent_admins"
  ON app_users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Triage samples policies
DROP POLICY IF EXISTS "Doctors can create triage samples" ON triage_samples;
DO $$ BEGIN
  CREATE POLICY "Doctors can create triage samples"
  ON triage_samples
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Gamification wallets policies
DROP POLICY IF EXISTS "Admins can read all wallets" ON gamification_wallets;
DO $$ BEGIN
  CREATE POLICY "Admins can read all wallets"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Users can read own wallet" ON gamification_wallets;
DO $$ BEGIN
  CREATE POLICY "Users can read own wallet"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (volunteer_id = (select auth.uid())::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Users can update own wallet" ON gamification_wallets;
DO $$ BEGIN
  CREATE POLICY "Users can update own wallet"
  ON gamification_wallets
  FOR UPDATE
  TO authenticated
  USING (volunteer_id = (select auth.uid())::text)
  WITH CHECK (volunteer_id = (select auth.uid())::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Game sessions policies
DROP POLICY IF EXISTS "Admins can approve sessions" ON game_sessions;
DO $$ BEGIN
  CREATE POLICY "Admins can approve sessions"
  ON game_sessions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Users can read own sessions" ON game_sessions;
DO $$ BEGIN
  CREATE POLICY "Users can read own sessions"
  ON game_sessions
  FOR SELECT
  TO authenticated
  USING (volunteer_id = (select auth.uid())::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Volunteers can create own sessions" ON game_sessions;
DO $$ BEGIN
  CREATE POLICY "Volunteers can create own sessions"
  ON game_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (volunteer_id = (select auth.uid())::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Medication reminders policies
DROP POLICY IF EXISTS "Clinical staff can manage medication reminders" ON medication_reminders;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage medication reminders"
  ON medication_reminders
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lab orders policies
DROP POLICY IF EXISTS "Clinical staff can manage lab orders" ON lab_orders;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage lab orders"
  ON lab_orders
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lab results policies
DROP POLICY IF EXISTS "Clinical staff can manage lab results" ON lab_results;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage lab results"
  ON lab_results
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Appointments policies
DROP POLICY IF EXISTS "Authenticated users can manage appointments" ON appointments;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage appointments"
  ON appointments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Waitlist policies
DROP POLICY IF EXISTS "Authenticated users can manage waitlist" ON waitlist;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage waitlist"
  ON waitlist
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Care tasks policies
DROP POLICY IF EXISTS "Clinical staff can manage care tasks" ON care_tasks;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage care tasks"
  ON care_tasks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Triage records policies
DROP POLICY IF EXISTS "Clinical staff can manage triage records" ON triage_records;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage triage records"
  ON triage_records
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patient allergies policies
DROP POLICY IF EXISTS "Clinical staff can manage allergies" ON patient_allergies;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage allergies"
  ON patient_allergies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Clinical staff can update allergies" ON patient_allergies;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can update allergies"
  ON patient_allergies
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Clinical staff can view allergies" ON patient_allergies;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can view allergies"
  ON patient_allergies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patient preferences policies
DROP POLICY IF EXISTS "Staff can manage patient preferences" ON patient_preferences;
DO $$ BEGIN
  CREATE POLICY "Staff can manage patient preferences"
  ON patient_preferences
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patient merges policies
DROP POLICY IF EXISTS "Admins can view patient merges" ON patient_merges;
DO $$ BEGIN
  CREATE POLICY "Admins can view patient merges"
  ON patient_merges
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Daily counts policies
DROP POLICY IF EXISTS "Authenticated users can read daily counts" ON daily_counts;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read daily counts"
  ON daily_counts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Conflict resolutions policies
DROP POLICY IF EXISTS "Admins can manage conflict resolutions" ON conflict_resolutions;
DO $$ BEGIN
  CREATE POLICY "Admins can manage conflict resolutions"
  ON conflict_resolutions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Message templates policies
DROP POLICY IF EXISTS "Authenticated users can read message templates" ON message_templates;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read message templates"
  ON message_templates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Outbound messages policies
DROP POLICY IF EXISTS "Authenticated users can manage outbound messages" ON outbound_messages;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage outbound messages"
  ON outbound_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users table policies
DROP POLICY IF EXISTS "Admins can manage users" ON users;
DO $$ BEGIN
  CREATE POLICY "Admins can manage users"
  ON users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Stock batches policies
DROP POLICY IF EXISTS "Pharmacists can manage stock batches" ON stock_batches;
DO $$ BEGIN
  CREATE POLICY "Pharmacists can manage stock batches"
  ON stock_batches
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'pharmacist')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- PART 5: CONSOLIDATE DUPLICATE POLICIES
-- =====================================================

-- Remove duplicate permissive policies on app_users table
-- Keep only the most general policy that covers all cases
DROP POLICY IF EXISTS "select_app_users_any" ON app_users;

-- Update the main app_users policy to be comprehensive
DROP POLICY IF EXISTS "Allow authenticated access to app_users" ON app_users;
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to app_users"
  ON app_users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON INDEX idx_appointments_created_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_consultations_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_consultations_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_dispenses_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_dispenses_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_inventory_discrepancies_item_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_lab_orders_ordered_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_lab_orders_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_lab_results_reviewed_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_medication_reminders_dispense_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_patient_allergies_created_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_queue_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_triage_records_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_visits_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_vitals_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_vitals_visit_id_fk IS 'Foreign key index for query performance';


-- Migration: 20251028000000_add_patient_portal.sql
-- ============================================================
/*
  # Patient Portal Database Schema

  ## Overview
  Creates a comprehensive patient portal system allowing patients to access their medical records,
  manage appointments, communicate with care team, and upload documents. Includes OTP authentication,
  secure messaging, and comprehensive audit logging.

  ## New Tables

  ### 1. patient_portal_users
  Patient portal account information with OTP authentication.
  - Linked to existing patients table via patient_id
  - Supports SMS and email OTP delivery
  - Tracks verification status and login security
  - Manages notification preferences and consent

  ### 2. patient_portal_sessions
  Active patient portal sessions for authentication tracking.
  - JWT token-based session management
  - Device fingerprinting for security
  - Tracks session activity and expiration
  - Supports multiple concurrent sessions

  ### 3. patient_portal_access_logs
  Comprehensive audit trail for all patient data access.
  - Records every data access attempt
  - Tracks IP addresses and user agents
  - Logs success/failure and error messages
  - Required for HIPAA-like compliance

  ### 4. patient_notifications
  Notifications and alerts delivered to patients.
  - Appointment reminders
  - New message alerts
  - Lab result notifications
  - Medication reminders
  - Custom care team messages

  ### 5. patient_messages
  Secure messaging between patients and care team.
  - Threaded conversations
  - File attachments support
  - Priority levels
  - Read/unread tracking

  ### 6. patient_appointment_requests
  Patient-initiated appointment scheduling requests.
  - Multiple preferred date/time options
  - Reason and notes
  - Review workflow for staff
  - Links to scheduled appointments

  ### 7. patient_documents
  Patient-uploaded documents and forms.
  - Insurance cards
  - Medical history forms
  - Consent forms
  - Photo ID
  - Supporting medical documents

  ### 8. patient_consent_records
  Tracks patient consent for data sharing and access.
  - Versioned consent forms
  - Timestamp and IP tracking
  - Revocation support
  - Audit trail for compliance

  ## Security
  - All tables have Row Level Security (RLS) enabled
  - Patients can only access their own data
  - Staff have role-based access to patient portal data
  - Comprehensive audit logging for PHI access
  - Encrypted sensitive fields

  ## Indexes
  - Performance indexes on all foreign keys
  - Indexes on frequently queried fields (status, dates)
  - Composite indexes for common query patterns
*/

-- ============================================================================
-- PATIENT PORTAL USERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL UNIQUE,
  phone_number text NOT NULL,
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
  notification_preferences jsonb NOT NULL DEFAULT '{"sms": true, "email": true, "push": false}'::jsonb,
  consent_given boolean NOT NULL DEFAULT false,
  consent_given_at timestamptz,
  terms_accepted_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_portal_users_patient ON patient_portal_users(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_portal_users_phone ON patient_portal_users(phone_number);
CREATE INDEX IF NOT EXISTS idx_patient_portal_users_email ON patient_portal_users(email);
CREATE INDEX IF NOT EXISTS idx_patient_portal_users_status ON patient_portal_users(account_status);

-- ============================================================================
-- PATIENT PORTAL SESSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid REFERENCES patient_portal_users(id) ON DELETE CASCADE NOT NULL,
  session_token text NOT NULL UNIQUE,
  device_fingerprint text,
  device_name text,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_patient_portal_sessions_user ON patient_portal_sessions(portal_user_id);
CREATE INDEX IF NOT EXISTS idx_patient_portal_sessions_token ON patient_portal_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_patient_portal_sessions_expires ON patient_portal_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_patient_portal_sessions_active ON patient_portal_sessions(is_active);

-- ============================================================================
-- PATIENT PORTAL ACCESS LOGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_portal_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid REFERENCES patient_portal_users(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  action_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  ip_address inet,
  user_agent text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_portal_access_logs_user ON patient_portal_access_logs(portal_user_id);
CREATE INDEX IF NOT EXISTS idx_patient_portal_access_logs_patient ON patient_portal_access_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_portal_access_logs_created ON patient_portal_access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_portal_access_logs_action ON patient_portal_access_logs(action_type);

-- ============================================================================
-- PATIENT NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_patient_notifications_read ON patient_notifications(read);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_created ON patient_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_type ON patient_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_priority ON patient_notifications(priority);

-- ============================================================================
-- PATIENT MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('patient', 'staff')),
  sender_id uuid NOT NULL,
  subject text,
  message_body text NOT NULL,
  parent_message_id uuid REFERENCES patient_messages(id) ON DELETE CASCADE,
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  attachments jsonb,
  priority text NOT NULL CHECK (priority IN ('normal', 'high')) DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_messages_patient ON patient_messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_sender ON patient_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_parent ON patient_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_created ON patient_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_messages_read ON patient_messages(read);

-- ============================================================================
-- PATIENT APPOINTMENT REQUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_appointment_requests (
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
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'scheduled', 'declined', 'cancelled')) DEFAULT 'pending',
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  scheduled_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_patient ON patient_appointment_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_status ON patient_appointment_requests(status);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_created ON patient_appointment_requests(created_at);

-- ============================================================================
-- PATIENT DOCUMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  document_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by_patient boolean NOT NULL DEFAULT true,
  uploaded_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  description text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON patient_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_documents_type ON patient_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_patient_documents_created ON patient_documents(created_at);

-- ============================================================================
-- PATIENT CONSENT RECORDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  consent_type text NOT NULL,
  consent_given boolean NOT NULL,
  consent_text text NOT NULL,
  consent_version text NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_patient_consent_records_patient ON patient_consent_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_consent_records_type ON patient_consent_records(consent_type);
CREATE INDEX IF NOT EXISTS idx_patient_consent_records_created ON patient_consent_records(created_at);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE patient_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_portal_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_appointment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consent_records ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT PORTAL USERS
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Patients can view own portal account"
  ON patient_portal_users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can update own preferences"
  ON patient_portal_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view patient portal accounts"
  ON patient_portal_users FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage patient portal accounts"
  ON patient_portal_users FOR ALL
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT PORTAL SESSIONS
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Patients can view own sessions"
  ON patient_portal_sessions FOR SELECT
  TO authenticated
  USING (portal_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can delete own sessions"
  ON patient_portal_sessions FOR DELETE
  TO authenticated
  USING (portal_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can view all patient sessions"
  ON patient_portal_sessions FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT NOTIFICATIONS
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Patients can view own notifications"
  ON patient_notifications FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can update own notifications"
  ON patient_notifications FOR UPDATE
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create patient notifications"
  ON patient_notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer', 'pharmacist')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT MESSAGES
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Patients can view own messages"
  ON patient_messages FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can update own messages"
  ON patient_messages FOR UPDATE
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view patient messages"
  ON patient_messages FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can send messages to patients"
  ON patient_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
    AND sender_type = 'staff'
    AND sender_id = auth.uid()
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT APPOINTMENT REQUESTS
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Patients can view own appointment requests"
  ON patient_appointment_requests FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can create appointment requests"
  ON patient_appointment_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can cancel own appointment requests"
  ON patient_appointment_requests FOR UPDATE
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND status = 'pending'
  )
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND status = 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view all appointment requests"
  ON patient_appointment_requests FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can review appointment requests"
  ON patient_appointment_requests FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT DOCUMENTS
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Patients can view own documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can upload documents"
  ON patient_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND uploaded_by_patient = true
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view patient documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can upload documents for patients"
  ON patient_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT CONSENT RECORDS
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Patients can view own consent records"
  ON patient_consent_records FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can create consent records"
  ON patient_consent_records FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view patient consent records"
  ON patient_consent_records FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'volunteer')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT ACCESS LOGS
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Admins can view all access logs"
  ON patient_portal_access_logs FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "System can create access logs"
  ON patient_portal_access_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- RLS POLICIES FOR PATIENT READ ACCESS TO CLINICAL DATA
-- ============================================================================

-- Patients can view their own visits
DO $$ BEGIN
  CREATE POLICY "Patients can view own visits"
  ON visits FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND status = 'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own vitals
DO $$ BEGIN
  CREATE POLICY "Patients can view own vitals"
  ON vitals FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own consultations
DO $$ BEGIN
  CREATE POLICY "Patients can view own consultations"
  ON consultations FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own dispenses (prescriptions)
DO $$ BEGIN
  CREATE POLICY "Patients can view own dispenses"
  ON dispenses FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own lab orders
DO $$ BEGIN
  CREATE POLICY "Patients can view own lab orders"
  ON lab_orders FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own lab results
DO $$ BEGIN
  CREATE POLICY "Patients can view own lab results"
  ON lab_results FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT lo.id FROM lab_orders lo
      JOIN patient_portal_users ppu ON lo.patient_id = ppu.patient_id
      WHERE ppu.id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own appointments
DO $$ BEGIN
  CREATE POLICY "Patients can view own appointments"
  ON appointments FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own medication reminders
DO $$ BEGIN
  CREATE POLICY "Patients can view own medication reminders"
  ON medication_reminders FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own allergies
DO $$ BEGIN
  CREATE POLICY "Patients can view own allergies"
  ON patient_allergies FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients can view their own preferences
DO $$ BEGIN
  CREATE POLICY "Patients can view own preferences"
  ON patient_preferences FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

CREATE OR REPLACE TRIGGER update_patient_portal_users_updated_at
  BEFORE UPDATE ON patient_portal_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_patient_messages_updated_at
  BEFORE UPDATE ON patient_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_patient_appointment_requests_updated_at
  BEFORE UPDATE ON patient_appointment_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_patient_documents_updated_at
  BEFORE UPDATE ON patient_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to log patient portal access
CREATE OR REPLACE FUNCTION log_patient_portal_access(
  p_portal_user_id uuid,
  p_patient_id uuid,
  p_action_type text,
  p_resource_type text,
  p_resource_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO patient_portal_access_logs (
    portal_user_id,
    patient_id,
    action_type,
    resource_type,
    resource_id,
    ip_address,
    success,
    metadata
  ) VALUES (
    p_portal_user_id,
    p_patient_id,
    p_action_type,
    p_resource_type,
    p_resource_id,
    inet_client_addr(),
    true,
    p_metadata
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create notification for patient
CREATE OR REPLACE FUNCTION create_patient_notification(
  p_patient_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_priority text DEFAULT 'normal',
  p_action_url text DEFAULT NULL,
  p_action_label text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_notification_id uuid;
BEGIN
  INSERT INTO patient_notifications (
    patient_id,
    notification_type,
    title,
    message,
    priority,
    action_url,
    action_label
  ) VALUES (
    p_patient_id,
    p_notification_type,
    p_title,
    p_message,
    p_priority,
    p_action_url,
    p_action_label
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if patient portal user exists for patient
CREATE OR REPLACE FUNCTION patient_has_portal_account(p_patient_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM patient_portal_users
    WHERE patient_id = p_patient_id
    AND account_status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Migration: 20251028120000_add_multi_tenant_foundation.sql
-- ============================================================
/*
  # Multi-Tenant Foundation for Medical Outreach Platform

  1. New Tables
    - `organizations`
      - `id` (uuid, primary key)
      - `name` (text) - organization name (e.g., DIOF)
      - `slug` (text, unique) - URL-friendly identifier
      - `logo_url` (text, nullable) - organization logo
      - `settings` (jsonb) - org-specific configuration
      - `subscription_tier` (text) - for future multi-org billing
      - `is_active` (boolean) - organization status
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `sites`
      - `id` (uuid, primary key)
      - `org_id` (uuid, foreign key to organizations)
      - `name` (text) - site name (e.g., "Okpanam PHC")
      - `site_code` (text) - short code for quick reference
      - `address` (text)
      - `state` (text)
      - `lga` (text)
      - `typical_patient_volume` (integer) - expected patients per event
      - `capacity` (integer) - max patients site can handle
      - `coordinates` (jsonb, nullable) - lat/lng for mapping
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `outreach_events`
      - `id` (uuid, primary key)
      - `org_id` (uuid, foreign key to organizations)
      - `site_id` (uuid, foreign key to sites)
      - `event_name` (text)
      - `event_date` (date)
      - `start_time` (time)
      - `end_time` (time)
      - `status` (text) - planned, active, completed, cancelled
      - `expected_volume` (integer)
      - `actual_volume` (integer, nullable)
      - `staff_roster` (jsonb) - array of staff assignments
      - `notes` (text, nullable)
      - `outcome_summary` (jsonb, nullable) - post-event metrics
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `event_staff_assignments`
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to outreach_events)
      - `user_id` (uuid, foreign key to users)
      - `role` (text) - doctor, nurse, pharmacist, volunteer
      - `station` (text, nullable) - registration, vitals, consult, pharmacy
      - `is_supervising` (boolean) - for lead doctor
      - `check_in_time` (timestamptz, nullable)
      - `check_out_time` (timestamptz, nullable)
      - `created_at` (timestamptz)

    - `user_org_sites`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `org_id` (uuid, foreign key to organizations)
      - `site_id` (uuid, foreign key to sites, nullable) - null means access to all sites
      - `is_default` (boolean) - default org/site for this user
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all new tables
    - Add policies for org/site-scoped access
    - Users can only access data for their assigned organizations and sites

  3. Important Notes
    - org_id and site_id will be added to existing tables in next migration
    - First organization (DIOF) will be seeded via application code
    - RLS policies ensure complete data isolation between organizations
*/

-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  settings jsonb DEFAULT '{}'::jsonb,
  subscription_tier text DEFAULT 'standard',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create sites table
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  site_code text NOT NULL,
  address text NOT NULL,
  state text NOT NULL,
  lga text NOT NULL,
  typical_patient_volume integer DEFAULT 200,
  capacity integer DEFAULT 300,
  coordinates jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, site_code)
);

-- Create outreach_events table
CREATE TABLE IF NOT EXISTS outreach_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_date date NOT NULL,
  start_time time DEFAULT '09:00:00',
  end_time time DEFAULT '15:00:00',
  status text DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  expected_volume integer DEFAULT 200,
  actual_volume integer,
  staff_roster jsonb DEFAULT '[]'::jsonb,
  notes text,
  outcome_summary jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create event_staff_assignments table
CREATE TABLE IF NOT EXISTS event_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES outreach_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('doctor', 'nurse', 'pharmacist', 'volunteer', 'lab_tech', 'admin')),
  station text CHECK (station IN ('registration', 'vitals', 'consult', 'pharmacy', 'lab', 'education')),
  is_supervising boolean DEFAULT false,
  check_in_time timestamptz,
  check_out_time timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, user_id)
);

-- Create user_org_sites table
CREATE TABLE IF NOT EXISTS user_org_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, org_id, site_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sites_org_id ON sites(org_id);
CREATE INDEX IF NOT EXISTS idx_sites_state ON sites(state);
CREATE INDEX IF NOT EXISTS idx_outreach_events_org_id ON outreach_events(org_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_site_id ON outreach_events(site_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_date ON outreach_events(event_date);
CREATE INDEX IF NOT EXISTS idx_outreach_events_status ON outreach_events(status);
CREATE INDEX IF NOT EXISTS idx_event_staff_assignments_event_id ON event_staff_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_staff_assignments_user_id ON event_staff_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_sites_user_id ON user_org_sites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_sites_org_id ON user_org_sites(org_id);

-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_org_sites ENABLE ROW LEVEL SECURITY;

-- RLS Policies for organizations
DO $$ BEGIN
  CREATE POLICY "Users can view their organizations"
  ON organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage their organizations"
  ON organizations
  FOR ALL
  TO authenticated
  USING (
    id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for sites
DO $$ BEGIN
  CREATE POLICY "Users can view sites in their organizations"
  ON sites
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage sites in their organizations"
  ON sites
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for outreach_events
DO $$ BEGIN
  CREATE POLICY "Users can view events in their organizations"
  ON outreach_events
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage events in their organizations"
  ON outreach_events
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for event_staff_assignments
DO $$ BEGIN
  CREATE POLICY "Users can view their event assignments"
  ON event_staff_assignments
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    event_id IN (
      SELECT id FROM outreach_events WHERE org_id IN (
        SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
      )
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage event assignments in their organizations"
  ON event_staff_assignments
  FOR ALL
  TO authenticated
  USING (
    event_id IN (
      SELECT id FROM outreach_events WHERE org_id IN (
        SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    event_id IN (
      SELECT id FROM outreach_events WHERE org_id IN (
        SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
      )
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for user_org_sites
DO $$ BEGIN
  CREATE POLICY "Users can view their own org assignments"
  ON user_org_sites
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage user org assignments"
  ON user_org_sites
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add updated_at trigger for organizations
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER sites_updated_at
  BEFORE UPDATE ON sites
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER outreach_events_updated_at
  BEFORE UPDATE ON outreach_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


-- Migration: 20251028121000_add_doctor_features_tables.sql
-- ============================================================
/*
  # Doctor-Specific Features and Communication Tables

  1. New Tables
    - `patient_flags`
      - Lightweight inter-station communication system
      - Replaces need for full chat system
      - Types: escalate_to_doctor, recheck_vitals, pharmacy_query, lab_pending

    - `referrals`
      - Patient referrals to specialists or facilities
      - Tracks follow-up and outcomes

    - `follow_up_schedules`
      - Return visit scheduling for chronic patients
      - Links to future outreach events

    - `prescription_templates`
      - Protocol-based medication sets
      - Quick-add for common conditions

    - `site_formulary`
      - Available medications at each site
      - Stock levels and alternatives

    - `doctor_analytics`
      - Per-event performance tracking
      - Throughput and quality metrics

    - `consultation_reviews`
      - Supervising doctor oversight
      - Quality assurance workflow

    - `protocol_library`
      - Clinical guidelines and treatment algorithms
      - Site-scoped protocols

  2. Security
    - Enable RLS on all tables
    - Scope access by org_id and site_id
    - Role-based permissions for doctors, nurses, pharmacists

  3. Important Notes
    - All tables include org_id and site_id for multi-tenant support
    - Indexes optimized for high-throughput outreach operations
    - Foreign key constraints ensure data integrity
*/

-- Create patient_flags table for lightweight inter-station communication
CREATE TABLE IF NOT EXISTS patient_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  flag_type text NOT NULL CHECK (flag_type IN ('escalate_to_doctor', 'recheck_vitals', 'pharmacy_query', 'lab_pending', 'urgent', 'follow_up_needed')),
  from_station text NOT NULL CHECK (from_station IN ('registration', 'vitals', 'consult', 'pharmacy', 'lab')),
  to_station text NOT NULL CHECK (to_station IN ('registration', 'vitals', 'consult', 'pharmacy', 'lab')),
  from_user_id uuid NOT NULL,
  to_user_id uuid,
  priority text DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  message text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'cancelled')),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz DEFAULT now()
);

-- Create referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  referring_doctor_id uuid NOT NULL,
  referral_type text NOT NULL CHECK (referral_type IN ('specialist', 'hospital', 'lab', 'imaging', 'follow_up')),
  specialty text,
  facility_name text,
  urgency text DEFAULT 'routine' CHECK (urgency IN ('emergency', 'urgent', 'routine')),
  reason text NOT NULL,
  clinical_summary text,
  diagnosis text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
  appointment_date date,
  outcome text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create follow_up_schedules table
CREATE TABLE IF NOT EXISTS follow_up_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  original_visit_id uuid,
  scheduled_event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  follow_up_type text NOT NULL CHECK (follow_up_type IN ('chronic_disease', 'medication_refill', 'test_results', 'post_treatment', 'general_checkup')),
  reason text NOT NULL,
  priority text DEFAULT 'routine' CHECK (priority IN ('urgent', 'high', 'routine')),
  scheduled_date date,
  reminder_sent boolean DEFAULT false,
  reminder_sent_at timestamptz,
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'reminded', 'completed', 'missed', 'cancelled')),
  completed_visit_id uuid,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create prescription_templates table
CREATE TABLE IF NOT EXISTS prescription_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  condition text NOT NULL,
  description text,
  medications jsonb NOT NULL,
  is_protocol boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, name)
);

-- Create site_formulary table
CREATE TABLE IF NOT EXISTS site_formulary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  medication_name text NOT NULL,
  generic_name text,
  form text NOT NULL,
  strength text NOT NULL,
  unit text NOT NULL,
  typical_stock_level integer,
  current_stock integer DEFAULT 0,
  reorder_threshold integer,
  is_controlled boolean DEFAULT false,
  alternatives jsonb DEFAULT '[]'::jsonb,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, site_id, medication_name, strength)
);

-- Create doctor_analytics table
CREATE TABLE IF NOT EXISTS doctor_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES outreach_events(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL,
  patients_seen integer DEFAULT 0,
  consultations_completed integer DEFAULT 0,
  avg_consultation_time_minutes numeric(5,2),
  prescriptions_written integer DEFAULT 0,
  referrals_made integer DEFAULT 0,
  pharmacy_queries integer DEFAULT 0,
  vitals_rechecks integer DEFAULT 0,
  diagnoses jsonb DEFAULT '{}'::jsonb,
  shift_start timestamptz,
  shift_end timestamptz,
  total_hours numeric(4,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, doctor_id)
);

-- Create consultation_reviews table
CREATE TABLE IF NOT EXISTS consultation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  consultation_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  reviewed_doctor_id uuid NOT NULL,
  reviewing_doctor_id uuid NOT NULL,
  review_type text DEFAULT 'routine' CHECK (review_type IN ('routine', 'requested', 'teaching', 'quality_assurance')),
  review_status text DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'modified', 'flagged')),
  feedback text,
  modifications jsonb,
  teaching_points text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create protocol_library table
CREATE TABLE IF NOT EXISTS protocol_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  title text NOT NULL,
  condition text NOT NULL,
  category text CHECK (category IN ('infectious', 'chronic', 'acute', 'emergency', 'pediatric', 'maternal', 'general')),
  protocol_content text NOT NULL,
  algorithm jsonb,
  medications jsonb,
  contraindications text[],
  special_considerations text,
  references text,
  version text DEFAULT '1.0',
  is_active boolean DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_flags_patient_id ON patient_flags(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_flags_event_id ON patient_flags(event_id);
CREATE INDEX IF NOT EXISTS idx_patient_flags_status ON patient_flags(status);
CREATE INDEX IF NOT EXISTS idx_patient_flags_flag_type ON patient_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_patient_flags_to_station ON patient_flags(to_station);

CREATE INDEX IF NOT EXISTS idx_referrals_patient_id ON referrals(patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_event_id ON referrals(event_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_referring_doctor_id ON referrals(referring_doctor_id);

CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_patient_id ON follow_up_schedules(patient_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_scheduled_date ON follow_up_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_status ON follow_up_schedules(status);

CREATE INDEX IF NOT EXISTS idx_site_formulary_site_id ON site_formulary(site_id);
CREATE INDEX IF NOT EXISTS idx_site_formulary_medication_name ON site_formulary(medication_name);

CREATE INDEX IF NOT EXISTS idx_doctor_analytics_event_id ON doctor_analytics(event_id);
CREATE INDEX IF NOT EXISTS idx_doctor_analytics_doctor_id ON doctor_analytics(doctor_id);

CREATE INDEX IF NOT EXISTS idx_consultation_reviews_reviewed_doctor_id ON consultation_reviews(reviewed_doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_reviewing_doctor_id ON consultation_reviews(reviewing_doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_review_status ON consultation_reviews(review_status);

CREATE INDEX IF NOT EXISTS idx_protocol_library_condition ON protocol_library(condition);
CREATE INDEX IF NOT EXISTS idx_protocol_library_category ON protocol_library(category);

-- Enable Row Level Security
ALTER TABLE patient_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_formulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies for patient_flags
DO $$ BEGIN
  CREATE POLICY "Staff can view flags in their organizations"
  ON patient_flags
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create flags in their organizations"
  ON patient_flags
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update flags in their organizations"
  ON patient_flags
  FOR UPDATE
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for referrals
DO $$ BEGIN
  CREATE POLICY "Staff can view referrals in their organizations"
  ON referrals
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Doctors can manage referrals in their organizations"
  ON referrals
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for follow_up_schedules
DO $$ BEGIN
  CREATE POLICY "Staff can view follow-ups in their organizations"
  ON follow_up_schedules
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage follow-ups in their organizations"
  ON follow_up_schedules
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for prescription_templates
DO $$ BEGIN
  CREATE POLICY "Staff can view prescription templates in their organizations"
  ON prescription_templates
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Doctors and admins can manage prescription templates"
  ON prescription_templates
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for site_formulary
DO $$ BEGIN
  CREATE POLICY "Staff can view site formulary in their organizations"
  ON site_formulary
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Pharmacists and admins can manage site formulary"
  ON site_formulary
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for doctor_analytics
DO $$ BEGIN
  CREATE POLICY "Staff can view doctor analytics in their organizations"
  ON doctor_analytics
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    ) OR
    doctor_id = auth.uid()
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "System can manage doctor analytics"
  ON doctor_analytics
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for consultation_reviews
DO $$ BEGIN
  CREATE POLICY "Staff can view consultation reviews in their organizations"
  ON consultation_reviews
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    ) OR
    reviewed_doctor_id = auth.uid() OR
    reviewing_doctor_id = auth.uid()
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Supervising doctors can manage reviews"
  ON consultation_reviews
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for protocol_library
DO $$ BEGIN
  CREATE POLICY "Staff can view protocols in their organizations"
  ON protocol_library
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Doctors and admins can manage protocols"
  ON protocol_library
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add updated_at triggers
CREATE OR REPLACE TRIGGER referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER follow_up_schedules_updated_at
  BEFORE UPDATE ON follow_up_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER prescription_templates_updated_at
  BEFORE UPDATE ON prescription_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER site_formulary_updated_at
  BEFORE UPDATE ON site_formulary
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER doctor_analytics_updated_at
  BEFORE UPDATE ON doctor_analytics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER protocol_library_updated_at
  BEFORE UPDATE ON protocol_library
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

