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
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL UNIQUE,
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
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
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
  reviewed_by text REFERENCES app_users(id) ON DELETE SET NULL,
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
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  document_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by_patient boolean NOT NULL DEFAULT true,
  uploaded_by_user_id text REFERENCES app_users(id) ON DELETE SET NULL,
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

CREATE POLICY "Patients can view own portal account"
  ON patient_portal_users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Patients can update own preferences"
  ON patient_portal_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Staff can view patient portal accounts"
  ON patient_portal_users FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
  );

CREATE POLICY "Admins can manage patient portal accounts"
  ON patient_portal_users FOR ALL
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT PORTAL SESSIONS
-- ============================================================================

CREATE POLICY "Patients can view own sessions"
  ON patient_portal_sessions FOR SELECT
  TO authenticated
  USING (portal_user_id = auth.uid());

CREATE POLICY "Patients can delete own sessions"
  ON patient_portal_sessions FOR DELETE
  TO authenticated
  USING (portal_user_id = auth.uid());

CREATE POLICY "Admins can view all patient sessions"
  ON patient_portal_sessions FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT NOTIFICATIONS
-- ============================================================================

DROP POLICY IF EXISTS "Patients can view own notifications" ON patient_notifications;
CREATE POLICY "Patients can view own notifications"
  ON patient_notifications FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can update own notifications" ON patient_notifications;
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

DROP POLICY IF EXISTS "Staff can create patient notifications" ON patient_notifications;
CREATE POLICY "Staff can create patient notifications"
  ON patient_notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw', 'pharmacist')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT MESSAGES
-- ============================================================================

DROP POLICY IF EXISTS "Patients can view own messages" ON patient_messages;
CREATE POLICY "Patients can view own messages"
  ON patient_messages FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can send messages" ON patient_messages;
CREATE POLICY "Patients can send messages"
  ON patient_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND sender_type = 'patient'
    AND sender_id = auth.uid()::uuid
    AND sender_id = auth.uid()
  );

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

CREATE POLICY "Staff can view patient messages"
  ON patient_messages FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
  );

CREATE POLICY "Staff can send messages to patients"
  ON patient_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
    AND sender_type = 'staff'
    AND sender_id = auth.uid()::uuid
    AND sender_id = auth.uid()
  );

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT APPOINTMENT REQUESTS
-- ============================================================================

DROP POLICY IF EXISTS "Patients can view own appointment requests" ON patient_appointment_requests;
CREATE POLICY "Patients can view own appointment requests"
  ON patient_appointment_requests FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can create appointment requests" ON patient_appointment_requests;
CREATE POLICY "Patients can create appointment requests"
  ON patient_appointment_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

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

CREATE POLICY "Staff can view all appointment requests"
  ON patient_appointment_requests FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
  );

CREATE POLICY "Staff can review appointment requests"
  ON patient_appointment_requests FOR UPDATE
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT DOCUMENTS
-- ============================================================================

DROP POLICY IF EXISTS "Patients can view own documents" ON patient_documents;
CREATE POLICY "Patients can view own documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can upload documents" ON patient_documents;
CREATE POLICY "Patients can upload documents"
  ON patient_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND uploaded_by_patient = true
  );

CREATE POLICY "Staff can view patient documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
  );

CREATE POLICY "Staff can upload documents for patients"
  ON patient_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT CONSENT RECORDS
-- ============================================================================

DROP POLICY IF EXISTS "Patients can view own consent records" ON patient_consent_records;
CREATE POLICY "Patients can view own consent records"
  ON patient_consent_records FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can create consent records" ON patient_consent_records;
CREATE POLICY "Patients can create consent records"
  ON patient_consent_records FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Staff can view patient consent records"
  ON patient_consent_records FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role IN ('admin', 'doctor', 'nurse', 'chw')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES - PATIENT ACCESS LOGS
-- ============================================================================

CREATE POLICY "Admins can view all access logs"
  ON patient_portal_access_logs FOR SELECT
  TO authenticated
  USING (
    auth.uid()::text IN (
      SELECT id FROM app_users WHERE role = 'admin'
    )
  );

CREATE POLICY "System can create access logs"
  ON patient_portal_access_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- RLS POLICIES FOR PATIENT READ ACCESS TO CLINICAL DATA
-- ============================================================================

-- Patients can view their own visits
CREATE POLICY "Patients can view own visits"
  ON visits FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
    AND status = 'closed'
  );

-- Patients can view their own vitals
CREATE POLICY "Patients can view own vitals"
  ON vitals FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can view their own consultations
CREATE POLICY "Patients can view own consultations"
  ON consultations FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can view their own dispenses (prescriptions)
CREATE POLICY "Patients can view own dispenses"
  ON dispenses FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can view their own lab orders
CREATE POLICY "Patients can view own lab orders"
  ON lab_orders FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can view their own lab results
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

-- Patients can view their own appointments
CREATE POLICY "Patients can view own appointments"
  ON appointments FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can view their own medication reminders
CREATE POLICY "Patients can view own medication reminders"
  ON medication_reminders FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can view their own allergies
CREATE POLICY "Patients can view own allergies"
  ON patient_allergies FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- Patients can view their own preferences
CREATE POLICY "Patients can view own preferences"
  ON patient_preferences FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE id = auth.uid()
    )
  );

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_patient_portal_users_updated_at ON patient_portal_users;
CREATE TRIGGER update_patient_portal_users_updated_at
  BEFORE UPDATE ON patient_portal_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_messages_updated_at ON patient_messages;
CREATE TRIGGER update_patient_messages_updated_at
  BEFORE UPDATE ON patient_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_appointment_requests_updated_at ON patient_appointment_requests;
CREATE TRIGGER update_patient_appointment_requests_updated_at
  BEFORE UPDATE ON patient_appointment_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_documents_updated_at ON patient_documents;
CREATE TRIGGER update_patient_documents_updated_at
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
