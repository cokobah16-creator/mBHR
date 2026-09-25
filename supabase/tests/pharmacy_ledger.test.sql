-- pgTAP: pharmacy stock ledger (prescriptions and stock lots are server-backed)
-- Migration under test: supabase/migrations/20260925100400_pharmacy_stock_ledger.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.
--
-- Not covered here: two rx_dispense calls running at the same moment in two
-- sessions. pgTAP runs in one session and one transaction, so the oversell
-- case below is sequential (the second call sees the first one's decrement).
-- The concurrent case relies on the row locks rx_dispense takes
-- (prescription, then medicines, then lots); see README.md for a manual
-- two-session check.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(33);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: guards and row-level security do not
-- apply to this role)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('44440000-0000-4000-8000-000000000001', 'pgTAP pharmacist', 'pharmacist'),
  ('44440000-0000-4000-8000-000000000002', 'pgTAP nurse', 'nurse'),
  ('44440000-0000-4000-8000-000000000003', 'pgTAP volunteer', 'volunteer');

INSERT INTO public.patients (id, given_name, family_name, phone)
VALUES ('pgtap-rx-patient', 'Ngozi', 'Ledger', '08000000021');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44440000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- A medicine and one lot of 10
-- ---------------------------------------------------------------------------
SELECT is(
  public.rx_register_item(
    '4444c0de-0000-4000-8000-000000000001', 'pgtap-rx-item-1',
    '{"med_name":"Pgtap Amoxicillin","form":"capsule","strength":"500 mg","unit":"capsule","site_key":"pgtap-rx-site"}'::jsonb,
    'device-pharmacist') ->> 'item_id',
  'pgtap-rx-item-1',
  'a pharmacist registers a medicine');

SELECT is(
  public.rx_receive_stock(
    '4444c0de-0000-4000-8000-000000000002', 'pgtap-rx-mv-1',
    jsonb_build_object('id', 'pgtap-rx-lot-1', 'item_id', 'pgtap-rx-item-1',
                       'lot_number', 'L1', 'expiry_date', (current_date + 365)::text),
    10, 'receipt', now(), 'device-pharmacist') ->> 'outcome',
  'applied',
  'a received lot of 10 is recorded');

SELECT is(
  (SELECT qty_on_hand FROM public.pharmacy_batches WHERE id = 'pgtap-rx-lot-1'),
  10,
  'the lot holds 10');

-- ---------------------------------------------------------------------------
-- Balances cannot be written directly
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$UPDATE public.pharmacy_batches SET qty_on_hand = 999 WHERE id = 'pgtap-rx-lot-1'$$,
  'a direct UPDATE of a lot runs without error');

SELECT is(
  (SELECT qty_on_hand FROM public.pharmacy_batches WHERE id = 'pgtap-rx-lot-1'),
  10,
  'the direct UPDATE of the lot balance is ignored');

SELECT lives_ok(
  $$UPDATE public.pharmacy_items SET on_hand_qty = 999, reorder_threshold = 5
     WHERE id = 'pgtap-rx-item-1'$$,
  'an inventory holder may edit medicine details');

SELECT ok(
  (SELECT on_hand_qty = 10 AND reorder_threshold = 5
     FROM public.pharmacy_items WHERE id = 'pgtap-rx-item-1'),
  'the medicine balance is kept; the reorder level changes');

SELECT throws_ok(
  $$INSERT INTO public.pharmacy_batches (id, item_id, lot_number, expiry_date, qty_on_hand)
    VALUES ('pgtap-rx-lot-direct', 'pgtap-rx-item-1', 'LX', current_date + 30, 50)$$,
  '42501', NULL,
  'a lot cannot be created directly');

SELECT throws_ok(
  $$INSERT INTO public.stock_movements (id, item_id, qty_delta, reason, occurred_at)
    VALUES ('pgtap-rx-mv-direct', 'pgtap-rx-item-1', 50, 'receipt', now())$$,
  '42501', NULL,
  'the ledger cannot be written directly');

-- ---------------------------------------------------------------------------
-- Two dispenses of 8 from the lot of 10: one applies, the other is refused
-- ---------------------------------------------------------------------------
SELECT is(
  public.rx_dispense(
    '4444c0de-0000-4000-8000-000000000003', 'pgtap-rx-1',
    '[{"item_id":"pgtap-rx-item-1","qty":8}]'::jsonb, now(), false, false, 'device-pharmacist',
    jsonb_build_object('patient_id', 'pgtap-rx-patient', 'visit_id', '', 'prescriber_id', 'device-doctor',
                       'lines', '[{"itemId":"pgtap-rx-item-1","qty":8}]'::jsonb)) ->> 'outcome',
  'applied',
  'the first dispense of 8 applies');

-- rx_dispense (and rx_import_history) turn on the transaction-local bypass
-- mbhr.stock_write and must turn it off before returning, so a direct write
-- later in the same transaction cannot skip the balance guards.
SELECT is(
  COALESCE(NULLIF(current_setting('mbhr.stock_write', true), ''), 'off'),
  'off',
  'no stock-write bypass is left on after rx_dispense returns');

