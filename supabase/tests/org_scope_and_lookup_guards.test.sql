-- pgTAP: organization memberships, merged-record lookups and opening stock
-- Migration under test: supabase/migrations/20260927100180_org_scope_and_lookup_guards.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('88880000-0000-4000-8000-0000000000c1', 'pgTAP admin A', 'admin'),
  ('88880000-0000-4000-8000-0000000000c2', 'pgTAP admin B', 'admin'),
  ('88880000-0000-4000-8000-0000000000c3', 'pgTAP volunteer A', 'volunteer'),
  ('88880000-0000-4000-8000-0000000000c4', 'pgTAP nurse', 'nurse'),
  ('88880000-0000-4000-8000-0000000000c5', 'pgTAP guest', 'guest'),
  ('88880000-0000-4000-8000-0000000000c6', 'pgTAP pharmacist', 'pharmacist');

INSERT INTO public.organizations (id, name, slug) VALUES
  ('88880000-0000-4000-8000-00000000a0a0', 'pgTAP Org A', 'pgtap-org-a'),
  ('88880000-0000-4000-8000-00000000b0b0', 'pgTAP Org B', 'pgtap-org-b');
INSERT INTO public.sites (id, org_id, name, site_code, address, state, lga) VALUES
  ('88880000-0000-4000-8000-00000000a0a1', '88880000-0000-4000-8000-00000000a0a0', 'pgTAP Site A1', 'PGA1', '1 Road', 'Lagos', 'Ikeja'),
  ('88880000-0000-4000-8000-00000000a0a2', '88880000-0000-4000-8000-00000000a0a0', 'pgTAP Site A2', 'PGA2', '2 Road', 'Lagos', 'Ikeja'),
  ('88880000-0000-4000-8000-00000000b0b1', '88880000-0000-4000-8000-00000000b0b0', 'pgTAP Site B1', 'PGB1', '3 Road', 'Oyo', 'Ibadan');
INSERT INTO public.user_org_sites (id, user_id, org_id, site_id) VALUES
  ('88880000-0000-4000-8000-0000000001a1', '88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-00000000a0a0', '88880000-0000-4000-8000-00000000a0a1'),
  ('88880000-0000-4000-8000-0000000001b2', '88880000-0000-4000-8000-0000000000c2', '88880000-0000-4000-8000-00000000b0b0', '88880000-0000-4000-8000-00000000b0b1'),
  ('88880000-0000-4000-8000-0000000001a3', '88880000-0000-4000-8000-0000000000c3', '88880000-0000-4000-8000-00000000a0a0', '88880000-0000-4000-8000-00000000a0a1');

-- A portal patient (no staff row) with their record, a record of theirs that
-- was merged into it, and a stranger's merged record.
INSERT INTO public.patients (id, given_name, family_name, phone, auth_uid) VALUES
  ('pgtap-scope-me', 'Ada', 'Mine', '08000000081', '88880000-0000-4000-8000-0000000000d1'),
  ('pgtap-scope-surv', 'Bola', 'Survivor', '08000000082', NULL);
UPDATE public.patients SET portal_enabled = true WHERE id = 'pgtap-scope-me';
INSERT INTO public.patients (id, given_name, family_name, phone, merged_into) VALUES
  ('pgtap-scope-mine-old', 'Ada', 'Mine', '08000000083', 'pgtap-scope-me'),
  ('pgtap-scope-loser', 'Bola', 'Survivor', '08000000084', 'pgtap-scope-surv');

INSERT INTO public.pharmacy_items (id, med_name, form, strength, unit, on_hand_qty, is_controlled, is_active, site_key) VALUES
  ('pgtap-scope-item-a', 'Pgtap Zinc', 'tablet', '20 mg', 'tablet', 0, false, true, 'pgtap-scope-site-a'),
  ('pgtap-scope-item-b', 'Pgtap Zinc', 'tablet', '20 mg', 'tablet', 0, false, true, 'pgtap-scope-site-b'),
  ('pgtap-scope-item-n', 'Pgtap ORS', 'sachet', '20.5 g', 'sachet', 0, false, true, NULL);

-- ---------------------------------------------------------------------------
-- 1. Merged-record lookup
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000d1","role":"authenticated"}';
SELECT is(public.canonical_patient_id('pgtap-scope-loser'), 'pgtap-scope-loser',
  'a portal patient is not told where a stranger''s merged record went');
SELECT is(public.canonical_patient_id('pgtap-scope-mine-old'), 'pgtap-scope-me',
  'a portal patient is told when their own old record went to their record');
SELECT is(public.canonical_patient_id('pgtap-scope-me'), 'pgtap-scope-me',
  'a portal patient''s own record comes back unchanged');

SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000c5","role":"authenticated"}';
SELECT is(public.canonical_patient_id('pgtap-scope-loser'), 'pgtap-scope-loser',
  'a guest account is not told where a merged record went');

SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000c4","role":"authenticated"}';
SELECT is(public.canonical_patient_id('pgtap-scope-loser'), 'pgtap-scope-surv',
  'staff keep the full lookup');
RESET ROLE;

SET LOCAL request.jwt.claims = '{}';
SELECT is(public.canonical_patient_id('pgtap-scope-loser'), 'pgtap-scope-surv',
  'with no signed-in account (service role, migrations) the lookup is unchanged');

-- ---------------------------------------------------------------------------
-- 2. Memberships stay within the caller's organizations
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$UPDATE public.user_org_sites
       SET org_id = '88880000-0000-4000-8000-00000000b0b0', site_id = '88880000-0000-4000-8000-00000000b0b1'
     WHERE user_id = '88880000-0000-4000-8000-0000000000c1'$$,
  '42501', NULL,
  'an admin cannot move their own membership to another organization');
SELECT is(ARRAY(SELECT public.app_org_ids()), ARRAY['88880000-0000-4000-8000-00000000a0a0'],
  'the admin still belongs only to their own organization');
SELECT throws_ok(
  $$UPDATE public.user_org_sites
       SET org_id = '88880000-0000-4000-8000-00000000b0b0', site_id = NULL
     WHERE user_id = '88880000-0000-4000-8000-0000000000c3'$$,
  '42501', NULL,
  'an admin cannot move a colleague''s membership to another organization');
SELECT throws_ok(
  $$INSERT INTO public.user_org_sites (user_id, org_id, site_id) VALUES
      ('88880000-0000-4000-8000-0000000000c3', '88880000-0000-4000-8000-00000000a0a0', '88880000-0000-4000-8000-00000000b0b1')$$,
  '42501', 'That site is not in that organization.',
  'a membership cannot name a site of another organization');
SELECT lives_ok(
  $$INSERT INTO public.user_org_sites (user_id, org_id, site_id) VALUES
      ('88880000-0000-4000-8000-0000000000c3', '88880000-0000-4000-8000-00000000a0a0', '88880000-0000-4000-8000-00000000a0a2')$$,
  'an admin adds a colleague to another site of their organization');
SELECT lives_ok(
  $$UPDATE public.user_org_sites SET site_id = '88880000-0000-4000-8000-00000000a0a2'
     WHERE id = '88880000-0000-4000-8000-0000000001a1'$$,
  'an admin moves a membership between sites of their organization');

SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000c3","role":"authenticated"}';
SELECT lives_ok(
  $$UPDATE public.user_org_sites SET is_default = true WHERE id = '88880000-0000-4000-8000-0000000001a3'$$,
  'staff still choose their default site');
SELECT throws_ok(
  $$UPDATE public.user_org_sites SET site_id = '88880000-0000-4000-8000-00000000a0a2'
     WHERE id = '88880000-0000-4000-8000-0000000001a3'$$,
  '42501', NULL,
  'staff without ''users'' cannot move their own membership');

-- ---------------------------------------------------------------------------
-- 3. Organizations and sites
-- ---------------------------------------------------------------------------
UPDATE public.organizations SET name = 'pgTAP renamed by volunteer', is_active = false
 WHERE id = '88880000-0000-4000-8000-00000000a0a0';
DELETE FROM public.organizations WHERE id = '88880000-0000-4000-8000-00000000a0a0';
UPDATE public.sites SET name = 'pgTAP site renamed by volunteer' WHERE id = '88880000-0000-4000-8000-00000000a0a1';
DELETE FROM public.sites WHERE id = '88880000-0000-4000-8000-00000000a0a1';
SELECT is((SELECT count(*) FROM public.organizations WHERE id = '88880000-0000-4000-8000-00000000a0a0'), 1::bigint,
  'a volunteer still sees their organization');

SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000c1","role":"authenticated"}';
UPDATE public.organizations SET name = 'pgTAP Org A renamed' WHERE id = '88880000-0000-4000-8000-00000000a0a0';
UPDATE public.organizations SET name = 'pgTAP Org B renamed by A' WHERE id = '88880000-0000-4000-8000-00000000b0b0';
DELETE FROM public.organizations WHERE id = '88880000-0000-4000-8000-00000000a0a0';
DELETE FROM public.sites WHERE id = '88880000-0000-4000-8000-00000000a0a2';
SELECT throws_ok(
  $$INSERT INTO public.sites (org_id, name, site_code, address, state, lga) VALUES
      ('88880000-0000-4000-8000-00000000b0b0', 'pgTAP intruder site', 'PGX', '9 Road', 'Oyo', 'Ibadan')$$,
  '42501', NULL,
  'an admin cannot add a site to another organization');
SELECT lives_ok(
  $$INSERT INTO public.sites (org_id, name, site_code, address, state, lga) VALUES
      ('88880000-0000-4000-8000-00000000a0a0', 'pgTAP Site A3', 'PGA3', '4 Road', 'Lagos', 'Ikeja')$$,
  'an admin adds a site to their organization');
