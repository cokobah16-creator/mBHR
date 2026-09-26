-- pgTAP: portal messages hardening
-- Migration under test: supabase/migrations/20260927100120_portal_messages_hardening.sql
-- Fixtures are created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures (migration owner; guards and RLS do not apply)
-- ---------------------------------------------------------------------------
SELECT set_config('mbhr.authoritative_write', 'on', true);

INSERT INTO public.app_users (id, full_name, role) VALUES
  ('7777bbbb-0000-4000-8000-000000000011', 'pgTAP doctor one', 'doctor'),
  ('7777bbbb-0000-4000-8000-000000000012', 'pgTAP doctor two', 'doctor'),
  ('7777bbbb-0000-4000-8000-000000000013', 'pgTAP nurse',      'nurse');

INSERT INTO public.patients (id, given_name, family_name, phone, dob) VALUES
  ('pgtap-msg-p1',  'Ada',   'Message', '08077711101', '1985-03-03'),
  ('pgtap-msg-p2',  'Bola',  'Other',   '08077711102', '1986-04-04'),
  ('pgtap-msg-old', 'Ada',   'Old',     '08077711103', '1985-03-03');

UPDATE public.patients
   SET portal_enabled = true, portal_enabled_changed_at = now(),
       auth_uid = '7777bbbb-0000-4000-8000-000000000001'
 WHERE id = 'pgtap-msg-p1';
UPDATE public.patients SET merged_into = 'pgtap-msg-p1' WHERE id = 'pgtap-msg-old';

INSERT INTO public.patient_secure_messages
  (id, patient_id, staff_id, subject, body, from_patient, from_name, read, is_archived) VALUES
  -- c1: doctor one writes to the patient
  ('7777bbbb-0000-4000-8000-0000000000c1', 'pgtap-msg-p1', '7777bbbb-0000-4000-8000-000000000011',
   'Results', 'Please book a review.', false, 'pgTAP doctor one', false, false),
  -- c2: doctor two writes to someone else
  ('7777bbbb-0000-4000-8000-0000000000c2', 'pgtap-msg-p2', '7777bbbb-0000-4000-8000-000000000012',
   'Hello', 'Other patient.', false, 'pgTAP doctor two', false, false),
  -- m1: the patient's own earlier message
  ('7777bbbb-0000-4000-8000-0000000000a1', 'pgtap-msg-p1', NULL,
   'Question', 'When is my visit?', true, 'Ada Message', false, false);

-- ---------------------------------------------------------------------------
-- 1. Patient updates: only read, false to true, on a clinic message
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777bbbb-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$UPDATE public.patient_secure_messages SET is_archived = true
     WHERE id = '7777bbbb-0000-4000-8000-0000000000c1'$$,
  '42501', NULL, 'a patient cannot archive a clinic message');

SELECT throws_ok(
  $$UPDATE public.patient_secure_messages SET is_archived = true
     WHERE id = '7777bbbb-0000-4000-8000-0000000000a1'$$,
  '42501', NULL, 'a patient cannot archive their own message');

SELECT throws_ok(
  $$UPDATE public.patient_secure_messages SET read = true
     WHERE id = '7777bbbb-0000-4000-8000-0000000000a1'$$,
  '42501', NULL, 'a patient cannot mark their own message read');

SELECT throws_ok(
  $$UPDATE public.patient_secure_messages SET from_patient = false
     WHERE id = '7777bbbb-0000-4000-8000-0000000000a1'$$,
  '42501', NULL, 'a patient cannot turn their message into a clinic message');

SELECT lives_ok(
  $$UPDATE public.patient_secure_messages SET read = true
     WHERE id = '7777bbbb-0000-4000-8000-0000000000c1'$$,
  'a patient marks a clinic message read');

