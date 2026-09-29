-- pgTAP: who is recorded as dispenser, stock mover and merger
-- Migration under test: supabase/migrations/20260927100160_command_attribution.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('66660000-0000-4000-8000-0000000000a1', 'pgTAP pharmacist A', 'pharmacist'),
  ('66660000-0000-4000-8000-0000000000a2', 'pgTAP pharmacist B', 'pharmacist'),
  ('66660000-0000-4000-8000-0000000000a3', 'pgTAP volunteer', 'volunteer'),
  ('66660000-0000-4000-8000-0000000000a4', 'pgTAP nurse', 'nurse'),
  ('66660000-0000-4000-8000-0000000000a5', 'pgTAP second nurse', 'nurse'),
  ('66660000-0000-4000-8000-0000000000a6', 'pgTAP doctor', 'doctor');

INSERT INTO public.patients (id, given_name, family_name, phone) VALUES
  ('pgtap-att-rx', 'Kemi', 'Attrib', '08000000061'),
  ('pgtap-att-a',  'Lara', 'Attrib', '08000000062'),
  ('pgtap-att-b',  'Lara', 'Attrib', '08000000063'),
  ('pgtap-att-c',  'Musa', 'Attrib', '08000000064'),
  ('pgtap-att-d',  'Musa', 'Attrib', '08000000065'),
  ('pgtap-att-e',  'Nkem', 'Attrib', '08000000066'),
  ('pgtap-att-f',  'Nkem', 'Attrib', '08000000067');

INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, status)
VALUES ('pgtap-att-rx-open', '', 'pgtap-att-rx', '66660000-0000-4000-8000-0000000000a6',
        '[{"itemId":"pgtap-att-item","qty":2}]'::jsonb, 'open');

-- ---------------------------------------------------------------------------
-- 1. The helper
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('authenticated', 'public.app_attributed_performer(text, text[])', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.app_attributed_performer(text, text[])', 'EXECUTE'),
  'signed-in users and anon cannot call the helper');

-- ---------------------------------------------------------------------------
-- 2. Stock
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-0000000000a1","role":"authenticated"}';
SELECT public.rx_register_item(
  '6666c0de-0000-4000-8000-000000000001', 'pgtap-att-item',
  '{"med_name":"Pgtap Amoxicillin","form":"capsule","strength":"250 mg","unit":"capsule","site_key":"pgtap-att-site"}'::jsonb,
  '66660000-0000-4000-8000-0000000000a1') ->> 'outcome' AS item;
-- A name that is not a staff id.
SELECT public.rx_receive_stock(
  '6666c0de-0000-4000-8000-000000000002', 'pgtap-att-mv-1',
  jsonb_build_object('id', 'pgtap-att-lot', 'item_id', 'pgtap-att-item',
                     'lot_number', 'A1', 'expiry_date', (current_date + 365)::text),
  50, 'receipt', now(), 'device-pharmacist') ->> 'outcome' AS lot;
-- A colleague who may move stock.
SELECT public.rx_adjust_stock(
  '6666c0de-0000-4000-8000-000000000003', 'pgtap-att-mv-2', 'pgtap-att-lot', -1, 'adjust',
  'pgtap: count', now(), '66660000-0000-4000-8000-0000000000a2') ->> 'outcome' AS adj1;
-- A volunteer, who may not.
SELECT public.rx_adjust_stock(
  '6666c0de-0000-4000-8000-000000000004', 'pgtap-att-mv-3', 'pgtap-att-lot', -1, 'adjust',
  'pgtap: count', now(), '66660000-0000-4000-8000-0000000000a3') ->> 'outcome' AS adj2;
RESET ROLE;

SELECT is((SELECT (requested_by, requested_by_claimed, actor_id::text)::text FROM public.stock_movements WHERE id = 'pgtap-att-mv-1'),
  '(66660000-0000-4000-8000-0000000000a1,device-pharmacist,66660000-0000-4000-8000-0000000000a1)',
  'a mover that is not a staff id is recorded as the sender, and the claim is kept');
SELECT is((SELECT (requested_by, requested_by_claimed, actor_id::text)::text FROM public.stock_movements WHERE id = 'pgtap-att-mv-2'),
  '(66660000-0000-4000-8000-0000000000a2,,66660000-0000-4000-8000-0000000000a1)',
  'a colleague who may move stock is kept, with the sender beside them');
SELECT is((SELECT (requested_by, requested_by_claimed)::text FROM public.stock_movements WHERE id = 'pgtap-att-mv-3'),
  '(66660000-0000-4000-8000-0000000000a1,66660000-0000-4000-8000-0000000000a3)',
  'a volunteer named as mover is replaced by the sender');
SELECT ok((SELECT recorded_at >= now() FROM public.stock_movements WHERE id = 'pgtap-att-mv-1'),
  'the received time is the server''s');

-- ---------------------------------------------------------------------------
-- 3. Dispensing
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-0000000000a1","role":"authenticated"}';
-- The sender's own id, in capitals.
SELECT public.rx_dispense(
  '6666c0de-0000-4000-8000-000000000011', 'pgtap-att-rx-open',
  '[{"item_id":"pgtap-att-item","qty":2,"dispense_ids":["pgtap-att-d1"]}]'::jsonb, now() - interval '2 days', true, false,
  upper('66660000-0000-4000-8000-0000000000a1')) ->> 'outcome' AS d1;
