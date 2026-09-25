-- ============================================================================
-- Registration lead role, the portal_invite permission, and an audit trail
-- for patient portal invitations
-- ============================================================================
-- Owner decisions:
--   * New staff role 'registration_lead': register, queue, portal_manage
--     and 'portal_invite'. No vitals (owner decision: registration-focused,
--     not clinical; vitals stay with staff assigned to that workflow).
--   * New permission 'portal_invite' = sending a patient portal invitation
--     by SMS or email. Holders: registration_lead, lead_clinician, admin.
--     Not volunteer, nurse, doctor, pharmacist, auditor or guest.
--     Turning portal access on or off stays 'portal_manage' (volunteers
--     still enable access at registration; they cannot send invitations).
--
-- This migration:
--   1. Lets app_users.role hold 'registration_lead' (the user_role enum in
--      production, text with a CHECK in the migration files; both handled).
--   2. Redefines the permission matrix, public.app_role_has_permission()
--      (mirror of ROLE_PERMISSIONS in src/auth/roles.ts, compared by
--      src/auth/roleMatrixParity.test.ts). Every existing grant is kept
--      exactly; the only changes are the new role and portal_invite for
--      admin, lead_clinician and registration_lead.
--   3. Counts 'registration_lead' as staff in public.app_is_staff(), which
--      lists roles by name.
--   4. public.portal_invitation_events: append-only record of every portal
--      invitation the server was asked to send (who, which patient, which
--      channel, when) and what happened to it (sent, or not sent and why).
--      No phone number, email address or message text is stored.
--   5. public.portal_invitation_begin() / portal_invitation_finish(): the
--      server-side purpose check used by the send-sms-reminder and
--      send-otp-email functions for purpose "portal_invitation". The sender
--      must be an active staff account whose role holds portal_invite; the
--      patient must be on the server, not merged away, with portal access
--      on; the recipient comes from the patient record. Service role only.
--   6. patients.portal_invited_at can be changed through the API only by
--      portal_invite holders (it records that an invitation went out).
--   7. queue_transitions uploads follow the 'queue' permission instead of a
--      list of role names, so registration leads' queue moves are accepted.
--
-- Note for production (enum): the new enum label is added in this
-- migration's transaction and can be stored only after it commits. Nothing
-- below casts to it; comparisons use role::text.
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   give every app_users row with role 'registration_lead' another role;
--   DROP TRIGGER app_guard_patient_portal_invited_at ON public.patients;
--   re-create policy queue_transitions_insert_queue_staff from
--     20260924120000_add_queue_transitions_audit.sql;
--   DROP TABLE public.portal_invitation_events;  (drops its triggers; export
--     it first if the invitation history must be kept)
--   DROP FUNCTION public.portal_invitation_finish(uuid, text, text, text, text),
--     public.portal_invitation_begin(uuid, text, text),
--     public.app_staff_role_of(uuid),
--     public.tg_portal_invitation_events_immutable();
--   re-run section 1 of 20260925100000_sync_authority_foundation.sql (the
--   matrix without registration_lead / portal_invite) and the app_is_staff()
--   definition in 20260924110000_rls_permission_helpers.sql.
--   An enum label cannot be dropped in place (it stays, unused); a text
--   CHECK can be narrowed again.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. app_users.role accepts 'registration_lead'
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_type    oid;
  v_typtype "char";
  v_attnum  smallint;
  v_con     record;
  v_values  text[];
