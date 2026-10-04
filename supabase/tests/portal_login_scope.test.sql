-- pgTAP: portal logins see only their own login; sessions and files follow access
-- Migration under test: supabase/migrations/20260927100190_portal_login_scope.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(56);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('99990000-0000-4000-8000-0000000000e1', 'pgTAP volunteer', 'volunteer'),
  ('99990000-0000-4000-8000-0000000000e2', 'pgTAP admin', 'admin');

-- Patient P1 has two logins (two carers, c1 and c2); P2 is another patient.
INSERT INTO public.patients (id, given_name, family_name, phone, dob) VALUES
  ('pgtap-scope-p1', 'Ada', 'Carers', '08000000091', '1980-01-01'),
  ('pgtap-scope-p2', 'Bola', 'Other', '08000000092', '1981-01-01'),
  ('pgtap-scope-child', 'Chidi', 'Young', '08000000093', (current_date - interval '10 years')::date),
  ('pgtap-scope-adult', 'Dayo', 'Grown', '08000000094', (current_date - interval '30 years')::date),
  ('pgtap-scope-nodob', 'Efe', 'Unknown', '08000000095', NULL);
UPDATE public.patients SET portal_enabled = true WHERE id IN ('pgtap-scope-p1', 'pgtap-scope-p2');
INSERT INTO public.patient_portal_users (id, patient_id, account_status, otp_secret, email) VALUES
  ('99990000-0000-4000-8000-0000000000c1', 'pgtap-scope-p1', 'active', '111111', 'pgtap-scope-c1@example.test'),
  ('99990000-0000-4000-8000-0000000000c2', 'pgtap-scope-p1', 'active', '222222', 'pgtap-scope-c2@example.test'),
  ('99990000-0000-4000-8000-0000000000c3', 'pgtap-scope-p2', 'suspended', '333333', 'pgtap-scope-c3@example.test');
INSERT INTO public.patient_portal_sessions (id, portal_user_id, session_token, expires_at, is_active) VALUES
  ('pgtap-scope-s1', '99990000-0000-4000-8000-0000000000c1', 'pgtap-scope-token-c1-aaaaaaaa', now() + interval '2 hours', true),
  ('pgtap-scope-s2', '99990000-0000-4000-8000-0000000000c2', 'pgtap-scope-token-c2-bbbbbbbb', now() + interval '2 hours', true),
  ('pgtap-scope-s3', '99990000-0000-4000-8000-0000000000c3', 'pgtap-scope-token-c3-cccccccc', now() + interval '2 hours', true);
-- P4 signs in by its own link (auth_uid), and the same login's portal
-- account for P4 is suspended. Login c5 opens P5 by its sign-in link only:
-- its portal account is for P6, whose access is off.
INSERT INTO public.patients (id, given_name, family_name, phone, dob, auth_uid, portal_enabled) VALUES
  ('pgtap-scope-p4', 'Jide', 'Linked', '08000000088', '1983-01-01', '99990000-0000-4000-8000-0000000000c4', true),
  ('pgtap-scope-p5', 'Kunle', 'Linked', '08000000089', '1984-01-01', '99990000-0000-4000-8000-0000000000c5', true),
  ('pgtap-scope-p6', 'Lola', 'Off', '08000000087', '1985-01-01', NULL, false);
INSERT INTO public.patient_portal_users (id, patient_id, account_status, otp_secret, email) VALUES
  ('99990000-0000-4000-8000-0000000000c4', 'pgtap-scope-p4', 'suspended', '444444', 'pgtap-scope-c4@example.test'),
  ('99990000-0000-4000-8000-0000000000c5', 'pgtap-scope-p6', 'active', '555555', 'pgtap-scope-c5@example.test');
INSERT INTO public.patient_portal_sessions (id, portal_user_id, session_token, expires_at, is_active) VALUES
  ('pgtap-scope-s4', '99990000-0000-4000-8000-0000000000c4', 'pgtap-scope-token-c4-dddddddd', now() + interval '2 hours', true),
  ('pgtap-scope-s5', '99990000-0000-4000-8000-0000000000c5', 'pgtap-scope-token-c5-eeeeeeee', now() + interval '2 hours', true);
