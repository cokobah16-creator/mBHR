-- pgTAP: patient merges are server-authoritative
-- Migration under test: supabase/migrations/20260925100300_patient_merge_authoritative.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.
--
-- "X into Y" below means merge_patients(p_winner_id => Y, p_loser_id => X):
-- X is the merged-away record, Y the kept record.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: guards and row-level security do not
-- apply to this role)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('33330000-0000-4000-8000-000000000001', 'pgTAP nurse', 'nurse'),
  ('33330000-0000-4000-8000-000000000002', 'pgTAP volunteer', 'volunteer');

INSERT INTO public.patients (id, given_name, family_name, phone, auth_uid) VALUES
  ('pgtap-merge-a', 'Amina', 'Merge', '08000000011', NULL),
  ('pgtap-merge-b', 'Amina', 'Merge', '08000000012', NULL),
  ('pgtap-merge-c', 'Amina', 'Merge', '08000000013', NULL),
  ('pgtap-merge-d', 'Dele',  'Merge', '08000000014', '33330000-0000-4000-8000-0000000000d1'),
  ('pgtap-merge-e', 'Dele',  'Merge', '08000000015', NULL),
  ('pgtap-merge-f', 'Femi',  'Merge', '08000000016', '33330000-0000-4000-8000-0000000000f1'),
  ('pgtap-merge-g', 'Femi',  'Merge', '08000000017', '33330000-0000-4000-8000-0000000000e1');

INSERT INTO public.vitals (id, patient_id, pulse_bpm, taken_at)
VALUES ('pgtap-merge-vital-1', 'pgtap-merge-a', 72, now());

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33330000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- A merge applies: the merged-away record points at the kept one and its
-- history moves
-- ---------------------------------------------------------------------------
SELECT is(
  public.merge_patients(
    '3333c0de-0000-4000-8000-000000000001', 'pgtap-merge-b', 'pgtap-merge-a',
    '{}'::jsonb, 'device-nurse', now(), 'dedupe_modal') ->> 'outcome',
  'applied',
  'a nurse (merge_patients) merges A into B');

SELECT is(
  (SELECT merged_into FROM public.patients WHERE id = 'pgtap-merge-a'),
  'pgtap-merge-b',
  'A now points at B');

SELECT is(
  (SELECT patient_id FROM public.vitals WHERE id = 'pgtap-merge-vital-1'),
  'pgtap-merge-b',
  'A''s vitals moved to B');

SELECT is(
  (SELECT result -> 'moved_counts' ->> 'vitals' FROM public.command_receipts
    WHERE command_id = '3333c0de-0000-4000-8000-000000000001'),
  '1',
  'the result counts the moved vitals row');

-- ---------------------------------------------------------------------------
-- (2) The same command id twice: identical stored result, one history row
-- ---------------------------------------------------------------------------
SELECT is(
  public.merge_patients(
    '3333c0de-0000-4000-8000-000000000001', 'pgtap-merge-b', 'pgtap-merge-a',
    '{}'::jsonb, 'device-nurse', now(), 'dedupe_modal'),
  (SELECT result FROM public.command_receipts
    WHERE command_id = '3333c0de-0000-4000-8000-000000000001'),
  'resending the command id returns the stored result');

SELECT is(
  (SELECT count(*)::int FROM public.patient_merges
    WHERE command_id = '3333c0de-0000-4000-8000-000000000001'),
  1,
  'the resend added no second history row');

-- ---------------------------------------------------------------------------
-- (1) Cycle: A into B, then B into A
-- ---------------------------------------------------------------------------
SELECT is(
  public.merge_patients(
    '3333c0de-0000-4000-8000-000000000002', 'pgtap-merge-a', 'pgtap-merge-b',
    '{}'::jsonb, 'device-nurse', now(), 'conflict_review') ->> 'reason',
  'cycle',
  'merging B into A after A into B is refused as a cycle');

-- ---------------------------------------------------------------------------
-- (3) A into B, then A into C
-- ---------------------------------------------------------------------------
SELECT is(
  public.merge_patients(
    '3333c0de-0000-4000-8000-000000000003', 'pgtap-merge-c', 'pgtap-merge-a',
    '{}'::jsonb, 'device-nurse', now(), 'conflict_review') ->> 'reason',
  'loser_merged_elsewhere',
  'merging A into C after A into B is refused (loser_merged_elsewhere)');

SELECT is(
  (SELECT result ->> 'outcome' FROM public.command_receipts
    WHERE command_id = '3333c0de-0000-4000-8000-000000000003'),
  'rejected',
  'the refusal is stored, so a resend gets the same answer');

-- ---------------------------------------------------------------------------
-- (9) Records already merged: already_merged with the earlier merge_id
-- ---------------------------------------------------------------------------
SELECT is(
  public.merge_patients(
    '3333c0de-0000-4000-8000-000000000004', 'pgtap-merge-b', 'pgtap-merge-a',
    '{}'::jsonb, 'device-other', now(), 'conflict_review') ->> 'already_merged',
  'true',
  'merging A into B again (another device) answers already_merged');

SELECT is(
  (SELECT result ->> 'merge_id' FROM public.command_receipts
    WHERE command_id = '3333c0de-0000-4000-8000-000000000004'),
  (SELECT id::text FROM public.patient_merges
    WHERE command_id = '3333c0de-0000-4000-8000-000000000001'),
  'already_merged returns the earlier merge_id');

