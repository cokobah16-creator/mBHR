-- pgTAP: portal record linking, attempt limit and whole-number phones
-- Migration under test: supabase/migrations/20260927100140_portal_link_attempt_limit.sql
-- Fixtures are created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(36);

-- ---------------------------------------------------------------------------
-- Fixtures (migration owner; guards and RLS do not apply)
-- ---------------------------------------------------------------------------
SELECT set_config('mbhr.authoritative_write', 'on', true);

INSERT INTO auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at) VALUES
  -- a US number whose last 10 digits equal record 1's Nigerian number
  ('7777cccc-0000-4000-8000-000000000001', NULL, '18077710001', NULL, now()),
  -- the owner of record 1's number
  ('7777cccc-0000-4000-8000-000000000002', NULL, '2348077710001', NULL, now()),
  -- guesses record 2's date of birth (by phone)
  ('7777cccc-0000-4000-8000-000000000003', NULL, '2348077710002', NULL, now()),
  -- record 3: one login by phone, one by email
  ('7777cccc-0000-4000-8000-000000000004', NULL, '2348077710003', NULL, now()),
  ('7777cccc-0000-4000-8000-000000000005', 'pgtap-pla-three@example.invalid', NULL, now(), NULL),
  -- the linked patient who copies record 4's phone onto their own record
  ('7777cccc-0000-4000-8000-000000000006', 'pgtap-pla-copier@example.invalid', NULL, now(), NULL),
  -- the owner of record 4's number
  ('7777cccc-0000-4000-8000-000000000007', NULL, '2348077710004', NULL, now()),
  -- record 5 (portal off) and record 6 (linked to someone else)
  ('7777cccc-0000-4000-8000-000000000008', NULL, '2348077710005', NULL, now()),
  ('7777cccc-0000-4000-8000-000000000009', NULL, '2348077710006', NULL, now()),
  -- a child's record's number
  ('7777cccc-0000-4000-8000-00000000000a', NULL, '2348077710007', NULL, now()),
  -- record 6's existing owner
  ('7777cccc-0000-4000-8000-00000000000b', 'pgtap-pla-six-owner@example.invalid', NULL, now(), NULL);

INSERT INTO public.patients (id, given_name, family_name, email, phone, dob) VALUES
  ('pgtap-pla-1',      'Ada',    'One',    NULL, '08077710001', '1980-01-01'),
  ('pgtap-pla-2',      'Bayo',   'Two',    NULL, '0807 771 0002', '1970-07-07'),
  ('pgtap-pla-3',      'Chidi',  'Three',  'pgtap-pla-three@example.invalid', '08077710003', '1965-03-03'),
  ('pgtap-pla-copier', 'Dayo',   'Copier', 'pgtap-pla-copier@example.invalid', '08077719999', '1990-01-01'),
  ('pgtap-pla-4',      'Efe',    'Four',   NULL, '+234 807 771 0004', '1985-05-05'),
  ('pgtap-pla-5',      'Funmi',  'Five',   NULL, '08077710005', '1960-06-06'),
  ('pgtap-pla-6',      'Gozie',  'Six',    NULL, '08077710006', '1955-05-05'),
  ('pgtap-pla-child',  'Hauwa',  'Child',  NULL, '08077710007', (current_date - interval '10 years')::date);

UPDATE public.patients
   SET portal_enabled = true, portal_enabled_changed_at = now()
 WHERE id IN ('pgtap-pla-1', 'pgtap-pla-2', 'pgtap-pla-3', 'pgtap-pla-copier',
              'pgtap-pla-4', 'pgtap-pla-6', 'pgtap-pla-child');
UPDATE public.patients SET auth_uid = '7777cccc-0000-4000-8000-000000000006' WHERE id = 'pgtap-pla-copier';
UPDATE public.patients SET auth_uid = '7777cccc-0000-4000-8000-00000000000b' WHERE id = 'pgtap-pla-6';

-- ---------------------------------------------------------------------------
-- 1. Phone numbers as E.164 digits
-- ---------------------------------------------------------------------------
SELECT is(public.app_phone_e164_digits('08031234567'), '2348031234567', 'local Nigerian number gets 234');
SELECT is(public.app_phone_e164_digits('+234 803 123 4567'), '2348031234567', 'formatted +234 number');
SELECT is(public.app_phone_e164_digits('+234 0803 123 4567'), '2348031234567', 'a trunk 0 after 234 is dropped');
SELECT is(public.app_phone_e164_digits('8031234567'), '2348031234567', 'bare 10 digits read as Nigerian, like the app');
SELECT is(public.app_phone_e164_digits('+1 803 123 4567'), '18031234567', 'a US number keeps its country code');
SELECT is(public.app_phone_e164_digits('00447911123456'), '447911123456', 'a 00 prefix is dropped');
SELECT is(public.app_phone_e164_digits(''), NULL, 'empty is NULL');
SELECT ok(NOT has_function_privilege('authenticated', 'public.app_phone_e164_digits(text)', 'EXECUTE'),
  'signed-in users cannot call the phone helper');
SELECT ok(NOT has_function_privilege('anon', 'public.portal_link_patient_record(date, text, text, text)', 'EXECUTE'),
  'anon cannot call portal_link_patient_record');

-- ---------------------------------------------------------------------------
-- 2. A phone matches on the whole number, not its last 10 digits
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is(public.portal_link_patient_record('1980-01-01') ->> 'status', 'no_clinic_record',
  '+1 807 771 0001 does not match the Nigerian 0807 771 0001');

SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT is(public.portal_link_patient_record('1980-01-01') ->> 'status', 'linked',
  'the owner of the Nigerian number links with the right date of birth');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. Five wrong dates of birth lock the login, even for the right date
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT is(public.portal_link_patient_record('1970-01-01') ->> 'status', 'needs_staff_verification',
  'a wrong date of birth is refused without saying why');
SELECT is(public.portal_link_patient_record('1970-01-02') ->> 'status', 'needs_staff_verification', 'wrong date 2');
SELECT is(public.portal_link_patient_record('1970-01-03') ->> 'status', 'needs_staff_verification', 'wrong date 3');
SELECT is(public.portal_link_patient_record('1970-01-04') ->> 'status', 'needs_staff_verification', 'wrong date 4');
SELECT is(public.portal_link_patient_record('1970-01-05') ->> 'status', 'needs_staff_verification', 'wrong date 5');
SELECT is(public.portal_link_patient_record('1970-07-07') ->> 'status', 'needs_staff_verification',
  'after five wrong dates the right one is refused too');
SELECT is_empty($$SELECT * FROM public.rate_limits$$,
  'a signed-in user cannot read the attempt counters');
RESET ROLE;

SELECT is((SELECT auth_uid FROM public.patients WHERE id = 'pgtap-pla-2'), NULL,
  'the guessed record was not linked');
SELECT is((SELECT count FROM public.rate_limits
            WHERE bucket = 'portal_link_uid' AND key = '7777cccc-0000-4000-8000-000000000003'), 5,
  'five wrong dates counted for the login (the locked call is not counted)');
SELECT is((SELECT count(*)::int FROM public.audit_logs
            WHERE action = 'portal_link_dob_mismatch'
              AND entity_id = '7777cccc-0000-4000-8000-000000000003'), 5,
  'each wrong date is in audit_logs under the login id');
SELECT is((SELECT count(*)::int FROM public.audit_logs
            WHERE action = 'portal_link_dob_mismatch' AND entity_id = 'pgtap-pla-2'), 0,
  'the audit rows do not name the record');

-- When the window has passed, the right date links.
UPDATE public.rate_limits SET window_start = now() - interval '25 hours'
 WHERE bucket IN ('portal_link_uid', 'portal_link_record')
   AND key IN ('7777cccc-0000-4000-8000-000000000003', 'pgtap-pla-2');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT is(public.portal_link_patient_record('1970-07-07') ->> 'status', 'linked',
  'after 24 hours the right date of birth links');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. Ten wrong dates on one record, from any logins, lock the record
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM generate_series('1965-01-01'::date, '1965-01-05', '1 day') AS d
             WHERE public.portal_link_patient_record(d::date) ->> 'status' = 'needs_staff_verification'), 5,
  'five wrong dates from the phone login');
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000005","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM generate_series('1965-02-01'::date, '1965-02-05', '1 day') AS d
             WHERE public.portal_link_patient_record(d::date) ->> 'status' = 'needs_staff_verification'), 5,
  'five wrong dates from the email login');
RESET ROLE;

SELECT is((SELECT count FROM public.rate_limits WHERE bucket = 'portal_link_record' AND key = 'pgtap-pla-3'), 10,
  'the record counted wrong dates from both logins');
-- Clear the email login's own counter: the record's counter alone still refuses.
DELETE FROM public.rate_limits WHERE bucket = 'portal_link_uid' AND key = '7777cccc-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000005","role":"authenticated"}';
SELECT is(public.portal_link_patient_record('1965-03-03') ->> 'status', 'needs_staff_verification',
  'a locked record refuses the right date of birth from a login with no failures');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. A copied phone number no longer blocks the real owner
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000006","role":"authenticated"}';
UPDATE public.patients SET phone = '08077710004' WHERE id = 'pgtap-pla-copier';
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000007","role":"authenticated"}';
SELECT is(public.portal_link_patient_record('1985-05-05') ->> 'status', 'linked',
  'the owner links although a linked patient copied their number');
RESET ROLE;
SELECT is((SELECT phone FROM public.patients WHERE id = 'pgtap-pla-copier'), '08077710004',
  'the copy was made (the portal lets patients edit their phone)');

-- ---------------------------------------------------------------------------
-- 6. No record state is told without the right date of birth
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000008","role":"authenticated"}';
SELECT is(public.portal_link_patient_record(NULL) ->> 'status', 'needs_staff_verification',
  'no date of birth: portal access being off is not told');
SELECT is(public.portal_link_patient_record('1960-01-01') ->> 'status', 'needs_staff_verification',
  'wrong date of birth: portal access being off is not told');
SELECT is(public.portal_link_patient_record('1960-06-06') ->> 'status', 'portal_not_enabled',
  'right date of birth: told that portal access is off');

SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-000000000009","role":"authenticated"}';
SELECT is(public.portal_link_patient_record('1955-01-01') ->> 'status', 'needs_staff_verification',
  'wrong date of birth: a record linked elsewhere is not told');
SELECT is(public.portal_link_patient_record('1955-05-05') ->> 'status', 'linked_elsewhere',
  'right date of birth: told that the record is linked to another account');

-- ---------------------------------------------------------------------------
-- 7. A child's record is still never linked, and that is not a failure
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"7777cccc-0000-4000-8000-00000000000a","role":"authenticated"}';
SELECT is(public.portal_link_patient_record((current_date - interval '10 years')::date) ->> 'status',
  'needs_staff_verification', 'a child''s record is not linked');
RESET ROLE;
SELECT is((SELECT count FROM public.rate_limits
            WHERE bucket = 'portal_link_uid' AND key = '7777cccc-0000-4000-8000-00000000000a'), 0,
  'the right date on a child''s record is not counted as a wrong date');

SELECT * FROM finish();
ROLLBACK;
