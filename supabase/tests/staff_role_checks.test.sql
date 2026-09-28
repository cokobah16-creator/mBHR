-- pgTAP: staff role checks on prescriptions, merges and triage
-- Migration under test: supabase/migrations/20260927100150_staff_role_checks.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(53);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: guards and row-level security do not
-- apply to this role)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('55550000-0000-4000-8000-000000000001', 'pgTAP doctor', 'doctor'),
  ('55550000-0000-4000-8000-000000000002', 'pgTAP nurse', 'nurse'),
  ('55550000-0000-4000-8000-000000000003', 'pgTAP pharmacist', 'pharmacist'),
  ('55550000-0000-4000-8000-000000000004', 'pgTAP volunteer', 'volunteer'),
  ('55550000-0000-4000-8000-000000000005', 'pgTAP auditor', 'auditor'),
  ('55550000-0000-4000-8000-000000000006', 'pgTAP second doctor', 'doctor'),
  ('55550000-0000-4000-8000-0000000000ab', 'pgTAP third doctor', 'doctor');

INSERT INTO public.patients (id, given_name, family_name, phone, email, auth_uid) VALUES
  ('pgtap-src-rx',  'Obi',   'Roles', '08000000031', NULL, NULL),
  -- merges: A into B (plain), C into D (field choice), E into F (sign-in),
  -- G into H (portal on), I into J and K into L (nurse)
  ('pgtap-src-a',   'Ada',   'Roles', '08000000032', NULL, NULL),
  ('pgtap-src-b',   'Ada',   'Roles', '08000000033', NULL, NULL),
  ('pgtap-src-c',   'Bola',  'Roles', '08000000034', NULL, NULL),
  ('pgtap-src-d',   'Bola',  'Roles', '08000000035', NULL, NULL),
  ('pgtap-src-e',   'Chi',   'Roles', '08000000036', NULL, '55550000-0000-4000-8000-0000000000e1'),
  ('pgtap-src-f',   'Chi',   'Roles', '08000000037', NULL, NULL),
  ('pgtap-src-g',   'Dayo',  'Roles', '08000000038', NULL, NULL),
  ('pgtap-src-h',   'Dayo',  'Roles', '08000000039', NULL, NULL),
  ('pgtap-src-i',   'Efe',   'Roles', '08000000040', 'pgtap-src-i@example.invalid', NULL),
  ('pgtap-src-j',   'Efe',   'Roles', '08000000041', NULL, NULL),
  ('pgtap-src-k',   'Fola',  'Roles', '08000000042', NULL, '55550000-0000-4000-8000-0000000000e2'),
  ('pgtap-src-l',   'Fola',  'Roles', '08000000043', NULL, NULL),
  ('pgtap-src-q',   'Gbenga', 'Roles', '08000000044', NULL, NULL),
  -- M into N: M has a portal login row; P into O: O has a portal sign-in
  ('pgtap-src-m',   'Hauwa', 'Roles', '08000000045', NULL, NULL),
  ('pgtap-src-n',   'Hauwa', 'Roles', '08000000046', NULL, NULL),
  ('pgtap-src-o',   'Ike',   'Roles', '08000000047', NULL, '55550000-0000-4000-8000-0000000000e3'),
  ('pgtap-src-p',   'Ike',   'Roles', '08000000048', NULL, NULL),
  -- R into S (nurse): values as the device sends them
  ('pgtap-src-r',   'Jumoke', 'Roles', '08000000049', NULL, NULL),
  ('pgtap-src-s',   'Jumoke', 'Roles', '08000000050', NULL, NULL);
UPDATE public.patients SET address = ' 2 Road ', dob = '1990-01-02' WHERE id = 'pgtap-src-r';
INSERT INTO public.patient_portal_users (id, patient_id, email)
VALUES ('55550000-0000-4000-8000-0000000000e4', 'pgtap-src-m', 'pgtap-src-m@example.invalid');

SELECT set_config('mbhr.authoritative_write', 'on', true);
UPDATE public.patients SET portal_enabled = true WHERE id = 'pgtap-src-g';

-- An open prescription already on the server (as a doctor's upload would be).
INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, status)
VALUES ('pgtap-src-rx-open', '', 'pgtap-src-rx', '55550000-0000-4000-8000-000000000001',
        '[{"itemId":"pgtap-src-item","qty":1}]'::jsonb, 'open');

