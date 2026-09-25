-- pgTAP: FHIR R4 Phase 2 database functions
-- Migration under test: supabase/migrations/20260926130000_interop_phase2.sql
-- (after 20260926110000_interop_foundation.sql). Run with `supabase test db`
-- (see supabase/tests/README.md). Fixtures are created below and everything
-- is rolled back at the end.
--
-- Fixture ids: uuids start with 9999, text ids with pgtap-p2-. Inside the
-- transaction the file adds app_users.is_active (if missing) and drops the
-- app_users role CHECK so that a 'guest' row can exist (production allows
-- guest); both are rolled back. These take a lock on app_users until the
-- rollback: on a shared database, run the file when nobody is signing in.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(227);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_active boolean;
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.app_users'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%role%' LOOP
    EXECUTE format('ALTER TABLE public.app_users DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- Staff. Every surname starts with "Pgtapq" so a name search can find
-- exactly these rows on a database that has other accounts.
INSERT INTO public.app_users (id, full_name, role, is_active) VALUES
  ('99990000-0000-4000-8000-000000000001', 'Dr. Adaeze Pgtapqone', 'doctor', NULL),
  ('99990000-0000-4000-8000-000000000002', 'Bola Pgtapqtwo', 'nurse', NULL),
  ('99990000-0000-4000-8000-000000000003', 'Chidi Pgtapqthree', 'pharmacist', NULL),
  ('99990000-0000-4000-8000-000000000004', 'Dayo Pgtapqfour', 'auditor', NULL),
  ('99990000-0000-4000-8000-000000000005', 'Guest Pgtapqfive', 'guest', NULL),
  ('99990000-0000-4000-8000-000000000006', 'Gbenga_x Pgtapqsix', 'volunteer', NULL),
  ('99990000-0000-4000-8000-000000000007', 'Gbengaa Pgtapqseven', 'volunteer', NULL),
  ('99990000-0000-4000-8000-000000000008', 'Ebere Pgtapqeight', 'nurse', false),
  ('99990000-0000-4000-8000-000000000009', 'Femi Pgtapqnine', 'admin', true);

-- Patients: A and B are portal patients (own sign-in, portal on). M1 is
-- merged into A, M2 into M1 (a 2-hop chain). L1..L12 form a loop. D0..D10
-- is a chain of exactly 10 hops. O is an orphaned tombstone. BX gets a
-- consent and is merged into B later (section 6c). C1..C6 hold the consent
-- summary cases (section 3f).
INSERT INTO public.patients (id, given_name, family_name, phone, auth_uid, portal_enabled, portal_enabled_changed_at)
VALUES
  ('pgtap-p2-a', 'Amaka', 'Phase', '08000990001', '99990000-0000-4000-8000-0000000000a1', true, now()),
  ('pgtap-p2-b', 'Bayo', 'Phase', '08000990002', '99990000-0000-4000-8000-0000000000b1', true, now());
INSERT INTO public.patients (id, given_name, family_name, phone)
VALUES
  ('pgtap-p2-m1', 'Amaka', 'Phase', '08000990003'),
  ('pgtap-p2-m2', 'Amaka', 'Phase', '08000990004'),
  ('pgtap-p2-o', 'Orphan', 'Phase', '08000990005'),
  ('pgtap-p2-bx', 'Bayo', 'Phase', '08000990006');
INSERT INTO public.patients (id, given_name, family_name, phone)
SELECT 'pgtap-p2-c' || g, 'Case', 'Phase', '0800099' || lpad((300 + g)::text, 4, '0')
  FROM generate_series(1, 6) AS g;
INSERT INTO public.patients (id, given_name, family_name, phone)
SELECT 'pgtap-p2-l' || g, 'Loop', 'Phase', '0800099' || lpad((100 + g)::text, 4, '0')
  FROM generate_series(1, 12) AS g;
INSERT INTO public.patients (id, given_name, family_name, phone)
SELECT 'pgtap-p2-d' || g, 'Deep', 'Phase', '0800099' || lpad((200 + g)::text, 4, '0')
  FROM generate_series(0, 10) AS g;

UPDATE public.patients SET merged_into = 'pgtap-p2-a', merged_at = now() WHERE id = 'pgtap-p2-m1';
UPDATE public.patients SET merged_into = 'pgtap-p2-m1', merged_at = now() WHERE id = 'pgtap-p2-m2';
UPDATE public.patients SET merged_into = 'pgtap-p2-l' || (g % 12 + 1), merged_at = now()
  FROM generate_series(1, 12) AS g WHERE id = 'pgtap-p2-l' || g;
UPDATE public.patients SET merged_into = 'pgtap-p2-d' || (g + 1), merged_at = now()
  FROM generate_series(0, 9) AS g WHERE id = 'pgtap-p2-d' || g;
UPDATE public.patients SET merged_at = now() WHERE id = 'pgtap-p2-o';

DO $$ BEGIN PERFORM set_config('pgtap_p2.a_fhir', (SELECT fhir_id::text FROM public.patients WHERE id = 'pgtap-p2-a'), true); END $$;
DO $$ BEGIN PERFORM set_config('pgtap_p2.b_fhir', (SELECT fhir_id::text FROM public.patients WHERE id = 'pgtap-p2-b'), true); END $$;

-- A medicine.
INSERT INTO public.pharmacy_items (id, med_name, form, strength, unit)
VALUES ('pgtap-p2-item-1', 'Pgtapq Paracetamol', 'tablet', '500 mg', 'tablet');

-- Lab results (the release guard of 20260925100500 lets these columns be
-- set only with mbhr.lab_release on). For A: R1 released (visible), R2
-- reviewed only, R3 withheld, R4 released but superseded by R1, R5 not
-- reviewed. For B: R6 released.
DO $$ BEGIN PERFORM set_config('mbhr.lab_release', 'on', true); END $$;
INSERT INTO public.lab_orders (id, patient_id, ordered_by, test_name, status) VALUES
  ('9999b0b0-0000-4000-8000-000000000001', 'pgtap-p2-a', '99990000-0000-4000-8000-000000000001', 'pgTAP panel', 'completed'),
  ('9999b0b0-0000-4000-8000-000000000002', 'pgtap-p2-b', '99990000-0000-4000-8000-000000000001', 'pgTAP panel', 'completed');
INSERT INTO public.lab_results (id, order_id, result_value, result_unit, interpretation,
  reviewed_by, reviewed_at, released_to_patient_at, released_to_patient_by, withheld_at, withheld_by, withheld_reason)
VALUES
  ('9999aaaa-0000-4000-8000-000000000001', '9999b0b0-0000-4000-8000-000000000001', '1.0', 'u', 'normal',
   '99990000-0000-4000-8000-000000000001', now(), now(), '99990000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('9999aaaa-0000-4000-8000-000000000002', '9999b0b0-0000-4000-8000-000000000001', '2.0', 'u', 'normal',
   '99990000-0000-4000-8000-000000000001', now(), NULL, NULL, NULL, NULL, NULL),
  ('9999aaaa-0000-4000-8000-000000000003', '9999b0b0-0000-4000-8000-000000000001', '3.0', 'u', 'abnormal',
   '99990000-0000-4000-8000-000000000001', now(), NULL, NULL, now(), '99990000-0000-4000-8000-000000000001', 'pgTAP withheld'),
  ('9999aaaa-0000-4000-8000-000000000004', '9999b0b0-0000-4000-8000-000000000001', '4.0', 'u', 'normal',
   '99990000-0000-4000-8000-000000000001', now(), now(), '99990000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('9999aaaa-0000-4000-8000-000000000005', '9999b0b0-0000-4000-8000-000000000001', '5.0', 'u', 'normal',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('9999aaaa-0000-4000-8000-000000000006', '9999b0b0-0000-4000-8000-000000000002', '6.0', 'u', 'normal',
   '99990000-0000-4000-8000-000000000001', now(), now(), '99990000-0000-4000-8000-000000000001', NULL, NULL, NULL);
UPDATE public.lab_results SET superseded_by = '9999aaaa-0000-4000-8000-000000000001'
 WHERE id = '9999aaaa-0000-4000-8000-000000000004';
DO $$ BEGIN PERFORM set_config('mbhr.lab_release', '', true); END $$;

-- ---------------------------------------------------------------------------
-- 1. Structure, grants, Phase 1 fixes, indexes
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text)', 'EXECUTE'),
  'v1 fhir_record_access is no longer executable by authenticated');

