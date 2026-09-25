/*
  # Extend resource_versions snapshot triggers to remaining clinical tables

  TEFCA QHIN Phase B-3.

  Phase B-2 added the resource_versions snapshot store with triggers on the
  six clinician-mutated tables that have an obvious 1-row -> 1-FHIR-resource
  mapping (patients, conditions, prescriptions, patient_allergies, care_plans,
  goals).

  Phase B-3 extends those triggers to the remaining single-row -> single-FHIR
  resources, giving them _history-instance / vread support without any
  changes to history.ts or the dispatcher:

      visits               -> Encounter
      immunizations        -> Immunization
      procedures           -> Procedure
      document_references  -> DocumentReference
      service_requests     -> ServiceRequest
      dispenses            -> MedicationDispense

  Intentionally NOT covered here:
    - vitals + sdoh_observations -> Observation. One DB row maps to multiple
      FHIR Observations (e.g. one vitals row produces BP + heart_rate + …),
      so a single snapshot can't faithfully represent the corresponding
      _history Bundle. A future PR would need either per-column snapshots
      or a smarter history.ts that knows the row-to-resources expansion.
    - lab_orders + lab_results -> DiagnosticReport. One FHIR resource is
      built by joining two tables, and a snapshot of either row in
      isolation won't reflect changes on the other. Same caveat as above.
    - dispenses also feeds the legacy MedicationRequest mapper. The trigger
      below records the row under resource_type='MedicationDispense'; the
      MedicationRequest mapper is invoked at vread time on the same snapshot
      via the registry's mapper indirection in history.ts:loadResourceVersion,
      so MedicationRequest is implicitly versioned by the same trigger.
      The registry exposes only one history-instance interaction per
      resource type either way.
*/

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (
      VALUES
        ('visits',              'Encounter'),
        ('immunizations',       'Immunization'),
        ('procedures',          'Procedure'),
        ('document_references', 'DocumentReference'),
        ('service_requests',    'ServiceRequest'),
        ('dispenses',           'MedicationDispense')
    ) AS t(table_name, fhir_type)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = pair.table_name)
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgname = 'trg_fhir_version_' || pair.table_name
       )
    THEN
      EXECUTE format(
        'CREATE TRIGGER %I
           AFTER INSERT OR UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION fhir_record_resource_version(%L);',
        'trg_fhir_version_' || pair.table_name,
        pair.table_name,
        pair.fhir_type
      );
    END IF;
  END LOOP;
END $$;