-- Queue rows, all urgent at consultation.
INSERT INTO public.queue (id, patient_id, stage, status, priority, position) VALUES
  ('pgtap-src-q1', 'pgtap-src-q', 'consult', 'waiting', 'urgent', 1),
  ('pgtap-src-q2', 'pgtap-src-q', 'consult', 'waiting', 'urgent', 2),
  ('pgtap-src-q3', 'pgtap-src-q', 'consult', 'waiting', 'urgent', 3),
  ('pgtap-src-q4', 'pgtap-src-q', 'consult', 'waiting', 'urgent', 4),
  ('pgtap-src-q5', 'pgtap-src-q', 'consult', 'waiting', 'urgent', 5),
  ('pgtap-src-q6', 'pgtap-src-q', 'consult', 'waiting', 'urgent', 6),
  ('pgtap-src-q7', 'pgtap-src-q', 'consult', 'waiting', 'urgent', 7);

-- A medicine and a lot of 100, received by the pharmacist.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT public.rx_register_item(
  '5555c0de-0000-4000-8000-000000000001', 'pgtap-src-item',
  '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","unit":"tablet","site_key":"pgtap-src-site"}'::jsonb,
  '55550000-0000-4000-8000-000000000003') ->> 'outcome' AS item;
SELECT public.rx_receive_stock(
  '5555c0de-0000-4000-8000-000000000002', 'pgtap-src-mv-1',
  jsonb_build_object('id', 'pgtap-src-lot', 'item_id', 'pgtap-src-item',
                     'lot_number', 'S1', 'expiry_date', (current_date + 365)::text),
  100, 'receipt', now(), '55550000-0000-4000-8000-000000000003') ->> 'outcome' AS lot;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1. Who may be named as a prescriber
-- ---------------------------------------------------------------------------
SELECT ok(public.app_staff_may_prescribe('55550000-0000-4000-8000-000000000001'), 'a doctor may prescribe');
SELECT ok(public.app_staff_may_prescribe('55550000-0000-4000-8000-000000000002'), 'a nurse may prescribe (as the app allows)');
SELECT ok(NOT public.app_staff_may_prescribe('55550000-0000-4000-8000-000000000003'), 'a pharmacist may not');
SELECT ok(NOT public.app_staff_may_prescribe('55550000-0000-4000-8000-000000000004'), 'a volunteer may not');
SELECT ok(NOT public.app_staff_may_prescribe('device-doctor'), 'a name that is not a staff id may not');
SELECT ok(NOT public.app_staff_may_prescribe('55550000-0000-4000-8000-0000000000ff'), 'an id with no staff account may not');
SELECT ok(NOT COALESCE(public.app_staff_may_prescribe(NULL), true), 'no prescriber may not');
SELECT ok(NOT has_function_privilege('authenticated', 'public.app_staff_may_prescribe(text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.app_staff_may_prescribe(text)', 'EXECUTE'),
  'signed-in users and anon cannot call the helper');

-- ---------------------------------------------------------------------------
-- 2. rx_dispense: a carried prescription must name a prescriber
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT is(
  public.rx_dispense(
    '5555c0de-0000-4000-8000-000000000011', 'pgtap-src-rx-1',
    '[{"item_id":"pgtap-src-item","qty":5}]'::jsonb, now(), false, false,
    '55550000-0000-4000-8000-000000000003',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'prescriber_id', 'made-up-doctor',
                       'lines', '[{"itemId":"pgtap-src-item","qty":5}]'::jsonb)) ->> 'reason',
  'prescriber_not_allowed',
  'a pharmacist cannot carry a prescription in a made-up name');
SELECT is(
  public.rx_dispense(
    '5555c0de-0000-4000-8000-000000000012', 'pgtap-src-rx-2',
    '[{"item_id":"pgtap-src-item","qty":5}]'::jsonb, now(), false, false,
    '55550000-0000-4000-8000-000000000003',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '',
                       'lines', '[{"itemId":"pgtap-src-item","qty":5}]'::jsonb)) ->> 'reason',
  'prescriber_not_allowed',
  'with no prescriber named, the pharmacist is not taken as the prescriber');
