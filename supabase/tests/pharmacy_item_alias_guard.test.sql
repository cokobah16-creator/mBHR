-- pgTAP: a medicine registration cannot re-point another medicine's id
-- Migration under test: supabase/migrations/20260927100170_pharmacy_item_alias_guard.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(50);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('77770000-0000-4000-8000-0000000000b1', 'pgTAP pharmacist one', 'pharmacist'),
  ('77770000-0000-4000-8000-0000000000b2', 'pgTAP pharmacist two', 'pharmacist'),
  ('77770000-0000-4000-8000-0000000000b3', 'pgTAP doctor', 'doctor');
INSERT INTO public.patients (id, given_name, family_name, phone) VALUES
  ('pgtap-alias-p', 'Ola', 'Alias', '08000000071');
INSERT INTO public.pharmacy_items (id, med_name, form, strength, unit, on_hand_qty, is_controlled, is_active, site_key) VALUES
  ('pgtap-alias-para', 'Pgtap Paracetamol', 'tablet', '500 mg', 'tablet', 0, false, true, 'pgtap-alias-site'),
  ('pgtap-alias-morph', 'Pgtap Morphine', 'tablet', '10 mg', 'tablet', 0, true, true, 'pgtap-alias-site');
-- Prescriptions a doctor uploaded with a device's own medicine ids.
INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, status) VALUES
  ('pgtap-alias-rx1', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-para","qty":10}]'::jsonb, 'open'),
  ('pgtap-alias-rx2', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-para2","qty":10}]'::jsonb, 'dispensed'),
  ('pgtap-alias-rx3', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-pend","qty":10}]'::jsonb, 'open'),
  ('pgtap-alias-rx4', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-x","qty":10},{"itemId":"pgtap-alias-morph","qty":1}]'::jsonb, 'open'),
  ('pgtap-alias-rx5', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-y","qty":10}]'::jsonb, 'open');
-- A mapping made while pgtap-alias-rx5 was being uploaded (the prescription
-- still names the device's id).
INSERT INTO public.pharmacy_item_aliases (alias_id, item_id) VALUES ('pgtap-dev-y', 'pgtap-alias-para');

-- ---------------------------------------------------------------------------
-- 1. The real device registers its paracetamol
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000001', 'pgtap-dev-para',
    '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'item_id',
  'pgtap-alias-para',
  'a device''s medicine maps to the server''s matching medicine');
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000003', 'pgtap-dev-para',
    '{"med_name":"pgtap paracetamol","form":"Tablet","strength":"500 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'item_id',
  'pgtap-alias-para',
  'registering it again as the same medicine gets the same answer');
-- A dispensed prescription's device id is registered.
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000004', 'pgtap-dev-para2',
    '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'item_id',
  'pgtap-alias-para',
  'a second device id for the same medicine maps too');
-- A medicine the server does not have yet.
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000005', 'pgtap-dev-ors',
    '{"med_name":"Pgtap ORS","form":"sachet","strength":"20.5 g","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'item_id',
  'pgtap-dev-ors',
  'a new medicine is registered under the device''s id');
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000006', 'pgtap-dev-ors',
    '{"med_name":"Pgtap ORS","form":"sachet","strength":"20.5 g","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'item_id',
  'pgtap-dev-ors',
  'and registering it again gets the same answer');
-- The mapping made during an upload: registering it re-points the prescription.
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000007', 'pgtap-dev-y',
    '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'item_id',
  'pgtap-alias-para',
  'an id already mapped to the same medicine gets that medicine');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';

SELECT is((SELECT (created_by::text, claimed ->> 'med_name')::text FROM public.pharmacy_item_aliases WHERE alias_id = 'pgtap-dev-para'),
  '(77770000-0000-4000-8000-0000000000b1,"Pgtap Paracetamol")',
  'the mapping records who made it and what they said the medicine was');
SELECT is((SELECT registered_by FROM public.pharmacy_items WHERE id = 'pgtap-dev-ors'),
  '77770000-0000-4000-8000-0000000000b1'::uuid,
  'a medicine created under a device''s id records who registered it');
SELECT is((SELECT lines -> 0 FROM public.prescriptions WHERE id = 'pgtap-alias-rx1'),
  '{"itemId":"pgtap-alias-para","deviceItemId":"pgtap-dev-para","qty":10}'::jsonb,
  'an open prescription naming the device''s id now names the server''s medicine, and keeps the device''s id');
