-- pgTAP: the registration_lead role, the portal_invite permission and the
-- portal invitation check / audit trail
-- Migration under test:
--   supabase/migrations/20260925100600_registration_lead_portal_invite.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(52);

-- ---------------------------------------------------------------------------
-- The permission matrix (public.app_role_has_permission)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE pgtap_perms (p text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO pgtap_perms VALUES
  ('register'), ('vitals'), ('consult'), ('dispense'), ('inventory'),
  ('export'), ('users'), ('approve_phi_conflicts'), ('audit_access'),
  ('resolve_conflicts'), ('lab_review'), ('queue'), ('portal_manage'),
  ('merge_patients'), ('lab_release'), ('portal_invite');
GRANT SELECT ON pgtap_perms TO PUBLIC;

CREATE TEMP TABLE pgtap_roles (r text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO pgtap_roles VALUES
  ('admin'), ('doctor'), ('nurse'), ('pharmacist'), ('volunteer'), ('guest'),
  ('auditor'), ('lead_clinician'), ('registration_lead'), ('chw');
GRANT SELECT ON pgtap_roles TO PUBLIC;

SELECT is(
  ARRAY(SELECT p FROM pgtap_perms
         WHERE public.app_role_has_permission('registration_lead', p) ORDER BY p),
  ARRAY['portal_invite', 'portal_manage', 'queue', 'register']::text[],
  'registration_lead holds exactly register, queue, portal_manage and portal_invite');

SELECT ok(
  NOT public.app_role_has_permission('registration_lead', 'vitals')
  AND public.app_role_has_permission('volunteer', 'vitals'),
  'registration_lead has no vitals (owner decision); volunteers keep vitals');

SELECT is(
  ARRAY(SELECT p FROM pgtap_perms
         WHERE public.app_role_has_permission('registration_lead', p)
           AND p <> 'portal_invite' ORDER BY p),
  ARRAY(SELECT p FROM pgtap_perms
         WHERE public.app_role_has_permission('volunteer', p)
           AND p <> 'vitals' ORDER BY p),
  'registration_lead = the volunteer permissions without vitals, plus portal_invite');

SELECT is(
  ARRAY(SELECT r FROM pgtap_roles
         WHERE public.app_role_has_permission(r, 'portal_invite') ORDER BY r),
  ARRAY['admin', 'lead_clinician', 'registration_lead']::text[],
  'portal_invite holders: admin, lead_clinician, registration_lead');

SELECT ok(
  NOT public.app_role_has_permission('volunteer', 'portal_invite'),
  'a volunteer cannot send portal invitations');

SELECT ok(
  public.app_role_has_permission('volunteer', 'portal_manage'),
  'a volunteer still manages portal access (enables it at registration)');

SELECT ok(
  NOT public.app_role_has_permission('nurse', 'portal_invite')
  AND NOT public.app_role_has_permission('doctor', 'portal_invite')
  AND NOT public.app_role_has_permission('pharmacist', 'portal_invite')
  AND NOT public.app_role_has_permission('auditor', 'portal_invite')
  AND NOT public.app_role_has_permission('guest', 'portal_invite'),
  'nurse, doctor, pharmacist, auditor and guest cannot send portal invitations');

-- Parity-critical rows of the confirmed role policy (unchanged here).
SELECT is(
  ARRAY(SELECT r FROM pgtap_roles
         WHERE public.app_role_has_permission(r, 'queue') ORDER BY r),
  ARRAY['admin', 'doctor', 'lead_clinician', 'nurse', 'pharmacist',
        'registration_lead', 'volunteer']::text[],
  'queue: station staff, pharmacist included');

SELECT is(
  ARRAY(SELECT r FROM pgtap_roles
         WHERE public.app_role_has_permission(r, 'merge_patients') ORDER BY r),
  ARRAY['admin', 'auditor', 'doctor', 'lead_clinician', 'nurse']::text[],
  'merge_patients: auditor included, volunteer and registration_lead excluded');

SELECT is(
  ARRAY(SELECT r FROM pgtap_roles
         WHERE public.app_role_has_permission(r, 'lab_release') ORDER BY r),
  ARRAY(SELECT r FROM pgtap_roles
         WHERE public.app_role_has_permission(r, 'lab_review') ORDER BY r),
  'lab_release holders = lab_review holders');

SELECT is(
  ARRAY(SELECT r FROM pgtap_roles
         WHERE public.app_role_has_permission(r, 'lab_review') ORDER BY r),
  ARRAY['admin', 'doctor', 'lead_clinician']::text[],
  'lab_review holders: doctor, lead_clinician, admin');

SELECT is(
  (SELECT count(*)::integer FROM pgtap_perms
    WHERE public.app_role_has_permission('guest', p)
       OR public.app_role_has_permission('chw', p)
       OR public.app_role_has_permission('not_a_role', p)
       OR public.app_role_has_permission(NULL, p)),
  0,
  'guest, legacy chw, unknown roles and NULL hold nothing');

SELECT ok(
  NOT public.app_role_has_permission('admin', 'not_a_permission'),
  'an unknown permission is refused, even for admin');

SELECT is(
  (SELECT count(*)::integer FROM pgtap_perms
    WHERE public.app_role_has_permission('admin', p)),
  16,
  'admin holds every permission the app knows (16)');

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: row-level security and the API-role
-- guards do not apply to this role)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.app_users (id, full_name, role) VALUES
      ('66660000-0000-4000-8000-000000000001', 'pgTAP registration lead', 'registration_lead')$$,
  'app_users accepts the registration_lead role');