SELECT throws_ok(
  $$UPDATE public.sites SET org_id = '88880000-0000-4000-8000-00000000b0b0'
     WHERE id = '88880000-0000-4000-8000-00000000a0a1'$$,
  '42501', NULL,
  'an admin cannot move a site to another organization');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';

SELECT is((SELECT (name, is_active)::text FROM public.organizations WHERE id = '88880000-0000-4000-8000-00000000a0a0'),
  '("pgTAP Org A renamed",t)',
  'only the admin''s rename of their own organization took effect');
SELECT is((SELECT name FROM public.organizations WHERE id = '88880000-0000-4000-8000-00000000b0b0'), 'pgTAP Org B',
  'another organization is not renamed');
SELECT is((SELECT count(*) FROM public.sites WHERE org_id = '88880000-0000-4000-8000-00000000a0a0'), 3::bigint,
  'no site was deleted, and the admin''s new site was added');
SELECT is((SELECT name FROM public.sites WHERE id = '88880000-0000-4000-8000-00000000a0a1'), 'pgTAP Site A1',
  'a volunteer cannot rename a site');
SELECT is((SELECT count(*) FROM public.user_org_sites WHERE org_id = '88880000-0000-4000-8000-00000000b0b0'), 1::bigint,
  'the other organization still has only its own member');
SELECT is((SELECT is_default FROM public.user_org_sites WHERE id = '88880000-0000-4000-8000-0000000001a3'), true,
  'the volunteer''s default site was saved');

-- ---------------------------------------------------------------------------
-- 4. Opening stock goes onto that site's medicines
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88880000-0000-4000-8000-0000000000c6","role":"authenticated"}';
SELECT is(
  public.rx_receive_stock(
    '8888c0de-0000-4000-8000-000000000001', 'pgtap-scope-mv-1',
    jsonb_build_object('id', 'pgtap-scope-lot-1', 'item_id', 'pgtap-scope-item-a',
                       'lot_number', 'S1', 'expiry_date', (current_date + 300)::text),
    5, 'opening_balance', now(), 'device-pharmacist', 'pgtap-scope-site-b', 'pgtap-scope-dev-x') ->> 'reason',
  'site_mismatch',
  'opening stock for a site is refused on another site''s medicine');
SELECT is(
  public.rx_receive_stock(
    '8888c0de-0000-4000-8000-000000000002', 'pgtap-scope-mv-2',
    jsonb_build_object('id', 'pgtap-scope-lot-2', 'item_id', 'pgtap-scope-item-b',
                       'lot_number', 'S2', 'expiry_date', (current_date + 300)::text),
    5, 'opening_balance', now(), 'device-pharmacist', 'pgtap-scope-site-b', 'pgtap-scope-dev-b') ->> 'outcome',
  'applied',
  'the refused upload did not take the site''s opening upload');
SELECT is(
  public.rx_receive_stock(
    '8888c0de-0000-4000-8000-000000000003', 'pgtap-scope-mv-3',
    jsonb_build_object('id', 'pgtap-scope-lot-3', 'item_id', 'pgtap-scope-item-n',
                       'lot_number', 'S3', 'expiry_date', (current_date + 300)::text),
    5, 'opening_balance', now(), 'device-pharmacist', 'pgtap-scope-site-b', 'pgtap-scope-dev-b') ->> 'outcome',
  'applied',
  'a medicine with no site takes any site''s opening stock');
-- An upload refused because its lot is another medicine's.
SELECT is(
  public.rx_receive_stock(
    '8888c0de-0000-4000-8000-000000000004', 'pgtap-scope-mv-4',
    jsonb_build_object('id', 'pgtap-scope-lot-2', 'item_id', 'pgtap-scope-item-n',
                       'lot_number', 'S2', 'expiry_date', (current_date + 300)::text),
    5, 'opening_balance', now(), 'device-pharmacist', 'pgtap-scope-site-c', 'pgtap-scope-dev-x') ->> 'reason',
  'batch_item_mismatch',
  'opening stock on another medicine''s lot is refused');
SELECT is(
  public.rx_receive_stock(
    '8888c0de-0000-4000-8000-000000000005', 'pgtap-scope-mv-5',
    jsonb_build_object('id', 'pgtap-scope-lot-5', 'item_id', 'pgtap-scope-item-n',
                       'lot_number', 'S5', 'expiry_date', (current_date + 300)::text),
    5, 'opening_balance', now(), 'device-pharmacist', 'pgtap-scope-site-c', 'pgtap-scope-dev-c') ->> 'outcome',
  'applied',
  'and it did not take that site''s opening upload');
RESET ROLE;
SET LOCAL request.jwt.claims = '{}';
SELECT is(
  (SELECT count(*) FROM public.stock_movements WHERE id IN ('pgtap-scope-mv-1', 'pgtap-scope-mv-2', 'pgtap-scope-mv-3')),
  2::bigint,
  'only the accepted uploads moved stock');

SELECT * FROM finish();
ROLLBACK;
