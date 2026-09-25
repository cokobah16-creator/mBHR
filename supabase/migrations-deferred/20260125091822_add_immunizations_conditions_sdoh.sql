/*
  # Add Immunizations, Conditions, and SDOH Observations for TEFCA/IAS

  1. New Tables
    - `immunizations` - Patient vaccination records
      - `id` (uuid, primary key)
      - `patient_id` (text) - Reference to patient
      - `vaccine_code` (text) - CVX code for vaccine
      - `vaccine_name` (text) - Display name
      - `lot_number` (text) - Vaccine lot number
      - `administered_at` (timestamptz) - Date/time administered
      - `administered_by` (text) - Healthcare worker
      - `site` (text) - Injection site
      - `route` (text) - Route of administration
      - `dose_quantity` (decimal) - Dose amount
      - `dose_unit` (text) - Dose unit
      - `series_doses_recommended` (integer) - Recommended doses in series
      - `series_dose_number` (integer) - Current dose number
      - `status` (text) - completed, entered-in-error, not-done
      - `notes` (text) - Additional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `conditions` - Patient diagnoses and health conditions
      - `id` (uuid, primary key)
      - `patient_id` (text) - Reference to patient
      - `condition_code` (text) - ICD-10 or SNOMED code
      - `condition_name` (text) - Display name
      - `clinical_status` (text) - active, recurrence, relapse, inactive, remission, resolved
      - `verification_status` (text) - unconfirmed, provisional, differential, confirmed
      - `category` (text) - problem-list-item, encounter-diagnosis, health-concern
      - `severity` (text) - mild, moderate, severe
      - `onset_date` (date) - When condition started
      - `abatement_date` (date) - When condition resolved
      - `recorded_by` (text) - Healthcare worker who recorded
      - `notes` (text) - Additional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `sdoh_observations` - Social Determinants of Health
      - `id` (uuid, primary key)
      - `patient_id` (text) - Reference to patient
      - `category` (text) - housing, food, transportation, employment, education, social
      - `observation_code` (text) - LOINC code
      - `observation_name` (text) - Display name
      - `value_code` (text) - Coded answer
      - `value_text` (text) - Text answer
      - `value_boolean` (boolean) - Boolean answer
      - `effective_date` (date) - When observation was made
      - `recorded_by` (text) - Healthcare worker
      - `notes` (text) - Additional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Staff can read/write patient data
    - Patients can view their own records via portal

  3. Indexes
    - Index on patient_id for fast lookups
    - Index on vaccine_code for immunization queries
    - Index on condition_code for diagnosis queries
*/

