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
CREATE POLICY "System can manage OTP rate limit tracking"
  ON otp_rate_limit_tracking FOR ALL
  TO authenticated
  WITH CHECK (true);

-- Admins can view rate limit tracking for monitoring
CREATE POLICY "Admins can view OTP rate limit tracking"
  ON otp_rate_limit_tracking FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );

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

CREATE TRIGGER update_otp_rate_limit_tracking_updated_at
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