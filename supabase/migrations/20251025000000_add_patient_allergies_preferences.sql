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
  created_by text REFERENCES users(id),
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
CREATE POLICY "Clinical staff can view patient allergies"
  ON patient_allergies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
      AND users.role IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );

-- Clinical staff can insert patient allergies
CREATE POLICY "Clinical staff can insert patient allergies"
  ON patient_allergies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
      AND users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Clinical staff can update patient allergies
CREATE POLICY "Clinical staff can update patient allergies"
  ON patient_allergies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
      AND users.role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
      AND users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Only admins and doctors can delete allergies
CREATE POLICY "Admins and doctors can delete patient allergies"
  ON patient_allergies FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
      AND users.role IN ('admin', 'doctor')
    )
  );

-- RLS Policies for patient_preferences

-- All authenticated staff can view patient preferences
CREATE POLICY "Staff can view patient preferences"
  ON patient_preferences FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
    )
  );

-- Clinical staff can insert patient preferences
CREATE POLICY "Staff can insert patient preferences"
  ON patient_preferences FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
    )
  );

-- Clinical staff can update patient preferences
CREATE POLICY "Staff can update patient preferences"
  ON patient_preferences FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
    )
  );

-- Only admins can delete preferences
CREATE POLICY "Admins can delete patient preferences"
  ON patient_preferences FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::text
      AND users.role = 'admin'
    )
  );

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
CREATE TRIGGER update_patient_allergies_updated_at
  BEFORE UPDATE ON patient_allergies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_preferences_updated_at ON patient_preferences;
CREATE TRIGGER update_patient_preferences_updated_at
  BEFORE UPDATE ON patient_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