SELECT is((SELECT lines -> 0 ->> 'itemId' FROM public.prescriptions WHERE id = 'pgtap-alias-rx2'), 'pgtap-dev-para2',
  'a dispensed prescription keeps its lines');
SELECT is((SELECT lines -> 0 ->> 'itemId' FROM public.prescriptions WHERE id = 'pgtap-alias-rx5'), 'pgtap-alias-para',
  'a prescription the mapping missed is re-pointed when the same medicine is registered again');

-- ---------------------------------------------------------------------------
-- 2. The server's own medicines
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b2","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000011', 'pgtap-alias-para',
    '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b2') ->> 'item_id',
  'pgtap-alias-para',
  'registering a server medicine''s own id with its details gets that medicine');
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000012', 'pgtap-alias-para',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-squat"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b2') ->> 'reason',
  'item_id_conflict',
  'a server medicine''s own id cannot be registered as another medicine');
SELECT is(public.app_rx_item_id('pgtap-alias-para'), 'pgtap-alias-para',
  'and the server''s own medicine stays in use');

-- What a medicine is cannot be changed directly; its reorder level can.
SELECT throws_ok(
  $$UPDATE public.pharmacy_items SET site_key = 'pgtap-alias-elsewhere' WHERE id = 'pgtap-alias-para'$$,
  '42501', NULL,
  'an inventory holder cannot move a medicine to another site directly');
SELECT throws_ok(
  $$UPDATE public.pharmacy_items SET med_name = 'Pgtap Changed' WHERE id = 'pgtap-alias-para'$$,
  '42501', NULL,
  'nor rename it');
SELECT throws_ok(
  $$UPDATE public.pharmacy_items SET is_controlled = true WHERE id = 'pgtap-alias-para'$$,
  '42501', NULL,
  'nor change its controlled-drug flag');
SELECT lives_ok(
  $$UPDATE public.pharmacy_items SET reorder_threshold = 7 WHERE id = 'pgtap-alias-para'$$,
  'the reorder level stays editable');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';

-- ---------------------------------------------------------------------------
-- 3. A pending id taken as a new medicine (the id is prescribed, not registered)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b2","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000021', 'pgtap-dev-pend',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-squat","is_controlled":true}'::jsonb,
    '77770000-0000-4000-8000-0000000000b2') ->> 'item_id',
  'pgtap-dev-pend',
  'another pharmacist registers a prescribed device id first, as another medicine');
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000022', 'pgtap-dev-pend',
    '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'reason',
  'item_id_conflict',
  'the real device''s registration is refused');
SELECT is(public.app_rx_item_id('pgtap-dev-pend'), 'disputed:pgtap-dev-pend',
  'the id is in dispute and names no medicine');
SELECT is(
  public.rx_dispense('7777c0de-0000-4000-8000-000000000023', 'pgtap-alias-rx3',
    '[{"item_id":"pgtap-dev-pend","qty":10}]'::jsonb, now(), false, false,
    '77770000-0000-4000-8000-0000000000b1', NULL) ->> 'reason',
  'unknown_item',
  'a prescription naming it is not dispensed as the other medicine');
SELECT is(
  public.rx_receive_stock('7777c0de-0000-4000-8000-000000000024', 'pgtap-alias-mv1',
    jsonb_build_object('id', 'pgtap-alias-lot1', 'item_id', 'pgtap-dev-pend', 'lot_number', 'L1',
                       'expiry_date', (current_date + 300)::text),
    100, 'receipt', now(), '77770000-0000-4000-8000-0000000000b1') ->> 'reason',
  'item_not_found',
  'stock received under it goes onto no medicine');
SELECT is(
  public.rx_set_item_active('7777c0de-0000-4000-8000-000000000025', 'pgtap-dev-pend', true,
    '77770000-0000-4000-8000-0000000000b2') ->> 'reason',
  'item_not_found',
  'it cannot be switched back on while in dispute');
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000026', 'pgtap-dev-pend',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-squat","is_controlled":true}'::jsonb,
    '77770000-0000-4000-8000-0000000000b2') ->> 'reason',
  'item_id_conflict',
  'nor registered again with the first details');
