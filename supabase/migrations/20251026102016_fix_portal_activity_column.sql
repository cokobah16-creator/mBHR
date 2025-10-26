/*
  # Fix Portal Activity Column

  1. Changes
    - Add missing `last_portal_activity` column to patients table
    - Add index for performance on portal activity queries
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'last_portal_activity'
  ) THEN
    ALTER TABLE patients ADD COLUMN last_portal_activity timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_last_portal_activity ON patients(last_portal_activity);
