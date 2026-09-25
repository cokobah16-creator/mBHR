-- pgTAP: the interop schema and the FHIR gateway's database functions
-- Migration under test: supabase/migrations-deferred/20260926110000_interop_foundation.sql
-- Deferred with its migration: run by .github/workflows/interop-fhir.yml
-- (plain PostgreSQL 16), not by `supabase test db`. Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(42);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('88880000-0000-4000-8000-000000000001', 'pgTAP nurse', 'nurse'),
  ('88880000-0000-4000-8000-000000000002', 'pgTAP doctor', 'doctor'),
  ('88880000-0000-4000-8000-000000000003', 'pgTAP pharmacist', 'pharmacist');

INSERT INTO interop.terminology_map
  (domain, local_system, local_code, fhir_system, fhir_code, review_status, reviewed_by, reviewed_at)
VALUES
  ('condition', 'https://mbhr.app/codes/condition', 'pgtap-verified',
   'http://hl7.org/fhir/sid/icd-10', 'Z00.0', 'verified',
   '88880000-0000-4000-8000-000000000002', now()),
  ('condition', 'https://mbhr.app/codes/condition', 'pgtap-unverified',
   'http://hl7.org/fhir/sid/icd-10', 'Z00.1', 'unverified', NULL, NULL);

INSERT INTO interop.consent_records (id, patient_id, status, scope, category, source_type)
VALUES ('88881111-0000-4000-8000-000000000001', 'pgtap-interop-patient', 'active',
        'patient-privacy', '59284-0', 'paper_form');
INSERT INTO interop.consent_provisions (consent_id, provision_type, action, purpose)
VALUES ('88881111-0000-4000-8000-000000000001', 'deny', 'disclose', 'HRESCH');

-- ---------------------------------------------------------------------------
-- 1. The schema is closed to the API roles
-- ---------------------------------------------------------------------------
SELECT ok(EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'interop'), 'schema interop exists');
SELECT ok(NOT has_schema_privilege('anon', 'interop', 'USAGE'), 'anon has no USAGE on interop');
SELECT ok(NOT has_schema_privilege('authenticated', 'interop', 'USAGE'), 'authenticated has no USAGE on interop');

SELECT ok(
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'interop' AND c.relkind = 'r'),
  'row-level security is on for every interop table');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'interop'),
  0,
  'interop tables have no policies (nothing is readable through a policy)');
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE table_schema = 'interop' AND grantee IN ('anon', 'authenticated', 'PUBLIC')),
  0,
  'no table privilege on interop for anon, authenticated or PUBLIC');

-- ---------------------------------------------------------------------------
-- 2. anon: no table, no function
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM interop.access_audit$$, '42501', NULL, 'anon cannot read the audit trail');
SELECT throws_ok($$SELECT * FROM interop.consent_records$$, '42501', NULL, 'anon cannot read consent records');
SELECT throws_ok($$SELECT public.fhir_gateway_context(60)$$, '42501', NULL, 'anon cannot call fhir_gateway_context');
SELECT throws_ok(
  $$SELECT public.fhir_record_access(gen_random_uuid(), 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL)$$,
  '42501', NULL, 'anon cannot call fhir_record_access');
SELECT throws_ok($$SELECT * FROM public.fhir_terminology_lookup('condition', ARRAY['pgtap-verified'])$$,
  '42501', NULL, 'anon cannot call fhir_terminology_lookup');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. A signed-in nurse
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT throws_ok($$SELECT * FROM interop.access_audit$$, '42501', NULL, 'a nurse cannot read the audit trail directly');
SELECT throws_ok(
  $$INSERT INTO interop.access_audit (request_id, action, decision) VALUES (gen_random_uuid(), 'read', 'permit')$$,
  '42501', NULL, 'a nurse cannot write the audit trail directly');
SELECT throws_ok($$SELECT * FROM interop.terminology_map$$, '42501', NULL, 'a nurse cannot read terminology_map directly');
SELECT throws_ok($$SELECT * FROM interop.resource_links$$, '42501', NULL, 'a nurse cannot read resource_links directly');
SELECT throws_ok($$SELECT * FROM interop.consent_provisions$$, '42501', NULL, 'a nurse cannot read consent provisions directly');

SELECT is(public.fhir_gateway_context(60) ->> 'role', 'nurse', 'fhir_gateway_context returns the caller''s role');
SELECT ok((public.fhir_gateway_context(60) -> 'permissions') ? 'vitals', 'a nurse holds vitals');
SELECT ok(NOT ((public.fhir_gateway_context(60) -> 'permissions') ? 'consult'), 'a nurse does not hold consult');
SELECT is((public.fhir_gateway_context(60) ->> 'rate_allowed')::boolean, true, 'within the rate limit');

SELECT isnt(
  public.fhir_record_access('88882222-0000-4000-8000-000000000001', 'search', 'Observation', NULL,
    ARRAY['pgtap-interop-patient'], 'TREAT', 'permit', NULL, 3, ARRAY['patient'], 'pgtap', NULL),
  NULL,
  'a nurse records an access');