SELECT ok(
  NOT (SELECT bool_or(has_function_privilege('anon', f, 'EXECUTE')) FROM unnest(ARRAY[
    'public.fhir_gateway_context_v2(integer, integer, boolean)',
    'public.fhir_record_access_v2(uuid, text, text, text, text[], text, text, text, integer, text[], text, text, integer, text, uuid, uuid, text[], text)',
    'public.fhir_resolve_patients(text[], text[])',
    'public.fhir_staff_directory(text[], text[], text, text, text, integer)',
    'public.fhir_link_ids(text, text[])', 'public.fhir_link_sources(text, text[])',
    'public.fhir_consent_directives(text[], uuid[], uuid, integer)',
    'public.fhir_access_audit_events(uuid, text[], text[], timestamptz, timestamptz, text, text, timestamptz, uuid, integer)',
    'public.fhir_interop_admin_status()', 'public.fhir_patient_lab_results(uuid[], uuid[], uuid, integer)',
    'public.interop_record_consent(text, text, text, text, text, text, timestamptz, timestamptz, jsonb)',
    'public.interop_verify_consent(uuid)', 'public.interop_withdraw_consent(uuid, text)',
    'public.interop_my_consents()', 'public.interop_consent_summary(text)']) AS f),
  'anon has EXECUTE on none of the new functions');

SELECT ok(
  NOT (SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'interop'),
  'authenticated can execute no interop.* function');

SELECT ok(
  (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'interop.consent_record_history'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'interop' AND tablename = 'consent_record_history')
  AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                   WHERE table_schema = 'interop' AND table_name = 'consent_record_history'
                     AND grantee IN ('anon', 'authenticated', 'PUBLIC')),
  'consent_record_history: row-level security on, no policies, no API grants');

SELECT ok(
  (SELECT bool_and(p.proconfig @> ARRAY['search_path=pg_catalog, public'])
     FROM pg_proc AS p
    WHERE p.oid IN ('public.fhir_gateway_context(integer)'::regprocedure,
                    'public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text)'::regprocedure,
                    'public.fhir_terminology_lookup(text, text[])'::regprocedure)),
  'the three Phase 1 functions run with search_path = pg_catalog, public');

SELECT ok(
  (SELECT bool_and(EXISTS (
            SELECT 1 FROM pg_index AS i JOIN pg_attribute AS a
                ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
             WHERE i.indrelid = t.rel AND a.attname = t.col AND i.indpred IS NULL))
     FROM (VALUES ('public.dispenses'::regclass, 'prescription_id'),
                  ('public.lab_results'::regclass, 'order_id'),
                  ('public.prescriptions'::regclass, 'patient_id'),
                  ('public.patient_allergies'::regclass, 'patient_id'),
                  ('public.patient_documents'::regclass, 'patient_id')) AS t(rel, col)),
  'dispenses(prescription_id), lab_results(order_id), prescriptions(patient_id), patient_allergies(patient_id) and patient_documents(patient_id) are indexed');

-- Where the migration built an index, it is the only valid, non-partial
-- index leading with that column (no duplicate of an existing one). On the
-- CI stub the first three are built and the last two are skipped (the
-- repository already indexes them); the CI job also applies the migration
-- to a stub without those two indexes and checks that each is built once.
SELECT ok(
  (SELECT bool_and(to_regclass(t.idx) IS NULL OR (
            SELECT count(*) FROM pg_index AS i JOIN pg_attribute AS a
                ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
             WHERE i.indrelid = t.rel AND a.attname = t.col AND i.indpred IS NULL AND i.indisvalid) = 1)
     FROM (VALUES ('public.dispenses'::regclass, 'prescription_id', 'public.interop_dispenses_prescription_id_idx'),
                  ('public.lab_results'::regclass, 'order_id', 'public.interop_lab_results_order_id_idx'),
                  ('public.prescriptions'::regclass, 'patient_id', 'public.interop_prescriptions_patient_id_idx'),
                  ('public.patient_allergies'::regclass, 'patient_id', 'public.interop_patient_allergies_patient_id_idx'),
                  ('public.patient_documents'::regclass, 'patient_id', 'public.interop_patient_documents_patient_id_idx'))
          AS t(rel, col, idx)),
  'an index the migration built is the only one on its column (no duplicate is added)');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'interop.access_audit'::regclass
      AND conname IN ('access_audit_consent_decision', 'access_audit_actor_kind',
                      'access_audit_http_status', 'access_audit_restrictions_bounded')),
  4,
  'access_audit has the four new CHECK constraints (added NOT VALID: no table scan under lock)');
SELECT throws_ok(
  $$INSERT INTO interop.access_audit (request_id, action, decision, http_status) VALUES (gen_random_uuid(), 'read', 'deny', 700)$$,
  '23514', NULL, 'access_audit: a NOT VALID CHECK still refuses a new bad row (http_status)');
SELECT throws_ok(
  $$INSERT INTO interop.access_audit (request_id, action, decision, actor_kind) VALUES (gen_random_uuid(), 'read', 'deny', 'robot')$$,
  '23514', NULL, 'access_audit: a NOT VALID CHECK still refuses a new bad row (actor_kind)');

-- ---------------------------------------------------------------------------
-- 2. anon: no function
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.fhir_gateway_context_v2(60, 20, false)$$, '42501', NULL, 'anon cannot call fhir_gateway_context_v2');
SELECT throws_ok(
  $$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'deny', 'x', 0, '{}', NULL, NULL, 401, NULL, NULL, NULL, '{}', 'none')$$,
  '42501', NULL, 'anon cannot call fhir_record_access_v2');
SELECT throws_ok($$SELECT * FROM public.fhir_resolve_patients(ARRAY['x'], '{}')$$, '42501', NULL, 'anon cannot call fhir_resolve_patients');
SELECT throws_ok($$SELECT * FROM public.fhir_staff_directory()$$, '42501', NULL, 'anon cannot call fhir_staff_directory');
SELECT throws_ok($$SELECT * FROM public.fhir_link_ids('Medication', ARRAY['x'])$$, '42501', NULL, 'anon cannot call fhir_link_ids');
SELECT throws_ok($$SELECT * FROM public.fhir_link_sources('Medication', ARRAY['x'])$$, '42501', NULL, 'anon cannot call fhir_link_sources');
SELECT throws_ok($$SELECT public.fhir_consent_directives(ARRAY['pgtap-p2-a'])$$, '42501', NULL, 'anon cannot call fhir_consent_directives');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'])$$, '42501', NULL, 'anon cannot call fhir_access_audit_events');
SELECT throws_ok($$SELECT public.fhir_interop_admin_status()$$, '42501', NULL, 'anon cannot call fhir_interop_admin_status');
SELECT throws_ok($$SELECT * FROM public.fhir_patient_lab_results()$$, '42501', NULL, 'anon cannot call fhir_patient_lab_results');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-a', 'patient-privacy', 'x', 'portal')$$, '42501', NULL, 'anon cannot call interop_record_consent');
SELECT throws_ok($$SELECT public.interop_verify_consent(gen_random_uuid())$$, '42501', NULL, 'anon cannot call interop_verify_consent');
SELECT throws_ok($$SELECT public.interop_withdraw_consent(gen_random_uuid())$$, '42501', NULL, 'anon cannot call interop_withdraw_consent');
SELECT throws_ok($$SELECT public.interop_my_consents()$$, '42501', NULL, 'anon cannot call interop_my_consents');
SELECT throws_ok($$SELECT public.interop_consent_summary('pgtap-p2-a')$$, '42501', NULL, 'anon cannot call interop_consent_summary');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. A doctor (staff)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000001","role":"authenticated"}';

-- 3a. Gateway context
SELECT ok(
  (SELECT c ->> 'role' = 'doctor' AND c ->> 'actor_kind' = 'staff' AND c -> 'patient_ids' = '[]'::jsonb
          AND (c -> 'permissions') ? 'consult' AND (c ->> 'rate_allowed')::boolean
          AND c -> 'retry_after_seconds' = 'null'::jsonb
     FROM public.fhir_gateway_context_v2(60, 20, false) AS c),
  'fhir_gateway_context_v2: a doctor is staff with their role and permissions and no patient ids');

-- 3b. fhir_record_access_v2
SELECT isnt(
  public.fhir_record_access_v2('99992222-0000-4000-8000-000000000001', 'search', 'Observation', NULL,
    ARRAY['pgtap-p2-a'], 'TREAT', 'permit', NULL, 3, ARRAY['patient', '_count', 'unsupported'], 'pgtap-agent', NULL,
    200, 'not-applicable', NULL, NULL, ARRAY['org_scope_not_applied'], 'staff'),
  NULL,
  'a doctor records a permitted search');