SELECT throws_ok(
  $$UPDATE public.pharmacy_items SET disputed_at = NULL, is_active = true WHERE id = 'pgtap-dev-pend'$$,
  '42501', NULL,
  'nor settled by an inventory holder writing the row');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is((SELECT (is_active, disputed_by::text, disputed_claim ->> 'med_name')::text FROM public.pharmacy_items WHERE id = 'pgtap-dev-pend'),
  '(f,77770000-0000-4000-8000-0000000000b1,"Pgtap Paracetamol")',
  'the medicine is switched off and records who disputed it and what they said');
SELECT is((SELECT count(*) FROM public.dispenses WHERE prescription_id = 'pgtap-alias-rx3')
          + (SELECT count(*) FROM public.stock_movements WHERE id = 'pgtap-alias-mv1'), 0::bigint,
  'nothing was dispensed or received against it');

-- ---------------------------------------------------------------------------
-- 4. A pending id mapped first to another medicine
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b2","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000031', 'pgtap-dev-x',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b2') ->> 'item_id',
  'pgtap-alias-morph',
  'another pharmacist maps a prescribed device id first, to morphine');
RESET ROLE;
SELECT is((SELECT lines FROM public.prescriptions WHERE id = 'pgtap-alias-rx4'),
  '[{"itemId":"pgtap-alias-morph","deviceItemId":"pgtap-dev-x","qty":10},{"itemId":"pgtap-alias-morph","qty":1}]'::jsonb,
  'the open prescription was re-pointed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000032', 'pgtap-dev-x',
    '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'reason',
  'item_id_conflict',
  'the real device''s registration is refused');
SELECT is(public.app_rx_item_id('pgtap-dev-x'), 'disputed:pgtap-dev-x',
  'the mapping is in dispute and names no medicine');
SELECT is(
  public.rx_receive_stock('7777c0de-0000-4000-8000-000000000033', 'pgtap-alias-mv2',
    jsonb_build_object('id', 'pgtap-alias-lot2', 'item_id', 'pgtap-dev-x', 'lot_number', 'L2',
                       'expiry_date', (current_date + 300)::text),
    100, 'opening_balance', now(), '77770000-0000-4000-8000-0000000000b1', 'pgtap-alias-site', 'pgtap-alias-dev') ->> 'reason',
  'item_not_found',
  'the device''s opening stock does not go onto morphine');
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000034', 'pgtap-dev-x',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b2') ->> 'reason',
  'item_id_conflict',
  'nor does the first registration''s answer come back');
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b3","role":"authenticated"}';
INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, status) VALUES
  ('pgtap-alias-rx6', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-x","qty":2}]'::jsonb, 'open');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is((SELECT lines FROM public.prescriptions WHERE id = 'pgtap-alias-rx4'),
  '[{"itemId":"pgtap-dev-x","qty":10},{"itemId":"pgtap-alias-morph","qty":1}]'::jsonb,
  'the re-pointed line goes back to the device''s id; the line that named morphine itself stays');
SELECT is((SELECT lines -> 0 ->> 'itemId' FROM public.prescriptions WHERE id = 'pgtap-alias-rx6'), 'pgtap-dev-x',
  'a new prescription naming the id keeps it');
SELECT is((SELECT (item_id, disputed_by::text, disputed_claim ->> 'med_name')::text FROM public.pharmacy_item_aliases WHERE alias_id = 'pgtap-dev-x'),
  '(pgtap-alias-morph,77770000-0000-4000-8000-0000000000b1,"Pgtap Paracetamol")',
  'the mapping records who disputed it and what they said');
SELECT is((SELECT (on_hand_qty, is_active)::text FROM public.pharmacy_items WHERE id = 'pgtap-alias-morph'), '(0,t)',
  'the medicine it pointed at is untouched');

-- ---------------------------------------------------------------------------
-- 5. A registration naming another medicine puts even a real mapping in dispute
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b2","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000041', 'pgtap-dev-para',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-site"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b2') ->> 'reason',
  'item_id_conflict',
  'an id already mapped cannot be re-pointed to another medicine');
SELECT is(public.app_rx_item_id('pgtap-dev-para2'), 'pgtap-alias-para',
  'other ids for the same medicine are still in use');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is((SELECT (item_id, disputed_by::text)::text FROM public.pharmacy_item_aliases WHERE alias_id = 'pgtap-dev-para'),
  '(pgtap-alias-para,77770000-0000-4000-8000-0000000000b2)',
  'the mapping still points at paracetamol, and records who disputed it');