INSERT INTO public.app_users (id, full_name, role) VALUES
  ('66660000-0000-4000-8000-000000000002', 'pgTAP volunteer', 'volunteer'),
  ('66660000-0000-4000-8000-000000000003', 'pgTAP nurse', 'nurse'),
  ('66660000-0000-4000-8000-000000000004', 'pgTAP pharmacist', 'pharmacist'),
  ('66660000-0000-4000-8000-000000000005', 'pgTAP lead clinician', 'lead_clinician'),
  ('66660000-0000-4000-8000-000000000006', 'pgTAP auditor', 'auditor');

-- inv-1: access on, phone and email. inv-2: access off. inv-3: merged into
-- inv-1. inv-4: access on, email only. A recorded decision
-- (portal_enabled_changed_at) keeps auto-enrolment away from these rows.
INSERT INTO public.patients (
  id, given_name, family_name, phone, email, portal_enabled, portal_enabled_changed_at)
VALUES
  ('pgtap-inv-1', 'Ngozi', 'Invite', '08000000061', 'pgtap-inv-1@example.org', true, now()),
  ('pgtap-inv-2', 'Bola', 'Invite', '08000000062', NULL, false, now()),
  ('pgtap-inv-3', 'Ngozi', 'Invite', '08000000063', NULL, true, now()),
  ('pgtap-inv-4', 'Sani', 'Invite', NULL, 'pgtap-inv-4@example.org', true, now());
UPDATE public.patients SET merged_into = 'pgtap-inv-1', merged_at = now()
 WHERE id = 'pgtap-inv-3';

-- ---------------------------------------------------------------------------
-- A registration lead is staff with registration-desk access
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(public.app_current_role(), 'registration_lead', 'the caller''s role is registration_lead');
SELECT ok(public.app_is_staff(), 'a registration lead counts as staff');
SELECT ok(public.app_has_permission('portal_invite'), 'a registration lead holds portal_invite');
SELECT ok(NOT public.app_has_permission('merge_patients'), 'a registration lead cannot merge patients');
SELECT ok(NOT public.app_has_permission('vitals'), 'a registration lead cannot record vital signs');
SELECT ok(public.app_has_permission('queue'), 'a registration lead moves patients through the queue');
SELECT isnt_empty(
  $$SELECT 1 FROM public.patients WHERE id = 'pgtap-inv-1'$$,
  'a registration lead can read patient records');