-- A record merged into P1 (its documents moved with it).
INSERT INTO public.patients (id, given_name, family_name, phone, dob, merged_into) VALUES
  ('pgtap-scope-p1-old', 'Ada', 'Carers', '08000000098', '1980-01-01', 'pgtap-scope-p1');
INSERT INTO public.patient_documents (id, patient_id, document_type, document_name, file_path) VALUES
  ('9999d0c0-0000-4000-8000-000000000001', 'pgtap-scope-p1', 'other', 'Kept.pdf', 'pgtap-scope-p1/kept.pdf'),
  ('9999d0c0-0000-4000-8000-000000000002', 'pgtap-scope-p2', 'other', 'Moved.pdf', 'pgtap-scope-p1/moved.pdf'),
  ('9999d0c0-0000-4000-8000-000000000003', 'pgtap-scope-p2', 'other', 'Odd.pdf', '/patient-documents//pgtap-scope-p1/odd.pdf'),
  ('9999d0c0-0000-4000-8000-000000000004', 'pgtap-scope-p1', 'other', 'Old.pdf', 'pgtap-scope-p1-old/old.pdf');
-- A merged-in record whose files stay in its folder, deleted after the
-- merge; and a file misfiled in P1's folder for P3, whose record is then
-- deleted (its document goes with it).
INSERT INTO public.patients (id, given_name, family_name, phone, dob, merged_into) VALUES
  ('pgtap-scope-p1-dup', 'Ada', 'Carers', '08000000099', '1980-01-01', 'pgtap-scope-p1');
INSERT INTO public.patients (id, given_name, family_name, phone, dob) VALUES
  ('pgtap-scope-p3', 'Ife', 'Third', '08000000090', '1982-01-01');
INSERT INTO public.patient_documents (id, patient_id, document_type, document_name, file_path) VALUES
  ('9999d0c0-0000-4000-8000-000000000005', 'pgtap-scope-p1', 'other', 'Scan.pdf', 'pgtap-scope-p1-dup/scan.pdf'),
  ('9999d0c0-0000-4000-8000-000000000006', 'pgtap-scope-p3', 'other', 'Misfiled.pdf', 'pgtap-scope-p1/misfiled.pdf'),
  ('9999d0c0-0000-4000-8000-000000000007', 'pgtap-scope-p2', 'other', 'Url.pdf',
   'https://example.supabase.co/storage/v1/object/sign/patient-documents/pgtap-scope-p1/url.pdf?token=abc'),
  ('9999d0c0-0000-4000-8000-000000000008', 'pgtap-scope-p2', 'other', 'Slashes.pdf', E'\u00a0Patient-Documents\\.\\pgtap-scope-p1\\bs.pdf\\ ');
DELETE FROM public.patients WHERE id IN ('pgtap-scope-p1-dup', 'pgtap-scope-p3');
INSERT INTO public.patient_portal_preferences (portal_user_id) VALUES
  ('99990000-0000-4000-8000-0000000000c1'), ('99990000-0000-4000-8000-0000000000c2');
INSERT INTO public.patient_portal_access_logs (portal_user_id, patient_id, action_type, resource_type, ip_address) VALUES
  ('99990000-0000-4000-8000-0000000000c2', 'pgtap-scope-p1', 'view', 'record', '10.0.0.2');

-- ---------------------------------------------------------------------------
-- 1. Own login and own sessions only
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000c1","role":"authenticated"}';
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.patient_portal_users WHERE patient_id = 'pgtap-scope-p1'),
  ARRAY['99990000-0000-4000-8000-0000000000c1'],
  'a portal login reads only its own login, not the other carer''s');
SELECT is((SELECT count(*) FROM public.patient_portal_sessions), 1::bigint,
  'a portal login reads only its own sessions');
