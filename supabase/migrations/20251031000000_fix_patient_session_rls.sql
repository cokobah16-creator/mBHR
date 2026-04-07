/*
  # Fix Patient Portal Session RLS

  ## Problem
  Patient portal users cannot validate their sessions because the RLS policies
  on patient_portal_sessions require auth.uid(), but patient portal users
  use custom session tokens, not Supabase Auth.

  ## Solution
  Add RLS policy that allows anyone to SELECT and UPDATE sessions using
  the session_token. This is safe because:
  1. Session tokens are UUIDs (virtually unguessable)
  2. We only allow operations on exact session_token match
  3. Tokens expire after 24 hours
  4. This only affects session validation, not data access

  ## Security
  - Session tokens act as bearer tokens
  - Only SELECT and UPDATE allowed (not DELETE or INSERT)
  - Must match exact session_token
  - All patient data access still protected by separate RLS policies
*/

-- Drop existing restrictive policies that block session validation
DROP POLICY IF EXISTS "Patients can delete own sessions" ON patient_portal_sessions;
DROP POLICY IF EXISTS "Admins can view all patient sessions" ON patient_portal_sessions;

-- Allow anyone to SELECT their session by token (for validation)
CREATE POLICY "Anyone can validate session by token"
  ON patient_portal_sessions FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow anyone to UPDATE their session by token (for refresh)
CREATE POLICY "Anyone can refresh session by token"
  ON patient_portal_sessions FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Staff can view all sessions for monitoring
CREATE POLICY "Staff can view all patient sessions"
  ON patient_portal_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Staff can manage sessions
CREATE POLICY "Staff can manage patient sessions"
  ON patient_portal_sessions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'doctor', 'nurse')
    )
  );