SELECT lives_ok(
  $$UPDATE public.patients SET portal_invited_at = now() WHERE id = 'pgtap-inv-1'$$,
  'a registration lead can record that an invitation went out (portal_invited_at)');

-- queue_transitions uploads follow the queue permission (section 7), so a
-- registration lead's queue history is accepted at sync.
SELECT ok(
  (SELECT with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'queue_transitions'
      AND policyname = 'queue_transitions_insert_queue_staff') ~ 'app_has_permission\(''queue''',
  'queue_transitions uploads are allowed by the queue permission, not a role list');

-- Clients never call the invitation functions or write the audit table.
SELECT throws_ok(
  $$SELECT public.portal_invitation_begin('66660000-0000-4000-8000-000000000001', 'pgtap-inv-1', 'sms')$$,
  '42501', NULL,
  'a signed-in user cannot call portal_invitation_begin (service role only)');
SELECT throws_ok(
  $$SELECT public.portal_invitation_finish(gen_random_uuid(), 'sent')$$,
  '42501', NULL,
  'a signed-in user cannot call portal_invitation_finish (service role only)');
SELECT throws_ok(
  $$INSERT INTO public.portal_invitation_events (
      invitation_id, event, patient_id, channel, actor_id, actor_role)
    VALUES (gen_random_uuid(), 'sent', 'pgtap-inv-1', 'sms',
            '66660000-0000-4000-8000-000000000001', 'registration_lead')$$,
  '42501', NULL,
  'a signed-in user cannot write the invitation audit trail');
RESET ROLE;

-- Register holders who cannot invite cannot set portal_invited_at.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT throws_ok(
  $$UPDATE public.patients SET portal_invited_at = now() - interval '1 day' WHERE id = 'pgtap-inv-1'$$,
  '42501', NULL,
  'a volunteer cannot change portal_invited_at');
SELECT lives_ok(
  $$UPDATE public.patients SET address = 'pgTAP address' WHERE id = 'pgtap-inv-1'$$,
  'a volunteer still updates other patient details');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  $$UPDATE public.patients SET portal_invited_at = now() - interval '1 day' WHERE id = 'pgtap-inv-1'$$,
  '42501', NULL,
  'a nurse cannot change portal_invited_at');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- The invitation check (what send-sms-reminder / send-otp-email run for
-- purpose "portal_invitation", as the service role)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;

CREATE TEMP TABLE pgtap_inv (k text PRIMARY KEY, r jsonb) ON COMMIT DROP;

INSERT INTO pgtap_inv VALUES ('lead_sms',
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000001', 'pgtap-inv-1', 'sms'));
SELECT is(
  (SELECT r - 'invitation_id' FROM pgtap_inv WHERE k = 'lead_sms'),
  jsonb_build_object(
    'allowed', true, 'patient_id', 'pgtap-inv-1', 'given_name', 'Ngozi',
    'recipient', '08000000061', 'actor_role', 'registration_lead'),
  'a registration lead may invite by SMS; the recipient is the stored phone');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000005', 'pgtap-inv-1', 'email') ->> 'recipient',
  'pgtap-inv-1@example.org',
  'a lead clinician may invite by email; the recipient is the stored email');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000002', 'pgtap-inv-1', 'sms'),
  '{"allowed": false, "reason": "not_permitted"}'::jsonb,
  'a volunteer is refused (not_permitted)');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000003', 'pgtap-inv-1', 'sms') ->> 'reason',
  'not_permitted',
  'a nurse is refused');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000004', 'pgtap-inv-1', 'sms') ->> 'reason',
  'not_permitted',
  'a pharmacist (medication reminder sender) cannot send an invitation');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-0000000000ff', 'pgtap-inv-1', 'sms') ->> 'reason',
  'not_permitted',
  'an account with no staff record is refused');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000001', 'pgtap-inv-2', 'sms') ->> 'reason',
  'portal_not_enabled',
  'no invitation while portal access is off on the server');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000001', 'pgtap-inv-3', 'sms') ->> 'reason',
  'patient_merged',
  'no invitation for a merged-away record');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000001', 'pgtap-no-such', 'sms') ->> 'reason',
  'patient_not_found',
  'no invitation for a patient not on the server');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000001', 'pgtap-inv-4', 'sms') ->> 'reason',
  'no_contact',
  'no SMS invitation for a patient without a stored phone');