UPDATE public.patient_portal_sessions SET expires_at = now() + interval '365 days' WHERE id = 'pgtap-scope-s2';
DELETE FROM public.patient_portal_sessions WHERE id = 'pgtap-scope-s2';
SELECT throws_ok(
  $$INSERT INTO public.patient_portal_sessions (id, portal_user_id, session_token, expires_at, is_active)
    VALUES ('pgtap-scope-s9', '99990000-0000-4000-8000-0000000000c2', 'pgtap-scope-token-x-dddddddd', now() + interval '1 hour', true)$$,
  '42501', NULL,
  'a portal login cannot add a session for another login');
SELECT throws_ok(
  $$INSERT INTO public.patient_portal_sessions (id, portal_user_id, session_token, expires_at, is_active)
    VALUES ('pgtap-scope-s8', '99990000-0000-4000-8000-0000000000c1', 'pgtap-scope-token-y-eeeeeeee', '2099-01-01', true)$$,
  '42501', NULL,
  'nor a session of its own');
UPDATE public.patient_portal_sessions SET expires_at = '2099-01-01' WHERE id = 'pgtap-scope-s1';

-- Access logs and preferences: the login's own rows only.
SELECT is((SELECT count(*) FROM public.patient_portal_access_logs), 0::bigint,
  'a portal login does not read another login''s access log');
UPDATE public.patient_portal_preferences SET sms_reminders = false
 WHERE portal_user_id = '99990000-0000-4000-8000-0000000000c2';
DELETE FROM public.patient_portal_preferences WHERE portal_user_id = '99990000-0000-4000-8000-0000000000c2';
SELECT lives_ok(
  $$UPDATE public.patient_portal_preferences SET sms_reminders = false
     WHERE portal_user_id = '99990000-0000-4000-8000-0000000000c1'$$,
  'a portal login still changes its own preferences');
SELECT throws_ok(
  $$INSERT INTO public.patient_portal_access_logs (portal_user_id, patient_id, action_type, resource_type)
    VALUES ('99990000-0000-4000-8000-0000000000c2', 'pgtap-scope-p1', 'forged', 'record')$$,
  '42501', NULL,
  'a portal login cannot write another login''s access log');
SELECT throws_ok(
  $$INSERT INTO public.patient_portal_access_logs (portal_user_id, patient_id, action_type, resource_type)
    VALUES ('99990000-0000-4000-8000-0000000000c1', 'pgtap-scope-p2', 'view', 'record')$$,
  '42501', NULL,
  'nor log an access to another patient''s record');
SELECT lives_ok(
  $$INSERT INTO public.patient_portal_access_logs (portal_user_id, patient_id, action_type, resource_type)
    VALUES ('99990000-0000-4000-8000-0000000000c1', 'pgtap-scope-p1', 'view', 'record')$$,
  'a portal login still logs its own access');
SELECT throws_ok(
  $$SELECT public.app_portal_user_ids()$$,
  '42501', NULL,
  'a signed-in account cannot list the other logins of its records');

SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000e1","role":"authenticated"}';
SELECT is((SELECT count(*) FROM public.patient_portal_users WHERE patient_id = 'pgtap-scope-p1'), 2::bigint,
  'staff still read every login');
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000e2","role":"authenticated"}';
SELECT is((SELECT count(*) FROM public.patient_portal_sessions WHERE id LIKE 'pgtap-scope-s%'), 5::bigint,
  'holders of ''users'' still read every session');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is((SELECT (expires_at < now() + interval '3 hours')::text || ',' || is_active::text
             FROM public.patient_portal_sessions WHERE id = 'pgtap-scope-s2'),
  'true,true',
  'the other carer''s session was neither extended nor ended');
SELECT is((SELECT expires_at < now() + interval '3 hours' FROM public.patient_portal_sessions WHERE id = 'pgtap-scope-s1'),
  true,
  'a portal login cannot set its own session''s expiry');
SELECT is((SELECT array_agg(sms_reminders ORDER BY portal_user_id) FROM public.patient_portal_preferences),
  ARRAY[false, true],
  'only its own preferences changed; the other carer''s are untouched');