SELECT isnt(
  public.fhir_record_access_v2('99992222-0000-4000-8000-000000000002', 'read', 'Patient', 'abc-1',
    ARRAY['pgtap-p2-b'], 'TREAT', 'permit', NULL, 1, '{}', repeat('u', 300), repeat('a', 64),
    200, NULL, NULL, NULL, '{}', 'patient'),
  NULL,
  'a doctor records a read (claiming to be a patient)');
SELECT isnt(
  public.fhir_record_access_v2('99992222-0000-4000-8000-000000000006', 'read', 'Observation', NULL,
    ARRAY['pgtap-p2-b'], 'TREAT', 'deny', 'no_lab_rows', 0, '{}', NULL, NULL, 403, NULL, NULL, NULL, '{}', 'staff'),
  NULL,
  'a doctor records a refusal naming a patient');
SELECT throws_ok(
  $$SELECT public.fhir_record_access('99992222-0000-4000-8000-0000000000ee', 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL)$$,
  '42501', NULL, 'a signed-in account can no longer call v1 fhir_record_access');

-- validation bounds (22023)
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL,
    (SELECT array_agg('p' || g) FROM generate_series(1, 101) g), 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'more than 100 patient ids are refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL,
    ARRAY['has space'], 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a malformed patient id is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'search', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0,
    (SELECT array_agg('p' || g) FROM generate_series(1, 21) g), NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'more than 20 search parameters are refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'search', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0,
    ARRAY['name=Smith'], NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a search parameter value is refused (names only)');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'search', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL,
    (SELECT array_agg('r' || g) FROM generate_series(1, 13) g), NULL)$$,
  '22023', NULL, 'more than 12 restrictions are refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'search', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL,
    ARRAY['Not A Code'], NULL)$$,
  '22023', NULL, 'a malformed restriction is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'patients', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a table name is not a resource type');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', 'bad/id', '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a malformed resource id is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'delete', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'an interaction other than read or search is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'deny', 'Not A Code', 0, '{}', NULL, NULL, 403, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a free-text denial reason is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', 'no_reason', 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a permit row with a denial reason is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, 'not-a-hash', 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'an ip hash that is not 64 hex characters is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 99, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'an HTTP status below 100 is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 600, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'an HTTP status above 599 is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, 'maybe', NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'an unknown consent decision is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', 'robot')$$,
  '22023', NULL, 'an unknown actor kind is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'treat me please', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a free-text purpose is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(NULL, 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a missing request id is refused');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, -1, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  '22023', NULL, 'a negative result count is refused');

-- 3c. fhir_resolve_patients (staff see every record)
SELECT ok(
  (SELECT r.id = 'pgtap-p2-a' AND NOT r.merged AND r.canonical_id = 'pgtap-p2-a'
          AND r.canonical_fhir_id = current_setting('pgtap_p2.a_fhir') AND r.chain_ok
          AND r.member_ids = ARRAY['pgtap-p2-a', 'pgtap-p2-m1', 'pgtap-p2-m2']
          AND r.input = current_setting('pgtap_p2.a_fhir')
     FROM public.fhir_resolve_patients(ARRAY[current_setting('pgtap_p2.a_fhir')], '{}') AS r),
  'resolve: the kept record by fhir_id is its own canonical, with its merged members');
SELECT ok(
  (SELECT r.merged AND r.canonical_id = 'pgtap-p2-a' AND r.chain_ok AND r.input = 'pgtap-p2-m1'
     FROM public.fhir_resolve_patients('{}', ARRAY['pgtap-p2-m1']) AS r),
  'resolve: a merged-away record points at the kept record');
SELECT ok(
  (SELECT r.merged AND r.canonical_id = 'pgtap-p2-a' AND r.canonical_fhir_id = current_setting('pgtap_p2.a_fhir')
          AND r.chain_ok AND 'pgtap-p2-m2' = ANY (r.member_ids)
     FROM public.fhir_resolve_patients('{}', ARRAY['pgtap-p2-m2']) AS r),
  'resolve: a 2-hop chain ends at the kept record');
SELECT ok(
  (SELECT r.chain_ok AND r.canonical_id = 'pgtap-p2-d10'
     FROM public.fhir_resolve_patients('{}', ARRAY['pgtap-p2-d0']) AS r),
  'resolve: a chain of exactly 10 hops resolves');
SELECT ok(
  (SELECT NOT r.chain_ok AND r.canonical_id IS NULL AND r.canonical_fhir_id IS NULL AND r.member_ids = '{}'
     FROM public.fhir_resolve_patients('{}', ARRAY['pgtap-p2-l1']) AS r),
  'resolve: a loop longer than 10 hops gives chain_ok false and no canonical record');
SELECT ok(
  (SELECT r.merged AND NOT r.chain_ok AND r.canonical_id = 'pgtap-p2-o'
     FROM public.fhir_resolve_patients('{}', ARRAY['pgtap-p2-o']) AS r),
  'resolve: an orphaned tombstone gives chain_ok false and resolves to itself');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_resolve_patients(ARRAY['not-a-uuid', '99990000-0000-4000-8000-00000000dead'], ARRAY['pgtap-p2-nope'])),
  0,
  'resolve: unknown inputs (including a non-uuid fhir_id) return no row and no error');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_resolve_patients(ARRAY[current_setting('pgtap_p2.a_fhir')], ARRAY['pgtap-p2-a', 'pgtap-p2-b'])),
  3,
  'resolve: one row per input');
SELECT throws_ok(
  $$SELECT * FROM public.fhir_resolve_patients((SELECT array_agg('x' || g) FROM generate_series(1, 150) g),
                                               (SELECT array_agg('y' || g) FROM generate_series(1, 51) g))$$,
  '22023', NULL, 'resolve: more than 200 inputs are refused');

-- 3d. fhir_staff_directory
SELECT is(
  (SELECT count(*)::int FROM public.fhir_staff_directory(p_name => 'pgtapq', p_limit => 101)),
  8,
  'directory: a name search returns the 8 staff rows (the guest row is excluded)');
SELECT ok(
  (SELECT bool_and(d.source_id IS NULL) AND bool_and(d.fhir_id NOT LIKE '99990000-%')
          AND bool_and(d.fhir_id ~ '^[0-9a-f-]{36}$')
     FROM public.fhir_staff_directory(p_name => 'pgtapq', p_limit => 101) AS d),
  'directory: no account id is returned outside p_source_ids mode');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_staff_directory(p_role => 'guest')),
  0,
  'directory: guest is not a staff role');
SELECT is(
  (SELECT d.fhir_id FROM public.fhir_staff_directory(p_source_ids => ARRAY['99990000-0000-4000-8000-000000000001']) AS d),
  (SELECT d.fhir_id FROM public.fhir_staff_directory(p_name => 'adaeze') AS d),
  'directory: the minted id is stable across calls and modes');
SELECT is(
  (SELECT d.source_id FROM public.fhir_staff_directory(p_source_ids => ARRAY['99990000-0000-4000-8000-000000000001']) AS d),
  '99990000-0000-4000-8000-000000000001',
  'directory: source_id is returned in p_source_ids mode');
SELECT ok(
  (SELECT d.full_name = 'Dr. Adaeze Pgtapqone' AND d.role = 'doctor' AND d.source_id IS NULL
     FROM public.fhir_staff_directory(p_fhir_ids => ARRAY[
       (SELECT x.fhir_id FROM public.fhir_staff_directory(p_name => 'adaeze') AS x)]) AS d),
  'directory: a lookup by fhir_id returns the name and role, without the account id');
SELECT is(
  (SELECT d.active FROM public.fhir_staff_directory(p_name => 'ebere') AS d), false,
  'directory: a deactivated account is active = false');
SELECT is(
  (SELECT d.active FROM public.fhir_staff_directory(p_name => 'femi') AS d), true,
  'directory: an explicitly active account is active = true');
SELECT is(
  (SELECT d.active FROM public.fhir_staff_directory(p_name => 'adaeze') AS d), NULL::boolean,
  'directory: with no flag the account is active = NULL (unknown)');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_staff_directory(p_name => 'pgtapqt')),
  2,
  'directory: a name matches the prefix of any word');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_staff_directory(p_name => 'ad%')),
  0,
  'directory: % in a name search is literal');
SELECT is(
  (SELECT string_agg(d.full_name, ',') FROM public.fhir_staff_directory(p_name => 'gbenga_') AS d),
  'Gbenga_x Pgtapqsix',
  'directory: _ in a name search is literal');