SELECT is(
  public.portal_invitation_begin('66660000-0000-4000-8000-000000000001', 'pgtap-inv-1', 'whatsapp') ->> 'reason',
  'invalid_channel',
  'only sms and email are invitation channels');

-- The audit trail: requests are recorded, refusals are not.
SELECT is(
  (SELECT count(*)::integer FROM public.portal_invitation_events
    WHERE patient_id LIKE 'pgtap-inv-%' AND event = 'requested'),
  2,
  'only the two allowed invitations were recorded as requested');

SELECT is(
  (SELECT jsonb_build_object('actor', actor_id::text, 'role', actor_role, 'channel', channel)
     FROM public.portal_invitation_events
    WHERE invitation_id = (SELECT (r ->> 'invitation_id')::uuid FROM pgtap_inv WHERE k = 'lead_sms')),
  jsonb_build_object('actor', '66660000-0000-4000-8000-000000000001',
                     'role', 'registration_lead', 'channel', 'sms'),
  'the request records who sent it, their role and the channel');

SELECT ok(
  public.portal_invitation_finish(
    (SELECT (r ->> 'invitation_id')::uuid FROM pgtap_inv WHERE k = 'lead_sms'),
    'sent', 'provider_accepted', 'termii', 'pgtap-msg-1'),
  'the outcome is recorded once the provider accepted it');

SELECT ok(
  NOT public.portal_invitation_finish(
    (SELECT (r ->> 'invitation_id')::uuid FROM pgtap_inv WHERE k = 'lead_sms'),
    'not_sent', 'provider_rejected'),
  'a second outcome for the same invitation is ignored (the first is kept)');

SELECT ok(
  NOT public.portal_invitation_finish(gen_random_uuid(), 'sent'),
  'an outcome for an unknown invitation is not recorded');

SELECT throws_ok(
  $$SELECT public.portal_invitation_finish(gen_random_uuid(), 'delivered')$$,
  '22023', NULL,
  'an outcome other than sent / not_sent is refused');
RESET ROLE;

-- Who can read the trail: portal_invite and audit_access holders.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT is_empty(
  $$SELECT 1 FROM public.portal_invitation_events WHERE patient_id LIKE 'pgtap-inv-%'$$,
  'a volunteer cannot read the invitation trail');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66660000-0000-4000-8000-000000000006","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::integer FROM public.portal_invitation_events WHERE patient_id LIKE 'pgtap-inv-%'),
  3,
  'an auditor reads the invitation trail (two requests, one outcome)');
RESET ROLE;

-- Append-only, even for the owner.
SELECT throws_ok(
  $$UPDATE public.portal_invitation_events SET detail = 'x' WHERE patient_id LIKE 'pgtap-inv-%'$$,
  '42501', NULL,
  'invitation events cannot be updated');
SELECT throws_ok(
  $$DELETE FROM public.portal_invitation_events WHERE patient_id LIKE 'pgtap-inv-%'$$,
  '42501', NULL,
  'invitation events cannot be deleted');
SELECT throws_ok(
  $$TRUNCATE public.portal_invitation_events$$,
  '42501', NULL,
  'the invitation trail cannot be truncated');

SELECT * FROM finish();
ROLLBACK;
