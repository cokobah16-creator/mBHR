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

CREATE POLICY "Service role can manage OTP rate limits"
  ON otp_rate_limits
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

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

CREATE POLICY "Staff can view access logs"
  ON patient_portal_access_logs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert access logs"
  ON patient_portal_access_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

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