SELECT throws_ok($$SELECT * FROM public.fhir_staff_directory(p_name => 'a')$$, '22023', NULL,
  'directory: a one-character name is refused');
SELECT throws_ok($$SELECT * FROM public.fhir_staff_directory(p_name => 'adaeze', p_role => 'doctor')$$, '22023', NULL,
  'directory: two selectors are refused');
SELECT ok(
  (WITH p1 AS (SELECT d.fhir_id FROM public.fhir_staff_directory(p_name => 'pgtapq', p_limit => 3) AS d),
        p2 AS (SELECT d.fhir_id FROM public.fhir_staff_directory(p_name => 'pgtapq', p_limit => 101,
                 p_after => (SELECT max(fhir_id COLLATE "C") FROM p1)) AS d)
   SELECT (SELECT count(*) FROM p1) = 3 AND (SELECT count(*) FROM p2) = 5
          AND NOT EXISTS (SELECT 1 FROM p1 JOIN p2 USING (fhir_id))),
  'directory: keyset paging by fhir_id neither repeats nor skips');

-- 3e. fhir_link_ids / fhir_link_sources
SELECT is(
  (SELECT count(*)::int FROM public.fhir_link_ids('Medication', ARRAY['pgtap-p2-item-1', 'pgtap-p2-missing'])),
  1,
  'links: an id is minted for an existing medicine only');
SELECT is(
  (SELECT l.fhir_id FROM public.fhir_link_ids('Medication', ARRAY['pgtap-p2-item-1']) AS l),
  (SELECT l.fhir_id FROM public.fhir_link_ids('Medication', ARRAY['pgtap-p2-item-1']) AS l),
  'links: the minted id is stable');
SELECT is(
  (SELECT s.source_id FROM public.fhir_link_sources('Medication',
     ARRAY[(SELECT l.fhir_id FROM public.fhir_link_ids('Medication', ARRAY['pgtap-p2-item-1']) AS l)]) AS s),
  'pgtap-p2-item-1',
  'links: the published id resolves back to the medicine');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_link_sources('Medication', ARRAY['99990000-0000-4000-8000-00000000beef'])),
  0,
  'links: an unknown published id resolves to nothing');
SELECT throws_ok($$SELECT * FROM public.fhir_link_ids('Patient', ARRAY['pgtap-p2-a'])$$, '22023', NULL,
  'links: a resource type outside the allowlist is refused');
SELECT throws_ok($$SELECT * FROM public.fhir_link_sources('Practitioner', ARRAY['x'])$$, '22023', NULL,
  'links: fhir_link_sources has the same allowlist');
SELECT throws_ok($$SELECT * FROM public.fhir_link_ids('Medication', (SELECT array_agg('i' || g) FROM generate_series(1, 201) g))$$,
  '22023', NULL, 'links: more than 200 ids are refused');

-- 3f. Consent management
SELECT isnt(
  public.interop_record_consent('pgtap-p2-a', 'patient-privacy', 'pgtap-share', 'paper_form', 'active',
    'https://mbhr.app/policy/pgtap', NULL, NULL,
    '[{"provision_type":"permit","actor_type":"external_system","action":"disclose","purpose":"HRESCH"}]'::jsonb),
  NULL,
  'a doctor records a consent for patient A');
SELECT isnt(
  public.interop_record_consent('pgtap-p2-b', 'patient-privacy', 'pgtap-share', 'paper_form'),
  NULL,
  'a doctor records a consent for patient B');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-nope', 'patient-privacy', 'x', 'portal')$$, '22023', NULL,
  'consent: an unknown patient is refused');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-m1', 'patient-privacy', 'x', 'portal')$$, '22023', NULL,
  'consent: a merged-away record is refused');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-a', 'patient-privacy', 'x', 'portal', 'inactive')$$, '22023', NULL,
  'consent: a new record cannot start inactive');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-a', 'patient-privacy', 'x', 'portal', 'active', NULL, NULL, NULL,
    '[{"provision_type":"permit","actor_reference":"Organization/1"}]'::jsonb)$$, '22023', NULL,
  'consent: a provision key outside the list is refused');
RESET ROLE;

DO $$ BEGIN PERFORM set_config('pgtap_p2.c_a', (SELECT id::text FROM interop.consent_records WHERE patient_id = 'pgtap-p2-a' AND category = 'pgtap-share'), true); END $$;
DO $$ BEGIN PERFORM set_config('pgtap_p2.c_b', (SELECT id::text FROM interop.consent_records WHERE patient_id = 'pgtap-p2-b' AND category = 'pgtap-share'), true); END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is(public.interop_verify_consent(current_setting('pgtap_p2.c_a')::uuid), true, 'a doctor verifies consent A');
SELECT is(public.interop_verify_consent(current_setting('pgtap_p2.c_a')::uuid), false, 'verifying again changes nothing');
SELECT throws_ok($$SELECT public.interop_verify_consent('99990000-0000-4000-8000-00000000dead')$$, '22023', NULL,
  'verifying an unknown consent is refused');

SELECT ok(
  (SELECT jsonb_array_length(d) = 1 AND d -> 0 ->> 'id' = current_setting('pgtap_p2.c_a')
          AND (d -> 0 ->> 'verified')::boolean AND jsonb_array_length(d -> 0 -> 'provisions') = 1
          AND d -> 0 -> 'provisions' -> 0 ->> 'actor_type' = 'external_system'
     FROM public.fhir_consent_directives(ARRAY['pgtap-p2-a']) AS d),
  'directives: staff read a patient''s consent with its provisions');
SELECT ok(
  (SELECT NOT (d -> 0 ?| ARRAY['recorded_by', 'verified_by', 'withdrawn_by', 'withdrawal_reason',
                               'granted_by', 'granted_by_relationship', 'source_document_id'])
          AND NOT (d -> 0 -> 'provisions' -> 0 ? 'actor_reference')
          AND position('99990000-0000-4000-8000-000000000001' IN d::text) = 0
     FROM public.fhir_consent_directives(ARRAY['pgtap-p2-a']) AS d),
  'directives: no account ids or internal fields in the JSON');
SELECT is(
  (SELECT jsonb_array_length(public.fhir_consent_directives(NULL,
     ARRAY[current_setting('pgtap_p2.c_a')::uuid, current_setting('pgtap_p2.c_b')::uuid]))),
  2,
  'directives: staff read by consent id');
SELECT throws_ok($$SELECT public.fhir_consent_directives()$$, '22023', NULL, 'directives: a selector is required');
SELECT is(
  public.interop_consent_summary('pgtap-p2-a') ->> 'external_sharing', 'allowed',
  'summary: an active permit for an external system is external sharing allowed');
SELECT is(
  public.interop_consent_summary('pgtap-p2-b') ->> 'external_sharing', 'not_allowed',
  'summary: a consent with no external permit is not_allowed');

-- The summary follows the gateway's consent evaluator (external sharing).
DO $$
DECLARE v uuid;
BEGIN
  -- C1: verified permit, actor any.
  v := public.interop_record_consent('pgtap-p2-c1', 'patient-privacy', 'pgtap-sum', 'paper_form', 'active', NULL, NULL, NULL,
         '[{"provision_type":"permit","actor_type":"any"}]');
  PERFORM public.interop_verify_consent(v);
  -- C2: verified permit, no actor, purpose TREAT (an external TREAT request is external sharing).
  v := public.interop_record_consent('pgtap-p2-c2', 'patient-privacy', 'pgtap-sum', 'paper_form', 'active', NULL, NULL, NULL,
         '[{"provision_type":"permit","purpose":"TREAT"}]');
  PERFORM public.interop_verify_consent(v);
  -- C3: verified external permit, but in the research scope.
  v := public.interop_record_consent('pgtap-p2-c3', 'research', 'pgtap-sum', 'paper_form', 'active', NULL, NULL, NULL,
         '[{"provision_type":"permit","actor_type":"external_system"}]');
  PERFORM public.interop_verify_consent(v);
  -- C4: verified external permit, and an unverified refusal on another record.
  v := public.interop_record_consent('pgtap-p2-c4', 'patient-privacy', 'pgtap-sum', 'paper_form', 'active', NULL, NULL, NULL,
         '[{"provision_type":"permit","actor_type":"external_system"}]');
  PERFORM public.interop_verify_consent(v);
  PERFORM public.interop_record_consent('pgtap-p2-c4', 'patient-privacy', 'pgtap-sum', 'portal', 'active', NULL, NULL, NULL,
         '[{"provision_type":"deny","actor_type":"organization","resource_type":"Observation"}]');
  -- C5: an external permit not verified yet.
  PERFORM public.interop_record_consent('pgtap-p2-c5', 'patient-privacy', 'pgtap-sum', 'paper_form', 'active', NULL, NULL, NULL,
         '[{"provision_type":"permit","actor_type":"external_system"}]');
  -- C6: verified external permit limited to labelled data (mBHR labels none).
  v := public.interop_record_consent('pgtap-p2-c6', 'patient-privacy', 'pgtap-sum', 'paper_form', 'active', NULL, NULL, NULL,
         '[{"provision_type":"permit","actor_type":"external_system","security_label":"R"}]');
  PERFORM public.interop_verify_consent(v);
  -- BX (merged into B in section 6c): a verified external permit.
  v := public.interop_record_consent('pgtap-p2-bx', 'patient-privacy', 'pgtap-merge', 'paper_form', 'active', NULL, NULL, NULL,
         '[{"provision_type":"permit","actor_type":"external_system"}]');
  PERFORM public.interop_verify_consent(v);
