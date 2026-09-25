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
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tefca_access_logs' AND policyname = 'Service role can insert TEFCA logs'
  ) THEN
    CREATE POLICY "Service role can insert TEFCA logs"
      ON tefca_access_logs
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tefca_access_logs' AND policyname = 'Anon can insert TEFCA logs for edge functions'
  ) THEN
    CREATE POLICY "Anon can insert TEFCA logs for edge functions"
      ON tefca_access_logs
      FOR INSERT
      TO anon
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tefca_qhin_partners' AND policyname = 'Admins can manage QHIN partners'
  ) THEN
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
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_data_sharing_preferences' AND policyname = 'Patients can view own data sharing preferences'
  ) THEN
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
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_data_sharing_preferences' AND policyname = 'Patients can update own data sharing preferences'
  ) THEN
    CREATE POLICY "Patients can update own data sharing preferences"
      ON patient_data_sharing_preferences
      FOR UPDATE
      TO authenticated
      USING (patient_id = auth.uid()::text)
      WITH CHECK (patient_id = auth.uid()::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'patient_data_sharing_preferences' AND policyname = 'Patients can insert own data sharing preferences'
  ) THEN
    CREATE POLICY "Patients can insert own data sharing preferences"
      ON patient_data_sharing_preferences
      FOR INSERT
      TO authenticated
      WITH CHECK (patient_id = auth.uid()::text);
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