SELECT is(
  public.rx_dispense(
    '5555c0de-0000-4000-8000-000000000013', 'pgtap-src-rx-3',
    '[{"item_id":"pgtap-src-item","qty":5}]'::jsonb, now(), true, false,
    '55550000-0000-4000-8000-000000000003',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '',
                       'prescriber_id', '55550000-0000-4000-8000-000000000003',
                       'lines', '[{"itemId":"pgtap-src-item","qty":5}]'::jsonb)) ->> 'reason',
  'prescriber_not_allowed',
  'a pharmacist cannot name themselves as prescriber (offline hand-over too)');
SELECT is(
  public.rx_dispense(
    '5555c0de-0000-4000-8000-000000000014', 'pgtap-src-rx-4',
    '[{"item_id":"pgtap-src-item","qty":5}]'::jsonb, now(), false, false,
    '55550000-0000-4000-8000-000000000003',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '',
                       'prescriber_id', '55550000-0000-4000-8000-000000000001',
                       'lines', '[{"itemId":"pgtap-src-item","qty":5}]'::jsonb)) ->> 'outcome',
  'applied',
  'a prescription written by a doctor on the device is carried and dispensed');
SELECT is(
  public.rx_dispense(
    '5555c0de-0000-4000-8000-000000000015', 'pgtap-src-rx-5',
    '[{"item_id":"pgtap-src-item","qty":5}]'::jsonb, now(), false, false,
    '55550000-0000-4000-8000-000000000003',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '',
                       'prescriber_id', '55550000-0000-4000-8000-000000000002',
                       'lines', '[{"itemId":"pgtap-src-item","qty":5}]'::jsonb)) ->> 'outcome',
  'applied',
  'a nurse''s prescription is carried as before');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.prescriptions WHERE id IN ('pgtap-src-rx-1', 'pgtap-src-rx-2', 'pgtap-src-rx-3')), 0,
  'the refused prescriptions were not saved');
SELECT is((SELECT (prescriber_id, status)::text FROM public.prescriptions WHERE id = 'pgtap-src-rx-4'),
  '(55550000-0000-4000-8000-000000000001,dispensed)',
  'the carried prescription names the doctor and is dispensed');
SELECT is((SELECT qty_on_hand FROM public.pharmacy_batches WHERE id = 'pgtap-src-lot'), 90,
  'only the two allowed dispenses took stock');

-- ---------------------------------------------------------------------------
-- 3. rx_import_history: history only, from a prescriber
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000021', 'pgtap-src-imp-1',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'open',
                       'prescriber_id', '55550000-0000-4000-8000-000000000001',
                       'lines', '[{"itemId":"pgtap-src-item","qty":20}]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'reason',
  'status_not_allowed',
  'an open prescription cannot be created through history import');
SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000022', 'pgtap-src-imp-2',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'void',
                       'prescriber_id', '55550000-0000-4000-8000-000000000001',
                       'lines', '[{"itemId":"pgtap-src-item","qty":20}]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'reason',
  'status_not_allowed',
  'a cancelled prescription cannot be created through history import');
SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000023', 'pgtap-src-imp-3',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'dispensed',
                       'prescriber_id', 'made-up-doctor',
                       'lines', '[{"itemId":"pgtap-src-item","qty":20}]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'reason',
  'prescriber_not_allowed',
  'history import cannot create a prescription in a made-up name');
SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000024', 'pgtap-src-imp-4',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'dispensed',
                       'prescriber_id', '55550000-0000-4000-8000-000000000001',
                       'lines', '[{"itemId":"pgtap-src-item","qty":20}]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'outcome',
  'applied',
  'a doctor''s dispensed prescription is imported as history');
SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000027', 'pgtap-src-imp-5',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'dispensed',
                       'prescriber_id', '55550000-0000-4000-8000-00000000000A',
                       'lines', '[]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'outcome',
  'rejected',
  'an id with no staff account is refused whatever its case');
SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000028', 'pgtap-src-imp-6',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'dispensed',
                       'prescriber_id', upper('55550000-0000-4000-8000-0000000000ab'),
                       'lines', '[]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'outcome',
  'applied',
  'a prescriber id in capitals is accepted');
SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000025', 'pgtap-src-rx-open',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'void',
                       'prescriber_id', '55550000-0000-4000-8000-000000000001',
                       'lines', '[{"itemId":"pgtap-src-item","qty":1}]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'reason',
  'status_not_allowed',
  'history import cannot cancel an open prescription (rx_void_prescription records who and why)');