SELECT is(
  (SELECT read FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000c1'),
  true, 'the clinic message is now read');

SELECT lives_ok(
  $$UPDATE public.patient_secure_messages SET read = true
     WHERE id = '7777bbbb-0000-4000-8000-0000000000c1'$$,
  'marking an already-read clinic message read again is not an error');

SELECT throws_ok(
  $$UPDATE public.patient_secure_messages SET read = false
     WHERE id = '7777bbbb-0000-4000-8000-0000000000c1'$$,
  '42501', NULL, 'a patient cannot mark a clinic message unread');

UPDATE public.patient_secure_messages SET updated_at = '2099-01-01'
 WHERE id = '7777bbbb-0000-4000-8000-0000000000c1';
SELECT ok(
  (SELECT updated_at < '2099-01-01' FROM public.patient_secure_messages
    WHERE id = '7777bbbb-0000-4000-8000-0000000000c1'),
  'an updated_at-only update from a patient writes nothing');

SELECT throws_ok(
  $$INSERT INTO public.patient_secure_messages (id, patient_id, subject, body, from_patient, from_name)
    VALUES ('7777bbbb-0000-4000-8000-0000000000c1', 'pgtap-msg-p1', 's', 'b', true, 'x')
    ON CONFLICT (id) DO UPDATE SET is_archived = true$$,
  '42501', NULL, 'an upsert cannot archive a clinic message either');

-- ---------------------------------------------------------------------------
-- 2. Patient inserts: the server sets the sender fields
-- ---------------------------------------------------------------------------
INSERT INTO public.patient_secure_messages
  (id, patient_id, staff_id, subject, body, from_patient, from_name, read, is_archived, created_at, updated_at)
VALUES
  ('7777bbbb-0000-4000-8000-0000000000a2', 'pgtap-msg-p1', 'not-a-staff-id',
   'Hi', 'Forged fields', true, 'Dr Somebody', true, true, '2099-01-01', '2099-01-01');

RESET ROLE;
SELECT is(
  (SELECT from_name FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a2'),
  'Ada Message', 'from_name comes from the patient record');
SELECT is(
  (SELECT staff_id FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a2'),
  NULL, 'a staff id with no message to this patient is cleared');
SELECT is(
  (SELECT read FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a2'),
  false, 'a new patient message starts unread');
SELECT is(
  (SELECT is_archived FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a2'),
  false, 'a new patient message starts not archived');
SELECT ok(
  (SELECT created_at < '2099-01-01' AND updated_at < '2099-01-01'
     FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a2'),
  'the server sets both timestamps');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777bbbb-0000-4000-8000-000000000001","role":"authenticated"}';

INSERT INTO public.patient_secure_messages (id, patient_id, staff_id, subject, body, from_patient, from_name)
VALUES
  ('7777bbbb-0000-4000-8000-0000000000a3', 'pgtap-msg-p1', '7777bbbb-0000-4000-8000-000000000011',
   'Re: Results', 'Booked.', true, 'Ada Message'),
  ('7777bbbb-0000-4000-8000-0000000000a4', 'pgtap-msg-p1', '7777bbbb-0000-4000-8000-000000000012',
   'Re: Hello', 'Wrong doctor.', true, 'Ada Message');

-- A reply sent on a merged-away record id lands on the kept record with its name.
INSERT INTO public.patient_secure_messages (id, patient_id, staff_id, subject, body, from_patient, from_name)
VALUES
  ('7777bbbb-0000-4000-8000-0000000000a5', 'pgtap-msg-old', '7777bbbb-0000-4000-8000-000000000011',
   'Re: Results', 'From an old session.', true, 'Patient');

SELECT throws_ok(
  $$INSERT INTO public.patient_secure_messages (patient_id, subject, body, from_patient, from_name)
    VALUES ('pgtap-msg-p1', 'Clinic', 'Pretending to be the clinic', false, 'pgTAP doctor one')$$,
  '42501', NULL, 'a patient cannot send a message as the clinic');

SELECT throws_ok(
  $$INSERT INTO public.patient_secure_messages (patient_id, subject, body, from_patient, from_name)
    VALUES ('pgtap-msg-p2', 'Hi', 'Someone else', true, 'Ada Message')$$,
  '42501', NULL, 'a patient cannot write on another patient''s record');

RESET ROLE;
SELECT is(
  (SELECT staff_id FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a3'),
  '7777bbbb-0000-4000-8000-000000000011', 'a reply keeps the staff member who wrote to this patient');
SELECT is(
  (SELECT staff_id FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a4'),
  NULL, 'a staff member who wrote only to another patient is cleared');
SELECT is(
  (SELECT patient_id || ' / ' || from_name || ' / ' || COALESCE(staff_id, 'none')
     FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a5'),
  'pgtap-msg-p1 / Ada Message / 7777bbbb-0000-4000-8000-000000000011',
  'a message on a merged-away id is stamped for the kept record');

-- ---------------------------------------------------------------------------
-- 3. Staff with consult are unaffected; staff without it cannot send
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777bbbb-0000-4000-8000-000000000011","role":"authenticated"}';

SELECT lives_ok(
  $$UPDATE public.patient_secure_messages SET read = true, is_archived = true
     WHERE id = '7777bbbb-0000-4000-8000-0000000000a1'$$,
  'a doctor marks a patient message read and archives it');
SELECT lives_ok(
  $$UPDATE public.patient_secure_messages SET read = false
     WHERE id = '7777bbbb-0000-4000-8000-0000000000c1'$$,
  'a doctor can mark a message unread');
SELECT lives_ok(
  $$INSERT INTO public.patient_secure_messages (id, patient_id, staff_id, subject, body, from_patient, from_name)
    VALUES ('7777bbbb-0000-4000-8000-0000000000c3', 'pgtap-msg-p1', '7777bbbb-0000-4000-8000-000000000011',
            'Follow-up', 'See you soon.', false, 'pgTAP doctor one')$$,
  'a doctor sends a clinic message');

RESET ROLE;
SELECT is(
  (SELECT read::text || ' / ' || is_archived::text FROM public.patient_secure_messages
    WHERE id = '7777bbbb-0000-4000-8000-0000000000a1'),
  'true / true', 'the doctor''s read and archive changes are stored');
SELECT is(
  (SELECT from_name || ' / ' || staff_id FROM public.patient_secure_messages
    WHERE id = '7777bbbb-0000-4000-8000-0000000000c3'),
  'pgTAP doctor one / 7777bbbb-0000-4000-8000-000000000011',
  'a doctor''s message keeps the name and staff id it was sent with');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"7777bbbb-0000-4000-8000-000000000013","role":"authenticated"}';
SELECT throws_ok(
  $$INSERT INTO public.patient_secure_messages (patient_id, staff_id, subject, body, from_patient, from_name)
    VALUES ('pgtap-msg-p1', '7777bbbb-0000-4000-8000-000000000013', 'Hi', 'Nurse note', false, 'pgTAP nurse')$$,
  '42501', NULL, 'a nurse without consult cannot send a clinic message');

-- ---------------------------------------------------------------------------
-- 4. The service role is unaffected
-- ---------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$UPDATE public.patient_secure_messages SET is_archived = false
     WHERE id = '7777bbbb-0000-4000-8000-0000000000a1'$$,
  'the service role can still change the archive flag');

RESET ROLE;
SELECT is(
  (SELECT is_archived FROM public.patient_secure_messages WHERE id = '7777bbbb-0000-4000-8000-0000000000a1'),
  false, 'the service role''s change is stored');

SELECT * FROM finish();
ROLLBACK;