-- A carried prescription, with a name as the dispenser.
SELECT public.rx_dispense(
  '6666c0de-0000-4000-8000-000000000012', 'pgtap-att-rx-2',
  '[{"item_id":"pgtap-att-item","qty":1,"dispense_ids":["pgtap-att-d2"]}]'::jsonb, now(), false, false,
  'Nurse Joy',
  jsonb_build_object('patient_id', 'pgtap-att-rx', 'visit_id', '',
                     'prescriber_id', '66660000-0000-4000-8000-0000000000a6',
                     'lines', '[{"itemId":"pgtap-att-item","qty":1}]'::jsonb)) ->> 'outcome' AS d2;
-- Onboarding history: one row by a colleague, one by a device-only user.
SELECT public.rx_import_history(
  '6666c0de-0000-4000-8000-000000000013', 'pgtap-att-imp-1',
  jsonb_build_object('patient_id', 'pgtap-att-rx', 'visit_id', '', 'status', 'dispensed',
                     'prescriber_id', '66660000-0000-4000-8000-0000000000a6',
                     'lines', '[{"itemId":"pgtap-att-item","qty":2}]'::jsonb),
  jsonb_build_array(
    jsonb_build_object('id', 'pgtap-att-h1', 'item_id', 'pgtap-att-item', 'qty', 1,
                       'dispensed_by', '66660000-0000-4000-8000-0000000000a2', 'dispensed_at', '2026-09-01T10:00:00Z'),
    jsonb_build_object('id', 'pgtap-att-h2', 'item_id', 'pgtap-att-item', 'qty', 1,
                       'dispensed_by', '01J9ZK3Q7N8XGQ4W5V6T2R1PBM', 'dispensed_at', '2026-09-01T10:00:00Z')),
  '66660000-0000-4000-8000-0000000000a1') ->> 'outcome' AS imp;
RESET ROLE;

SELECT is((SELECT (dispensed_by, dispensed_by_claimed, received_by::text)::text FROM public.dispenses WHERE id = 'pgtap-att-d1'),
  '(66660000-0000-4000-8000-0000000000a1,,66660000-0000-4000-8000-0000000000a1)',
  'the sender''s own dispense is recorded under their id, in lower case');
SELECT ok((SELECT received_at >= now() AND dispensed_at < now() - interval '1 day' FROM public.dispenses WHERE id = 'pgtap-att-d1'),
  'the device''s dispensing time and the server''s received time are both kept');
SELECT is((SELECT (requested_by, requested_by_claimed)::text FROM public.stock_movements WHERE dispense_id = 'pgtap-att-d1'),
  '(66660000-0000-4000-8000-0000000000a1,)',
  'its stock movement names the same person');
SELECT is((SELECT dispensed_by FROM public.prescriptions WHERE id = 'pgtap-att-rx-open'),
  '66660000-0000-4000-8000-0000000000a1',
  'and so does the prescription');
SELECT is((SELECT (dispensed_by, dispensed_by_claimed)::text FROM public.dispenses WHERE id = 'pgtap-att-d2'),
  '(66660000-0000-4000-8000-0000000000a1,"Nurse Joy")',
  'a name sent as the dispenser is replaced by the sender, and the claim is kept');
SELECT is((SELECT jsonb_object_agg(id, jsonb_build_array(dispensed_by, dispensed_by_claimed, received_by))
             FROM public.dispenses WHERE id IN ('pgtap-att-h1', 'pgtap-att-h2')),
  jsonb_build_object(
    'pgtap-att-h1', jsonb_build_array('66660000-0000-4000-8000-0000000000a2', NULL, '66660000-0000-4000-8000-0000000000a1'),
    'pgtap-att-h2', jsonb_build_array('66660000-0000-4000-8000-0000000000a1', '01J9ZK3Q7N8XGQ4W5V6T2R1PBM', '66660000-0000-4000-8000-0000000000a1')),
  'imported history keeps a colleague who may dispense and replaces a device-only id');

-- A visit dispense through plain sync: its dispenser is a display name.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-0000000000a1","role":"authenticated"}';
INSERT INTO public.dispenses (id, patient_id, item_name, qty, dispensed_by, dispensed_at, received_by, received_at)
VALUES ('pgtap-att-v1', 'pgtap-att-rx', 'Pgtap ORS', 1, 'Ade Pharmacist', now(),
        '66660000-0000-4000-8000-0000000000a2', '2000-01-01T00:00:00Z');
UPDATE public.dispenses SET received_by = '66660000-0000-4000-8000-0000000000a2', received_at = '2000-01-01T00:00:00Z'
 WHERE id = 'pgtap-att-v1';