SELECT is(
  (SELECT count(*)::int FROM public.patient_merges WHERE loser_id = 'pgtap-merge-a'),
  1,
  'still one history row for A');

-- ---------------------------------------------------------------------------
-- (4) Late offline writes for A land on B (merge_redirect_patient)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.vitals (id, patient_id, pulse_bpm, taken_at)
    VALUES ('pgtap-merge-vital-2', 'pgtap-merge-a', 80, now())$$,
  'a late vitals upload for A is accepted');

SELECT is(
  (SELECT patient_id FROM public.vitals WHERE id = 'pgtap-merge-vital-2'),
  'pgtap-merge-b',
  'the late vitals row is stored on B');

SELECT lives_ok(
  $$INSERT INTO public.vitals (id, patient_id, pulse_bpm, taken_at)
    VALUES ('pgtap-merge-vital-1', 'pgtap-merge-a', 74, now())
    ON CONFLICT (id) DO UPDATE
      SET patient_id = EXCLUDED.patient_id, pulse_bpm = EXCLUDED.pulse_bpm$$,
  'a late upsert of a moved vitals row naming A is accepted');

SELECT is(
  (SELECT patient_id FROM public.vitals WHERE id = 'pgtap-merge-vital-1'),
  'pgtap-merge-b',
  'the upserted row stays on B');

-- ---------------------------------------------------------------------------
-- (6) Portal sign-in (auth_uid)
-- ---------------------------------------------------------------------------
SELECT is(
  public.merge_patients(
    '3333c0de-0000-4000-8000-000000000005', 'pgtap-merge-e', 'pgtap-merge-d',
    '{}'::jsonb, 'device-nurse', now(), 'dedupe_modal') ->> 'portal_sign_in_moved',
  'true',
  'merging D (has a sign-in) into E (none) moves the sign-in');

SELECT ok(
  (SELECT e.auth_uid::text = '33330000-0000-4000-8000-0000000000d1' AND d.auth_uid IS NULL
     FROM public.patients AS e, public.patients AS d
    WHERE e.id = 'pgtap-merge-e' AND d.id = 'pgtap-merge-d'),
  'the sign-in is now on E only (the unique index holds)');

SELECT is(
  public.merge_patients(
    '3333c0de-0000-4000-8000-000000000006', 'pgtap-merge-g', 'pgtap-merge-f',
    '{}'::jsonb, 'device-nurse', now(), 'dedupe_modal') ->> 'portal_sign_in_moved',
  'false',
  'merging F into G when both have a sign-in does not move it');

SELECT is(
  (SELECT auth_uid::text FROM public.patients WHERE id = 'pgtap-merge-g'),
  '33330000-0000-4000-8000-0000000000e1',
  'the kept record keeps its own sign-in');

-- ---------------------------------------------------------------------------
-- (8) An unknown loser raises PT409 and records nothing
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT public.merge_patients(
      '3333c0de-0000-4000-8000-000000000007', 'pgtap-merge-c', 'pgtap-merge-missing',
      '{}'::jsonb, 'device-nurse', now(), 'dedupe_modal')$$,
  'PT409', NULL,
  'a merged-away record not on the server raises PT409');

SELECT is_empty(
  $$SELECT 1 FROM public.command_receipts
     WHERE command_id = '3333c0de-0000-4000-8000-000000000007'$$,
  'no receipt is stored for the PT409 command');

-- ---------------------------------------------------------------------------
-- History access: merge_patients holders read it; nobody writes it directly
-- ---------------------------------------------------------------------------
SELECT isnt_empty(
  $$SELECT 1 FROM public.patient_merges
     WHERE command_id = '3333c0de-0000-4000-8000-000000000001'$$,
  'a merge_patients holder can read the merge history');

SELECT throws_ok(
  $$INSERT INTO public.patient_merges (id, winner_id, loser_id, merged_by)
    VALUES ('pgtap-merge-direct', 'pgtap-merge-c', 'pgtap-merge-b', 'device-nurse')$$,
  '42501', NULL,
  'staff cannot insert merge history directly');

-- ---------------------------------------------------------------------------
-- (7) A volunteer (no merge_patients)
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"33330000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.merge_patients(
      '3333c0de-0000-4000-8000-000000000008', 'pgtap-merge-c', 'pgtap-merge-b',
      '{}'::jsonb, 'device-volunteer', now(), 'dedupe_modal')$$,
  '42501', NULL,
  'a volunteer cannot merge patients');

SELECT is_empty(
  $$SELECT 1 FROM public.patient_merges$$,
  'a volunteer cannot read the merge history');

SELECT is(
  (SELECT merged_into FROM public.patients WHERE id = 'pgtap-merge-a'),
  'pgtap-merge-b',
  'a volunteer still sees the merge itself on the patient record');

-- ---------------------------------------------------------------------------
-- (5) The history is immutable, even for the table owner
-- ---------------------------------------------------------------------------
RESET ROLE;

SELECT throws_ok(
  $$UPDATE public.patient_merges SET reason = 'edited' WHERE loser_id = 'pgtap-merge-a'$$,
  '42501', NULL,
  'patient_merges rows cannot be updated');

SELECT throws_ok(
  $$DELETE FROM public.patient_merges WHERE loser_id = 'pgtap-merge-a'$$,
  '42501', NULL,
  'patient_merges rows cannot be deleted');

SELECT throws_ok(
  $$TRUNCATE public.patient_merges$$,
  '42501', NULL,
  'patient_merges cannot be truncated');

SELECT * FROM finish();
ROLLBACK;
