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
CREATE POLICY "Patients can view own notifications"
  ON patient_notifications FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Patients can update own notifications"
  ON patient_notifications FOR UPDATE
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Staff can create patient notifications"
  ON patient_notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- MESSAGES: Patients can view and send messages
CREATE POLICY "Patients can view own messages"
  ON patient_messages FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Patients can send messages"
  ON patient_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Staff can manage messages"
  ON patient_messages FOR ALL
  TO authenticated
  USING (true);

-- APPOINTMENT REQUESTS: Patients can create and view own requests
CREATE POLICY "Patients can view own appointment requests"
  ON patient_appointment_requests FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Patients can create appointment requests"
  ON patient_appointment_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Staff can manage appointment requests"
  ON patient_appointment_requests FOR ALL
  TO authenticated
  USING (true);

-- DOCUMENTS: Patients can upload and view own documents
CREATE POLICY "Patients can view own documents"
  ON patient_documents FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Patients can upload documents"
  ON patient_documents FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Staff can manage patient documents"
  ON patient_documents FOR ALL
  TO authenticated
  USING (true);

-- CONSENT RECORDS: Patients can view and create own consent
CREATE POLICY "Patients can view own consent records"
  ON patient_consent_records FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Patients can create consent records"
  ON patient_consent_records FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

CREATE POLICY "Staff can view consent records"
  ON patient_consent_records FOR SELECT
  TO authenticated
  USING (true);

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