-- A staff id as a visit dispense's dispenser is shown as that person's name.
INSERT INTO public.dispenses (id, patient_id, item_name, qty, dispensed_by, dispensed_at) VALUES
  ('pgtap-att-v2', 'pgtap-att-rx', 'Pgtap ORS', 1, '66660000-0000-4000-8000-0000000000a6', now()),
  ('pgtap-att-v3', 'pgtap-att-rx', 'Pgtap ORS', 1, '66660000-0000-4000-8000-0000000000a2', now());
UPDATE public.dispenses SET dispensed_by = '66660000-0000-4000-8000-0000000000a3' WHERE id = 'pgtap-att-v3';
-- No dispenser named at all.
SELECT public.rx_import_history(
  '6666c0de-0000-4000-8000-000000000014', 'pgtap-att-imp-2',
  jsonb_build_object('patient_id', 'pgtap-att-rx', 'visit_id', '', 'status', 'dispensed',
                     'prescriber_id', '66660000-0000-4000-8000-0000000000a6', 'lines', '[]'::jsonb),
  '[]'::jsonb, NULL) ->> 'outcome' AS imp2;
RESET ROLE;
SELECT is((SELECT (dispensed_by, received_by::text, received_at >= now())::text FROM public.dispenses WHERE id = 'pgtap-att-v1'),
  '("Ade Pharmacist",66660000-0000-4000-8000-0000000000a1,t)',
  'a visit dispense keeps its display name, and who sent it and when cannot be supplied or changed');
SELECT is((SELECT jsonb_object_agg(id, jsonb_build_array(dispensed_by, dispensed_by_claimed))
             FROM public.dispenses WHERE id IN ('pgtap-att-v2', 'pgtap-att-v3')),
  jsonb_build_object(
    'pgtap-att-v2', jsonb_build_array('66660000-0000-4000-8000-0000000000a1', '66660000-0000-4000-8000-0000000000a6'),
    'pgtap-att-v3', jsonb_build_array('66660000-0000-4000-8000-0000000000a1', '66660000-0000-4000-8000-0000000000a3')),
  'a visit dispense naming a doctor, or changed to name a volunteer, is recorded as the sender');
SELECT is((SELECT dispensed_by FROM public.dispenses WHERE id = 'pgtap-att-v1'), 'Ade Pharmacist',
  'a display name is left alone');
SELECT is((SELECT dispensed_by FROM public.prescriptions WHERE id = 'pgtap-att-imp-2'),
  '66660000-0000-4000-8000-0000000000a1',
  'a dispensed prescription with no dispenser named records the sender');

-- ---------------------------------------------------------------------------
-- 4. Merges
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-0000000000a4","role":"authenticated"}';
SELECT public.merge_patients('6666c0de-0000-4000-8000-000000000021', 'pgtap-att-b', 'pgtap-att-a',
  '{}'::jsonb, 'device-nurse', now(), 'dedupe_modal') ->> 'outcome' AS m1;
SELECT public.merge_patients('6666c0de-0000-4000-8000-000000000022', 'pgtap-att-d', 'pgtap-att-c',
  '{}'::jsonb, '66660000-0000-4000-8000-0000000000a5', now(), 'backfill') ->> 'outcome' AS m2;
SELECT public.merge_patients('6666c0de-0000-4000-8000-000000000023', 'pgtap-att-f', 'pgtap-att-e',
  '{}'::jsonb, '66660000-0000-4000-8000-0000000000a3', now(), 'dedupe_modal') ->> 'outcome' AS m3;
RESET ROLE;

SELECT is((SELECT (merged_by, requested_by, actor_id::text)::text FROM public.patient_merges WHERE loser_id = 'pgtap-att-a'),
  '(66660000-0000-4000-8000-0000000000a4,device-nurse,66660000-0000-4000-8000-0000000000a4)',
  'a merger that is not a staff id is recorded as the sender; the claim stays in requested_by');
SELECT is((SELECT (merged_by, actor_id::text)::text FROM public.patient_merges WHERE loser_id = 'pgtap-att-c'),
  '(66660000-0000-4000-8000-0000000000a5,66660000-0000-4000-8000-0000000000a4)',
  'a colleague''s merge sent later (backfill) keeps the colleague, with the sender beside them');
SELECT is((SELECT merged_by FROM public.patient_merges WHERE loser_id = 'pgtap-att-e'),
  '66660000-0000-4000-8000-0000000000a4',
  'a volunteer named as merger is replaced by the sender');

-- ---------------------------------------------------------------------------
-- 5. Without a signed-in account (service role, migrations)
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{}';
SELECT set_config('mbhr.stock_write', 'on', true);
INSERT INTO public.stock_movements (id, item_id, batch_id, qty_delta, reason, requested_by, occurred_at, recorded_at)
VALUES ('pgtap-att-mv-9', 'pgtap-att-item', 'pgtap-att-lot', 1, 'adjust', 'seed-script', now(), '2000-01-01T00:00:00Z');
SELECT set_config('mbhr.stock_write', 'off', true);
SELECT is((SELECT (requested_by, requested_by_claimed, recorded_at >= now())::text FROM public.stock_movements WHERE id = 'pgtap-att-mv-9'),
  '(seed-script,,t)',
  'with no signed-in account the claim is kept as sent, and the received time is still the server''s');

SELECT * FROM finish();
ROLLBACK;