-- ---------------------------------------------------------------------------
-- 2. A session lives only while its login has portal access
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.portal_session_check('pgtap-scope-token-c1-aaaaaaaa', now() + interval '1 hour')),
  1::bigint,
  'an active login''s session is checked and extended');
SELECT is((SELECT count(*) FROM public.portal_session_check('pgtap-scope-token-c3-cccccccc', now() + interval '1 hour')),
  0::bigint,
  'a suspended login''s session is not kept alive');
RESET ROLE;
SELECT is((SELECT is_active FROM public.patient_portal_sessions WHERE id = 'pgtap-scope-s3'), false,
  'the suspended login''s session is ended');
UPDATE public.patients SET portal_enabled = false WHERE id = 'pgtap-scope-p1';
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.portal_session_check('pgtap-scope-token-c2-bbbbbbbb', NULL)),
  0::bigint,
  'a session ends when the patient''s portal access is switched off');
RESET ROLE;
SELECT is((SELECT is_active FROM public.patient_portal_sessions WHERE id = 'pgtap-scope-s2'), false,
  'and that session is ended');
UPDATE public.patients SET portal_enabled = true WHERE id = 'pgtap-scope-p1';

-- A record's own sign-in link gives no access to a login whose portal
-- account for that record is suspended.
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.portal_session_check('pgtap-scope-token-c4-dddddddd', NULL)),
  0::bigint,
  'a suspended login''s session is not kept alive by the record''s sign-in link');
SELECT is((SELECT count(*) FROM public.portal_session_check('pgtap-scope-token-c5-eeeeeeee', NULL)),
  1::bigint,
  'a session of a login that opens a record only by its sign-in link is kept');
RESET ROLE;
SELECT is((SELECT is_active FROM public.patient_portal_sessions WHERE id = 'pgtap-scope-s4'), false,
  'the suspended login''s session is ended');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000c4","role":"authenticated"}';
SELECT is((SELECT count(*) FROM public.app_portal_patient_ids()), 0::bigint,
  'the suspended login opens no record through the sign-in link');
SELECT is((SELECT array_agg(portal_enabled) FROM public.portal_access_status()), ARRAY[false],
  'and the portal is told access is off');
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000c5","role":"authenticated"}';
SELECT is((SELECT array_agg(id) FROM public.app_portal_patient_ids() AS id), ARRAY['pgtap-scope-p5'],
  'a login with only the sign-in link still opens its record');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';

-- ---------------------------------------------------------------------------
-- 3. A stored file follows the document that names it
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000c1","role":"authenticated"}';
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1/kept.pdf'), true,
  'a patient opens their own document''s file');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1/moved.pdf'), false,
  'a file whose document was moved to another patient is no longer theirs');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1/new-upload.pdf', '99990000-0000-4000-8000-0000000000c1'), true,
  'a file they uploaded to their folder, with no document yet, stays visible');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1/new-upload.pdf'), false,
  'a file no document names does not open when its uploader is not known');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1/misfiled.pdf', '99990000-0000-4000-8000-0000000000e1'), false,
  'a file staff put in their folder for a patient since deleted does not open');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1-dup/scan.pdf'), true,
  'a merged-in record''s file opens after that record is deleted');
SELECT is(
  (SELECT array_agg(public.app_patient_document_file_visible_to_patient(n) ORDER BY n)
     FROM unnest(ARRAY['pgtap-scope-p1/bs.pdf', 'pgtap-scope-p1/url.pdf']) AS n),
  ARRAY[false, false],
  'a document naming the file by a storage URL, backslashes or ./ still counts');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p2/moved.pdf'), false,
  'another patient''s folder stays closed');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1/odd.pdf'), false,
  'a document naming the file with the bucket name and doubled slashes still counts');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p1-old/old.pdf'), true,
  'a file in the folder of a record merged into theirs opens');
SELECT is(public.app_patient_document_file_visible_to_patient('pgtap-scope-p2/other.pdf'), false,
  'a folder of a record not merged into theirs stays closed');