RESET ROLE;
SELECT is((SELECT status FROM public.prescriptions WHERE id = 'pgtap-src-rx-open'), 'open',
  'the open prescription is still open');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT is(
  public.rx_import_history(
    '5555c0de-0000-4000-8000-000000000026', 'pgtap-src-rx-open',
    jsonb_build_object('patient_id', 'pgtap-src-rx', 'visit_id', '', 'status', 'dispensed',
                       'prescriber_id', 'anyone',
                       'lines', '[{"itemId":"pgtap-src-item","qty":1}]'::jsonb),
    '[]'::jsonb, '55550000-0000-4000-8000-000000000003') ->> 'outcome',
  'applied',
  'an open prescription on the server can still be closed as dispensed history');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.prescriptions WHERE id IN ('pgtap-src-imp-1', 'pgtap-src-imp-2', 'pgtap-src-imp-3')), 0,
  'the refused imports were not saved');
SELECT is((SELECT (prescriber_id, status)::text FROM public.prescriptions WHERE id = 'pgtap-src-rx-open'),
  '(55550000-0000-4000-8000-000000000001,dispensed)',
  'closing it keeps the prescriber the server has');
SELECT is((SELECT prescriber_id FROM public.prescriptions WHERE id = 'pgtap-src-imp-6'),
  '55550000-0000-4000-8000-0000000000ab',
  'and stored in the form the app looks staff up by');
SELECT is(
  COALESCE(NULLIF(current_setting('mbhr.stock_write', true), ''), 'off'),
  'off',
  'no stock-write bypass is left on after a refused import');

-- ---------------------------------------------------------------------------
-- 4. merge_patients: details and portal access need their own permissions
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000005","role":"authenticated"}';

SELECT is(
  public.merge_patients(
    '5555c0de-0000-4000-8000-000000000031', 'pgtap-src-b', 'pgtap-src-a',
    '{}'::jsonb, '55550000-0000-4000-8000-000000000005', now(), 'dedupe_modal') ->> 'outcome',
  'applied',
  'an auditor can still merge two records when nothing else changes');
SELECT throws_ok(
  $$SELECT public.merge_patients(
      '5555c0de-0000-4000-8000-000000000032', 'pgtap-src-d', 'pgtap-src-c',
      '{"phone":{"source":"loser","value":"08000000034"}}'::jsonb,
      '55550000-0000-4000-8000-000000000005', now(), 'conflict_review')$$,
  '42501', 'register permission required to choose field values in a merge',
  'an auditor cannot choose field values');
SELECT throws_ok(
  $$SELECT public.merge_patients(
      '5555c0de-0000-4000-8000-000000000033', 'pgtap-src-f', 'pgtap-src-e',
      '{}'::jsonb, '55550000-0000-4000-8000-000000000005', now(), 'dedupe_modal')$$,
  '42501', 'portal_manage permission required: this merge involves portal access',
  'an auditor cannot move a portal sign-in');
SELECT throws_ok(
  $$SELECT public.merge_patients(
      '5555c0de-0000-4000-8000-000000000034', 'pgtap-src-h', 'pgtap-src-g',
      '{}'::jsonb, '55550000-0000-4000-8000-000000000005', now(), 'dedupe_modal')$$,
  '42501', 'portal_manage permission required: this merge involves portal access',
  'an auditor cannot switch portal access on through a merge');
SELECT throws_ok(
  $$SELECT public.merge_patients(
      '5555c0de-0000-4000-8000-000000000037', 'pgtap-src-n', 'pgtap-src-m',
      '{}'::jsonb, '55550000-0000-4000-8000-000000000005', now(), 'dedupe_modal')$$,
  '42501', 'portal_manage permission required: this merge involves portal access',
  'an auditor cannot move a portal login row with the merged record''s history');
SELECT throws_ok(
  $$SELECT public.merge_patients(
      '5555c0de-0000-4000-8000-000000000038', 'pgtap-src-o', 'pgtap-src-p',
      '{}'::jsonb, '55550000-0000-4000-8000-000000000005', now(), 'dedupe_modal')$$,
  '42501', 'portal_manage permission required: this merge involves portal access',
  'an auditor cannot put another record''s history under a portal sign-in');
