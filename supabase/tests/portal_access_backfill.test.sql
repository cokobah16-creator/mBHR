-- pgTAP: one-off portal access backfill for existing verified portal accounts
-- Migration under test: supabase/migrations/20260924105900_portal_access_backfill.sql
-- (its logic is public.app_portal_access_backfill(), which the migration
-- runs once). Run with `supabase test db` (see supabase/tests/README.md).
-- Fixtures are created below and everything is rolled back at the end.
--
-- With every migration applied, this exercises the "late run" path
-- (patient_portal_access_events and portal_enabled_changed_at exist).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: guards and row-level security do not
-- apply to this role)
-- ---------------------------------------------------------------------------
INSERT INTO public.portal_enrollment_settings (setting_key, setting_value)
VALUES ('auto_enrollment_enabled', 'false'::jsonb)
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

INSERT INTO public.app_users (id, full_name, role) VALUES
  ('66660000-0000-4000-8000-000000000001', 'pgTAP nurse', 'nurse'),
  ('66660000-0000-4000-8000-000000000002', 'pgTAP volunteer', 'volunteer'),
  ('66660000-0000-4000-8000-000000000003', 'pgTAP auditor', 'auditor');

-- Supabase Auth accounts. Only a01 .. a12 with a confirmation are verified.
INSERT INTO auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at) VALUES
  ('6666aaaa-0000-4000-8000-000000000001', 'pgtap-bf-a01@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000002', 'pgtap-bf-a02@example.invalid', NULL, NULL, NULL),
  ('6666aaaa-0000-4000-8000-000000000003', NULL, '2348066600003', NULL, now()),
  ('6666aaaa-0000-4000-8000-000000000004', 'pgtap-bf-match@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000005', 'pgtap-bf-a05@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000006', 'pgtap-bf-a06@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000007', 'pgtap-bf-a07@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000008', 'pgtap-bf-a08@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000009', 'pgtap-bf-a09@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000010', 'pgtap-bf-a10@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000011', 'pgtap-bf-a11@example.invalid', NULL, now(), NULL),
  ('6666aaaa-0000-4000-8000-000000000012', 'pgtap-bf-a12@example.invalid', NULL, now(), NULL),
  -- The volunteer's own (staff) account, confirmed.
  ('66660000-0000-4000-8000-000000000002', 'pgtap-bf-staff@example.invalid', NULL, now(), NULL);

INSERT INTO public.patients (id, given_name, family_name, phone, email, auth_uid, portal_enabled, portal_opt_out) VALUES
  -- Turned on: verified account linked by auth_uid.
  ('pgtap-bf-verified',    'Ada',   'Test', '+2348066601001', NULL, '6666aaaa-0000-4000-8000-000000000001', false, false),
  -- Stays off: linked account never confirmed.
  ('pgtap-bf-unverified',  'Bola',  'Test', '+2348066601002', NULL, '6666aaaa-0000-4000-8000-000000000002', false, false),
  -- Stays off: phone and email equal a confirmed account's, but not linked.
  ('pgtap-bf-contact-match', 'Chidi', 'Test', '2348066600003', 'pgtap-bf-match@example.invalid', NULL, false, false),
  -- Stays off: opted out.
  ('pgtap-bf-opted-out',   'Dayo',  'Test', '+2348066601005', NULL, '6666aaaa-0000-4000-8000-000000000005', false, true),
  -- Already on: untouched.
  ('pgtap-bf-already-on',  'Femi',  'Test', '+2348066601010', NULL, '6666aaaa-0000-4000-8000-000000000010', true, false),
  -- Staff turn this one off below, before the backfill runs.
  ('pgtap-bf-staff-off',   'Gbenga', 'Test', '+2348066601007', NULL, '6666aaaa-0000-4000-8000-000000000007', true, false),
  -- Turned on: only a migration snapshot said "off".
  ('pgtap-bf-snapshot',    'Hauwa', 'Test', '+2348066601008', NULL, '6666aaaa-0000-4000-8000-000000000008', false, false),
  -- Stays off: the portal account is suspended.
  ('pgtap-bf-suspended',   'Ifeoma', 'Test', '+2348066601009', NULL, '6666aaaa-0000-4000-8000-000000000009', false, false),
  -- Stays off: a person turned access off (history event, no opt-out).
  ('pgtap-bf-staff-event', 'Jide',  'Test', '+2348066601011', NULL, '6666aaaa-0000-4000-8000-000000000011', false, false),
  -- Turned on: verified auth account and verified portal account.
  ('pgtap-bf-both',        'Kemi',  'Test', '+2348066601012', NULL, '6666aaaa-0000-4000-8000-000000000012', false, false),
  -- Stays off: linked to a staff account (even with a verified portal row below).
  ('pgtap-bf-staff-linked', 'Lami', 'Test', '+2348066601013', NULL, '66660000-0000-4000-8000-000000000002', false, false),
  -- Turned on: verified patient_portal_users row only.
  ('pgtap-bf-ppu-verified', 'Musa', 'Test', '+2348066601014', NULL, NULL, false, false),
  -- Stays off: portal account row never verified.
  ('pgtap-bf-ppu-unverified', 'Ngozi', 'Test', '+2348066601015', NULL, NULL, false, false);

