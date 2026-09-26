-- pgTAP: portal identity hardening
-- Migration under test: supabase/migrations/20260927100110_portal_identity_hardening.sql
-- Fixtures are created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures (migration owner; guards and RLS do not apply)
-- ---------------------------------------------------------------------------
SELECT set_config('mbhr.authoritative_write', 'on', true);

INSERT INTO auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at) VALUES
  -- A: verified email with no clinic record at all
  ('7777aaaa-0000-4000-8000-000000000001', 'pgtap-pih-new@example.invalid', NULL, now(), NULL),
  -- B: verified phone matching a kept record and a merged-away duplicate.
  -- (By phone: production's idx_patients_email lets only one record hold an
  -- email, so a duplicate can share only the phone number.)
  ('7777aaaa-0000-4000-8000-000000000002', NULL, '2348077700002', NULL, now()),
  -- C: a phone-only login whose JWT carries a family's shared number
  ('7777aaaa-0000-4000-8000-000000000003', NULL, '2348077700003', NULL, now()),
  -- D: an email that was never confirmed, with no clinic record
  ('7777aaaa-0000-4000-8000-000000000004', 'pgtap-pih-unconfirmed@example.invalid', NULL, NULL, NULL);

INSERT INTO public.patients (id, given_name, family_name, email, phone, dob) VALUES
  ('pgtap-pih-kept',   'Ngozi', 'Kept',   NULL, '08077700002', '1980-01-01'),
  ('pgtap-pih-dup',    'Ngozi', 'Dup',    NULL, '08077700002', '1980-01-01'),
  ('pgtap-pih-family', 'Emeka', 'Family', NULL, '08077700003', '1975-05-05');

UPDATE public.patients
   SET portal_enabled = true, portal_enabled_changed_at = now()
 WHERE id IN ('pgtap-pih-kept', 'pgtap-pih-dup', 'pgtap-pih-family');
UPDATE public.patients SET merged_into = 'pgtap-pih-kept' WHERE id = 'pgtap-pih-dup';

-- A portal user row for the family record carrying the shared number, owned
-- by some other login (not C).
INSERT INTO public.patient_portal_users (id, patient_id, phone_number, account_status)
VALUES ('7777aaaa-0000-4000-8000-0000000000ff', 'pgtap-pih-family', '2348077700003', 'active');

-- ---------------------------------------------------------------------------
-- 1. A sign-up that matches no clinic record gets no new patient record
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777aaaa-0000-4000-8000-000000000001","role":"authenticated","email":"pgtap-pih-new@example.invalid"}';

SELECT is(
  public.portal_link_patient_record('1990-02-02', 'Ada', 'New', NULL) ->> 'status',
  'no_clinic_record',
  'no matching clinic record: refused, not created');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.patients WHERE auth_uid = '7777aaaa-0000-4000-8000-000000000001'),
  0,
  'no patient record was created for the sign-up');

-- ---------------------------------------------------------------------------
-- 2. A merged-away duplicate does not block linking to the kept record
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777aaaa-0000-4000-8000-000000000002","role":"authenticated","phone":"2348077700002"}';

SELECT is(
  public.portal_link_patient_record('1980-01-01', 'Ngozi', 'Kept', NULL) ->> 'status',
  'linked',
  'the merged-away duplicate is ignored; the kept record links');

SELECT is(
  public.portal_link_patient_record('1980-01-01', 'Ngozi', 'Kept', NULL) ->> 'patient_id',
  'pgtap-pih-kept',
  'linked to the kept record, not the merged-away one');

SELECT is(
  (SELECT array_agg(i ORDER BY i) FROM public.app_portal_patient_ids() AS i),
  ARRAY['pgtap-pih-kept']::text[],
  'the linked login sees only the kept record');

RESET ROLE;
SELECT is(
  (SELECT auth_uid FROM public.patients WHERE id = 'pgtap-pih-dup'),
  NULL,
  'the merged-away record was not linked');

-- ---------------------------------------------------------------------------
-- 3. An unconfirmed email is still told to confirm it, and gets no record
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777aaaa-0000-4000-8000-000000000004","role":"authenticated","email":"pgtap-pih-unconfirmed@example.invalid"}';

SELECT is(
  public.portal_link_patient_record('1990-03-03', 'Uche', 'Unconfirmed', NULL) ->> 'status',
  'contact_not_verified',
  'an unconfirmed email is asked to confirm it first');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.patients WHERE auth_uid = '7777aaaa-0000-4000-8000-000000000004'),
  0,
  'no patient record was created for the unconfirmed sign-up');

-- ---------------------------------------------------------------------------
-- 4. A JWT phone claim no longer opens records carrying that number
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777aaaa-0000-4000-8000-000000000003","role":"authenticated","phone":"2348077700003"}';

SELECT is_empty(
  $$SELECT * FROM public.app_portal_patient_ids()$$,
  'a shared phone number does not open the family record');

SELECT is_empty(
  $$SELECT * FROM public.portal_access_status()$$,
  'portal_access_status does not report the family record either');

SELECT is_empty(
  $$SELECT id FROM public.patients WHERE id = 'pgtap-pih-family'$$,
  'the family record is not readable through RLS');

SELECT * FROM finish();
ROLLBACK;
