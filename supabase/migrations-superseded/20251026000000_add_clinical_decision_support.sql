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
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
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

-- Policy: Clinical staff can create alerts
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

-- Policy: Clinical staff can acknowledge alerts
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

-- Policy: Admins can delete alerts
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
CREATE TRIGGER trigger_set_acknowledged_at
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