-- ---------------------------------------------------------------------------
-- 6. Ids
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(
  (SELECT array_agg(public.rx_register_item(gen_random_uuid(), v,
            '{"med_name":"Pgtap Zinc","form":"tablet","strength":"20 mg","site_key":"pgtap-alias-site"}'::jsonb,
            '77770000-0000-4000-8000-0000000000b1') ->> 'reason' ORDER BY v)
     FROM unnest(ARRAY['', ' pgtap-dev-z', 'pgtap:dev-z', repeat('z', 129)]) AS v),
  ARRAY['invalid_request', 'invalid_request', 'invalid_request', 'invalid_request'],
  'an empty id, one with outer spaces or '':'', or one over 128 characters is refused');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT throws_ok(
  $$INSERT INTO public.pharmacy_items (id, med_name, form, strength, unit) VALUES ('disputed:pgtap-x', 'Pgtap X', 'tablet', '1 mg', 'tablet')$$,
  '23514', NULL,
  'no medicine id can look like an id in dispute');

-- ---------------------------------------------------------------------------
-- 7. A medicine in dispute takes no new ids; uploads and history follow it
-- ---------------------------------------------------------------------------
-- A mapping made before its medicine was put in dispute.
INSERT INTO public.pharmacy_item_aliases (alias_id, item_id) VALUES ('pgtap-dev-w', 'pgtap-dev-pend');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000071', 'pgtap-dev-m2',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-squat"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'reason',
  'item_disputed',
  'a new id matching a medicine in dispute is refused');
SELECT is(public.app_rx_item_id('pgtap-dev-m2'), 'pgtap-dev-m2',
  'and is not mapped to it');
SELECT is(
  public.rx_register_item('7777c0de-0000-4000-8000-000000000072', 'pgtap-dev-w',
    '{"med_name":"Pgtap Morphine","form":"tablet","strength":"10 mg","site_key":"pgtap-alias-squat"}'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'reason',
  'item_disputed',
  'an id mapped to a medicine in dispute is refused too');
-- deviceItemId is written only by the server.
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b3","role":"authenticated"}';
INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, status) VALUES
  ('pgtap-alias-rx7', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-ors","deviceItemId":"pgtap-dev-x","qty":1}]'::jsonb, 'open'),
  ('pgtap-alias-rx8', '', 'pgtap-alias-p', '77770000-0000-4000-8000-0000000000b3',
   '[{"itemId":"pgtap-dev-para2","deviceItemId":"pgtap-forged","qty":1}]'::jsonb, 'open');
-- History for an open prescription naming an id in dispute.
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000b1","role":"authenticated"}';
SELECT is(
  public.rx_import_history('7777c0de-0000-4000-8000-000000000073', 'pgtap-alias-rx3',
    '{"patient_id":"pgtap-alias-p","status":"dispensed","lines":[{"itemId":"pgtap-dev-pend","qty":10}]}'::jsonb,
    '[{"id":"pgtap-alias-d1","item_id":"pgtap-dev-pend","qty":10}]'::jsonb,
    '77770000-0000-4000-8000-0000000000b1') ->> 'reason',
  'unknown_item',
  'history naming an id in dispute is refused');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is((SELECT lines FROM public.prescriptions WHERE id = 'pgtap-alias-rx7'),
  '[{"itemId":"pgtap-dev-ors","qty":1}]'::jsonb,
  'an uploaded deviceItemId is dropped');
SELECT is((SELECT lines FROM public.prescriptions WHERE id = 'pgtap-alias-rx8'),
  '[{"itemId":"pgtap-alias-para","deviceItemId":"pgtap-dev-para2","qty":1}]'::jsonb,
  'a re-pointed upload keeps the id it was uploaded with, not the one it claimed');
SELECT is((SELECT status FROM public.prescriptions WHERE id = 'pgtap-alias-rx3')
          || ':' || (SELECT count(*) FROM public.dispenses WHERE prescription_id = 'pgtap-alias-rx3'),
  'open:0',
  'the prescription stays open with nothing recorded as given');

SELECT * FROM finish();
ROLLBACK;