-- ---------------------------------------------------------------------------
-- 4. No portal access for a child's record
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000e1","role":"authenticated"}';
SELECT is(
  public.set_patient_portal_access('9999c0de-0000-4000-8000-000000000001', 'pgtap-scope-child', true,
    NULL, now(), '99990000-0000-4000-8000-0000000000e1', 'staff') ->> 'reason',
  'minor',
  'portal access is not turned on for a child''s record');
SELECT is(
  public.set_patient_portal_access('9999c0de-0000-4000-8000-000000000002', 'pgtap-scope-child', true,
    NULL, now(), '99990000-0000-4000-8000-0000000000e1', 'auto_enrollment') ->> 'reason',
  'minor',
  'nor by automatic enrolment');
SELECT is(
  public.set_patient_portal_access('9999c0de-0000-4000-8000-000000000003', 'pgtap-scope-adult', true,
    NULL, now(), '99990000-0000-4000-8000-0000000000e1', 'staff') ->> 'outcome',
  'applied',
  'an adult''s record is turned on');
SELECT is(
  public.set_patient_portal_access('9999c0de-0000-4000-8000-000000000004', 'pgtap-scope-nodob', true,
    NULL, now(), '99990000-0000-4000-8000-0000000000e1', 'staff') ->> 'outcome',
  'applied',
  'a record with no date of birth is not refused');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
UPDATE public.patients SET portal_enabled = true WHERE id = 'pgtap-scope-child';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000e1","role":"authenticated"}';
SELECT is(
  public.set_patient_portal_access('9999c0de-0000-4000-8000-000000000006', 'pgtap-scope-child', true,
    NULL, now(), '99990000-0000-4000-8000-0000000000e1', 'staff') ->> 'reason',
  'minor',
  'an enable request for a child''s record whose flag is already on is answered ''minor''');
SELECT is(
  public.set_patient_portal_access('9999c0de-0000-4000-8000-000000000005', 'pgtap-scope-child', false,
    'staff_choice', now(), '99990000-0000-4000-8000-0000000000e1', 'staff') ->> 'outcome',
  'applied',
  'a child''s record that already had access can still be turned off');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is((SELECT portal_enabled FROM public.patients WHERE id = 'pgtap-scope-child'), false,
  'and it is off');

-- A record with access whose date of birth becomes a child's gives no access.
UPDATE public.patients SET dob = (current_date - interval '10 years')::date WHERE id = 'pgtap-scope-p1';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000c1","role":"authenticated"}';
SELECT is((SELECT count(*) FROM public.app_portal_patient_ids()), 0::bigint,
  'a child''s record gives no portal access, whatever its stored flag');
SELECT is((SELECT portal_enabled FROM public.portal_access_status() WHERE patient_id = 'pgtap-scope-p1'), false,
  'and the portal is told access is off');
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.portal_session_check('pgtap-scope-token-c1-aaaaaaaa', NULL)), 0::bigint,
  'and its session ends');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';

-- Automatic enrolment on insert skips a child's record.
UPDATE public.portal_enrollment_settings SET setting_value = 'true'::jsonb WHERE setting_key = 'auto_enrollment_enabled';
UPDATE public.portal_enrollment_settings SET setting_value = 'false'::jsonb WHERE setting_key = 'require_email';
INSERT INTO public.patients (id, given_name, family_name, phone, dob) VALUES
  ('pgtap-scope-child2', 'Femi', 'Young', '08000000096', (current_date - interval '5 years')::date),
  ('pgtap-scope-adult2', 'Gbemi', 'Grown', '08000000097', (current_date - interval '40 years')::date);
SELECT is((SELECT array_agg(id || '=' || COALESCE(portal_enabled, false)::text ORDER BY id) FROM public.patients
            WHERE id IN ('pgtap-scope-child2', 'pgtap-scope-adult2')),
  ARRAY['pgtap-scope-adult2=true', 'pgtap-scope-child2=false'],
  'automatic enrolment on insert enrols an adult''s record but not a child''s');

