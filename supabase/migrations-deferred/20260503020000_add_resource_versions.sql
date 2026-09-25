/*
  # Add resource_versions snapshot table for FHIR _history / vread

  TEFCA / FHIR R4 compliance Phase B-2.

  Records a JSONB snapshot of every UPDATE/DELETE on the configured set of
  clinician-mutated tables so the FHIR endpoint can answer:
    GET /{Resource}/{id}/_history
    GET /{Resource}/{id}/_history/{vid}     -> vread

  Snapshotted resources (clinician-mutated): patients, conditions, prescriptions,
  patient_allergies, care_plans, goals.

  Derived/append-only resources (Observation/vitals, Observation/sdoh, Encounter,
  Immunization, Procedure, DiagnosticReport, DocumentReference, ServiceRequest,
  MedicationDispense) reconstruct history on-the-fly from updated_at / audit
  logs and therefore have no triggers here.

  Schema
    resource_versions
      id           uuid PK
      resource_type text     - FHIR resource type ("Patient", "Condition", ...)
      logical_id   text      - underlying primary key (matches the source row)
      version_id   int       - monotonically increasing per (resource_type,logical_id)
      valid_from   timestamptz - when this version became current
      valid_to     timestamptz - when this version was superseded (NULL = current)
      snapshot     jsonb       - full row at this point in time
      operation    text        - 'INSERT' | 'UPDATE' | 'DELETE'
      created_by   text        - auth.uid()::text where available

  Trigger fhir_record_resource_version() runs AFTER INSERT/UPDATE/DELETE and
  closes the previous current version then writes the new snapshot.

  Indexes
    (resource_type, logical_id, version_id) for vread
    (resource_type, logical_id, valid_from DESC) for _history paging
*/

CREATE TABLE IF NOT EXISTS resource_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL,
  logical_id   text NOT NULL,
  version_id   int  NOT NULL,
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_to     timestamptz,
  snapshot     jsonb NOT NULL,
  operation    text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_versions_vread
  ON resource_versions(resource_type, logical_id, version_id);

CREATE INDEX IF NOT EXISTS idx_resource_versions_history
  ON resource_versions(resource_type, logical_id, valid_from DESC);

ALTER TABLE resource_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'resource_versions' AND policyname = 'Service role can manage resource_versions'
  ) THEN
    CREATE POLICY "Service role can manage resource_versions"
      ON resource_versions
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'resource_versions' AND policyname = 'Admins can read resource_versions'
  ) THEN
    CREATE POLICY "Admins can read resource_versions"
      ON resource_versions
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

CREATE OR REPLACE FUNCTION fhir_record_resource_version()
RETURNS TRIGGER AS $$
DECLARE
  v_resource_type text := TG_ARGV[0];
  v_logical_id    text;
  v_snapshot      jsonb;
  v_next_version  int;
  v_actor         text;
BEGIN
  -- Pick the surviving row's id (NEW for INSERT/UPDATE, OLD for DELETE).
  IF TG_OP = 'DELETE' THEN
    v_logical_id := OLD.id::text;
    v_snapshot   := to_jsonb(OLD);
  ELSE
    v_logical_id := NEW.id::text;
    v_snapshot   := to_jsonb(NEW);
  END IF;

  -- Best-effort capture of the actor; auth.uid() may be NULL for service role.
  BEGIN
    v_actor := auth.uid()::text;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  -- Close the previous current version (if any) and bump the version counter.
  UPDATE resource_versions
     SET valid_to = now()
   WHERE resource_type = v_resource_type
     AND logical_id    = v_logical_id
     AND valid_to IS NULL;

  SELECT COALESCE(MAX(version_id), 0) + 1
    INTO v_next_version
    FROM resource_versions
   WHERE resource_type = v_resource_type
     AND logical_id    = v_logical_id;

  INSERT INTO resource_versions (
    resource_type, logical_id, version_id,
    valid_from, valid_to, snapshot, operation, created_by
  ) VALUES (
    v_resource_type, v_logical_id, v_next_version,
    now(),
    CASE WHEN TG_OP = 'DELETE' THEN now() ELSE NULL END,
    v_snapshot,
    TG_OP,
    v_actor
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (
      VALUES
        ('patients',          'Patient'),
        ('conditions',        'Condition'),
        ('prescriptions',     'MedicationRequest'),
        ('patient_allergies', 'AllergyIntolerance'),
        ('care_plans',        'CarePlan'),
        ('goals',             'Goal')
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

COMMENT ON TABLE resource_versions IS
  'FHIR R4 _history / vread snapshot store for clinician-mutated resources';
COMMENT ON COLUMN resource_versions.version_id IS
  'Per (resource_type, logical_id) monotonic version number; matches FHIR meta.versionId';