-- Stays off: merged away (kept record: pgtap-bf-already-on).
INSERT INTO public.patients (id, given_name, family_name, phone, auth_uid, portal_enabled, merged_into)
VALUES ('pgtap-bf-merged', 'Obi', 'Test', '+2348066601006', '6666aaaa-0000-4000-8000-000000000006',
        false, 'pgtap-bf-already-on');

-- The 20260925100100 snapshot of a record that was off at that time.
UPDATE public.patients
   SET portal_enabled_changed_at = now() - interval '1 day'
 WHERE id = 'pgtap-bf-snapshot';
INSERT INTO public.patient_portal_access_events (patient_id, enabled, applied, outcome, reason, source, actor_id)
VALUES ('pgtap-bf-snapshot', false, true, 'applied', 'state_at_migration', 'migration', NULL),
       ('pgtap-bf-staff-event', false, true, 'applied', 'staff_choice', 'staff', NULL);

INSERT INTO public.patient_portal_users (id, patient_id, phone_number, email, phone_verified, email_verified, account_status) VALUES
  ('6666bbbb-0000-4000-8000-000000000001', 'pgtap-bf-ppu-verified',   '+2348066601014', NULL, true,  false, 'active'),
  ('6666bbbb-0000-4000-8000-000000000002', 'pgtap-bf-ppu-unverified', '+2348066601015', NULL, false, false, 'active'),
  ('6666bbbb-0000-4000-8000-000000000003', 'pgtap-bf-suspended',      '+2348066601009', NULL, true,  false, 'suspended'),
  ('6666bbbb-0000-4000-8000-000000000004', 'pgtap-bf-both',           '+2348066601012', 'pgtap-bf-a12@example.invalid', false, true, 'active'),
  -- A verified portal row does not outweigh an auth_uid link to a staff account.
  ('6666bbbb-0000-4000-8000-000000000005', 'pgtap-bf-staff-linked',   '+2348066601013', NULL, true,  false, 'active');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is(
  public.set_patient_portal_access(
    '6666c0de-0000-4000-8000-000000000001', 'pgtap-bf-staff-off', false,
    'staff_choice', clock_timestamp(), 'device-nurse', 'staff') ->> 'outcome',
  'applied',
  'fixture: a nurse turns a record off through the server before the backfill');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1. First run: exactly the verified, linked records are turned on