END $$;
SELECT is(public.interop_consent_summary('pgtap-p2-c1') ->> 'external_sharing', 'allowed',
  'summary: a verified patient-privacy permit for actor "any" is allowed (as the evaluator)');
SELECT is(public.interop_consent_summary('pgtap-p2-c2') ->> 'external_sharing', 'allowed',
  'summary: a verified permit with no actor (any purpose) is allowed (as the evaluator)');
SELECT is(public.interop_consent_summary('pgtap-p2-c3') ->> 'external_sharing', 'not_allowed',
  'summary: a permit in the research scope does not allow external sharing');
SELECT is(public.interop_consent_summary('pgtap-p2-c4') ->> 'external_sharing', 'not_allowed',
  'summary: a matching refusal (even unverified, even narrow) wins over a permit');
SELECT ok(
  (SELECT s ->> 'external_sharing' = 'not_allowed' AND (s ->> 'pending_verification')::boolean
     FROM public.interop_consent_summary('pgtap-p2-c5') AS s),
  'summary: an unverified permit is not_allowed, with pending_verification');
SELECT ok(
  (SELECT s ->> 'external_sharing' = 'not_allowed' AND NOT (s ->> 'pending_verification')::boolean
     FROM public.interop_consent_summary('pgtap-p2-c6') AS s),
  'summary: a permit limited to a security label covers nothing (as the evaluator)');

SELECT ok(
  (WITH ids AS (SELECT ARRAY['pgtap-p2-c1', 'pgtap-p2-c2', 'pgtap-p2-c3', 'pgtap-p2-c4', 'pgtap-p2-c5', 'pgtap-p2-c6'] AS a),
        allr AS (SELECT e ->> 'id' AS id FROM ids, jsonb_array_elements(public.fhir_consent_directives(ids.a, NULL, NULL, 101)) AS e),
        p1 AS (SELECT e ->> 'id' AS id FROM ids, jsonb_array_elements(public.fhir_consent_directives(ids.a, NULL, NULL, 3)) AS e),
        p2 AS (SELECT e ->> 'id' AS id FROM ids, jsonb_array_elements(public.fhir_consent_directives(ids.a, NULL,
                 (SELECT id FROM p1 ORDER BY id DESC LIMIT 1)::uuid, 101)) AS e)
   SELECT (SELECT count(*) FROM allr) = 7 AND (SELECT count(*) FROM p1) = 3 AND (SELECT count(*) FROM p2) = 4
          AND (SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM p1 UNION ALL SELECT id FROM p2) AS u)
            = (SELECT array_agg(id ORDER BY id) FROM allr)),
  'directives: p_limit and the p_after keyset page by id with no repeat and no gap');
SELECT is(jsonb_array_length(public.fhir_consent_directives(ARRAY['pgtap-p2-c4'], NULL, NULL, 0)), 1,
  'directives: p_limit is clamped to at least 1');

-- 3g. Functions a doctor may not use
SELECT throws_ok($$SELECT * FROM public.fhir_patient_lab_results()$$, '42501', NULL,
  'lab results RPC: staff are refused');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'])$$, '42501', NULL,
  'audit events: a doctor (no audit_access) is refused');
SELECT throws_ok($$SELECT public.fhir_interop_admin_status()$$, '42501', NULL,
  'admin status: a doctor (neither audit_access nor users) is refused');
SELECT throws_ok($$SELECT public.interop_my_consents()$$, '42501', NULL,
  'my consents: a staff account that is not a patient is refused');
RESET ROLE;

SELECT ok(
  (SELECT actor_user_id = '99990000-0000-4000-8000-000000000001'::uuid AND actor_role = 'doctor'
          AND actor_kind = 'staff' AND http_status = 200 AND consent_decision = 'not-applicable'
          AND restrictions = ARRAY['org_scope_not_applied'] AND patient_id = 'pgtap-p2-a'
          AND result_count = 3 AND metadata = '{"search_params": ["patient", "_count", "unsupported"]}'::jsonb
     FROM interop.access_audit WHERE request_id = '99992222-0000-4000-8000-000000000001'),
  'record_access_v2: the row names the caller from the session with every new column');
SELECT ok(
  (SELECT actor_kind = 'staff' AND (metadata ->> 'actor_kind_mismatch')::boolean
          AND length(user_agent) = 200 AND resource_id = 'abc-1'
     FROM interop.access_audit WHERE request_id = '99992222-0000-4000-8000-000000000002'),
  'record_access_v2: the server actor kind wins over the argument (mismatch flagged); user agent cut to 200');

-- ---------------------------------------------------------------------------
-- 4. A pharmacist: rate buckets; consent functions refused
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT is((public.fhir_gateway_context_v2(2, 1, true) ->> 'rate_allowed')::boolean, true,
  'rate: first sensitive call fits both buckets');
SELECT ok(
  (SELECT (c ->> 'rate_allowed')::boolean = false AND (c ->> 'retry_after_seconds')::int >= 1
     FROM public.fhir_gateway_context_v2(2, 1, true) AS c),
  'rate: the second sensitive call is refused by the sensitive bucket, with a retry time');
SELECT is((public.fhir_gateway_context_v2(2, 1, false) ->> 'rate_allowed')::boolean, false,
  'rate: the general bucket (limit 2) refuses the third call');
SELECT is((public.fhir_gateway_context_v2(2, 5, true) ->> 'rate_allowed')::boolean, false,
  'rate: a sensitive call the general bucket refuses is refused');
SELECT throws_ok($$SELECT public.fhir_consent_directives(ARRAY['pgtap-p2-b'])$$, '42501', NULL,
  'directives: staff without consult, portal_manage or audit_access are refused');
SELECT throws_ok($$SELECT public.interop_consent_summary('pgtap-p2-b')$$, '42501', NULL,
  'summary: staff without consult, portal_manage or audit_access are refused');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-a', 'patient-privacy', 'x', 'portal')$$, '42501', NULL,
  'consent: a pharmacist cannot record a consent');
SELECT throws_ok($$SELECT public.interop_verify_consent(current_setting('pgtap_p2.c_b')::uuid)$$, '42501', NULL,
  'consent: a pharmacist cannot verify a consent');
SELECT throws_ok($$SELECT public.interop_withdraw_consent(current_setting('pgtap_p2.c_b')::uuid)$$, '42501', NULL,
  'consent: a pharmacist cannot withdraw a consent');
SELECT ok(
  (SELECT count(*) = 1 FROM public.fhir_staff_directory(p_name => 'chidi')),
  'directory: any staff role may read it');
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE bucket = 'fhir_gateway_sensitive' AND key = '99990000-0000-4000-8000-000000000003'),
  2,
  'rate: a call the general bucket refused did not use up the sensitive allowance');

-- A nurse: a non-sensitive call does not touch the sensitive bucket.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT bool_and((public.fhir_gateway_context_v2(5, 1, false) ->> 'rate_allowed')::boolean) FROM generate_series(1, 3)),
  true,
  'rate: three ordinary calls fit a general limit of 5');
SELECT is((public.fhir_gateway_context_v2(5, 1, true) ->> 'rate_allowed')::boolean, true,
  'rate: the sensitive bucket was not consumed by ordinary calls');