CREATE TABLE IF NOT EXISTS immunizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  vaccine_code text,
  vaccine_name text NOT NULL,
  lot_number text,
  administered_at timestamptz DEFAULT now(),
  administered_by text,
  site text,
  route text,
  dose_quantity decimal(10,2),
  dose_unit text DEFAULT 'mL',
  series_doses_recommended integer,
  series_dose_number integer,
  status text DEFAULT 'completed' CHECK (status IN ('completed', 'entered-in-error', 'not-done')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  condition_code text,
  condition_name text NOT NULL,
  clinical_status text DEFAULT 'active' CHECK (clinical_status IN ('active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved')),
  verification_status text DEFAULT 'confirmed' CHECK (verification_status IN ('unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error')),
  category text DEFAULT 'problem-list-item' CHECK (category IN ('problem-list-item', 'encounter-diagnosis', 'health-concern')),
  severity text CHECK (severity IN ('mild', 'moderate', 'severe')),
  onset_date date,
  abatement_date date,
  recorded_by text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sdoh_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('housing', 'food', 'transportation', 'employment', 'education', 'social', 'financial', 'safety')),
  observation_code text,
  observation_name text NOT NULL,
  value_code text,
  value_text text,
  value_boolean boolean,
  effective_date date DEFAULT CURRENT_DATE,
  recorded_by text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE immunizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sdoh_observations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'immunizations' AND policyname = 'Staff can manage immunizations'
  ) THEN
    CREATE POLICY "Staff can manage immunizations"
      ON immunizations
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse', 'volunteer')
        )
      )
      WITH CHECK (
        EXISTS (
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
    SELECT 1 FROM pg_policies WHERE tablename = 'immunizations' AND policyname = 'Patients can view own immunizations'
  ) THEN
    CREATE POLICY "Patients can view own immunizations"
      ON immunizations
      FOR SELECT
      TO authenticated
      USING (patient_id = auth.uid()::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'conditions' AND policyname = 'Staff can manage conditions'
  ) THEN
    CREATE POLICY "Staff can manage conditions"
      ON conditions
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse', 'volunteer')
        )
      )
      WITH CHECK (
        EXISTS (
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
    SELECT 1 FROM pg_policies WHERE tablename = 'conditions' AND policyname = 'Patients can view own conditions'
  ) THEN
    CREATE POLICY "Patients can view own conditions"
      ON conditions
      FOR SELECT
      TO authenticated
      USING (patient_id = auth.uid()::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sdoh_observations' AND policyname = 'Staff can manage SDOH observations'
  ) THEN
    CREATE POLICY "Staff can manage SDOH observations"
      ON sdoh_observations
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role IN ('admin', 'doctor', 'nurse', 'volunteer')
        )
      )
      WITH CHECK (
        EXISTS (
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
    SELECT 1 FROM pg_policies WHERE tablename = 'sdoh_observations' AND policyname = 'Patients can view own SDOH observations'
  ) THEN
    CREATE POLICY "Patients can view own SDOH observations"
      ON sdoh_observations
      FOR SELECT
      TO authenticated
      USING (patient_id = auth.uid()::text);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_immunizations_patient_id ON immunizations(patient_id);
CREATE INDEX IF NOT EXISTS idx_immunizations_vaccine_code ON immunizations(vaccine_code);
CREATE INDEX IF NOT EXISTS idx_immunizations_administered_at ON immunizations(administered_at DESC);

CREATE INDEX IF NOT EXISTS idx_conditions_patient_id ON conditions(patient_id);
CREATE INDEX IF NOT EXISTS idx_conditions_condition_code ON conditions(condition_code);
CREATE INDEX IF NOT EXISTS idx_conditions_clinical_status ON conditions(clinical_status);

CREATE INDEX IF NOT EXISTS idx_sdoh_patient_id ON sdoh_observations(patient_id);
CREATE INDEX IF NOT EXISTS idx_sdoh_category ON sdoh_observations(category);
CREATE INDEX IF NOT EXISTS idx_sdoh_effective_date ON sdoh_observations(effective_date DESC);

CREATE OR REPLACE FUNCTION update_immunizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_immunizations_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_immunizations_updated_at_trigger
      BEFORE UPDATE ON immunizations
      FOR EACH ROW
      EXECUTE FUNCTION update_immunizations_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_conditions_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_conditions_updated_at_trigger
      BEFORE UPDATE ON conditions
      FOR EACH ROW
      EXECUTE FUNCTION update_immunizations_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_sdoh_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_sdoh_updated_at_trigger
      BEFORE UPDATE ON sdoh_observations
      FOR EACH ROW
      EXECUTE FUNCTION update_immunizations_updated_at();
  END IF;
END $$;

COMMENT ON TABLE immunizations IS 'Patient vaccination records - FHIR Immunization resource';
COMMENT ON TABLE conditions IS 'Patient diagnoses and health conditions - FHIR Condition resource';
COMMENT ON TABLE sdoh_observations IS 'Social Determinants of Health observations - FHIR Observation (SDOH) resource';
COMMENT ON COLUMN immunizations.vaccine_code IS 'CVX vaccine code from CDC';
COMMENT ON COLUMN conditions.condition_code IS 'ICD-10-CM or SNOMED CT code';
COMMENT ON COLUMN sdoh_observations.category IS 'SDOH domain: housing, food, transportation, employment, education, social, financial, safety';
