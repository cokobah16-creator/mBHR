-- pgTAP: lab results reach the patient portal only after review and release
-- Migration under test: supabase/migrations/20260925100500_lab_results_release.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(37);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: guards and row-level security do not
-- apply to this role; the release guard trigger does)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('55550000-0000-4000-8000-000000000001', 'pgTAP doctor', 'doctor'),
  ('55550000-0000-4000-8000-000000000002', 'pgTAP nurse', 'nurse');

-- Portal patients (linked by auth_uid, portal access on). pgtap-lab-4 is the
-- record pgtap-lab-3 is merged into below; both have their own sign-in.
INSERT INTO public.patients (
  id, given_name, family_name, phone, auth_uid, portal_enabled, portal_enabled_changed_at)
VALUES
  ('pgtap-lab-1', 'Kemi', 'Lab', '08000000031', '55550000-0000-4000-8000-0000000000a1', true, now()),
  ('pgtap-lab-2', 'Tunde', 'Lab', '08000000032', '55550000-0000-4000-8000-0000000000a2', true, now()),
  ('pgtap-lab-3', 'Uche', 'Lab', '08000000033', '55550000-0000-4000-8000-0000000000a3', true, now()),
  ('pgtap-lab-4', 'Uche', 'Lab', '08000000034', '55550000-0000-4000-8000-0000000000a4', true, now());

INSERT INTO public.lab_orders (id, patient_id, ordered_by, test_name, status) VALUES
  ('5555b0b0-0000-4000-8000-000000000001', 'pgtap-lab-1', '55550000-0000-4000-8000-000000000001', 'pgTAP panel', 'completed'),
  ('5555b0b0-0000-4000-8000-000000000002', 'pgtap-lab-2', '55550000-0000-4000-8000-000000000001', 'pgTAP panel', 'completed'),
  ('5555b0b0-0000-4000-8000-000000000003', 'pgtap-lab-3', '55550000-0000-4000-8000-000000000001', 'pgTAP panel', 'completed');

-- R1 unreviewed; R2 reviewed only; R3 released; R4 released then withheld;
-- R5 released (patient 2); R6 released (patient 3); R7 released, then its
-- interpretation is changed.
INSERT INTO public.lab_results (id, order_id, result_value, result_unit, interpretation) VALUES
  ('5555aaaa-0000-4000-8000-000000000001', '5555b0b0-0000-4000-8000-000000000001', '1.0', 'u', 'normal'),
  ('5555aaaa-0000-4000-8000-000000000002', '5555b0b0-0000-4000-8000-000000000001', '2.0', 'u', 'abnormal'),
  ('5555aaaa-0000-4000-8000-000000000003', '5555b0b0-0000-4000-8000-000000000001', '3.0', 'u', 'normal'),
  ('5555aaaa-0000-4000-8000-000000000004', '5555b0b0-0000-4000-8000-000000000001', '4.0', 'u', 'critical'),
  ('5555aaaa-0000-4000-8000-000000000005', '5555b0b0-0000-4000-8000-000000000002', '5.0', 'u', 'normal'),
  ('5555aaaa-0000-4000-8000-000000000006', '5555b0b0-0000-4000-8000-000000000003', '6.0', 'u', 'normal'),
  ('5555aaaa-0000-4000-8000-000000000007', '5555b0b0-0000-4000-8000-000000000001', '7.0', 'u', 'normal');

-- ---------------------------------------------------------------------------
-- Staff: review, release, withhold
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  public.lab_review_result('5555aaaa-0000-4000-8000-000000000002', false) ->> 'outcome',
  'applied',
  'a doctor reviews R2 without releasing it');

SELECT is(
  public.lab_release_result('5555aaaa-0000-4000-8000-000000000001', NULL) ->> 'reason',
  'not_reviewed',
  'releasing an unreviewed result is refused (not_reviewed)');

SELECT ok(
  (public.lab_review_result('5555aaaa-0000-4000-8000-000000000003', true, 'pgTAP note')
     ->> 'released_to_patient_at') IS NOT NULL,
  'a doctor reviews and releases R3');

SELECT is(
  public.lab_review_result('5555aaaa-0000-4000-8000-000000000004', true) ->> 'outcome',
  'applied',
  'a doctor reviews and releases R4');