SELECT is(jsonb_array_length(public.fhir_consent_directives(ARRAY['pgtap-p2-b'])), 1,
  'directives: a nurse (portal_manage) may read them');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. A signed-in account that is neither staff nor a portal patient
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000ff","role":"authenticated"}';
SELECT ok(
  (SELECT c ->> 'actor_kind' = 'none' AND c ->> 'role' IS NULL AND c -> 'permissions' = '[]'::jsonb
          AND c -> 'patient_ids' = '[]'::jsonb
     FROM public.fhir_gateway_context_v2() AS c),
  'context: an unknown account is actor_kind none with no role, permissions or patients');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, ARRAY['pgtap-p2-a'], 'TREAT', 'permit', NULL, 1, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', 'staff')$$,
  '42501', NULL, 'record_access_v2: a non-staff, non-patient account cannot record a permit');
SELECT isnt(
  public.fhir_record_access_v2('99992222-0000-4000-8000-000000000003', 'read', 'Patient', NULL, '{}', 'TREAT',
    'deny', 'no_staff_role', 0, '{}', NULL, NULL, 403, NULL, NULL, NULL, '{}', 'none'),
  NULL,
  'record_access_v2: it can record a refusal naming no patient');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, ARRAY['pgtap-p2-a'], 'TREAT', 'deny', 'no_staff_role', 0, '{}', NULL, NULL, 403, NULL, NULL, NULL, '{}', 'none')$$,
  '42501', NULL, 'record_access_v2: it cannot record a refusal naming a patient');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_resolve_patients(ARRAY[current_setting('pgtap_p2.a_fhir')], ARRAY['pgtap-p2-a', 'pgtap-p2-m1'])),
  0,
  'resolve: an account with no access sees no patient');
SELECT throws_ok($$SELECT * FROM public.fhir_staff_directory()$$, '42501', NULL, 'directory: non-staff are refused');
SELECT throws_ok($$SELECT * FROM public.fhir_link_ids('Medication', ARRAY['pgtap-p2-item-1'])$$, '42501', NULL, 'links: non-staff are refused (fhir_link_ids)');
SELECT throws_ok($$SELECT * FROM public.fhir_link_sources('Medication', ARRAY['x'])$$, '42501', NULL, 'links: non-staff are refused (fhir_link_sources)');
SELECT throws_ok($$SELECT public.fhir_consent_directives(ARRAY['pgtap-p2-a'])$$, '42501', NULL, 'directives: non-staff non-patients are refused');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-a', 'patient-privacy', 'x', 'portal')$$, '42501', NULL, 'consent: non-staff cannot record');
SELECT throws_ok($$SELECT public.interop_verify_consent(current_setting('pgtap_p2.c_b')::uuid)$$, '42501', NULL, 'consent: non-staff cannot verify');
SELECT throws_ok($$SELECT public.interop_withdraw_consent(current_setting('pgtap_p2.c_b')::uuid)$$, '42501', NULL, 'consent: a stranger cannot withdraw');
SELECT throws_ok($$SELECT public.interop_my_consents()$$, '42501', NULL, 'my consents: refused for an account with no patient');
SELECT throws_ok($$SELECT public.interop_consent_summary('pgtap-p2-a')$$, '42501', NULL, 'summary: refused for a stranger');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'])$$, '42501', NULL, 'audit events: refused');
SELECT throws_ok($$SELECT public.fhir_interop_admin_status()$$, '42501', NULL, 'admin status: refused');
SELECT throws_ok($$SELECT * FROM public.fhir_patient_lab_results()$$, '42501', NULL, 'lab results RPC: refused for an account with no patient');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. Portal patient A
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000a1","role":"authenticated"}';
SELECT ok(
  (SELECT c ->> 'actor_kind' = 'patient' AND c -> 'patient_ids' = '["pgtap-p2-a"]'::jsonb
          AND c ->> 'role' IS NULL AND c -> 'permissions' = '[]'::jsonb
     FROM public.fhir_gateway_context_v2() AS c),
  'context: a portal patient is actor_kind patient with their own record only');
SELECT isnt(
  public.fhir_record_access_v2('99992222-0000-4000-8000-000000000004', 'read', 'Patient', NULL,
    ARRAY['pgtap-p2-a'], 'PATRQT', 'permit', NULL, 1, '{}', NULL, NULL, 200, 'not-applicable', NULL, NULL, '{}', 'patient'),
  NULL,
  'record_access_v2: a patient records a permitted read of their own record');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, ARRAY['pgtap-p2-a', 'pgtap-p2-b'], 'PATRQT', 'permit', NULL, 2, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', 'patient')$$,
  '42501', NULL, 'record_access_v2: a patient cannot record a permit that names another patient');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'search', 'Patient', NULL, '{}', 'PATRQT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', 'patient')$$,
  '42501', NULL, 'record_access_v2: a patient permit must name their record');
SELECT throws_ok($$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Observation', NULL,
    ARRAY['pgtap-p2-b'], 'PATRQT', 'deny', 'not_own_record', 0, '{}', NULL, NULL, 404, NULL, NULL, NULL, '{}', 'patient')$$,
  '42501', NULL, 'record_access_v2: a patient cannot record a refusal naming another patient');
SELECT isnt(
  public.fhir_record_access_v2('99992222-0000-4000-8000-000000000005', 'read', 'Observation', NULL,
    ARRAY['pgtap-p2-a'], 'PATRQT', 'deny', 'no_lab_rows', 0, '{}', NULL, NULL, 403, NULL, NULL, NULL, '{}', 'patient'),
  NULL,
  'record_access_v2: a patient records a refusal naming their own record');

SELECT ok(
  (SELECT r.chain_ok AND r.canonical_id = 'pgtap-p2-a' AND r.member_ids = ARRAY['pgtap-p2-a']
     FROM public.fhir_resolve_patients(ARRAY[current_setting('pgtap_p2.a_fhir')], '{}') AS r),
  'resolve: a patient resolves their own record; merged records they cannot see are not members');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_resolve_patients(ARRAY[current_setting('pgtap_p2.b_fhir')], ARRAY['pgtap-p2-m1', 'pgtap-p2-b'])),
  0,
  'resolve: another patient''s record and a merged-away record are invisible (no row)');

SELECT throws_ok($$SELECT * FROM public.fhir_staff_directory(p_name => 'adaeze')$$, '42501', NULL, 'directory: patients are refused');
SELECT throws_ok($$SELECT * FROM public.fhir_link_ids('Medication', ARRAY['pgtap-p2-item-1'])$$, '42501', NULL, 'links: patients are refused');

SELECT ok(
  (SELECT jsonb_array_length(d) = 1 AND d -> 0 ->> 'id' = current_setting('pgtap_p2.c_a')
          AND NOT (d -> 0 ?| ARRAY['recorded_by', 'verified_by', 'withdrawn_by', 'withdrawal_reason'])
     FROM public.fhir_consent_directives(ARRAY['pgtap-p2-a']) AS d),
  'directives: a patient reads their own consent, without account ids');
SELECT throws_ok($$SELECT public.fhir_consent_directives(ARRAY['pgtap-p2-b'])$$, '42501', NULL,
  'directives: a patient cannot read another patient''s consents');
SELECT is(
  public.fhir_consent_directives(NULL, ARRAY[current_setting('pgtap_p2.c_b')::uuid]),
  '[]'::jsonb,
  'directives: another patient''s consent id returns nothing');
SELECT is(public.interop_consent_summary('pgtap-p2-a') ->> 'external_sharing', 'allowed', 'summary: a patient reads their own');
SELECT throws_ok($$SELECT public.interop_consent_summary('pgtap-p2-b')$$, '42501', NULL, 'summary: not another patient''s');
SELECT throws_ok($$SELECT public.interop_withdraw_consent(current_setting('pgtap_p2.c_b')::uuid)$$, '42501', NULL,
  'withdraw: a patient cannot withdraw another patient''s consent');
SELECT throws_ok($$SELECT public.interop_withdraw_consent(current_setting('pgtap_p2.c_a')::uuid, repeat('r', 501))$$, '22023', NULL,
  'withdraw: a reason over 500 characters is refused');
SELECT is(public.interop_withdraw_consent(current_setting('pgtap_p2.c_a')::uuid, 'pgTAP private reason'), true,
  'withdraw: a patient withdraws their own consent');
SELECT is(public.interop_withdraw_consent(current_setting('pgtap_p2.c_a')::uuid), false,
  'withdraw: a repeat withdrawal changes nothing');
SELECT ok(
  (SELECT jsonb_array_length(m) = 1 AND (m -> 0 ->> 'withdrawn')::boolean AND m -> 0 ->> 'status' = 'inactive'
          AND position('pgTAP private reason' IN m::text) = 0
     FROM public.interop_my_consents() AS m),
  'my consents: the patient sees the withdrawal, not the reason');