SELECT is(
  public.rx_dispense(
    '4444c0de-0000-4000-8000-000000000004', 'pgtap-rx-2',
    '[{"item_id":"pgtap-rx-item-1","qty":8}]'::jsonb, now(), false, false, 'device-pharmacist',
    jsonb_build_object('patient_id', 'pgtap-rx-patient', 'visit_id', '', 'prescriber_id', 'device-doctor',
                       'lines', '[{"itemId":"pgtap-rx-item-1","qty":8}]'::jsonb)) ->> 'reason',
  'insufficient_stock',
  'the second dispense of 8 (online) is refused as insufficient_stock');

SELECT is(
  (SELECT result -> 'lines' -> 0 ->> 'available' FROM public.command_receipts
    WHERE command_id = '4444c0de-0000-4000-8000-000000000004'),
  '2',
  'the refusal reports the 2 units still available');

SELECT ok(
  (SELECT b.qty_on_hand = 2 AND i.on_hand_qty = 2
     FROM public.pharmacy_batches AS b
     JOIN public.pharmacy_items AS i ON i.id = b.item_id
    WHERE b.id = 'pgtap-rx-lot-1'),
  'the lot and the medicine hold 2 (never below zero)');

SELECT is(
  (SELECT status FROM public.prescriptions WHERE id = 'pgtap-rx-2'),
  'open',
  'the refused prescription stays open');

-- ---------------------------------------------------------------------------
-- A repeated command id returns the stored result and takes no stock
-- ---------------------------------------------------------------------------
SELECT is(
  public.rx_dispense(
    '4444c0de-0000-4000-8000-000000000003', 'pgtap-rx-1',
    '[{"item_id":"pgtap-rx-item-1","qty":8}]'::jsonb, now(), false, false, 'device-pharmacist', NULL),
  (SELECT result FROM public.command_receipts
    WHERE command_id = '4444c0de-0000-4000-8000-000000000003'),
  'resending the dispense command returns the stored result');

SELECT is(
  (SELECT qty_on_hand FROM public.pharmacy_batches WHERE id = 'pgtap-rx-lot-1'),
  2,
  'the resend took no stock');

-- ---------------------------------------------------------------------------
-- Handed over offline with a shortfall: recorded, and filed as a discrepancy
-- ---------------------------------------------------------------------------
SELECT is(
  public.rx_dispense(
    '4444c0de-0000-4000-8000-000000000005', 'pgtap-rx-3',
    '[{"item_id":"pgtap-rx-item-1","qty":5}]'::jsonb, now(), true, false, 'device-pharmacist',
    jsonb_build_object('patient_id', 'pgtap-rx-patient', 'visit_id', '', 'prescriber_id', 'device-doctor',
                       'lines', '[{"itemId":"pgtap-rx-item-1","qty":5}]'::jsonb)) ->> 'outcome',
  'applied',
  'an offline handover of 5 with only 2 in stock is recorded');

SELECT is(
  (SELECT result -> 'uncovered' -> 0 ->> 'qty' FROM public.command_receipts
    WHERE command_id = '4444c0de-0000-4000-8000-000000000005'),
  '3',
  'the result reports 3 units not covered by stock');

SELECT is(
  (SELECT count(*)::int FROM public.stock_discrepancies
    WHERE prescription_id = 'pgtap-rx-3' AND qty_uncovered = 3 AND status = 'open'),
  1,
  'the shortfall is filed in stock_discrepancies');

SELECT is(
  (SELECT sum(qty)::int FROM public.dispenses WHERE prescription_id = 'pgtap-rx-3'),
  5,
  'all 5 units are recorded as given to the patient');

SELECT is(
  (SELECT qty_on_hand FROM public.pharmacy_batches WHERE id = 'pgtap-rx-lot-1'),
  0,
  'the lot is at 0, not below');

-- ---------------------------------------------------------------------------
-- Opening stock: one device per site
-- ---------------------------------------------------------------------------
SELECT is(
  public.rx_receive_stock(
    '4444c0de-0000-4000-8000-000000000006', 'pgtap-rx-mv-open-a',
    jsonb_build_object('id', 'pgtap-rx-lot-2', 'item_id', 'pgtap-rx-item-1',
                       'lot_number', 'L2', 'expiry_date', (current_date + 300)::text),
    20, 'opening_balance', now(), 'device-pharmacist', 'pgtap-rx-site', 'pgtap-device-a') ->> 'outcome',
  'applied',
  'the first device''s opening balance for a site applies');

SELECT is(
  public.rx_receive_stock(
    '4444c0de-0000-4000-8000-000000000007', 'pgtap-rx-mv-open-b',
    jsonb_build_object('id', 'pgtap-rx-lot-3', 'item_id', 'pgtap-rx-item-1',
                       'lot_number', 'L3', 'expiry_date', (current_date + 300)::text),
    20, 'opening_balance', now(), 'device-pharmacist', 'pgtap-rx-site', 'pgtap-device-b') ->> 'reason',
  'opening_stock_already_uploaded',
  'a second device''s opening balance for the same site is refused');