SELECT is(
  public.lab_withhold_result('5555aaaa-0000-4000-8000-000000000004', 'Clinician will discuss it in person') ->> 'released_to_patient_at',
  NULL,
  'withholding R4 takes it off the portal');

SELECT is(
  public.lab_release_result('5555aaaa-0000-4000-8000-000000000003', NULL) ->> 'already_released',
  'true',
  'releasing R3 again changes nothing (already_released)');

SELECT lives_ok(
  $$SELECT public.lab_review_result(id, true)
      FROM public.lab_results
     WHERE id IN ('5555aaaa-0000-4000-8000-000000000005',
                  '5555aaaa-0000-4000-8000-000000000006',
                  '5555aaaa-0000-4000-8000-000000000007')$$,
  'a doctor reviews and releases R5, R6 and R7');

SELECT is(
  (SELECT count(*)::int FROM public.lab_results
    WHERE id IN ('5555aaaa-0000-4000-8000-000000000005',
                 '5555aaaa-0000-4000-8000-000000000006',
                 '5555aaaa-0000-4000-8000-000000000007')
      AND reviewed_at IS NOT NULL AND released_to_patient_at IS NOT NULL),
  3,
  'R5, R6 and R7 are reviewed and released');

SELECT is(
  (SELECT count(*)::int FROM public.lab_result_release_log
    WHERE result_id = '5555aaaa-0000-4000-8000-000000000004'),
  3,
  'R4''s review, release and withhold are in the release log');

SELECT lives_ok(
  $$UPDATE public.lab_results
       SET released_to_patient_at = now(), released_to_patient_by = 'someone'
     WHERE id = '5555aaaa-0000-4000-8000-000000000002'$$,
  'a direct UPDATE of the release columns runs without error');

SELECT is(
  (SELECT released_to_patient_at FROM public.lab_results
    WHERE id = '5555aaaa-0000-4000-8000-000000000002'),
  NULL,
  'a direct UPDATE cannot release a result (only the RPCs can)');

SELECT throws_ok(
  $$UPDATE public.lab_results SET result_value = '99'
     WHERE id = '5555aaaa-0000-4000-8000-000000000007'$$,
  '42501', NULL,
  'staff cannot rewrite a recorded value through the API');

SELECT lives_ok(
  $$UPDATE public.lab_results SET interpretation = 'abnormal'
     WHERE id = '5555aaaa-0000-4000-8000-000000000007'$$,
  'a lab_review holder changes R7''s interpretation');

SELECT ok(
  (SELECT reviewed_at IS NULL AND released_to_patient_at IS NULL AND amended_at IS NOT NULL
     FROM public.lab_results WHERE id = '5555aaaa-0000-4000-8000-000000000007'),
  'changing the interpretation clears R7''s review and release');

-- A nurse (vitals, no lab_review / lab_release)
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.lab_review_result('5555aaaa-0000-4000-8000-000000000001', false)$$,
  '42501', NULL,
  'a nurse cannot review a result');

SELECT throws_ok(
  $$SELECT public.lab_release_result('5555aaaa-0000-4000-8000-000000000002', NULL)$$,
  '42501', NULL,
  'a nurse cannot release a result');

SELECT is_empty(
  $$SELECT 1 FROM public.lab_result_release_log$$,
  'a nurse cannot read the release log');

-- ---------------------------------------------------------------------------
-- Portal patient 1: only released, not withheld results, and only by RPC
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-0000000000a1","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.portal_my_lab_results(100, NULL)),
  1,
  'patient 1 sees exactly one result');

SELECT is(
  (SELECT result_id FROM public.portal_my_lab_results(100, NULL)),
  '5555aaaa-0000-4000-8000-000000000003'::uuid,
  'the one result is the released R3');

SELECT is(
  (SELECT patient_note FROM public.portal_my_lab_results(100, NULL)),
  'pgTAP note',
  'the release note comes with it');

SELECT is_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)
     WHERE result_id = '5555aaaa-0000-4000-8000-000000000001'$$,
  'an unreviewed result is not visible');

