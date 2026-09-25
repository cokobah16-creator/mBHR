-- pgTAP: portal access is decided by the server
-- Migration under test: supabase/migrations/20260925100100_portal_access_authoritative.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(36);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: guards and row-level security do not
-- apply to this role)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('11110000-0000-4000-8000-000000000001', 'pgTAP nurse', 'nurse'),
  ('11110000-0000-4000-8000-000000000002', 'pgTAP pharmacist', 'pharmacist');

INSERT INTO public.portal_enrollment_settings (setting_key, setting_value)
VALUES ('auto_enrollment_enabled', 'true'::jsonb),
       ('require_email', 'false'::jsonb)
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- ---------------------------------------------------------------------------
-- 1. A staff insert with a phone is auto-enrolled and stamped
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$INSERT INTO public.patients (id, given_name, family_name, phone)
    VALUES ('pgtap-portal-a', 'Ada', 'Test', '08000000001')$$,
  'a nurse registers a patient with a phone');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-portal-a'),
  true,
  'auto-enrolment turns portal access on for the new record');

SELECT ok(
  (SELECT portal_enabled_changed_at IS NOT NULL AND auto_enrolled
     FROM public.patients WHERE id = 'pgtap-portal-a'),
  'auto-enrolment is stamped as a server decision');

SELECT is(
  (SELECT count(*)::int FROM public.patient_portal_access_events
    WHERE patient_id = 'pgtap-portal-a' AND source = 'auto_enrollment' AND applied),
  1,
  'auto-enrolment is recorded in the access history');

-- ---------------------------------------------------------------------------
-- 2. A staff disable applies; a repeated command id returns the stored result
-- ---------------------------------------------------------------------------
SELECT is(
  public.set_patient_portal_access(
    '1111c0de-0000-4000-8000-000000000001', 'pgtap-portal-a', false,
    'staff_choice', now(), 'device-nurse', 'staff') ->> 'outcome',
  'applied',
  'a staff disable applies');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-portal-a'),
  false,
  'portal access is off after the disable');

SELECT is(
  public.set_patient_portal_access(
    '1111c0de-0000-4000-8000-000000000001', 'pgtap-portal-a', true,
    NULL, now(), 'device-nurse', 'staff'),
  (SELECT result FROM public.command_receipts
    WHERE command_id = '1111c0de-0000-4000-8000-000000000001'),
  'a repeated command id returns the stored result, whatever else it sends');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-portal-a'),
  false,
  'the repeated command did not change portal access');

SELECT is(
  (SELECT count(*)::int FROM public.patient_portal_access_events
    WHERE command_id = '1111c0de-0000-4000-8000-000000000001'),
  1,
  'one history row per command id');

-- ---------------------------------------------------------------------------
-- 3. Register holders cannot turn access back on by UPDATE or upsert
--    (auto-enrolment is still on here: it must not fire on these writes)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$UPDATE public.patients
       SET portal_enabled = true, phone = '08000000002'
     WHERE id = 'pgtap-portal-a'$$,
  'a register holder may edit the record');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-portal-a'),
  false,
  'a direct UPDATE does not turn portal access back on');

SELECT lives_ok(
  $$INSERT INTO public.patients (id, given_name, family_name, phone, portal_enabled)
    VALUES ('pgtap-portal-a', 'Ada', 'Test', '08000000003', true)
    ON CONFLICT (id) DO UPDATE
      SET phone = EXCLUDED.phone, portal_enabled = true$$,
  'an upsert of the record is accepted');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-portal-a'),
  false,
  'an upsert does not turn portal access back on');

SELECT is(
  (SELECT phone FROM public.patients WHERE id = 'pgtap-portal-a'),
  '08000000003',
  'the upsert still saved the other change');

-- An API insert starts with portal access off (auto-enrolment off here).
RESET ROLE;
UPDATE public.portal_enrollment_settings
   SET setting_value = 'false'::jsonb
 WHERE setting_key = 'auto_enrollment_enabled';
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.patients (id, given_name, family_name, email, portal_enabled)
    VALUES ('pgtap-portal-b', 'Bola', 'Test', 'pgtap-portal-b@example.invalid', true)$$,
  'a nurse registers a patient and asks for portal access in the row');

SELECT ok(
  (SELECT NOT portal_enabled AND portal_enabled_changed_at IS NULL
     FROM public.patients WHERE id = 'pgtap-portal-b'),
  'an API insert starts with portal access off and no recorded decision');

-- ---------------------------------------------------------------------------
-- 4. An automatic (backfill) enable never overrides the staff disable
-- ---------------------------------------------------------------------------
SELECT is(
  public.set_patient_portal_access(
    '1111c0de-0000-4000-8000-000000000002', 'pgtap-portal-a', true,
    'backfill', now(), NULL, 'backfill') ->> 'outcome',
  'rejected',
  'a backfill enable after a staff disable is refused');

SELECT is(
  (SELECT result ->> 'reason' FROM public.command_receipts
    WHERE command_id = '1111c0de-0000-4000-8000-000000000002'),
  'server_decision_kept',
  'the refusal reason is server_decision_kept');