RESET ROLE;
SELECT ok(
  (SELECT e.auth_uid IS NOT NULL AND e.merged_into IS NULL AND f.auth_uid IS NULL
          AND NOT COALESCE(h.portal_enabled, false) AND g.merged_into IS NULL
          AND m.merged_into IS NULL AND p.merged_into IS NULL
     FROM public.patients AS e, public.patients AS f, public.patients AS g, public.patients AS h,
          public.patients AS m, public.patients AS p
    WHERE e.id = 'pgtap-src-e' AND f.id = 'pgtap-src-f' AND g.id = 'pgtap-src-g' AND h.id = 'pgtap-src-h'
      AND m.id = 'pgtap-src-m' AND p.id = 'pgtap-src-p'),
  'the refused merges changed nothing');
SELECT is((SELECT patient_id FROM public.patient_portal_users WHERE id = '55550000-0000-4000-8000-0000000000e4'),
  'pgtap-src-m',
  'the portal login row stayed on its own record');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT is(
  public.merge_patients(
    '5555c0de-0000-4000-8000-000000000035', 'pgtap-src-j', 'pgtap-src-i',
    '{"phone":{"source":"custom","value":"08000000040"},
      "given_name":{"source":"loser","value":"Mallory"},
      "family_name":{"source":"custom","value":"Roles"}}'::jsonb,
    '55550000-0000-4000-8000-000000000002', now(), 'conflict_review') -> 'skipped_fields',
  '["given_name"]'::jsonb,
  'a value neither record holds is skipped, whatever source the device names');
RESET ROLE;
SELECT is((SELECT (given_name, phone)::text FROM public.patients WHERE id = 'pgtap-src-j'),
  '(Efe,08000000040)',
  'the kept record takes the loser''s phone and keeps its own name');
SELECT is((SELECT field_choices -> 'phone' ->> 'source' FROM public.patient_merges WHERE loser_id = 'pgtap-src-i'),
  'loser',
  'the merge history records where the value really came from');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT is(
  public.merge_patients(
    '5555c0de-0000-4000-8000-000000000036', 'pgtap-src-l', 'pgtap-src-k',
    '{}'::jsonb, '55550000-0000-4000-8000-000000000002', now(), 'dedupe_modal') ->> 'portal_sign_in_moved',
  'true',
  'a nurse (portal_manage) still moves a portal sign-in in a merge');
-- The device trims text and may send a date as a timestamp.
SELECT is(
  public.merge_patients(
    '5555c0de-0000-4000-8000-000000000039', 'pgtap-src-s', 'pgtap-src-r',
    '{"address":{"source":"loser","value":"2 Road"},
      "dob":{"source":"loser","value":"1990-01-02T00:00:00.000Z"}}'::jsonb,
    '55550000-0000-4000-8000-000000000002', now(), 'conflict_review') -> 'skipped_fields',
  '[]'::jsonb,
  'a loser''s value sent trimmed, or a date sent as a timestamp, still counts as the loser''s');
RESET ROLE;
SELECT is((SELECT (address, dob)::text FROM public.patients WHERE id = 'pgtap-src-s'),
  '(" 2 Road ",1990-01-02)',
  'the server''s own copy of the value is written');

-- ---------------------------------------------------------------------------
-- 5. Lowering triage priority: a clinician's own upload
-- ---------------------------------------------------------------------------
-- A volunteer's device uploads a downgrade recorded for a doctor.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000004","role":"authenticated"}';
INSERT INTO public.queue_transitions (id, queue_item_id, patient_id, kind, to_stage,
  from_priority, to_priority, reason, user_id, user_role, device_id, at)
VALUES ('pgtap-src-t1', 'pgtap-src-q1', 'pgtap-src-q', 'priority_downgrade', 'consult',
  'urgent', 'low', 'pgtap: seen, stable', '55550000-0000-4000-8000-000000000001', 'doctor',
  'pgtap-device', now());
-- A doctor uploads their own downgrade.
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000001","role":"authenticated"}';
INSERT INTO public.queue_transitions (id, queue_item_id, patient_id, kind, to_stage,
  from_priority, to_priority, reason, user_id, user_role, device_id, at)
VALUES ('pgtap-src-t2', 'pgtap-src-q2', 'pgtap-src-q', 'priority_downgrade', 'consult',
  'urgent', 'low', 'pgtap: seen, stable', '55550000-0000-4000-8000-000000000001', 'doctor',
  'pgtap-device', now());