SELECT is(public.interop_consent_summary('pgtap-p2-a') ->> 'external_sharing', 'withdrawn',
  'summary: after the withdrawal external sharing is withdrawn');
SELECT throws_ok($$SELECT public.interop_record_consent('pgtap-p2-a', 'patient-privacy', 'x', 'portal')$$, '42501', NULL,
  'consent: a patient cannot record a consent through the staff function');

-- 6b. Lab results
SELECT is(
  (SELECT string_agg(r.id::text, ',' ORDER BY r.id) FROM public.fhir_patient_lab_results() AS r),
  '9999aaaa-0000-4000-8000-000000000001',
  'lab results RPC: only the reviewed, released, not withheld, not superseded result of the patient');
SELECT ok(
  (SELECT r.patient_id = 'pgtap-p2-a' AND r.order_id = '9999b0b0-0000-4000-8000-000000000001'
          AND r.test_name = 'pgTAP panel' AND r.order_status = 'completed'
          AND r.reviewed_at IS NOT NULL AND r.released_to_patient_at IS NOT NULL
     FROM public.fhir_patient_lab_results(ARRAY['9999aaaa-0000-4000-8000-000000000001'::uuid]) AS r),
  'lab results RPC: the row carries its order');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_patient_lab_results(ARRAY['9999aaaa-0000-4000-8000-000000000006'::uuid])),
  0,
  'lab results RPC: another patient''s released result is not returned');
SELECT throws_ok($$SELECT * FROM public.fhir_patient_lab_results((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 101)))$$,
  '22023', NULL, 'lab results RPC: more than 100 ids are refused');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'])$$, '42501', NULL,
  'audit events: patients are refused');
RESET ROLE;

-- Portal patient B
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(
  (SELECT string_agg(r.id::text, ',') FROM public.fhir_patient_lab_results() AS r),
  '9999aaaa-0000-4000-8000-000000000006',
  'lab results RPC: patient B sees only their own released result');
SELECT throws_ok($$SELECT public.interop_withdraw_consent(current_setting('pgtap_p2.c_a')::uuid)$$, '42501', NULL,
  'withdraw: patient B cannot touch patient A''s consent');
SELECT is(jsonb_array_length(public.interop_my_consents()), 1,
  'my consents: before the merge, B sees only B''s record');
RESET ROLE;

-- 6c. A consent recorded on a record that is then merged away stays the
-- patient's: BX (verified external permit) is merged into B.
DO $$ BEGIN PERFORM set_config('pgtap_p2.c_bx', (SELECT id::text FROM interop.consent_records WHERE patient_id = 'pgtap-p2-bx'), true); END $$;
UPDATE public.patients SET merged_into = 'pgtap-p2-b', merged_at = now() WHERE id = 'pgtap-p2-bx';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is(public.interop_consent_summary('pgtap-p2-b') ->> 'external_sharing', 'allowed',
  'merge: the kept record''s summary counts the consent of the merged-away record (staff)');
SELECT is(public.interop_consent_summary('pgtap-p2-bx') ->> 'external_sharing', 'allowed',
  'merge: the merged-away record has the same summary as its family');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT ok(
  (SELECT jsonb_array_length(m) = 2
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(m) AS e WHERE e ->> 'id' = current_setting('pgtap_p2.c_bx'))
     FROM public.interop_my_consents() AS m),
  'merge: the patient sees the consent recorded on their merged-away record');
SELECT is(public.interop_consent_summary('pgtap-p2-b') ->> 'external_sharing', 'allowed',
  'merge: the patient''s summary counts it');
SELECT is(
  (SELECT e ->> 'id' FROM jsonb_array_elements(public.fhir_consent_directives(ARRAY['pgtap-p2-bx'])) AS e),
  current_setting('pgtap_p2.c_bx'),
  'merge: the patient may read directives of their merged-away record');
SELECT is(jsonb_array_length(public.fhir_consent_directives(NULL, ARRAY[current_setting('pgtap_p2.c_bx')::uuid])), 1,
  'merge: and by consent id');
SELECT is(public.interop_withdraw_consent(current_setting('pgtap_p2.c_bx')::uuid), true,
  'merge: the patient can withdraw it');
SELECT is(public.interop_consent_summary('pgtap-p2-b') ->> 'external_sharing', 'withdrawn',
  'merge: after that, external sharing is withdrawn');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000a1","role":"authenticated"}';
SELECT throws_ok($$SELECT public.fhir_consent_directives(ARRAY['pgtap-p2-bx'])$$, '42501', NULL,
  'merge: another patient still cannot read the merged-away record''s directives');
SELECT throws_ok($$SELECT public.interop_consent_summary('pgtap-p2-bx')$$, '42501', NULL,
  'merge: nor its summary');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. Consent history, audit rows and guards (as the owner)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(event || ':' || changed_by_kind, ',' ORDER BY changed_at)
     FROM interop.consent_record_history WHERE consent_id = current_setting('pgtap_p2.c_a')::uuid),
  'created:staff,verified:staff,withdrawn:patient',
  'history: created, verified and withdrawn, each with who kind');
SELECT ok(
  (SELECT bool_and(changed_by IS NOT NULL) AND bool_or(status_before = 'active' AND status_after = 'inactive')
     FROM interop.consent_record_history WHERE consent_id = current_setting('pgtap_p2.c_a')::uuid),
  'history: statuses before and after are kept');
SELECT is(
  (SELECT string_agg(metadata::text, ',' ORDER BY occurred_at, metadata::text)
     FROM interop.access_audit
    WHERE action = 'consent_change' AND resource_id = current_setting('pgtap_p2.c_a')),
  '{"event": "created"},{"event": "verified"},{"event": "withdrawn"}',
  'audit: one consent_change row per change, carrying the event name only');
SELECT ok(
  (SELECT bool_and(decision = 'permit' AND patient_id = 'pgtap-p2-a' AND resource_type = 'Consent'
                   AND position('pgTAP private reason' IN (to_jsonb(a))::text) = 0)
     FROM interop.access_audit AS a
    WHERE a.action = 'consent_change' AND a.resource_id = current_setting('pgtap_p2.c_a')),
  'audit: consent rows hold no payload (no reason text)');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET status = 'active', withdrawn_at = NULL, withdrawn_by = NULL, withdrawal_reason = NULL
     WHERE id = current_setting('pgtap_p2.c_a')::uuid$$,
  '42501', NULL, 'guard: a withdrawn consent cannot be re-activated');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET withdrawal_reason = 'rewritten' WHERE id = current_setting('pgtap_p2.c_a')::uuid$$,
  '42501', NULL, 'guard: a withdrawal cannot be rewritten');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET patient_id = 'pgtap-p2-a' WHERE id = current_setting('pgtap_p2.c_b')::uuid$$,
  '42501', NULL, 'guard: a consent cannot move to another patient');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET scope = 'research' WHERE id = current_setting('pgtap_p2.c_b')::uuid$$,
  '42501', NULL, 'guard: the scope of a consent cannot change');
SELECT lives_ok(
  $$UPDATE interop.consent_records SET policy_uri = 'https://mbhr.app/policy/pgtap-2' WHERE id = current_setting('pgtap_p2.c_b')::uuid$$,
  'guard: other fields of an active consent can change');
SELECT is(
  (SELECT string_agg(event, ',' ORDER BY changed_at) FROM interop.consent_record_history
    WHERE consent_id = current_setting('pgtap_p2.c_b')::uuid),
  'created,modified',
  'history: a change is recorded as modified');
SELECT lives_ok(
  $$UPDATE interop.consent_records SET policy_uri = policy_uri WHERE id = current_setting('pgtap_p2.c_b')::uuid$$,
  'an update that changes nothing runs');
SELECT is(
  (SELECT count(*)::int FROM interop.consent_record_history WHERE consent_id = current_setting('pgtap_p2.c_b')::uuid),
  2,
  'history: an update that changes nothing is not recorded');
SELECT throws_ok(
  $$UPDATE interop.consent_provisions SET purpose = 'TREAT' WHERE consent_id = current_setting('pgtap_p2.c_a')::uuid$$,
  '42501', NULL, 'provisions: UPDATE is refused (record a new consent)');
SELECT throws_ok(
  $$INSERT INTO interop.consent_provisions (consent_id, provision_type, actor_type)
    VALUES (current_setting('pgtap_p2.c_a')::uuid, 'permit', 'any')$$,
  '42501', NULL, 'provisions: none can be added to a verified, withdrawn consent');