BEGIN
  IF to_regclass('public.app_users') IS NULL THEN
    RAISE WARNING 'registration lead: table public.app_users does not exist, skipped';
    RETURN;
  END IF;

  SELECT a.atttypid, a.attnum, t.typtype
    INTO v_type, v_attnum, v_typtype
    FROM pg_attribute AS a
    JOIN pg_type AS t ON t.oid = a.atttypid
   WHERE a.attrelid = 'public.app_users'::regclass
     AND a.attname = 'role'
     AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE WARNING 'registration lead: public.app_users has no role column, skipped';
    RETURN;
  END IF;

  -- Production shape: an enum (user_role). ADD VALUE IF NOT EXISTS is a
  -- no-op on a re-run.
  IF v_typtype = 'e' THEN
    EXECUTE format('ALTER TYPE %s ADD VALUE IF NOT EXISTS %L',
                   v_type::regtype, 'registration_lead');
  END IF;

  -- Migration-file shape: text with a CHECK listing the allowed roles
  -- (app_users_role_check). Widen every "role = ANY (ARRAY[...])" check on
  -- the role column alone, keeping the values it already allows. A check
  -- that already allows the new role is left alone (re-run).
  FOR v_con IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint AS c
     WHERE c.conrelid = 'public.app_users'::regclass
       AND c.contype = 'c'
       AND c.conkey = ARRAY[v_attnum]
  LOOP
    CONTINUE WHEN v_con.def ~ '\mregistration_lead\M';
    CONTINUE WHEN v_con.def !~* '=\s*ANY\s*\(\s*\(?\s*ARRAY\s*\[';

    SELECT array_agg(m.match[1] ORDER BY m.n)
      INTO v_values
      FROM regexp_matches(v_con.def, '''([a-z_]+)''', 'g')
           WITH ORDINALITY AS m(match, n);
    CONTINUE WHEN v_values IS NULL;
    v_values := v_values || 'registration_lead'::text;

    -- Rebuilt in the same "= ANY (ARRAY[...])" form, so a re-run (or a
    -- later migration) recognises it.
    EXECUTE format('ALTER TABLE public.app_users DROP CONSTRAINT %I', v_con.conname);
    EXECUTE format(
      'ALTER TABLE public.app_users ADD CONSTRAINT %I CHECK (role::text = ANY (ARRAY[%s]::text[]))',
      v_con.conname,
      (SELECT string_agg(quote_literal(u.v), ', ' ORDER BY u.n)
         FROM unnest(v_values) WITH ORDINALITY AS u(v, n)));
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Permission matrix (KEEP IN SYNC with ROLE_PERMISSIONS in src/auth/roles.ts)
-- ----------------------------------------------------------------------------
-- Copied from 20260925100000_sync_authority_foundation.sql. Changes:
-- 'portal_invite' for admin and lead_clinician, and the new
-- 'registration_lead' branch (register, queue, portal_manage,
-- portal_invite; no vitals).
-- Confirmed policy, unchanged here: queue includes pharmacist;
-- merge_patients includes auditor and excludes volunteer; lab_release is
-- held by the lab_review holders (doctor, lead_clinician, admin).
CREATE OR REPLACE FUNCTION public.app_role_has_permission(
  p_role text,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    CASE p_role
      WHEN 'admin' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'dispense', 'inventory', 'export',
        'users', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts',
        'lab_review', 'queue', 'portal_manage', 'merge_patients',
        'lab_release', 'portal_invite'])
      WHEN 'doctor' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'resolve_conflicts', 'lab_review',
        'queue', 'portal_manage', 'merge_patients', 'lab_release'])
      WHEN 'nurse' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'resolve_conflicts', 'queue', 'portal_manage',
        'merge_patients'])
      WHEN 'volunteer' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'queue', 'portal_manage'])
      WHEN 'registration_lead' THEN p_permission = ANY (ARRAY[
        'register', 'queue', 'portal_manage', 'portal_invite'])
      WHEN 'pharmacist' THEN p_permission = ANY (ARRAY[
        'dispense', 'inventory', 'queue'])
      WHEN 'auditor' THEN p_permission = ANY (ARRAY[
        'export', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts',
        'merge_patients'])
      WHEN 'lead_clinician' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'export', 'approve_phi_conflicts',
        'audit_access', 'resolve_conflicts', 'lab_review', 'queue',
        'portal_manage', 'merge_patients', 'lab_release', 'portal_invite'])
      -- 'guest', legacy 'chw', unknown roles and NULL: no permissions.
      ELSE false
    END,
    false
  );
$$;

COMMENT ON FUNCTION public.app_role_has_permission(text, text) IS
  'Server copy of ROLE_PERMISSIONS in src/auth/roles.ts. Change both together '
  '(src/auth/roleMatrixParity.test.ts compares them). See docs/security/RLS_MATRIX.md.';