-- A doctor's device uploads a second doctor's downgrade (a colleague's change).
INSERT INTO public.queue_transitions (id, queue_item_id, patient_id, kind, to_stage,
  from_priority, to_priority, reason, user_id, user_role, device_id, at)
VALUES ('pgtap-src-t3', 'pgtap-src-q3', 'pgtap-src-q', 'priority_downgrade', 'consult',
  'urgent', 'normal', 'pgtap: seen, stable', '55550000-0000-4000-8000-000000000006', 'doctor',
  'pgtap-device', now());
-- A row that names a volunteer but claims the doctor role.
INSERT INTO public.queue_transitions (id, queue_item_id, patient_id, kind, to_stage,
  from_priority, to_priority, reason, user_id, user_role, device_id, at)
VALUES ('pgtap-src-t4', 'pgtap-src-q4', 'pgtap-src-q', 'priority_downgrade', 'consult',
  'urgent', 'low', 'pgtap: seen, stable', '55550000-0000-4000-8000-000000000004', 'doctor',
  'pgtap-device', now());
-- A row whose user is not a staff id.
INSERT INTO public.queue_transitions (id, queue_item_id, patient_id, kind, to_stage,
  from_priority, to_priority, reason, user_id, user_role, device_id, at)
VALUES ('pgtap-src-t5', 'pgtap-src-q5', 'pgtap-src-q', 'priority_downgrade', 'consult',
  'urgent', 'low', 'pgtap: seen, stable', 'Dr Anyone', 'doctor',
  'pgtap-device', now());
-- A doctor's downgrade with no target priority.
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000001","role":"authenticated"}';
INSERT INTO public.queue_transitions (id, queue_item_id, patient_id, kind, to_stage,
  from_priority, to_priority, reason, user_id, user_role, device_id, at)
VALUES ('pgtap-src-t6', 'pgtap-src-q6', 'pgtap-src-q', 'priority_downgrade', 'consult',
  'urgent', NULL, 'pgtap: seen, stable', '55550000-0000-4000-8000-000000000001', 'doctor',
  'pgtap-device', now());
-- A volunteer tries to delete a queue row (to add it again lower).
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT throws_ok(
  $$DELETE FROM public.queue WHERE id = 'pgtap-src-q7'$$,
  '42501', NULL,
  'signed-in staff cannot delete a queue row');
RESET ROLE;

SELECT is((SELECT (applied, reject_reason)::text FROM public.queue_transitions WHERE id = 'pgtap-src-t1'),
  '(f,uploaded_by_non_clinician)',
  'a downgrade uploaded by a volunteer is recorded but not applied');
SELECT is((SELECT priority FROM public.queue WHERE id = 'pgtap-src-q1'), 'urgent',
  'the patient stays urgent');
SELECT is((SELECT (applied, reject_reason)::text FROM public.queue_transitions WHERE id = 'pgtap-src-t2'),
  '(t,)',
  'a doctor''s own downgrade applies');
SELECT is((SELECT priority FROM public.queue WHERE id = 'pgtap-src-q2'), 'low',
  'the doctor''s downgrade lowered the priority');
SELECT is((SELECT (applied, priority)::text FROM public.queue_transitions AS t JOIN public.queue AS q ON q.id = t.queue_item_id
            WHERE t.id = 'pgtap-src-t3'),
  '(t,normal)',
  'a clinician may upload a colleague clinician''s downgrade');
SELECT is((SELECT (applied, reject_reason)::text FROM public.queue_transitions WHERE id = 'pgtap-src-t4'),
  '(f,not_a_clinician)',
  'the recorded role is read from the staff list, not from the row');
SELECT is((SELECT (applied, reject_reason)::text FROM public.queue_transitions WHERE id = 'pgtap-src-t5'),
  '(f,not_a_clinician)',
  'a recorded user who is not on the staff list is not a clinician');
SELECT is((SELECT count(*)::int FROM public.queue WHERE id IN ('pgtap-src-q4', 'pgtap-src-q5') AND priority = 'urgent'), 2,
  'those patients stay urgent too');
SELECT is((SELECT (t.applied, t.reject_reason, q.priority)::text
             FROM public.queue_transitions AS t JOIN public.queue AS q ON q.id = t.queue_item_id
            WHERE t.id = 'pgtap-src-t6'),
  '(f,not_a_downgrade,urgent)',
  'a downgrade with no target priority is refused and the patient stays urgent');

SELECT * FROM finish();
ROLLBACK;