-- ---------------------------------------------------------------------------
-- 5. A staff enable made before the newer disable is refused
-- ---------------------------------------------------------------------------
SELECT is(
  public.set_patient_portal_access(
    '1111c0de-0000-4000-8000-000000000003', 'pgtap-portal-a', true,
    NULL, now() - interval '1 day', 'device-nurse', 'staff') ->> 'reason',
  'newer_decision_on_server',
  'a stale staff enable (client time before the disable) is refused');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-portal-a'),
  false,
  'portal access stays off after the refused enables');

SELECT is(
  public.set_patient_portal_access(
    '1111c0de-0000-4000-8000-000000000004', 'pgtap-portal-a', true,
    NULL, clock_timestamp(), 'device-nurse', 'staff') ->> 'outcome',
  'applied',
  'a staff enable made after the disable applies');

-- ---------------------------------------------------------------------------
-- 6. A backfill enable on a never-decided patient applies
-- ---------------------------------------------------------------------------
SELECT is(
  public.set_patient_portal_access(
    '1111c0de-0000-4000-8000-000000000005', 'pgtap-portal-b', true,
    'backfill', now(), NULL, 'backfill') ->> 'outcome',
  'applied',
  'a backfill enable applies when the server holds no decision');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-portal-b'),
  true,
  'portal access is on after the backfill enable');

-- ---------------------------------------------------------------------------
-- 7. A patient not on the server yet raises PT409 and records nothing
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.set_patient_portal_access(
      '1111c0de-0000-4000-8000-000000000006', 'pgtap-portal-missing', true,
      NULL, now(), 'device-nurse', 'staff')$$,
  'PT409', NULL,
  'an unknown patient raises PT409 (the device retries after upload)');

SELECT is_empty(
  $$SELECT 1 FROM public.command_receipts
     WHERE command_id = '1111c0de-0000-4000-8000-000000000006'$$,
  'no receipt is stored for the PT409 command');

-- ---------------------------------------------------------------------------
-- 8. A pharmacist (no portal_manage) is refused
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.set_patient_portal_access(
      '1111c0de-0000-4000-8000-000000000007', 'pgtap-portal-b', false,
      NULL, now(), 'device-pharmacist', 'staff')$$,
  '42501', NULL,
  'a pharmacist cannot change portal access');

SELECT is_empty(
  $$SELECT 1 FROM public.patient_portal_access_events$$,
  'a pharmacist cannot read the access history');

-- ---------------------------------------------------------------------------
-- 9. A portal patient: own status, own address, never portal_enabled
-- ---------------------------------------------------------------------------
RESET ROLE;
INSERT INTO public.patients (
  id, given_name, family_name, email, auth_uid, portal_enabled, portal_enabled_changed_at)
VALUES (
  'pgtap-portal-d', 'Dayo', 'Test', 'pgtap-portal-d@example.invalid',
  '11110000-0000-4000-8000-000000000003', true, now());
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.portal_access_status()
    WHERE patient_id = 'pgtap-portal-d' AND portal_enabled),
  1,
  'portal_access_status() returns the signed-in patient''s record as enabled');

SELECT is(
  (SELECT count(*)::int FROM public.portal_access_status()),
  1,
  'portal_access_status() returns no other patient''s record');

SELECT throws_ok(
  $$UPDATE public.patients SET portal_enabled = false WHERE id = 'pgtap-portal-d'$$,
  '42501', NULL,
  'a portal patient cannot change portal_enabled');

SELECT lives_ok(
  $$UPDATE public.patients SET address = '1 Test Street' WHERE id = 'pgtap-portal-d'$$,
  'a portal patient can update their own address');

SELECT is(
  (SELECT address FROM public.patients WHERE id = 'pgtap-portal-d'),
  '1 Test Street',
  'the address change was saved');

SELECT throws_ok(
  $$SELECT public.set_patient_portal_access(
      '1111c0de-0000-4000-8000-000000000008', 'pgtap-portal-d', false,
      NULL, now(), NULL, 'staff')$$,
  '42501', NULL,
  'a portal patient cannot call set_patient_portal_access');

-- ---------------------------------------------------------------------------
-- 10. The access history is append-only
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$INSERT INTO public.patient_portal_access_events
      (patient_id, enabled, applied, outcome, source)
    VALUES ('pgtap-portal-a', true, true, 'applied', 'staff')$$,
  '42501', NULL,
  'staff cannot write the access history directly');

RESET ROLE;

SELECT throws_ok(
  $$UPDATE public.patient_portal_access_events
       SET reason = 'edited'
     WHERE patient_id = 'pgtap-portal-a'$$,
  '42501', NULL,
  'the access history cannot be updated, even by the table owner');

SELECT throws_ok(
  $$DELETE FROM public.patient_portal_access_events
     WHERE patient_id = 'pgtap-portal-a'$$,
  '42501', NULL,
  'the access history cannot be deleted, even by the table owner');

SELECT * FROM finish();
ROLLBACK;