-- Grants as in 20260924110000 (CREATE OR REPLACE keeps them; restated so a
-- database that lost them is repaired).
REVOKE ALL ON FUNCTION public.app_role_has_permission(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_role_has_permission(text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Staff = a known, non-guest app role (now including registration_lead)
-- ----------------------------------------------------------------------------
-- Same as 20260924110000 plus 'registration_lead'.
CREATE OR REPLACE FUNCTION public.app_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    public.app_current_role() = ANY (ARRAY[
      'admin', 'doctor', 'nurse', 'pharmacist', 'volunteer', 'auditor',
      'lead_clinician', 'registration_lead']),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.app_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_is_staff() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Portal invitation audit trail (append-only)
-- ----------------------------------------------------------------------------
-- One invitation = one 'requested' row (written before anything is sent;
-- if it cannot be written, nothing is sent) and at most one outcome row:
-- 'sent' (the SMS or email provider accepted it) or 'not_sent' (with a
-- short code in detail: demo_mode, provider_rejected, not_configured,
-- invalid_recipient, rate_limited, ...). A 'requested' row without an
-- outcome means the function stopped before it could record one: treat
-- the invitation as not confirmed.
CREATE TABLE IF NOT EXISTS public.portal_invitation_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id       uuid NOT NULL,
  event               text NOT NULL
                        CHECK (event IN ('requested', 'sent', 'not_sent')),
  patient_id          text NOT NULL,
  channel             text NOT NULL CHECK (channel IN ('sms', 'email')),
  actor_id            uuid NOT NULL,   -- the staff member who sent it
  actor_role          text NOT NULL,   -- their app_users.role at the time
  detail              text CHECK (detail IS NULL OR char_length(detail) <= 200),
  provider            text CHECK (provider IS NULL OR char_length(provider) <= 40),
  provider_message_id text CHECK (provider_message_id IS NULL
                                  OR char_length(provider_message_id) <= 200),
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_invitation_events_one_request
  ON public.portal_invitation_events (invitation_id)
  WHERE event = 'requested';
CREATE UNIQUE INDEX IF NOT EXISTS portal_invitation_events_one_outcome
  ON public.portal_invitation_events (invitation_id)
  WHERE event <> 'requested';
CREATE INDEX IF NOT EXISTS idx_portal_invitation_events_patient_created
  ON public.portal_invitation_events (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_invitation_events_actor_created
  ON public.portal_invitation_events (actor_id, created_at DESC);

COMMENT ON TABLE public.portal_invitation_events IS
  'Append-only record of patient portal invitations: who asked the server to send one, for which patient, by SMS or email, when, and whether the provider accepted it. Written only by portal_invitation_begin() / portal_invitation_finish(). No contact details or message text.';

CREATE OR REPLACE FUNCTION public.tg_portal_invitation_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'portal_invitation_events is append-only (% refused)', TG_OP
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_portal_invitation_events_immutable()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portal_invitation_events_immutable ON public.portal_invitation_events;
CREATE TRIGGER portal_invitation_events_immutable
  BEFORE UPDATE OR DELETE ON public.portal_invitation_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_portal_invitation_events_immutable();

-- TRUNCATE bypasses row triggers; refuse it too.
DROP TRIGGER IF EXISTS portal_invitation_events_no_truncate ON public.portal_invitation_events;
CREATE TRIGGER portal_invitation_events_no_truncate
  BEFORE TRUNCATE ON public.portal_invitation_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_portal_invitation_events_immutable();

ALTER TABLE public.portal_invitation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_invitation_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.portal_invitation_events TO authenticated;
GRANT SELECT, INSERT ON public.portal_invitation_events TO service_role;

-- Readable by the people who send invitations and by auditors.
DROP POLICY IF EXISTS portal_invitation_events_select ON public.portal_invitation_events;
CREATE POLICY portal_invitation_events_select
  ON public.portal_invitation_events FOR SELECT TO authenticated
  USING ((SELECT public.app_has_any_permission(ARRAY['portal_invite', 'audit_access'])));
-- No INSERT / UPDATE / DELETE policy: clients cannot write it.

-- ----------------------------------------------------------------------------
-- 5. The server-side invitation check (service role only)
-- ----------------------------------------------------------------------------
-- The role of an active staff account, by id: the same rules as
-- public.app_current_role() (a deactivated row has no role), for a user id
-- the edge function has already verified from the access token.
CREATE OR REPLACE FUNCTION public.app_staff_role_of(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT au.role::text
    FROM public.app_users AS au
   WHERE p_user_id IS NOT NULL
     AND au.id::text = p_user_id::text
     AND COALESCE(to_jsonb(au) ->> 'is_active', 'true') NOT IN ('false', '0')
     AND COALESCE(to_jsonb(au) ->> 'active', 'true') <> 'false'
     AND COALESCE(to_jsonb(au) ->> 'disabled', 'false') <> 'true'
     AND COALESCE(to_jsonb(au) ->> 'deactivated', 'false') <> 'true'
     AND (to_jsonb(au) ->> 'deactivated_at') IS NULL
     AND (to_jsonb(au) ->> 'disabled_at') IS NULL
   LIMIT 1;
$$;

-- Checks an invitation and records the request. Returns
--   {"allowed": true, "invitation_id", "patient_id", "given_name",
--    "recipient", "actor_role"}
-- or {"allowed": false, "reason": ...} with reason one of
--   invalid_channel, not_permitted, patient_not_found, patient_merged,
--   portal_not_enabled, no_contact.
-- Refusals are returned (nothing recorded). The recipient is the patient's
-- stored phone (sms) or email (email), never a value from the caller.
CREATE OR REPLACE FUNCTION public.portal_invitation_begin(
  p_actor uuid,
  p_patient_id text,
  p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role       text;
  v_patient    record;
  v_recipient  text;
  v_invitation uuid := gen_random_uuid();
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('sms', 'email') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_channel');
  END IF;

  v_role := public.app_staff_role_of(p_actor);
  IF NOT public.app_role_has_permission(v_role, 'portal_invite') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_permitted');
  END IF;

  SELECT p.id::text AS id,
         p.given_name::text AS given_name,
         p.phone::text AS phone,
         p.email::text AS email,
         COALESCE(p.portal_enabled, false) AS portal_enabled,
         p.merged_into
    INTO v_patient
    FROM public.patients AS p
   WHERE p.id::text = p_patient_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'patient_not_found');
  END IF;
  IF v_patient.merged_into IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'patient_merged');
  END IF;
  IF NOT v_patient.portal_enabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'portal_not_enabled');
  END IF;

  v_recipient := NULLIF(btrim(CASE p_channel
                                WHEN 'email' THEN v_patient.email
                                ELSE v_patient.phone
                              END), '');
  IF v_recipient IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_contact');
  END IF;

  INSERT INTO public.portal_invitation_events (
    invitation_id, event, patient_id, channel, actor_id, actor_role)
  VALUES (v_invitation, 'requested', v_patient.id, p_channel, p_actor, v_role);

  RETURN jsonb_build_object(
    'allowed', true,
    'invitation_id', v_invitation,
    'patient_id', v_patient.id,
    'given_name', v_patient.given_name,
    'recipient', v_recipient,
    'actor_role', v_role);
END;
$$;

-- Records what happened to an invitation started with
-- portal_invitation_begin(). Returns false for an unknown invitation or one
-- that already has an outcome (the first outcome is kept).
CREATE OR REPLACE FUNCTION public.portal_invitation_finish(
  p_invitation_id uuid,
  p_outcome text,
  p_detail text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_request public.portal_invitation_events%ROWTYPE;
  v_id      uuid;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'not_sent') THEN
    RAISE EXCEPTION 'portal_invitation_finish: outcome must be sent or not_sent'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
    FROM public.portal_invitation_events AS e
   WHERE e.invitation_id = p_invitation_id
     AND e.event = 'requested';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.portal_invitation_events (
    invitation_id, event, patient_id, channel, actor_id, actor_role,
    detail, provider, provider_message_id)
  VALUES (
    v_request.invitation_id, p_outcome, v_request.patient_id, v_request.channel,
    v_request.actor_id, v_request.actor_role,
    left(p_detail, 200), left(p_provider, 40), left(p_provider_message_id, 200))
  ON CONFLICT (invitation_id) WHERE event <> 'requested' DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.app_staff_role_of(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_invitation_begin(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_invitation_finish(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_staff_role_of(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_invitation_begin(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_invitation_finish(uuid, text, text, text, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 6. patients.portal_invited_at: portal_invite holders only (API callers)
-- ----------------------------------------------------------------------------
-- app_guard_patient_identity (20260924110100) already locks the column for
-- callers without 'register'. This second trigger also refuses register
-- holders who cannot send invitations (volunteer, nurse, doctor). The
-- service role, SECURITY DEFINER functions and migrations are not
-- restricted (see app_guard_immutable_columns()). Device sync does not
-- upload this column, and the trigger fires only for writes that name it.
DO $$
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RAISE WARNING 'registration lead: table public.patients does not exist, skipped';
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS app_guard_patient_portal_invited_at ON public.patients;
  CREATE TRIGGER app_guard_patient_portal_invited_at
    BEFORE UPDATE OF portal_invited_at ON public.patients
    FOR EACH ROW
    EXECUTE FUNCTION public.app_guard_immutable_columns(
      'portal_invite', 'portal_invited_at');
END $$;

-- ----------------------------------------------------------------------------
-- 7. queue_transitions: uploads by queue holders (registration_lead included)
-- ----------------------------------------------------------------------------
-- 20260924120000 named the uploading roles one by one (volunteer, nurse,
-- doctor, lead_clinician, admin, pharmacist): exactly the 'queue' holders
-- before this migration. A registration lead moves patients through the
-- queue too, so without this their queue history would be refused at sync.
-- The rule is now the permission itself; the set of roles is otherwise
-- unchanged. Rows must still be uploaded by the caller themselves.
DO $$
BEGIN
  IF to_regclass('public.queue_transitions') IS NULL THEN
    RAISE WARNING 'registration lead: table public.queue_transitions does not exist, skipped';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS "queue_transitions_insert_queue_staff" ON public.queue_transitions;
  CREATE POLICY "queue_transitions_insert_queue_staff"
    ON public.queue_transitions FOR INSERT TO authenticated
    WITH CHECK (
      uploaded_by = (SELECT auth.uid())
      AND (SELECT public.app_has_permission('queue'))
    );
END $$;

-- End of migration.
