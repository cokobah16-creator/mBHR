/*
  # Add Patient Portal Features

  Complete implementation of patient portal features per use case diagram.

  ## New Tables

  1. **patient_secure_messages**
     - Secure messaging between patients and healthcare providers
     - Supports bidirectional communication
     - Tracks read status and sender information

  2. **patient_lab_results**
     - Lab test results viewable by patients
     - Tracks test status and abnormal flags
     - Includes reference ranges and units

  3. **patient_medical_conditions**
     - Patient-entered medical conditions
     - Tracks condition status (active, managed, resolved)
     - Links to patient records

  4. **patient_documents**
     - Document upload and storage management
     - Categorizes document types
     - Tracks file metadata and storage paths

  5. **patient_referrals**
     - Specialist referrals tracking
     - Manages appointment scheduling
     - Priority and status tracking

  6. **patient_portal_preferences**
     - User notification preferences
     - Email and SMS notification settings
     - Per-user customization

  ## Security

  - All tables have RLS enabled
  - Patients can only access their own data
  - Staff can access patient data through appropriate roles
  - Secure storage bucket for documents

  ## Indexes

  - Optimized queries for patient_id lookups
  - Date-based sorting indexes
  - Status and priority filtering indexes
*/

-- Create secure messaging table
CREATE TABLE IF NOT EXISTS patient_secure_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  staff_id text REFERENCES users(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body text NOT NULL,
  from_patient boolean NOT NULL DEFAULT true,
  from_name text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secure_messages_patient ON patient_secure_messages(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_secure_messages_staff ON patient_secure_messages(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_secure_messages_unread ON patient_secure_messages(patient_id, read) WHERE NOT read;

-- Create lab results table
CREATE TABLE IF NOT EXISTS patient_lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  test_name text NOT NULL,
  test_type text NOT NULL,
  result_value text,
  unit text,
  reference_range text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'reviewed')),
  ordered_date timestamptz NOT NULL DEFAULT now(),
  result_date timestamptz,
  notes text,
  abnormal boolean DEFAULT false,
  ordered_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_results_patient ON patient_lab_results(patient_id, ordered_date DESC);
CREATE INDEX IF NOT EXISTS idx_lab_results_status ON patient_lab_results(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_results_abnormal ON patient_lab_results(patient_id, abnormal) WHERE abnormal = true;

-- Create medical conditions table
CREATE TABLE IF NOT EXISTS patient_medical_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  condition_name text NOT NULL,
  diagnosed_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'managed')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_conditions_patient ON patient_medical_conditions(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_conditions_status ON patient_medical_conditions(patient_id, status);

-- Create documents table
CREATE TABLE IF NOT EXISTS patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('medical_record', 'lab_result', 'imaging', 'prescription', 'insurance', 'other')),
  description text,
  storage_path text NOT NULL,
  upload_date timestamptz DEFAULT now(),
  uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_patient ON patient_documents(patient_id, upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_type ON patient_documents(patient_id, document_type);

-- Create referrals table
CREATE TABLE IF NOT EXISTS patient_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  referring_provider text NOT NULL,
  specialist_name text,
  specialty text NOT NULL,
  reason text NOT NULL,
  referral_date date NOT NULL DEFAULT CURRENT_DATE,
  appointment_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'emergency')),
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_patient ON patient_referrals(patient_id, referral_date DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON patient_referrals(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_priority ON patient_referrals(patient_id, priority);

-- Create portal preferences table
CREATE TABLE IF NOT EXISTS patient_portal_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES patient_portal_users(id) ON DELETE CASCADE,
  email_reminders boolean DEFAULT true,
  sms_reminders boolean DEFAULT true,
  appointment_alerts boolean DEFAULT true,
  lab_results_alerts boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(portal_user_id)
);

-- Enable Row Level Security
ALTER TABLE patient_secure_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_medical_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_portal_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for patient_secure_messages

DROP POLICY IF EXISTS "Patients can view own messages" ON patient_secure_messages;
CREATE POLICY "Patients can view own messages"
  ON patient_secure_messages FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

DROP POLICY IF EXISTS "Patients can send messages" ON patient_secure_messages;
CREATE POLICY "Patients can send messages"
  ON patient_secure_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Staff can view all messages"
  ON patient_secure_messages FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));

CREATE POLICY "Staff can send messages"
  ON patient_secure_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));

-- RLS Policies for patient_lab_results

DROP POLICY IF EXISTS "Patients can view own lab results" ON patient_lab_results;
CREATE POLICY "Patients can view own lab results"
  ON patient_lab_results FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Staff can view all lab results"
  ON patient_lab_results FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));

CREATE POLICY "Staff can manage lab results"
  ON patient_lab_results FOR ALL
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));

-- RLS Policies for patient_medical_conditions

DROP POLICY IF EXISTS "Patients can view own conditions" ON patient_medical_conditions;
CREATE POLICY "Patients can view own conditions"
  ON patient_medical_conditions FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Patients can add own conditions"
  ON patient_medical_conditions FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Staff can view all conditions"
  ON patient_medical_conditions FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));

-- RLS Policies for patient_documents

DROP POLICY IF EXISTS "Patients can view own documents" ON patient_documents;
CREATE POLICY "Patients can view own documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

DROP POLICY IF EXISTS "Patients can upload documents" ON patient_documents;
CREATE POLICY "Patients can upload documents"
  ON patient_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Patients can delete own documents"
  ON patient_documents FOR DELETE
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Staff can view all documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));

-- RLS Policies for patient_referrals

CREATE POLICY "Patients can view own referrals"
  ON patient_referrals FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Staff can manage referrals"
  ON patient_referrals FOR ALL
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));

-- RLS Policies for patient_portal_preferences

CREATE POLICY "Patients can manage own preferences"
  ON patient_portal_preferences FOR ALL
  TO authenticated
  USING (
    portal_user_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
  )
  WITH CHECK (
    portal_user_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
  );

-- Create storage bucket for patient documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('patient-documents', 'patient-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for patient documents
CREATE POLICY "Patients can upload own documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] IN (
      SELECT patient_id::text FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Patients can view own documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] IN (
      SELECT patient_id::text FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );

CREATE POLICY "Staff can view all patient documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'patient-documents' AND
    auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse')
  );

-- Update triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  DROP TRIGGER IF EXISTS update_patient_secure_messages_updated_at ON patient_secure_messages;
  CREATE TRIGGER update_patient_secure_messages_updated_at
    BEFORE UPDATE ON patient_secure_messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_lab_results_updated_at ON patient_lab_results;
  CREATE TRIGGER update_patient_lab_results_updated_at
    BEFORE UPDATE ON patient_lab_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_medical_conditions_updated_at ON patient_medical_conditions;
  CREATE TRIGGER update_patient_medical_conditions_updated_at
    BEFORE UPDATE ON patient_medical_conditions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_referrals_updated_at ON patient_referrals;
  CREATE TRIGGER update_patient_referrals_updated_at
    BEFORE UPDATE ON patient_referrals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_portal_preferences_updated_at ON patient_portal_preferences;
  CREATE TRIGGER update_patient_portal_preferences_updated_at
    BEFORE UPDATE ON patient_portal_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END $$;
