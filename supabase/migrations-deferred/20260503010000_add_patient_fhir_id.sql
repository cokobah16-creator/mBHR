/*
  # Add stable external FHIR id to patients

  Adds patients.fhir_id (uuid) so the FHIR API can expose a stable, opaque
  identifier separate from the human-readable internal patients.id. Existing
  rows are backfilled with gen_random_uuid().

  1. Schema change
    - patients.fhir_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid()

  2. Index
    - idx_patients_fhir_id for lookup by external FHIR id

  Note: tefca-ias edge function will continue to accept the internal id during
  the transition; new clients should use fhir_id.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'fhir_id'
  ) THEN
    ALTER TABLE patients ADD COLUMN fhir_id uuid DEFAULT gen_random_uuid();
    UPDATE patients SET fhir_id = gen_random_uuid() WHERE fhir_id IS NULL;
    ALTER TABLE patients ALTER COLUMN fhir_id SET NOT NULL;
    ALTER TABLE patients ADD CONSTRAINT patients_fhir_id_unique UNIQUE (fhir_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_fhir_id ON patients(fhir_id);

COMMENT ON COLUMN patients.fhir_id IS 'Stable opaque UUID exposed as Patient.id over the FHIR API. Internal patients.id remains for in-app references.';