-- ---------------------------------------------------------------------------
-- 5. The date in Nigeria; invitations; own submissions; access log time
-- ---------------------------------------------------------------------------
UPDATE public.patients SET dob = '1980-01-01' WHERE id = 'pgtap-scope-p1';
SELECT is(
  public.app_storage_object_key(E'\u00a0Patient-Documents\\.\\pgtap-scope-p1\\bs.pdf\\ ')
    || ',' || public.app_storage_object_key('https://example.supabase.co/storage/v1/object/public/patient-documents/a/b.pdf?x=1')
    || ',' || public.app_storage_object_key('patient-documents/patient-documents/./a//b.pdf/'),
  'pgtap-scope-p1/bs.pdf,a/b.pdf,a/b.pdf',
  'app_storage_object_key reads the ways a file path is written');
SET LOCAL TIME ZONE 'Pacific/Kiritimati';
SELECT is(
  ARRAY[public.app_patient_is_minor(((now() AT TIME ZONE 'Africa/Lagos')::date - interval '18 years' + interval '1 day')::date),
        public.app_patient_is_minor(((now() AT TIME ZONE 'Africa/Lagos')::date - interval '18 years')::date)],
  ARRAY[true, false],
  'under 18 goes by the date in Nigeria, not the session''s time zone (UTC+14)');
SET LOCAL TIME ZONE 'Pacific/Pago_Pago';
SELECT is(
  ARRAY[public.app_patient_is_minor(((now() AT TIME ZONE 'Africa/Lagos')::date - interval '18 years' + interval '1 day')::date),
        public.app_patient_is_minor(((now() AT TIME ZONE 'Africa/Lagos')::date - interval '18 years')::date)],
  ARRAY[true, false],
  'and (UTC-11)');
RESET TIME ZONE;

UPDATE public.patients SET portal_enabled = true WHERE id = 'pgtap-scope-child';
SET LOCAL ROLE service_role;
SELECT is(
  public.portal_invitation_begin('99990000-0000-4000-8000-0000000000e2', 'pgtap-scope-child', 'sms') ->> 'reason',
  'portal_not_enabled',
  'no invitation is sent for a child''s record, whatever its stored flag');
RESET ROLE;

INSERT INTO public.patient_submitted_data (id, patient_id, portal_user_id, submission_type, data) VALUES
  ('pgtap-scope-sub-c2', 'pgtap-scope-p1', '99990000-0000-4000-8000-0000000000c2', 'symptoms', '{"by":"c2"}');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99990000-0000-4000-8000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$INSERT INTO public.patient_submitted_data (id, patient_id, portal_user_id, submission_type, data)
    VALUES ('pgtap-scope-sub-f', 'pgtap-scope-p1', '99990000-0000-4000-8000-0000000000c2', 'symptoms', '{}')$$,
  '42501', NULL,
  'a portal login cannot add a submission in another login''s name');
SELECT lives_ok(
  $$INSERT INTO public.patient_submitted_data (id, patient_id, portal_user_id, submission_type, data)
    VALUES ('pgtap-scope-sub-c1', 'pgtap-scope-p1', '99990000-0000-4000-8000-0000000000c1', 'symptoms', '{}')$$,
  'it still adds its own');
UPDATE public.patient_submitted_data SET data = '{"by":"c1"}', portal_user_id = '99990000-0000-4000-8000-0000000000c1'
 WHERE id = 'pgtap-scope-sub-c2';
INSERT INTO public.patient_portal_access_logs (portal_user_id, patient_id, action_type, resource_type, created_at)
VALUES ('99990000-0000-4000-8000-0000000000c1', 'pgtap-scope-p1', 'download', 'document', '2020-01-01');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is((SELECT (portal_user_id, data ->> 'by')::text FROM public.patient_submitted_data WHERE id = 'pgtap-scope-sub-c2'),
  '(99990000-0000-4000-8000-0000000000c2,c2)',
  'nor change another login''s submission');
SELECT is((SELECT created_at > now() - interval '1 minute' FROM public.patient_portal_access_logs
            WHERE portal_user_id = '99990000-0000-4000-8000-0000000000c1' AND action_type = 'download'),
  true,
  'an access log row gets the server''s time');

SELECT * FROM finish();
ROLLBACK;
