#!/usr/bin/env python3
"""Print the SQL a plain PostgreSQL needs before the interop migrations can run.

The repository's migration history cannot replay on an empty database (see
docs/interoperability/testing.md), so the interop CI job builds only what
supabase/migrations-deferred/20260926110000_interop_foundation.sql and
supabase/migrations-deferred/20260926130000_interop_phase2.sql depend on: the
Supabase API roles, an auth.uid() and auth.jwt() that read request.jwt.claims
(as Supabase's do), minimal stand-ins for the tables the functions read (only
the columns they use), and the real definitions of the helper functions,
copied from the migration files that define them (the latest definition wins).

Phase 1 part: app_users, rate limits, app_current_role, app_role_has_permission,
app_is_staff. Phase 2 part: patients (fhir_id, merge and portal columns, the
patients_select row-level security rule), patient_portal_users, pharmacy_items,
lab_orders, lab_results, prescriptions, dispenses, patient_allergies,
patient_documents, current_portal_user_id and app_portal_patient_ids. The stub
tables carry the indexes the repository's migrations leave on them, so the
Phase 2 index step is checked against the same starting point.
"""
import re
import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

PRELUDE = """
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END$$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA auth, extensions, public TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$f$;
CREATE TABLE IF NOT EXISTS public.app_users (
  id text PRIMARY KEY, full_name text NOT NULL, role text NOT NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
"""

FUNCTIONS = [
    ("20260924110000_rls_permission_helpers.sql", "app_current_role"),
    ("20260925100600_registration_lead_portal_invite.sql", "app_role_has_permission"),
    ("20260925100600_registration_lead_portal_invite.sql", "app_is_staff"),
]

# Phase 2: auth.jwt() and the clinical tables the new functions read. Column
# names and types follow the repository's migrations (text patient ids, uuid
# lab ids); only the columns the interop functions and tests use are here.
PHASE2_TABLES = """
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$f$;

CREATE TABLE IF NOT EXISTS public.patients (
  id text PRIMARY KEY,
  fhir_id uuid NOT NULL DEFAULT gen_random_uuid(),
  given_name text, family_name text, phone text,
  auth_uid text,
  portal_enabled boolean NOT NULL DEFAULT false,
  portal_enabled_changed_at timestamptz,
  merged_into text REFERENCES public.patients (id) ON DELETE SET NULL,
  merged_at timestamptz,
  merged_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT patients_fhir_id_unique UNIQUE (fhir_id),
  CONSTRAINT patients_not_self_merged CHECK (merged_into IS NULL OR merged_into <> id));
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_auth_uid_unique ON public.patients (auth_uid) WHERE auth_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_merged_into ON public.patients (merged_into) WHERE merged_into IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.patient_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL UNIQUE,
  phone_number text,
  account_status text NOT NULL DEFAULT 'active');

CREATE TABLE IF NOT EXISTS public.pharmacy_items (
  id text PRIMARY KEY, med_name text NOT NULL, form text NOT NULL,
  strength text NOT NULL, unit text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS public.lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  visit_id text, ordered_by text,
  test_name text NOT NULL, test_code text,
  priority text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'ordered',
  specimen_type text, clinical_notes text,
  ordered_at timestamptz NOT NULL DEFAULT now(), collected_at timestamptz,
  completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient_id ON public.lab_orders (patient_id);

CREATE TABLE IF NOT EXISTS public.lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.lab_orders (id) ON DELETE CASCADE,
  result_value text NOT NULL, result_unit text, reference_range text,
  interpretation text,
  result_date timestamptz NOT NULL DEFAULT now(),
  reviewed_by text, reviewed_at timestamptz, notes text,
  released_to_patient_at timestamptz, released_to_patient_by text, patient_note text,
  withheld_at timestamptz, withheld_by text, withheld_reason text,
  amended_at timestamptz,
  superseded_by uuid REFERENCES public.lab_results (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- As left by 20251027000000 (idx_lab_results_order dropped) and 20260925100500.
CREATE INDEX IF NOT EXISTS idx_lab_results_released ON public.lab_results (order_id) WHERE released_to_patient_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id text PRIMARY KEY, visit_id text NOT NULL, patient_id text NOT NULL,
  prescriber_id text NOT NULL, lines jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL);
CREATE TABLE IF NOT EXISTS public.dispenses (
  id text PRIMARY KEY,
  prescription_id text REFERENCES public.prescriptions (id) ON DELETE CASCADE,
  patient_id text NOT NULL, dispensed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_dispenses_patient_id ON public.dispenses (patient_id);

CREATE TABLE IF NOT EXISTS public.patient_allergies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id text NOT NULL, allergen text NOT NULL);
-- 20251025000000:92 (not dropped by 20251027000000, which drops idx_patient_allergies_patient).
CREATE INDEX IF NOT EXISTS idx_patient_allergies_patient_id ON public.patient_allergies (patient_id);

CREATE TABLE IF NOT EXISTS public.patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id text NOT NULL,
  document_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- 20251026225242:121 and 20251030000000:123.
CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON public.patient_documents (patient_id);
CREATE INDEX IF NOT EXISTS idx_documents_patient ON public.patient_documents (patient_id, created_at DESC);
"""

PHASE2_FUNCTIONS = [
    ("20260517152556_lockdown_rls_and_definer.sql", "current_portal_user_id"),
    ("20260925100000_sync_authority_foundation.sql", "app_portal_patient_ids"),
]

# The patients SELECT rule of 20260924110100 (staff read all; a portal patient
# reads their own linked record) and the API grants Supabase gives by default.
PHASE2_POLICIES = """
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patients_select ON public.patients;
CREATE POLICY patients_select ON public.patients FOR SELECT TO authenticated
  USING ((SELECT public.app_is_staff()) OR id::text IN (SELECT public.app_portal_patient_ids()));
GRANT SELECT ON public.patients TO authenticated;
GRANT SELECT ON public.patients TO service_role;
GRANT EXECUTE ON FUNCTION public.current_portal_user_id(), public.app_portal_patient_ids()
  TO authenticated, service_role;
"""


def function_sql(file: str, name: str) -> str:
    text = (MIGRATIONS / file).read_text()
    starts = [m.start() for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\." + name + r"\(", text)]
    if not starts:
        sys.exit(f"{name} not found in {file}")
    start = starts[-1]
    body = text.index("AS $$", start) + len("AS $$")
    end = text.index("$$;", body) + len("$$;")
    return text[start:end]


def main() -> None:
    parts = [PRELUDE, (MIGRATIONS / "20260517153407_generic_rate_limits.sql").read_text()]
    parts += [function_sql(f, n) for f, n in FUNCTIONS]
    parts.append(
        "GRANT EXECUTE ON FUNCTION public.app_current_role(), "
        "public.app_role_has_permission(text, text), public.app_is_staff() TO authenticated;"
    )
    parts.append(PHASE2_TABLES)
    parts += [function_sql(f, n) for f, n in PHASE2_FUNCTIONS]
    parts.append(PHASE2_POLICIES)
    print("\n\n".join(parts))


if __name__ == "__main__":
    main()
