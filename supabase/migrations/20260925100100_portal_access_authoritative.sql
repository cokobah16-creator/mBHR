-- ============================================================================
-- Portal access is decided by the server (Wave B, work package 1)
-- ============================================================================
-- Owner decision: patients.portal_enabled is authoritative in the database.
-- A device asks for a change with the idempotent command RPC
-- set_patient_portal_access (queued in the device's command outbox,
-- src/sync/commandOutbox.ts) and shows the change as "waiting for the
-- server" until the answer arrives. Builds on
-- 20260925100000_sync_authority_foundation.sql (command receipts, the
-- patients guard trigger, portal_enabled_changed_at/_by, merged_into and
-- app_portal_patient_ids()).
--
--   1. patient_portal_access_events: append-only history of every portal
--      access request and what the server did with it.
--   2. The patients guard trigger also keeps portal_enabled (and a linked
--      auth_uid) away from API writes: only this RPC, SECURITY DEFINER
--      functions and migrations change them. A new row written through the
--      API starts with portal access off (auto-enrolment below may turn it
--      on).
--   3. Auto-enrolment (trigger_auto_enrollment from 20260115072241) runs on
--      INSERT only. It used to run on every UPDATE and turned portal access
--      back on whenever a patient with a phone or email was edited, which
--      undid any disable made on the server. It now never touches an
--      existing record, a record with a recorded decision, a patient who
--      opted out, or a patient whose access was turned off before.
--   4. set_patient_portal_access(p_command_id, p_patient_id, p_enabled,
--      p_reason, p_client_at, p_requested_by, p_source): permission
--      portal_manage, idempotent by command id, audited. Rules:
--        * a disable always applies (fail-safe);
--        * a staff enable made offline is refused when the server recorded
--          a newer decision that turned access off (stale enable);
--        * an automatic enable (source 'backfill' from the device upgrade,
--          or 'auto_enrollment') applies only when the server has never
--          recorded a decision for that patient, the patient has not opted
--          out and was never turned off before. It can never override a
--          disable made on the server.
--   5. portal_access_status(): the signed-in portal user's records and
--      whether portal access is on (the portal sign-in check).
--   6. Server backfill: existing portal-enabled and opted-out patients, and
--      patients whose access is off although it was on before (auto-enrolled,
--      invited or linked), get portal_enabled_changed_at, so devices treat
--      the current server value as a decision and backfill enables cannot
--      override an opt-out or an earlier disable.
--   7. Defensive drops of the old anonymous patients policies (already
--      removed by 20260924110100's policy reset).
--   8. Audit readers (audit_access) may read portal_access_backfill_log,
--      written by 20260924105900_portal_access_backfill.sql before the
--      permission helpers existed.
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   DROP FUNCTION public.set_patient_portal_access(uuid, text, boolean, text, timestamptz, text, text);
--   DROP FUNCTION public.portal_access_status();
--   re-run the tg_patients_guard_authoritative() definition from
--     20260925100000_sync_authority_foundation.sql;
--   re-run the AUTO-ENROLLMENT TRIGGER section of
--     20260115072241_add_portal_enhancements_v3.sql (restores the
--     INSERT OR UPDATE trigger, which re-enables disabled patients: only do
--     this if the device app is rolled back too);
--   DROP TABLE public.patient_portal_access_events;
--   DROP FUNCTION public.tg_portal_access_events_immutable();
--   DROP POLICY portal_access_backfill_log_select_audit ON public.portal_access_backfill_log;
--   REVOKE SELECT ON public.portal_access_backfill_log FROM authenticated;
--   portal_enabled_changed_at values written by section 6 can stay.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Portal access history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_portal_access_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Command that asked for the change (NULL for database-made decisions:
  -- auto-enrolment on insert, this migration's backfill).
  command_id         uuid UNIQUE,
  -- No foreign key: patients.id drifted between text and uuid, and the
  -- history must outlive a deleted record.
  patient_id         text NOT NULL,
  enabled            boolean NOT NULL,
  applied            boolean NOT NULL,
  outcome            text NOT NULL CHECK (outcome IN ('applied', 'unchanged', 'rejected')),
  -- Short reason code (never free text).
  reason             text,
  source             text NOT NULL CHECK (source IN (
                       'staff', 'auto_enrollment', 'merge', 'backfill', 'migration')),
  -- Online user who sent the command; NULL when the database decided.
  actor_id           uuid DEFAULT auth.uid(),
  -- Device staff user id who made the decision (NULL for automatic ones).
  requested_by       text,
  -- Device clock when the decision was made.
  client_recorded_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_access_events_patient_created
  ON public.patient_portal_access_events (patient_id, created_at DESC);

COMMENT ON TABLE public.patient_portal_access_events IS
  'Append-only history of portal access requests and decisions. Written only by '
  'set_patient_portal_access, check_auto_enrollment and migrations.';

CREATE OR REPLACE FUNCTION public.tg_portal_access_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Portal access history cannot be changed or deleted'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_portal_access_events_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portal_access_events_immutable ON public.patient_portal_access_events;
CREATE TRIGGER portal_access_events_immutable
  BEFORE UPDATE OR DELETE ON public.patient_portal_access_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_portal_access_events_immutable();

ALTER TABLE public.patient_portal_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_portal_access_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.patient_portal_access_events TO authenticated;
GRANT ALL ON public.patient_portal_access_events TO service_role;

DROP POLICY IF EXISTS patient_portal_access_events_select ON public.patient_portal_access_events;
CREATE POLICY patient_portal_access_events_select
  ON public.patient_portal_access_events FOR SELECT TO authenticated
  USING (
    (SELECT public.app_has_permission('portal_manage'))
    OR (SELECT public.app_has_permission('audit_access'))
  );
-- No INSERT / UPDATE / DELETE policy: only SECURITY DEFINER code writes it.

-- ----------------------------------------------------------------------------
-- 2. Guard: portal_enabled and a linked auth_uid are server-owned
-- ----------------------------------------------------------------------------
-- Extends the foundation's guard (keep its merged_* and
-- portal_enabled_changed_* lines). Callers other than the API roles
-- (SECURITY DEFINER functions such as set_patient_portal_access and
-- portal_link_patient_record, service_role, migrations) are not restricted;
-- code running as the caller can opt in with
-- set_config('mbhr.authoritative_write', 'on', true).
--
-- The trigger (patients_guard_authoritative) already exists; it fires before
-- trigger_auto_enrollment (name order), so auto-enrolment still decides a
-- new row's portal access after this guard has reset it.
CREATE OR REPLACE FUNCTION public.tg_patients_guard_authoritative()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR current_setting('mbhr.authoritative_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.merged_into := NULL;
    NEW.merged_at := NULL;
    NEW.merged_by := NULL;
    NEW.portal_enabled_changed_at := NULL;
    NEW.portal_enabled_changed_by := NULL;
    -- A new record starts without portal access; staff turn it on through
    -- set_patient_portal_access (auto-enrolment may turn it on at insert).
    NEW.portal_enabled := false;
  ELSE
    NEW.merged_into := OLD.merged_into;
    NEW.merged_at := OLD.merged_at;
    NEW.merged_by := OLD.merged_by;
    NEW.portal_enabled_changed_at := OLD.portal_enabled_changed_at;
    NEW.portal_enabled_changed_by := OLD.portal_enabled_changed_by;
    NEW.portal_enabled := OLD.portal_enabled;
    -- A linked portal account stays linked (linking goes through
    -- portal_link_patient_record; staff may still link an unlinked record).
    IF OLD.auth_uid IS NOT NULL THEN
      NEW.auth_uid := OLD.auth_uid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_patients_guard_authoritative() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Auto-enrolment: new records only, never over a decision
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_auto_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auto_enabled boolean;
  v_require_email boolean;
  v_has_email boolean := NEW.email IS NOT NULL AND NEW.email <> '';
  v_has_phone boolean := NEW.phone IS NOT NULL AND NEW.phone <> '';
BEGIN
  -- Never on UPDATE: an edit of the patient (a new phone number, a synced
  -- copy of the row) must not turn access back on after it was turned off.
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  -- A recorded decision, access already on, an opt-out or a merged-away
  -- record: nothing to decide.
  IF NEW.portal_enabled_changed_at IS NOT NULL
     OR COALESCE(NEW.portal_enabled, false)
     OR NEW.portal_opt_out IS TRUE
     OR NEW.merged_into IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- An upsert of an existing record fires this INSERT trigger on the
  -- proposed row before it turns into an UPDATE: leave that record alone.
  IF EXISTS (SELECT 1 FROM public.patients AS p WHERE p.id::text = NEW.id::text) THEN
    RETURN NEW;
  END IF;
  -- Access was turned off for this id before (for example a record deleted
  -- and uploaded again): never auto-enable it.
  IF EXISTS (
    SELECT 1 FROM public.patient_portal_access_events AS e
     WHERE e.patient_id = NEW.id::text AND e.enabled = false
  ) THEN
    RETURN NEW;
  END IF;

  SELECT (s.setting_value)::boolean INTO v_auto_enabled
    FROM public.portal_enrollment_settings AS s
   WHERE s.setting_key = 'auto_enrollment_enabled';
  SELECT (s.setting_value)::boolean INTO v_require_email
    FROM public.portal_enrollment_settings AS s
   WHERE s.setting_key = 'require_email';

  IF v_auto_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF (v_require_email IS TRUE AND v_has_email)
     OR (v_require_email IS NOT TRUE AND (v_has_email OR v_has_phone)) THEN
    NEW.portal_enabled := true;
    NEW.auto_enrolled := true;
    NEW.auto_enrolled_at := now();
    -- A server decision: devices download it, and automatic enables from
    -- devices can no longer change it. changed_by stays NULL (the database
    -- decided, not a person).
    NEW.portal_enabled_changed_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_auto_enrollment() FROM PUBLIC, anon, authenticated;

-- Record auto-enrolments in the history once the row exists.
CREATE OR REPLACE FUNCTION public.log_auto_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.auto_enrolled IS TRUE
     AND COALESCE(NEW.portal_enabled, false)
     AND NEW.portal_enabled_changed_at IS NOT NULL
     AND NEW.portal_enabled_changed_by IS NULL THEN
    INSERT INTO public.patient_portal_access_events (
      patient_id, enabled, applied, outcome, reason, source, actor_id)
    VALUES (NEW.id::text, true, true, 'applied', 'auto_enrolled_on_insert',
            'auto_enrollment', NULL);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_auto_enrollment() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RAISE WARNING 'portal access: table public.patients does not exist, skipped';
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS trigger_auto_enrollment ON public.patients;
  CREATE TRIGGER trigger_auto_enrollment
    BEFORE INSERT ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.check_auto_enrollment();
  DROP TRIGGER IF EXISTS trigger_auto_enrollment_log ON public.patients;
  CREATE TRIGGER trigger_auto_enrollment_log
    AFTER INSERT ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.log_auto_enrollment();
END $$;

-- ----------------------------------------------------------------------------
-- 4. set_patient_portal_access: the only way to change portal access
-- ----------------------------------------------------------------------------
-- Parameter names are fixed: the device outbox and its one-off backfill
-- (src/db/migrations/backfillPlans.ts) send exactly these.
--
-- Returns jsonb {outcome: applied|rejected, patient_id, portal_enabled,
-- changed_at, row_version, changed, reason?, canonical_patient_id?}.
-- Business refusals are RETURNED (stored as a receipt, so a resend gets the
-- same answer). Raises only:
--   42501  the caller does not hold portal_manage;
--   PT409  the patient record is not on the server yet (a device queues the
--          command before its next upload of the new record; the outbox
--          retries it and nothing is recorded).
CREATE OR REPLACE FUNCTION public.set_patient_portal_access(
  p_command_id   uuid,
  p_patient_id   text,
  p_enabled      boolean,
  p_reason       text DEFAULT NULL,
  p_client_at    timestamptz DEFAULT NULL,
  p_requested_by text DEFAULT NULL,
  p_source       text DEFAULT 'staff'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  c_rpc constant text := 'set_patient_portal_access';
  v_prior jsonb;
  v_source text := COALESCE(p_source, 'staff');
  v_reason text := CASE
                     WHEN p_reason ~ '^[a-z][a-z0-9_]{0,59}$' THEN p_reason
                     ELSE NULL
                   END;
  v_id text;
  v_enabled boolean;
  v_changed_at timestamptz;
  v_opt_out boolean;
  v_merged_into text;
  v_row_version bigint;
  v_ever_disabled boolean;
  v_outcome text;
  v_event_outcome text;
  v_refusal text;
  v_changed boolean := false;
  v_result jsonb;
BEGIN
  IF NOT public.app_has_permission('portal_manage') THEN
    RAISE EXCEPTION 'portal_manage permission required' USING ERRCODE = '42501';
  END IF;

  IF p_command_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'missing_command_id');
  END IF;

  v_prior := public.app_command_prior_result(p_command_id, c_rpc);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior;
  END IF;

  IF p_patient_id IS NULL OR p_enabled IS NULL
     OR v_source NOT IN ('staff', 'auto_enrollment', 'merge', 'backfill') THEN
    RETURN public.app_command_record(
      p_command_id, c_rpc, 'rejected',
      jsonb_build_object('reason', 'invalid_request', 'patient_id', p_patient_id),
      p_requested_by, p_client_at);
  END IF;

  SELECT p.id::text, COALESCE(p.portal_enabled, false), p.portal_enabled_changed_at,
         p.portal_opt_out IS TRUE, p.merged_into::text, p.row_version
    INTO v_id, v_enabled, v_changed_at, v_opt_out, v_merged_into, v_row_version
    FROM public.patients AS p
   WHERE p.id::text = p_patient_id
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'patient_not_on_server' USING ERRCODE = 'PT409';
  END IF;

  -- A concurrent resend of the same command waited on the row lock above:
  -- answer it with the first one's result.
  v_prior := public.app_command_prior_result(p_command_id, c_rpc);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior;
  END IF;

  IF v_merged_into IS NOT NULL THEN
    v_refusal := 'patient_merged';
  ELSIF p_enabled AND v_source IN ('backfill', 'auto_enrollment') THEN
    -- Automatic enables never override a decision the server holds.
    IF NOT v_enabled THEN
      SELECT EXISTS (
        SELECT 1 FROM public.patient_portal_access_events AS e
         WHERE e.patient_id = v_id AND e.enabled = false AND e.applied
      ) INTO v_ever_disabled;
      IF v_changed_at IS NOT NULL OR v_opt_out OR v_ever_disabled THEN
        v_refusal := 'server_decision_kept';
      ELSE
        v_changed := true;
      END IF;
    END IF;
    -- Already on: nothing to change (outcome applied, changed false).
  ELSIF p_enabled THEN
    -- Staff (or merge) enable: refused when made before a newer decision
    -- that turned access off (for example an offline enable synced after
    -- someone else disabled access on the server).
    IF NOT v_enabled
       AND p_client_at IS NOT NULL
       AND v_changed_at IS NOT NULL
       AND p_client_at < v_changed_at THEN
      v_refusal := 'newer_decision_on_server';
    ELSIF v_enabled AND p_client_at IS NOT NULL AND v_changed_at IS NOT NULL
          AND p_client_at < v_changed_at THEN
      v_changed := false; -- already on, and a newer decision exists: keep it
    ELSE
      v_changed := true;
    END IF;
  ELSE
    -- A disable always applies (fail-safe) and is recorded as a decision.
    v_changed := true;
  END IF;

  IF v_refusal IS NOT NULL THEN
    v_outcome := 'rejected';
    v_event_outcome := 'rejected';
  ELSIF v_changed THEN
    PERFORM set_config('mbhr.authoritative_write', 'on', true);
    UPDATE public.patients AS p
       SET portal_enabled = p_enabled,
           portal_opt_out = NOT p_enabled,
           portal_enabled_changed_at = clock_timestamp(),
           portal_enabled_changed_by = auth.uid(),
           auto_enrolled = CASE
                             WHEN p_enabled AND v_source = 'auto_enrollment' THEN true
                             ELSE p.auto_enrolled
                           END,
           auto_enrolled_at = CASE
                                WHEN p_enabled AND v_source = 'auto_enrollment' THEN now()
                                ELSE p.auto_enrolled_at
                              END
     WHERE p.id::text = v_id
    RETURNING COALESCE(p.portal_enabled, false), p.portal_enabled_changed_at, p.row_version
      INTO v_enabled, v_changed_at, v_row_version;
    PERFORM set_config('mbhr.authoritative_write', 'off', true);
    v_outcome := 'applied';
    v_event_outcome := 'applied';
  ELSE
    v_outcome := 'applied';
    v_event_outcome := 'unchanged';
  END IF;

  v_result := jsonb_build_object(
    'patient_id', v_id,
    'portal_enabled', v_enabled,
    'changed_at', v_changed_at,
    'row_version', v_row_version,
    'changed', v_changed AND v_refusal IS NULL
  );
  IF v_refusal IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('reason', v_refusal);
  END IF;
  IF v_refusal = 'patient_merged' THEN
    v_result := v_result || jsonb_build_object(
      'canonical_patient_id', public.canonical_patient_id(v_id));
  END IF;

  INSERT INTO public.patient_portal_access_events (
    command_id, patient_id, enabled, applied, outcome, reason, source,
    actor_id, requested_by, client_recorded_at)
  VALUES (
    p_command_id, v_id, p_enabled, v_event_outcome = 'applied', v_event_outcome,
    COALESCE(v_refusal, v_reason), v_source,
    auth.uid(), p_requested_by, p_client_at)
  ON CONFLICT (command_id) DO NOTHING;

  RETURN public.app_command_record(
    p_command_id, c_rpc, v_outcome, v_result, p_requested_by, p_client_at);
END;
$$;

COMMENT ON FUNCTION public.set_patient_portal_access(uuid, text, boolean, text, timestamptz, text, text) IS
  'Turn portal access on or off (portal_manage). Idempotent by p_command_id; '
  'a disable always applies; automatic enables never override a server decision.';

REVOKE ALL ON FUNCTION public.set_patient_portal_access(uuid, text, boolean, text, timestamptz, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_patient_portal_access(uuid, text, boolean, text, timestamptz, text, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Portal sign-in check
-- ----------------------------------------------------------------------------
-- The signed-in portal user's patient records and whether portal access is
-- on for each (off for a merged-away record or a suspended portal account).
-- Same identities as app_portal_patient_ids(), without its "enabled"
-- filter, so the portal can tell "not linked" from "turned off".
CREATE OR REPLACE FUNCTION public.portal_access_status()
RETURNS TABLE (patient_id text, portal_enabled boolean, changed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p.id::text,
         COALESCE(p.portal_enabled, false) AND p.merged_into IS NULL,
         p.portal_enabled_changed_at
    FROM public.patients AS p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.auth_uid::text = (SELECT auth.uid())::text
  UNION
  SELECT p.id::text,
         COALESCE(p.portal_enabled, false)
           AND p.merged_into IS NULL
           AND COALESCE(ppu.account_status, 'active') = 'active',
         p.portal_enabled_changed_at
    FROM public.patient_portal_users AS ppu
    JOIN public.patients AS p ON p.id::text = ppu.patient_id::text
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND (
          ppu.id::text = (SELECT auth.uid())::text
       OR ppu.id::text = (SELECT public.current_portal_user_id())
       OR (
            ppu.phone_number IS NOT NULL
        AND ppu.phone_number = NULLIF((SELECT auth.jwt()) ->> 'phone', '')
       )
     );
$$;

REVOKE ALL ON FUNCTION public.portal_access_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_access_status() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Server backfill: the current state counts as a decision
-- ----------------------------------------------------------------------------
-- Until portal_enabled_changed_at is set, devices ignore the server's
-- portal_enabled (it may be only the column default). Patients with access
-- on, patients who opted out, and patients whose access is off although the
-- record shows it was on before (auto-enrolled, invited or linked to a
-- portal account, i.e. turned off by an older app version) get it now, so
-- devices apply the server value and device backfill enables cannot
-- override an opt-out or that earlier disable. Runs as the
-- migration owner; the flag makes the intent explicit for the guard.
-- Records with a verified portal account linked to them were already turned
-- on by 20260924105900_portal_access_backfill.sql, so they are stamped here
-- as on; the linked records still off are the ones that backfill refused.
DO $$
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('mbhr.authoritative_write', 'on', true);
  WITH stamped AS (
    UPDATE public.patients AS p
       SET portal_enabled_changed_at = COALESCE(p.updated_at, now())
     WHERE p.portal_enabled_changed_at IS NULL
       AND (
            COALESCE(p.portal_enabled, false)
         OR p.portal_opt_out IS TRUE
            -- Access is off, but the record shows it was on before (it was
            -- auto-enrolled, invited or linked to a portal account): it was
            -- turned off, a decision a device backfill must not undo.
         OR p.auto_enrolled IS TRUE
         OR p.portal_invited_at IS NOT NULL
         OR p.auth_uid IS NOT NULL
       )
    RETURNING p.id::text AS id, COALESCE(p.portal_enabled, false) AS enabled
  )
  INSERT INTO public.patient_portal_access_events (
    patient_id, enabled, applied, outcome, reason, source, actor_id)
  SELECT s.id, s.enabled, true, 'applied', 'state_at_migration', 'migration', NULL
    FROM stamped AS s;
  PERFORM set_config('mbhr.authoritative_write', 'off', true);
END $$;

-- ----------------------------------------------------------------------------
-- 7. Old anonymous patients policies (already dropped by the policy reset in
--    20260924110100; kept here so a database that skipped it is still safe)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anonymous patient lookup for portal registration" ON public.patients;
DROP POLICY IF EXISTS "Allow anonymous patient registration" ON public.patients;
DROP POLICY IF EXISTS "Patients can view own record" ON public.patients;

-- ----------------------------------------------------------------------------
-- 8. Portal access backfill log: audit readers
-- ----------------------------------------------------------------------------
-- 20260924105900_portal_access_backfill.sql runs before the permission
-- helpers exist, so it leaves its log readable only by the service role.
-- Same rule as its own late-run branch: audit_access holders read it; no
-- client writes (the log's triggers refuse UPDATE, DELETE and TRUNCATE).
DO $$
BEGIN
  IF to_regclass('public.portal_access_backfill_log') IS NULL THEN
    RETURN;
  END IF;
  GRANT SELECT ON public.portal_access_backfill_log TO authenticated;
  DROP POLICY IF EXISTS portal_access_backfill_log_select_audit
    ON public.portal_access_backfill_log;
  CREATE POLICY portal_access_backfill_log_select_audit
    ON public.portal_access_backfill_log FOR SELECT TO authenticated
    USING ((SELECT public.app_has_permission('audit_access')));
END $$;

-- End of migration.