INSERT INTO interop.consent_records (patient_id, status, scope, category, source_type, created_at, recorded_at)
VALUES ('pgtap-p2-c1', 'active', 'patient-privacy', 'pgtap-old', 'paper_form', now() - interval '1 day', now() - interval '1 day');
SELECT throws_ok(
  $$INSERT INTO interop.consent_provisions (consent_id, provision_type, actor_type)
    SELECT id, 'permit', 'any' FROM interop.consent_records WHERE category = 'pgtap-old'$$,
  '42501', NULL, 'provisions: none can be added to a consent created in an earlier transaction');
INSERT INTO interop.consent_records (patient_id, status, scope, category, source_type)
VALUES ('pgtap-p2-c1', 'draft', 'patient-privacy', 'pgtap-new', 'paper_form');
SELECT lives_ok(
  $$INSERT INTO interop.consent_provisions (consent_id, provision_type, actor_type)
    SELECT id, 'deny', 'any' FROM interop.consent_records WHERE category = 'pgtap-new'$$,
  'provisions: they are added in the transaction that created their consent');
SELECT lives_ok(
  $$UPDATE interop.consent_records SET status = 'rejected' WHERE category = 'pgtap-new'$$,
  'status: a draft consent can be rejected');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET status = 'active' WHERE category = 'pgtap-new'$$,
  '42501', NULL, 'status: a rejected consent cannot be made active');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET status = 'active' WHERE id = current_setting('pgtap_p2.c_a')::uuid$$,
  '42501', NULL, 'status: an inactive consent cannot be made active');
SELECT lives_ok(
  $$UPDATE interop.consent_records SET status = 'entered-in-error' WHERE category = 'pgtap-new'$$,
  'status: a rejected consent can be marked entered-in-error');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET status = 'draft' WHERE category = 'pgtap-new'$$,
  '42501', NULL, 'status: an entered-in-error consent cannot leave that status');
DO $$ BEGIN PERFORM set_config('pgtap_p2.c_new', (SELECT id::text FROM interop.consent_records WHERE category = 'pgtap-new'), true); END $$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.interop_verify_consent(current_setting('pgtap_p2.c_new')::uuid)$$,
  '22023', NULL, 'verify: an entered-in-error consent cannot be verified');
RESET ROLE;
SELECT throws_ok($$DELETE FROM interop.consent_records WHERE id = current_setting('pgtap_p2.c_b')::uuid$$, '42501', NULL,
  'consent records: DELETE is refused (Phase 1 guard)');
SELECT throws_ok($$UPDATE interop.consent_record_history SET event = 'modified'$$, '42501', NULL, 'history: UPDATE is refused');
SELECT throws_ok($$DELETE FROM interop.consent_record_history$$, '42501', NULL, 'history: DELETE is refused');
SELECT throws_ok($$TRUNCATE interop.consent_record_history$$, '42501', NULL, 'history: TRUNCATE is refused');

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$INSERT INTO interop.consent_record_history (consent_id, event, status_after, changed_by_kind)
    VALUES (current_setting('pgtap_p2.c_b')::uuid, 'created', 'active', 'system')$$,
  '42501', NULL, 'history: the service role cannot write history rows');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8. patients.fhir_id is kept once set
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$UPDATE public.patients SET fhir_id = '99990000-0000-4000-8000-00000000f1d0' WHERE id = 'pgtap-p2-a'$$,
  'fhir_id: an update that changes it runs without error');
SELECT is(
  (SELECT fhir_id::text FROM public.patients WHERE id = 'pgtap-p2-a'),
  current_setting('pgtap_p2.a_fhir'),
  'fhir_id: the old value is kept');

-- ---------------------------------------------------------------------------
-- 9. The audit rate bucket
-- ---------------------------------------------------------------------------
UPDATE public.rate_limits SET count = 300
 WHERE bucket = 'fhir_audit' AND key = '99990000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL, 200, NULL, NULL, NULL, '{}', NULL)$$,
  'P0001', NULL, 'record_access_v2: the 301st row in a minute is refused (rate limited)');
RESET ROLE;
UPDATE public.rate_limits SET count = 30
 WHERE bucket = 'fhir_audit' AND key = '99990000-0000-4000-8000-0000000000ff';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000ff","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.fhir_record_access_v2(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'deny', 'no_staff_role', 0, '{}', NULL, NULL, 403, NULL, NULL, NULL, '{}', 'none')$$,
  'P0001', NULL, 'record_access_v2: an account that is neither staff nor patient gets 30 rows a minute');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 10. An auditor (audit_access): audit events and admin status
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events()$$, '22023', NULL,
  'audit events: a narrowing selector is required');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_from => now() - interval '32 days', p_to => now())$$, '22023', NULL,
  'audit events: a date range over 31 days is refused');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_from => now() - interval '1 day')$$, '22023', NULL,
  'audit events: an open date range is refused');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'], p_decision => 'maybe')$$, '22023', NULL,
  'audit events: an unknown decision is refused');
SELECT throws_ok($$SELECT * FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'], p_after_occurred => now())$$, '22023', NULL,
  'audit events: a half keyset is refused');
SELECT lives_ok($$SELECT * FROM public.fhir_access_audit_events(p_from => now() - interval '31 days', p_to => now())$$,
  'audit events: a 31-day range is accepted');
SELECT ok(
  (SELECT count(*) >= 2 AND bool_and(e.action IN ('read', 'search')) AND bool_and('pgtap-p2-a' = ANY (e.patient_ids))
     FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'], p_limit => 101) AS e),
  'audit events: the patient filter returns gateway requests only (no consent_change rows)');
SELECT ok(
  (SELECT count(*) >= 2 AND bool_and(e.actor_user_id = '99990000-0000-4000-8000-000000000001'::uuid)
     FROM public.fhir_access_audit_events(p_actor_source_ids => ARRAY['99990000-0000-4000-8000-000000000001', 'not-a-uuid'], p_limit => 101) AS e),
  'audit events: the agent filter returns that account''s rows only');
SELECT is(
  (SELECT e.decision FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-b'], p_decision => 'deny') AS e),
  'deny',
  'audit events: the decision filter');
SELECT ok(
  (WITH first AS (SELECT e.id, e.occurred_at FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a', 'pgtap-p2-b'], p_limit => 1) AS e),
        rest AS (SELECT e.id FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a', 'pgtap-p2-b'], p_limit => 101,
                   p_after_occurred => (SELECT occurred_at FROM first), p_after_id => (SELECT id FROM first)) AS e)
   SELECT (SELECT count(*) FROM rest) >= 2 AND NOT EXISTS (SELECT 1 FROM rest WHERE id = (SELECT id FROM first))),
  'audit events: keyset paging continues after the last row');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_access_audit_events(p_id => '99992222-0000-4000-8000-00000000dead')),
  0,
  'audit events: an unknown id returns nothing');

SELECT ok(
  (SELECT (s ->> 'requests_24h')::int >= 5 AND (s ->> 'denials_24h')::int >= 2
          AND (s ->> 'requests_7d')::int >= (s ->> 'requests_24h')::int
          AND jsonb_array_length(s -> 'recent') BETWEEN 1 AND 20
          AND jsonb_array_length(s -> 'recent_denials') BETWEEN 1 AND 20
          AND (s -> 'consent' ->> 'records')::int >= 2 AND (s -> 'consent' ->> 'withdrawn')::int >= 1
     FROM public.fhir_interop_admin_status() AS s),
  'admin status: counts, recent requests and refusals, consent counts');
SELECT ok(
  (SELECT NOT (s::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
          AND position('pgtap-p2' IN s::text) = 0
          AND (SELECT bool_and(k IN ('occurred_at', 'action', 'resource_type', 'decision', 'denial_reason', 'actor_role', 'http_status'))
                 FROM jsonb_array_elements(s -> 'recent') AS e, jsonb_object_keys(e) AS k)
     FROM public.fhir_interop_admin_status() AS s),
  'admin status: no ids of any kind and no patient data');
RESET ROLE;

-- An admin (users) may read the admin status too.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000009","role":"authenticated"}';
SELECT lives_ok($$SELECT public.fhir_interop_admin_status()$$, 'admin status: an admin (users) may read it');
SELECT lives_ok($$SELECT * FROM public.fhir_access_audit_events(p_patient_ids => ARRAY['pgtap-p2-a'])$$,
  'audit events: an admin (audit_access) may read them');
RESET ROLE;

-- A deactivated account is not staff.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-000000000008","role":"authenticated"}';
SELECT throws_ok($$SELECT * FROM public.fhir_staff_directory()$$, '42501', NULL,
  'directory: a deactivated account is refused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
