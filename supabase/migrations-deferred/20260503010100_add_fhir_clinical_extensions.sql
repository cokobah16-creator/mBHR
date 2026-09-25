/*
  # Add FHIR clinical extension tables (Procedure, DocumentReference, CarePlan, Goal, ServiceRequest)

  These tables back the corresponding FHIR R4 / US Core 7.0 resources served by
  the TEFCA IAS endpoint.

  1. New tables
    - procedures           -> FHIR Procedure
    - document_references  -> FHIR DocumentReference
    - care_plans           -> FHIR CarePlan
    - goals                -> FHIR Goal
    - service_requests     -> FHIR ServiceRequest

  2. Security
    - RLS enabled on every table
    - Staff (admin/doctor/nurse/volunteer) can read/write per role policy
    - Patients can read their own rows via portal

  3. Indexes
    - (patient_id), (status), (encounter_id) where applicable to support FHIR
      `patient`, `status`, `_lastUpdated` searches.
*/

CREATE TABLE IF NOT EXISTS procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id text REFERENCES visits(id) ON DELETE SET NULL,
  code_system text,
  code text,
  display text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN (
    'preparation','in-progress','not-done','on-hold','stopped','completed','entered-in-error','unknown'
  )),
  performed_at timestamptz,
  performer_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  context_encounter_id text REFERENCES visits(id) ON DELETE SET NULL,
  type_system text DEFAULT 'http://loinc.org',
  type_code text,
  type_display text,
  category text,
  status text NOT NULL DEFAULT 'current' CHECK (status IN (
    'current','superseded','entered-in-error'
  )),
  doc_status text CHECK (doc_status IN ('preliminary','final','amended','entered-in-error')),
  content_url text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/pdf',
  content_title text,
  author_id text,
  authored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  category text,
  intent text NOT NULL DEFAULT 'plan' CHECK (intent IN ('proposal','plan','order','option','directive')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'draft','active','on-hold','revoked','completed','entered-in-error','unknown'
  )),
  title text,
  description text,
  period_start timestamptz,
  period_end timestamptz,
  addresses jsonb DEFAULT '[]'::jsonb,
  goal_ids jsonb DEFAULT '[]'::jsonb,
  author_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  care_plan_id uuid REFERENCES care_plans(id) ON DELETE SET NULL,
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN (
    'proposed','planned','accepted','active','on-hold','completed','cancelled','entered-in-error','rejected'
  )),
  achievement_status text CHECK (achievement_status IN (
    'in-progress','improving','worsening','no-change','achieved','sustaining','not-achieved','no-progress','not-attainable'
  )),
  category text,
  description text NOT NULL,
  start_date date,
  target_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id text REFERENCES visits(id) ON DELETE SET NULL,
  intent text NOT NULL DEFAULT 'order' CHECK (intent IN (
    'proposal','plan','directive','order','original-order','reflex-order','filler-order','instance-order','option'
  )),
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'draft','active','on-hold','revoked','completed','entered-in-error','unknown'
  )),
  category text,
  code_system text,
  code text,
  display text NOT NULL,
  requester_id text,
  occurrence_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE procedures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_references  ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['procedures','document_references','care_plans','goals','service_requests']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = t AND policyname = 'Staff can manage ' || t
    ) THEN
      EXECUTE format($f$
        CREATE POLICY %I
          ON %I
          FOR ALL
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM app_users
              WHERE app_users.id = auth.uid()::text
              AND app_users.role IN ('admin','doctor','nurse','volunteer')
            )
          )
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM app_users
              WHERE app_users.id = auth.uid()::text
              AND app_users.role IN ('admin','doctor','nurse')
            )
          );
      $f$, 'Staff can manage ' || t, t);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = t AND policyname = 'Patients can view own ' || t
    ) THEN
      EXECUTE format($f$
        CREATE POLICY %I
          ON %I
          FOR SELECT
          TO authenticated
          USING (patient_id = auth.uid()::text);
      $f$, 'Patients can view own ' || t, t);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_procedures_patient_id   ON procedures(patient_id);
CREATE INDEX IF NOT EXISTS idx_procedures_status       ON procedures(status);
CREATE INDEX IF NOT EXISTS idx_procedures_performed_at ON procedures(performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_refs_patient_id  ON document_references(patient_id);
CREATE INDEX IF NOT EXISTS idx_doc_refs_status      ON document_references(status);
CREATE INDEX IF NOT EXISTS idx_doc_refs_authored_at ON document_references(authored_at DESC);

CREATE INDEX IF NOT EXISTS idx_care_plans_patient_id ON care_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_care_plans_status     ON care_plans(status);

CREATE INDEX IF NOT EXISTS idx_goals_patient_id      ON goals(patient_id);
CREATE INDEX IF NOT EXISTS idx_goals_lifecycle       ON goals(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_goals_care_plan_id    ON goals(care_plan_id);

CREATE INDEX IF NOT EXISTS idx_svc_req_patient_id    ON service_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_svc_req_status        ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_svc_req_occurrence_at ON service_requests(occurrence_at DESC);

CREATE OR REPLACE FUNCTION fhir_ext_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['procedures','document_references','care_plans','goals','service_requests']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_touch_updated_at'
    ) THEN
      EXECUTE format($f$
        CREATE TRIGGER %I
          BEFORE UPDATE ON %I
          FOR EACH ROW
          EXECUTE FUNCTION fhir_ext_touch_updated_at();
      $f$, 'trg_' || t || '_touch_updated_at', t);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE procedures          IS 'FHIR Procedure resource backing store';
COMMENT ON TABLE document_references IS 'FHIR DocumentReference resource backing store';
COMMENT ON TABLE care_plans          IS 'FHIR CarePlan resource backing store';
COMMENT ON TABLE goals               IS 'FHIR Goal resource backing store';
COMMENT ON TABLE service_requests    IS 'FHIR ServiceRequest resource backing store';