SELECT is_empty(
  $$SELECT 1 FROM public.pharmacy_batches WHERE id = 'pgtap-rx-lot-3'$$,
  'the refused opening balance created no lot');

-- ---------------------------------------------------------------------------
-- Ledger and balances agree after a mixed sequence of receipts, counts and
-- dispenses (fixed seed, so the sequence is the same on every run)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  i integer;
  v_op double precision;
  v_lot text;
  v_qty integer;
BEGIN
  PERFORM setseed(0.25);
  PERFORM public.rx_register_item(
    gen_random_uuid(), 'pgtap-rx-item-2',
    '{"med_name":"Pgtap Paracetamol","form":"tablet","strength":"500 mg","unit":"tablet","site_key":"pgtap-rx-site"}'::jsonb,
    'device-pharmacist');
  FOR i IN 1 .. 60 LOOP
    v_op := random();
    v_lot := 'pgtap-rx-lot-r' || (1 + floor(random() * 3))::int;
    v_qty := 1 + floor(random() * 12)::int;
    IF v_op < 0.35 THEN
      PERFORM public.rx_receive_stock(
        gen_random_uuid(), 'pgtap-rx-mv-r' || i,
        jsonb_build_object('id', v_lot, 'item_id', 'pgtap-rx-item-2', 'lot_number', v_lot,
                           'expiry_date', (current_date + 200 + i)::text),
        v_qty, 'receipt', now(), 'device-pharmacist');
    ELSIF v_op < 0.6 THEN
      PERFORM public.rx_adjust_stock(
        gen_random_uuid(), 'pgtap-rx-mv-r' || i, v_lot,
        CASE WHEN random() < 0.5 THEN -v_qty ELSE v_qty END,
        'adjust', 'pgtap count', now(), 'device-pharmacist');
    ELSE
      PERFORM public.rx_dispense(
        gen_random_uuid(), 'pgtap-rx-r' || i,
        jsonb_build_array(jsonb_build_object('item_id', 'pgtap-rx-item-2', 'qty', v_qty)),
        now(), random() < 0.25, false, 'device-pharmacist',
        jsonb_build_object(
          'patient_id', 'pgtap-rx-patient', 'visit_id', '', 'prescriber_id', 'device-doctor',
          'lines', jsonb_build_array(jsonb_build_object('itemId', 'pgtap-rx-item-2', 'qty', v_qty))));
    END IF;
  END LOOP;
END $$;

SELECT ok(
  (SELECT count(*) >= 10 FROM public.stock_movements WHERE item_id = 'pgtap-rx-item-2'),
  'the mixed sequence wrote ledger movements');

SELECT is_empty(
  $$SELECT 1 FROM public.stock_balance_drift WHERE item_id LIKE 'pgtap-rx-%'$$,
  'stock_balance_drift is empty for the test medicines');

SELECT is_empty(
  $$SELECT 1 FROM public.stock_item_balance_drift WHERE item_id LIKE 'pgtap-rx-%'$$,
  'stock_item_balance_drift is empty for the test medicines');

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"44440000-0000-4000-8000-000000000002","role":"authenticated"}';

-- Open clinical question (docs/clinical/CLINICAL_LOGIC_CHANGES.md): the app
-- lets nurses prescribe, the server requires consult.
SELECT throws_ok(
  $$INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, status)
    VALUES ('pgtap-rx-nurse', '', 'pgtap-rx-patient', 'device-nurse',
            '[{"itemId":"pgtap-rx-item-1","qty":1}]'::jsonb, 'open')$$,
  '42501', NULL,
  'a nurse (no consult) cannot insert a prescription on the server');

SET LOCAL request.jwt.claims = '{"sub":"44440000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.rx_dispense(
      '4444c0de-0000-4000-8000-000000000008', 'pgtap-rx-2',
      '[{"item_id":"pgtap-rx-item-1","qty":8}]'::jsonb, now(), false, false, 'device-volunteer', NULL)$$,
  '42501', NULL,
  'a volunteer (no dispense) cannot dispense');

SELECT is_empty(
  $$SELECT 1 FROM public.stock_movements$$,
  'a volunteer cannot read the stock ledger');

-- ---------------------------------------------------------------------------
-- The ledger is append-only, even for the table owner
-- ---------------------------------------------------------------------------
RESET ROLE;

SELECT throws_ok(
  $$UPDATE public.stock_movements SET qty_delta = 1 WHERE item_id = 'pgtap-rx-item-1'$$,
  '42501', NULL,
  'stock_movements rows cannot be updated');

SELECT throws_ok(
  $$DELETE FROM public.stock_movements WHERE item_id = 'pgtap-rx-item-1'$$,
  '42501', NULL,
  'stock_movements rows cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