SELECT is_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)
     WHERE result_id = '5555aaaa-0000-4000-8000-000000000002'$$,
  'a reviewed but unreleased result is not visible');

SELECT is_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)
     WHERE result_id = '5555aaaa-0000-4000-8000-000000000004'$$,
  'a withheld result is not visible');

SELECT is_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, 'pgtap-lab-2')$$,
  'asking for another patient''s record returns nothing');

SELECT is_empty(
  $$SELECT 1 FROM public.lab_results$$,
  'a portal patient cannot SELECT lab_results directly');

SELECT is_empty(
  $$SELECT 1 FROM public.lab_orders$$,
  'a portal patient cannot SELECT lab_orders directly');

-- ---------------------------------------------------------------------------
-- A changed value clears review and release (for every writer)
-- ---------------------------------------------------------------------------
RESET ROLE;
UPDATE public.lab_results SET result_value = '3.5'
 WHERE id = '5555aaaa-0000-4000-8000-000000000003';

SELECT ok(
  (SELECT reviewed_at IS NULL AND released_to_patient_at IS NULL AND amended_at IS NOT NULL
     FROM public.lab_results WHERE id = '5555aaaa-0000-4000-8000-000000000003'),
  'changing R3''s value clears its review and release');

SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)$$,
  'patient 1 no longer sees R3 (or R7)');

-- ---------------------------------------------------------------------------
-- Portal access turned off: zero rows
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-0000000000a2","role":"authenticated"}';

SELECT isnt_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)$$,
  'patient 2 sees the released R5 while portal access is on');

SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  public.set_patient_portal_access(
    '5555c0de-0000-4000-8000-000000000001', 'pgtap-lab-2', false,
    'staff_choice', clock_timestamp(), 'device-doctor', 'staff') ->> 'outcome',
  'applied',
  'a doctor turns portal access off for patient 2');

SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-0000000000a2","role":"authenticated"}';

SELECT is_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)$$,
  'patient 2 gets zero rows once portal access is off');

-- ---------------------------------------------------------------------------
-- Merged-away record: zero rows
-- (Both records have their own sign-in, so the merged-away one's sign-in
-- does not move to the kept record.)
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-0000000000a3","role":"authenticated"}';

SELECT isnt_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)$$,
  'patient 3 sees the released R6 before the merge');

SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  public.merge_patients(
    '5555c0de-0000-4000-8000-000000000002', 'pgtap-lab-4', 'pgtap-lab-3',
    '{}'::jsonb, 'device-doctor', now(), 'dedupe_modal') ->> 'outcome',
  'applied',
  'a doctor merges record 3 into record 4');

SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-0000000000a3","role":"authenticated"}';

SELECT is_empty(
  $$SELECT 1 FROM public.portal_my_lab_results(100, NULL)$$,
  'the merged-away record''s portal account gets zero rows');

SET LOCAL request.jwt.claims = '{"sub":"55550000-0000-4000-8000-0000000000a4","role":"authenticated"}';

SELECT is(
  (SELECT result_id FROM public.portal_my_lab_results(100, NULL)),
  '5555aaaa-0000-4000-8000-000000000006'::uuid,
  'the kept record''s portal account sees R6, which moved with the merge');

-- ---------------------------------------------------------------------------
-- A release without a review violates lab_results_release_requires_review
-- (the release RPCs set mbhr.lab_release; the check is the last line of
-- defence for any code that does the same)
-- ---------------------------------------------------------------------------
RESET ROLE;
SET LOCAL mbhr.lab_release = 'on';

SELECT throws_ok(
  $$INSERT INTO public.lab_results (
      order_id, result_value, interpretation, released_to_patient_at, released_to_patient_by)
    VALUES ('5555b0b0-0000-4000-8000-000000000001', '8.0', 'normal', now(), 'someone')$$,
  '23514',
  'new row for relation "lab_results" violates check constraint "lab_results_release_requires_review"',
  'a release without a review violates lab_results_release_requires_review');

SET LOCAL mbhr.lab_release = 'off';

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lab_results'
      AND column_name = 'interpretation'),
  NULL,
  'lab_results.interpretation has no default (an omitted value is never filed as normal)');

SELECT * FROM finish();
ROLLBACK;