-- ---------------------------------------------------------------------------
-- Audit summaries written before this test (the migration's own run).
CREATE TEMP TABLE pgtap_bf_audit_before AS
SELECT count(*)::int AS n FROM public.audit_logs WHERE action = 'portal_access_backfill';

SELECT ok(
  public.app_portal_access_backfill() >= 4,
  'the backfill turns on (at least) the four verified, linked fixture records');

SELECT is(
  (SELECT array_agg(patient_id ORDER BY patient_id) FROM public.portal_access_backfill_log
    WHERE patient_id LIKE 'pgtap-bf-%'),
  ARRAY['pgtap-bf-both', 'pgtap-bf-ppu-verified', 'pgtap-bf-snapshot', 'pgtap-bf-verified'],
  'the log holds exactly the four records turned on');

SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.patients
    WHERE id LIKE 'pgtap-bf-%' AND portal_enabled),
  ARRAY['pgtap-bf-already-on', 'pgtap-bf-both', 'pgtap-bf-ppu-verified',
        'pgtap-bf-snapshot', 'pgtap-bf-verified'],
  'portal access is on for those four and the record that already had it');

SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.patients
    WHERE id LIKE 'pgtap-bf-%' AND NOT portal_enabled),
  ARRAY['pgtap-bf-contact-match', 'pgtap-bf-merged', 'pgtap-bf-opted-out',
        'pgtap-bf-ppu-unverified', 'pgtap-bf-staff-event', 'pgtap-bf-staff-linked',
        'pgtap-bf-staff-off', 'pgtap-bf-suspended', 'pgtap-bf-unverified'],
  'opted-out, merged, suspended, staff-disabled, staff-linked and unverified records stay off');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-bf-unverified'),
  false,
  'a linked account without a confirmed email or phone does not count');

SELECT is_empty(
  $$SELECT 1 FROM public.portal_access_backfill_log WHERE patient_id = 'pgtap-bf-contact-match'$$,
  'a phone and email equal to a confirmed account''s are not evidence');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-bf-staff-linked'),
  false,
  'a record linked to a staff account is not turned on, even with a verified portal row');

SELECT is(
  (SELECT format('%s|%s|%s|%s', auth_uid, COALESCE(portal_user_id, '-'), verified_by,
                 portal_enabled_before::text)
     FROM public.portal_access_backfill_log WHERE patient_id = 'pgtap-bf-verified'),
  '6666aaaa-0000-4000-8000-000000000001|-|{auth_email_confirmed}|false',
  'the log names the linked auth account, what was confirmed and the previous value');

SELECT is(
  (SELECT format('%s|%s|%s', COALESCE(auth_uid, '-'), portal_user_id, verified_by)
     FROM public.portal_access_backfill_log WHERE patient_id = 'pgtap-bf-ppu-verified'),
  '-|6666bbbb-0000-4000-8000-000000000001|{portal_phone_verified}',
  'the log names the verified portal account row');

SELECT is(
  (SELECT format('%s|%s|%s', auth_uid, portal_user_id, verified_by)
     FROM public.portal_access_backfill_log WHERE patient_id = 'pgtap-bf-both'),
  '6666aaaa-0000-4000-8000-000000000012|6666bbbb-0000-4000-8000-000000000004|{auth_email_confirmed,portal_email_verified}',
  'a record with both kinds of evidence gets one log row naming both');

SELECT is(
  (SELECT count(*)::int FROM public.portal_access_backfill_log
    WHERE patient_id LIKE 'pgtap-bf-%'
      AND migration = '20260924105900_portal_access_backfill'),
  4,
  'every log row names the migration');

SELECT ok(
  (SELECT bool_and(portal_enabled_changed_at >= now()) FROM public.patients
    WHERE id IN ('pgtap-bf-both', 'pgtap-bf-ppu-verified', 'pgtap-bf-snapshot', 'pgtap-bf-verified')),
  'a late run stamps the change as a new server decision (devices download it)');

SELECT is(
  (SELECT count(*)::int FROM public.patient_portal_access_events
    WHERE patient_id LIKE 'pgtap-bf-%' AND enabled AND applied
      AND source = 'migration' AND reason = 'portal_account_backfill'),
  4,
  'a late run records each change in the portal access history');

