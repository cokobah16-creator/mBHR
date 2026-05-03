/*
  # FHIR write-path passthrough store

  TEFCA QHIN Phase H (D-2).

  Adds a generic, validator-gated FHIR resource store backing the new write
  endpoints (POST /{Resource}, PUT /{Resource}/{id}, DELETE /{Resource}/{id})
  in tefca-ias.

  Why a passthrough store instead of writing back to the existing clinical
  tables? Each FHIR resource type would need a hand-written reverse mapper
  to fit its native row shape (e.g. an Observation BP panel into vitals.
  systolic + diastolic columns). Phase H scope is the validator gate, not
  the round-trip integration; writes land here and the existing read
  endpoints continue to serve from the canonical clinical tables. A
  follow-up phase will introduce a read-merger that unions fhir_resources
  with the per-resource queries.

  Schema
    fhir_resources(
      resource_type      FHIR R4 resourceType the payload claims to be
      logical_id         FHIR id assigned at create time (server-generated UUID)
      version_id         monotonically increasing per (resource_type, logical_id)
      payload            full FHIR JSON
      patient_id         denormalized patient reference for audit/index
      source_client_id   oauth_clients.client_id of the writer
      status             active | superseded | entered-in-error
      created_at, updated_at timestamps
    )

  Triggers populate resource_versions so /Resource/{id}/_history and
  /Resource/{id}/_history/{vid} (vread) Just Work for written payloads.

  Security
    RLS service-role-managed (the edge function uses the service-role key).
    Admins can SELECT for diagnostics.
*/

CREATE TABLE IF NOT EXISTS fhir_resources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type     text NOT NULL,
  /** FHIR id surfaced as Resource.id and used in read paths. */
  logical_id        text NOT NULL,
  version_id        int NOT NULL DEFAULT 1,
  payload           jsonb NOT NULL,
  patient_id        text,
  source_client_id  text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN (
                      'active','superseded','entered-in-error'
                    )),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fhir_resources_logical_id_unique
    UNIQUE (resource_type, logical_id)
);

CREATE INDEX IF NOT EXISTS idx_fhir_resources_resource_type
  ON fhir_resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_fhir_resources_patient_id
  ON fhir_resources(patient_id);
CREATE INDEX IF NOT EXISTS idx_fhir_resources_source_client_id
  ON fhir_resources(source_client_id);
CREATE INDEX IF NOT EXISTS idx_fhir_resources_updated_at
  ON fhir_resources(updated_at DESC);

ALTER TABLE fhir_resources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'fhir_resources' AND policyname = 'service_role manages fhir_resources'
  ) THEN
    CREATE POLICY "service_role manages fhir_resources"
      ON fhir_resources FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'fhir_resources' AND policyname = 'Admins read fhir_resources'
  ) THEN
    CREATE POLICY "Admins read fhir_resources"
      ON fhir_resources FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role = 'admin'
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fhir_resources_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function FIRST, then the trigger that references it.
CREATE OR REPLACE FUNCTION fhir_record_fhir_resources_version()
RETURNS TRIGGER AS $$
DECLARE
  v_resource_type text;
  v_logical_id    text;
  v_snapshot      jsonb;
  v_next_version  int;
  v_actor         text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_resource_type := OLD.resource_type;
    v_logical_id    := OLD.logical_id;
    v_snapshot      := OLD.payload;
  ELSE
    v_resource_type := NEW.resource_type;
    v_logical_id    := NEW.logical_id;
    v_snapshot      := NEW.payload;
  END IF;

  BEGIN
    v_actor := auth.uid()::text;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fhir_resources_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_fhir_resources_touch_updated_at
      BEFORE UPDATE ON fhir_resources
      FOR EACH ROW EXECUTE FUNCTION fhir_resources_touch_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fhir_resources_record_version'
  ) THEN
    CREATE TRIGGER trg_fhir_resources_record_version
      AFTER INSERT OR UPDATE OR DELETE ON fhir_resources
      FOR EACH ROW EXECUTE FUNCTION fhir_record_fhir_resources_version();
  END IF;
END $$;

COMMENT ON TABLE fhir_resources IS
  'Validator-gated FHIR write store (Phase H / D-2). Reads still come from the canonical clinical tables; a future read-merger PR will union both.';