SELECT is(
  (SELECT count(*)::int FROM public.fhir_terminology_lookup('condition', ARRAY['pgtap-verified', 'pgtap-unverified'])),
  1,
  'staff get verified mappings only');
RESET ROLE;

SELECT ok(
  (SELECT actor_user_id = '88880000-0000-4000-8000-000000000001'::uuid
          AND actor_role = 'nurse' AND patient_id = 'pgtap-interop-patient'
          AND result_count = 3 AND decision = 'permit' AND denial_reason IS NULL
          AND metadata -> 'search_params' = '["patient"]'::jsonb
     FROM interop.access_audit WHERE request_id = '88882222-0000-4000-8000-000000000001'),
  'the audit row names the caller from the session, with their role');

-- ---------------------------------------------------------------------------
-- 4. Audit arguments are checked
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.fhir_record_access(gen_random_uuid(), 'delete', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL)$$,
  '22023', NULL, 'an unknown action is refused');
SELECT throws_ok(
  $$SELECT public.fhir_record_access(gen_random_uuid(), 'read', 'patients', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL)$$,
  '22023', NULL, 'a table name is not a resource type');
SELECT throws_ok(
  $$SELECT public.fhir_record_access(NULL, 'read', 'Patient', NULL, '{}', 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL)$$,
  '22023', NULL, 'a missing request id is refused');
SELECT throws_ok(
  $$SELECT public.fhir_record_access(gen_random_uuid(), 'read', 'Patient', NULL,
      (SELECT array_agg('p' || g) FROM generate_series(1, 101) g), 'TREAT', 'permit', NULL, 0, '{}', NULL, NULL)$$,
  '22023', NULL, 'more than 100 patient ids are refused');
SELECT lives_ok(
  $$SELECT public.fhir_record_access('88882222-0000-4000-8000-000000000002', 'read', 'Condition', NULL, '{}', 'TREAT', 'deny', 'missing_permission', 0, '{}', NULL, NULL)$$,
  'a denial is recorded with its reason');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. A signed-in account with no staff role (e.g. a portal patient)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000ff","role":"authenticated"}';
SELECT is(public.fhir_gateway_context(60) ->> 'role', NULL, 'no role for an account without app_users');
SELECT is(public.fhir_gateway_context(60) -> 'permissions', '[]'::jsonb, 'and no permissions');
SELECT is(
  (SELECT count(*)::int FROM public.fhir_terminology_lookup('condition', ARRAY['pgtap-verified'])),
  0,
  'non-staff get no terminology mappings');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. The rate limit counts per account
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT is(
  (SELECT bool_and((public.fhir_gateway_context(2) ->> 'rate_allowed')::boolean) FROM generate_series(1, 2)),
  true,
  'two calls fit a limit of two');
SELECT is((public.fhir_gateway_context(2) ->> 'rate_allowed')::boolean, false, 'the third call in the window is refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. The audit trail is append-only, even for the owner
-- ---------------------------------------------------------------------------
SELECT throws_ok($$UPDATE interop.access_audit SET result_count = 0$$, '42501', NULL, 'audit rows cannot be updated');
SELECT throws_ok($$DELETE FROM interop.access_audit$$, '42501', NULL, 'audit rows cannot be deleted');
SELECT throws_ok($$TRUNCATE interop.access_audit$$, '42501', NULL, 'the audit trail cannot be truncated');

-- ---------------------------------------------------------------------------
-- 8. Consent history is kept; withdrawal is recorded, not deleted
-- ---------------------------------------------------------------------------
SELECT throws_ok($$DELETE FROM interop.consent_records$$, '42501', NULL, 'consent records cannot be deleted');
SELECT throws_ok($$DELETE FROM interop.consent_provisions$$, '42501', NULL, 'consent provisions cannot be deleted');
SELECT throws_ok(
  $$UPDATE interop.consent_records SET withdrawn_at = now() WHERE id = '88881111-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'a withdrawn consent cannot stay active');
SELECT lives_ok(
  $$UPDATE interop.consent_records SET withdrawn_at = now(), status = 'inactive', withdrawal_reason = 'pgtap'
     WHERE id = '88881111-0000-4000-8000-000000000001'$$,
  'a withdrawal is recorded by making the consent inactive');
SELECT throws_ok(
  $$INSERT INTO interop.consent_records (patient_id, status, scope, category, source_type)
    VALUES ('pgtap-interop-patient', 'granted', 'treatment', 'x', 'portal')$$,
  '23514', NULL, 'only FHIR R4 Consent status codes are accepted');

-- ---------------------------------------------------------------------------
-- 9. A mapping is verified only with a reviewer
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO interop.terminology_map (domain, local_system, local_code, fhir_system, fhir_code, review_status)
    VALUES ('condition', 'https://mbhr.app/codes/condition', 'pgtap-x', 'http://snomed.info/sct', '1', 'verified')$$,
  '23514', NULL, 'a verified mapping needs a reviewer and a review time');

SELECT * FROM finish();
ROLLBACK;