SELECT is(
  (SELECT count(*)::int FROM public.audit_logs WHERE action = 'portal_access_backfill'),
  (SELECT n + 1 FROM pgtap_bf_audit_before),
  'one summary row is written to audit_logs');

SELECT is(
  (SELECT row_version FROM public.patients WHERE id = 'pgtap-bf-already-on'),
  1::bigint,
  'a record that already had access is not rewritten');

-- ---------------------------------------------------------------------------
-- 2. Second run: nothing turned on, nothing logged
-- ---------------------------------------------------------------------------
SELECT is(
  public.app_portal_access_backfill(),
  0,
  'a second run turns nothing on');

SELECT is(
  (SELECT count(*)::int FROM public.portal_access_backfill_log WHERE patient_id LIKE 'pgtap-bf-%'),
  4,
  'a second run logs nothing new');

SELECT is(
  (SELECT count(*)::int FROM public.audit_logs WHERE action = 'portal_access_backfill'),
  (SELECT n + 1 FROM pgtap_bf_audit_before),
  'a second run writes no audit summary');

-- ---------------------------------------------------------------------------
-- 3. A later staff disable wins over a re-run
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  public.set_patient_portal_access(
    '6666c0de-0000-4000-8000-000000000002', 'pgtap-bf-verified', false,
    'staff_choice', clock_timestamp(), 'device-nurse', 'staff') ->> 'outcome',
  'applied',
  'staff can turn a backfilled record off');

RESET ROLE;

SELECT is(
  public.app_portal_access_backfill(),
  0,
  're-running the backfill after the disable turns nothing on');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-bf-verified'),
  false,
  'the staff disable stands');

-- ---------------------------------------------------------------------------
-- 4. A record is backfilled at most once, even when nothing else says why
--    it is off
-- ---------------------------------------------------------------------------
UPDATE public.patients SET portal_enabled = false WHERE id = 'pgtap-bf-ppu-verified';

SELECT is(
  public.app_portal_access_backfill(),
  0,
  'a record already in the log is never turned on again');

SELECT is(
  (SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-bf-ppu-verified'),
  false,
  'the record stays off');

-- ---------------------------------------------------------------------------
-- 5. The log is append-only, even for the table owner
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$UPDATE public.portal_access_backfill_log SET portal_enabled_before = true
     WHERE patient_id = 'pgtap-bf-both'$$,
  '42501', NULL,
  'the backfill log cannot be updated');

SELECT throws_ok(
  $$DELETE FROM public.portal_access_backfill_log WHERE patient_id = 'pgtap-bf-both'$$,
  '42501', NULL,
  'the backfill log cannot be deleted from');

SELECT throws_ok(
  $$TRUNCATE public.portal_access_backfill_log$$,
  '42501', NULL,
  'the backfill log cannot be truncated');

-- ---------------------------------------------------------------------------
-- 6. Who reads the log and who runs the backfill
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM public.portal_access_backfill_log WHERE patient_id LIKE 'pgtap-bf-%'),
  4,
  'an auditor (audit_access) reads the log');

SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is_empty(
  $$SELECT 1 FROM public.portal_access_backfill_log$$,
  'a nurse (no audit_access) sees no log rows');

SELECT throws_ok(
  $$SELECT public.app_portal_access_backfill()$$,
  '42501', NULL,
  'a signed-in user cannot run the backfill');

SELECT throws_ok(
  $$INSERT INTO public.portal_access_backfill_log (patient_id, auth_uid, verified_by, migration)
    VALUES ('pgtap-bf-unverified', '6666aaaa-0000-4000-8000-000000000002', ARRAY['auth_email_confirmed'], 'forged')$$,
  '42501', NULL,
  'a signed-in user cannot write the log');

SET LOCAL request.jwt.claims = '{"sub":"6666aaaa-0000-4000-8000-000000000012","role":"authenticated"}';
SELECT is_empty(
  $$SELECT 1 FROM public.portal_access_backfill_log$$,
  'a portal patient sees no log rows, not even their own');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
