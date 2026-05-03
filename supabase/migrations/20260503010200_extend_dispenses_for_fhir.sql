/*
  # Extend dispenses for FHIR MedicationDispense

  Adds the columns required by FHIR R4 MedicationDispense / US Core 7.0
  us-core-medicationdispense profile so dispenses can be served distinctly
  from MedicationRequest.

  Canonical dispenses table (from supabase/migrations/20250930030513_super_flower.sql):
    id, patient_id, visit_id, item_name, qty, dosage, directions,
    dispensed_by, dispensed_at, updated_at

  1. Added columns
    - when_handed_over            timestamptz  (FHIR MedicationDispense.whenHandedOver)
    - dispense_status             text         (FHIR MedicationDispense.status)
    - days_supply                 int          (FHIR MedicationDispense.daysSupply.value)
    - authorizing_prescription_id text         (FHIR MedicationDispense.authorizingPrescription -> prescriptions.id)
    - medication_code_system      text         (RxNorm by default)
    - medication_code             text

  2. Backfill
    - when_handed_over <- dispensed_at where null
    - dispense_status defaults to 'completed' for historical rows
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'dispenses' AND column_name = 'when_handed_over'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN when_handed_over timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'dispenses' AND column_name = 'dispense_status'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN dispense_status text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'dispenses' AND column_name = 'days_supply'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN days_supply int;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'dispenses' AND column_name = 'authorizing_prescription_id'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN authorizing_prescription_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'dispenses' AND column_name = 'medication_code_system'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN medication_code_system text DEFAULT 'http://www.nlm.nih.gov/research/umls/rxnorm';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'dispenses' AND column_name = 'medication_code'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN medication_code text;
  END IF;
END $$;

UPDATE dispenses
   SET when_handed_over = dispensed_at
 WHERE when_handed_over IS NULL
   AND dispensed_at IS NOT NULL;

UPDATE dispenses
   SET dispense_status = 'completed'
 WHERE dispense_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'dispenses' AND constraint_name = 'dispenses_status_chk'
  ) THEN
    ALTER TABLE dispenses
      ADD CONSTRAINT dispenses_status_chk CHECK (
        dispense_status IS NULL OR dispense_status IN (
          'preparation','in-progress','cancelled','on-hold','completed',
          'entered-in-error','stopped','declined','unknown'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prescriptions')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'dispenses' AND constraint_name = 'dispenses_authorizing_rx_fk'
     )
  THEN
    ALTER TABLE dispenses
      ADD CONSTRAINT dispenses_authorizing_rx_fk
      FOREIGN KEY (authorizing_prescription_id)
      REFERENCES prescriptions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispenses_when_handed_over ON dispenses(when_handed_over DESC);
CREATE INDEX IF NOT EXISTS idx_dispenses_dispense_status ON dispenses(dispense_status);
CREATE INDEX IF NOT EXISTS idx_dispenses_authorizing_rx ON dispenses(authorizing_prescription_id);

COMMENT ON COLUMN dispenses.when_handed_over IS 'FHIR MedicationDispense.whenHandedOver';
COMMENT ON COLUMN dispenses.dispense_status IS 'FHIR MedicationDispense.status';
COMMENT ON COLUMN dispenses.days_supply IS 'FHIR MedicationDispense.daysSupply.value (days)';
COMMENT ON COLUMN dispenses.authorizing_prescription_id IS 'FHIR MedicationDispense.authorizingPrescription -> prescriptions.id';
COMMENT ON COLUMN dispenses.medication_code IS 'RxNorm code (or coded system in medication_code_system) for the dispensed product';
