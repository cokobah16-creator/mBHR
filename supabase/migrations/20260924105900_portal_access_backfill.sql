-- ============================================================================
-- Portal access backfill: keep access for existing verified portal accounts
-- ============================================================================
-- Owner rule: "Backfill existing legitimate access -> deploy stricter
-- authorization -> require explicit permission for future portal
-- invitations -> make patient-document ownership explicit", and "one-off
-- backfill FIRST: only existing verified portal accounts already linked to
-- patients -> portal access true; record in audit log; NOT based on
-- phone/email matches."
--
-- Why: until 20260924110300_rls_patient_portal.sql no database rule looked
-- at patients.portal_enabled, so a patient who signed up for the portal
-- could read their records whatever that flag said. From 20260924110300 on,
-- portal data is visible only while portal_enabled is true
-- (app_portal_patient_ids()), and 20260925100100 makes the flag
-- server-owned. Patients who use the portal today with portal_enabled
-- false or NULL would lose access. This file runs first (its timestamp sorts
-- before 20260924110000) and turns access on for them only.
--
-- A patient record is turned on (false or NULL -> true) only when a VERIFIED
-- portal account is already LINKED to that exact record:
--   (a) patients.auth_uid is a Supabase Auth account with a confirmed email
--       or phone (email_confirmed_at / phone_confirmed_at set), that is not
--       deleted, banned or anonymous and is not a staff account (a row in
--       app_users; staff accounts are not portal accounts, as in
--       portal_link_patient_record); and/or
--   (b) a patient_portal_users row whose patient_id is that record, with
--       account_status 'active' and phone_verified or email_verified true.
-- Nothing is matched on phone number or email text.
--
-- Never turned on: records linked by auth_uid to a staff account (a row in
-- app_users), whatever their other evidence; records that opted out
-- (portal_opt_out), were merged away (merged_into), are soft-deleted (deleted_at / is_deleted, if such a
-- column exists), whose portal account is 'suspended', that were already
-- backfilled once (the log below), or, when this file runs after
-- 20260925100100, whose access was turned off (portal_enabled_changed_by
-- set, or any applied "off" event in patient_portal_access_events other
-- than that migration's 'state_at_migration' snapshot). Records already on
-- are not touched.
--
-- Every record turned on gets one row in public.portal_access_backfill_log
-- (append-only: UPDATE, DELETE and TRUNCATE are refused for every role),
-- and one summary row goes to audit_logs (counts only, no patient ids).
--
-- Order and re-runs:
--   * Normal order (production has not applied the 20260924* files): this
--     runs before the patient_portal_access_events table and the
--     portal_enabled_changed_at column exist; it only sets portal_enabled.
--     20260925100100 section 6 later stamps every enabled record as a server
--     decision, so the backfilled records end up enabled, a later staff
--     disable (set_patient_portal_access) always wins, and device backfills
--     cannot undo it.
--   * Late run (the 20260924*/20260925* files were applied first, then this
--     file with `supabase db push --include-all` or by hand): 20260925100100
--     stamped these records as "off" with a 'state_at_migration' event. That
--     snapshot is not a person's decision, so the record is still turned on;
--     this time portal_enabled_changed_at is set too and an access event
--     (source 'migration', reason 'portal_account_backfill') is recorded, so
--     devices download the change.
--   * Idempotent: a second run turns nothing on and logs nothing (records
--     are on, and each record can be backfilled once: unique patient_id in
--     the log).
--
-- Rollback (in this order):
--   DROP FUNCTION public.app_portal_access_backfill();
--   DROP TABLE public.portal_access_backfill_log;
--   DROP FUNCTION public.tg_portal_access_backfill_log_immutable();
--   Records turned on stay on (take the list from the log BEFORE dropping it
--   and turn access off with set_patient_portal_access if needed).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill log (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_access_backfill_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No foreign key: patients.id drifted between text and uuid, and the log
  -- must outlive a deleted record.
  patient_id            text NOT NULL,
  -- Evidence: the linked Supabase Auth account (patients.auth_uid) and/or
  -- the patient_portal_users row. At least one is set.
  auth_uid              text,
  portal_user_id        text,
  -- Which confirmations were seen: auth_email_confirmed,
  -- auth_phone_confirmed, portal_phone_verified, portal_email_verified.
  verified_by           text[] NOT NULL,
  -- patients.portal_enabled before the backfill (false or NULL).
  portal_enabled_before boolean,
  migration             text NOT NULL,
  backfilled_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_access_backfill_log_has_evidence
    CHECK (auth_uid IS NOT NULL OR portal_user_id IS NOT NULL)
);

-- One backfill per record, ever: a re-run can never turn a record on again
-- after someone turned it off.
CREATE UNIQUE INDEX IF NOT EXISTS portal_access_backfill_log_patient_key
  ON public.portal_access_backfill_log (patient_id);

COMMENT ON TABLE public.portal_access_backfill_log IS
  'Append-only record of patients whose portal access was turned on by '
  '20260924105900_portal_access_backfill.sql (existing verified portal '
  'accounts linked to the record). Readable by audit_access holders.';

CREATE OR REPLACE FUNCTION public.tg_portal_access_backfill_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'The portal access backfill log cannot be changed or deleted'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_portal_access_backfill_log_immutable()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portal_access_backfill_log_immutable
  ON public.portal_access_backfill_log;
CREATE TRIGGER portal_access_backfill_log_immutable
  BEFORE UPDATE OR DELETE ON public.portal_access_backfill_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_portal_access_backfill_log_immutable();

DROP TRIGGER IF EXISTS portal_access_backfill_log_no_truncate
  ON public.portal_access_backfill_log;
CREATE TRIGGER portal_access_backfill_log_no_truncate
  BEFORE TRUNCATE ON public.portal_access_backfill_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_portal_access_backfill_log_immutable();

-- No client writes, ever. Reads: audit_access holders only. The permission
-- helpers arrive in 20260924110000, so in the normal order the SELECT policy
-- is created by 20260925100100 (section 8); on a late run it is created
-- here.
ALTER TABLE public.portal_access_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_access_backfill_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.portal_access_backfill_log TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.app_has_permission(text)') IS NULL THEN
    RETURN;
  END IF;
  GRANT SELECT ON public.portal_access_backfill_log TO authenticated;
  DROP POLICY IF EXISTS portal_access_backfill_log_select_audit
    ON public.portal_access_backfill_log;
  CREATE POLICY portal_access_backfill_log_select_audit
    ON public.portal_access_backfill_log FOR SELECT TO authenticated
    USING ((SELECT public.app_has_permission('audit_access')));
END $$;

-- ----------------------------------------------------------------------------
-- 2. The backfill
-- ----------------------------------------------------------------------------
-- A function so supabase/tests/portal_access_backfill.test.sql runs exactly
-- this code. Only the owner (the migration role) may run it; it is not part
-- of the app. Returns how many records were turned on.
CREATE OR REPLACE FUNCTION public.app_portal_access_backfill()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  c_migration constant text := '20260924105900_portal_access_backfill';
  v_has_ppu boolean := to_regclass('public.patient_portal_users') IS NOT NULL;
  v_has_events boolean := to_regclass('public.patient_portal_access_events') IS NOT NULL;
  v_stamp boolean;
  v_ids text[];
  v_count integer;
BEGIN
  IF to_regclass('public.patients') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'public' AND c.table_name = 'patients'
          AND c.column_name = 'portal_enabled') THEN
    RAISE WARNING 'portal access backfill: public.patients.portal_enabled does not exist, skipped';
    RETURN 0;
  END IF;

  -- portal_enabled_changed_at arrives in 20260925100000 (late run only).
  v_stamp := EXISTS (
    SELECT 1 FROM information_schema.columns AS c
     WHERE c.table_schema = 'public' AND c.table_name = 'patients'
       AND c.column_name = 'portal_enabled_changed_at');

  -- One row per piece of evidence. Optional columns are read through
  -- to_jsonb(), so a column that does not exist simply does not count.
  IF to_regclass('pg_temp.portal_backfill_evidence') IS NOT NULL THEN
    DROP TABLE pg_temp.portal_backfill_evidence;
  END IF;
  CREATE TEMP TABLE portal_backfill_evidence (
    patient_id     text NOT NULL,
    auth_uid       text,
    portal_user_id text,
    verified_by    text[] NOT NULL
  );

  -- (a) The Supabase Auth account linked by patients.auth_uid, with a
  --     confirmed email or phone.
  IF to_regclass('auth.users') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'public' AND c.table_name = 'patients'
          AND c.column_name = 'auth_uid') THEN
    INSERT INTO pg_temp.portal_backfill_evidence (patient_id, auth_uid, verified_by)
    SELECT p.id::text,
           p.auth_uid::text,
           array_remove(ARRAY[
             CASE WHEN (u.j ->> 'email_confirmed_at') IS NOT NULL
                  THEN 'auth_email_confirmed' END,
             CASE WHEN (u.j ->> 'phone_confirmed_at') IS NOT NULL
                  THEN 'auth_phone_confirmed' END
           ], NULL)
      FROM public.patients AS p
      JOIN auth.users AS au ON au.id::text = p.auth_uid::text
     CROSS JOIN LATERAL (SELECT to_jsonb(au) AS j) AS u
     WHERE p.auth_uid IS NOT NULL
       AND ((u.j ->> 'email_confirmed_at') IS NOT NULL
            OR (u.j ->> 'phone_confirmed_at') IS NOT NULL)
       AND (u.j ->> 'deleted_at') IS NULL
       AND COALESCE(u.j ->> 'is_anonymous', 'false') <> 'true'
       AND ((u.j ->> 'banned_until') IS NULL
            OR (u.j ->> 'banned_until')::timestamptz <= now());
  END IF;

  -- (b) An active, verified patient_portal_users row for this exact record.
  IF v_has_ppu
     AND EXISTS (
       SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'public' AND c.table_name = 'patient_portal_users'
          AND c.column_name = 'patient_id') THEN
    INSERT INTO pg_temp.portal_backfill_evidence (patient_id, portal_user_id, verified_by)
    SELECT ppu.patient_id::text,
           ppu.id::text,
           array_remove(ARRAY[
             CASE WHEN (u.j ->> 'phone_verified') = 'true'
                  THEN 'portal_phone_verified' END,
             CASE WHEN (u.j ->> 'email_verified') = 'true'
                  THEN 'portal_email_verified' END
           ], NULL)
      FROM public.patient_portal_users AS ppu
     CROSS JOIN LATERAL (SELECT to_jsonb(ppu) AS j) AS u
     WHERE ppu.patient_id IS NOT NULL
       AND (u.j ->> 'account_status') = 'active'
       AND ((u.j ->> 'phone_verified') = 'true'
            OR (u.j ->> 'email_verified') = 'true');

    -- A portal account staff suspended is not current, legitimate access,
    -- whatever other evidence the record has.
    DELETE FROM pg_temp.portal_backfill_evidence AS e
     WHERE EXISTS (
       SELECT 1 FROM public.patient_portal_users AS ppu
        WHERE ppu.patient_id::text = e.patient_id
          AND (to_jsonb(ppu) ->> 'account_status') = 'suspended');
  END IF;

  -- Staff accounts are not portal accounts. A record whose auth_uid is a
  -- staff account is skipped whatever its other evidence: turning it on
  -- would also open the portal path (app_portal_patient_ids(): auth_uid =
  -- auth.uid()) to that staff account.
  IF to_regclass('public.app_users') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns AS c
        WHERE c.table_schema = 'public' AND c.table_name = 'patients'
          AND c.column_name = 'auth_uid') THEN
    DELETE FROM pg_temp.portal_backfill_evidence AS e
     WHERE EXISTS (
       SELECT 1
         FROM public.patients AS p
         JOIN public.app_users AS au ON au.id::text = p.auth_uid::text
        WHERE p.id::text = e.patient_id);
  END IF;

  -- Late run: access was turned off (set_patient_portal_access, a merge).
  -- Only the 'state_at_migration' snapshot of 20260925100100 section 6 is
  -- not a decision (it recorded whatever the flag was, before this backfill
  -- could run) and does not block.
  IF v_has_events THEN
    DELETE FROM pg_temp.portal_backfill_evidence AS e
     WHERE EXISTS (
       SELECT 1 FROM public.patient_portal_access_events AS ae
        WHERE ae.patient_id = e.patient_id
          AND ae.enabled = false
          AND ae.applied
          AND (ae.source <> 'migration'
               OR ae.reason IS DISTINCT FROM 'state_at_migration'));
  END IF;

  -- Turn access on and log it, in one statement. Dynamic only because
  -- portal_enabled_changed_at may not exist yet. Row locks (FOR UPDATE)
  -- make the skip checks and the logged previous value match the row that
  -- is updated.
  PERFORM set_config('mbhr.authoritative_write', 'on', true);
  EXECUTE format($sql$
    WITH evidence AS (
      SELECT e.patient_id,
             max(e.auth_uid) AS auth_uid,
             max(e.portal_user_id) AS portal_user_id,
             array_agg(DISTINCT f.flag ORDER BY f.flag) AS verified_by
        FROM pg_temp.portal_backfill_evidence AS e
       CROSS JOIN LATERAL unnest(e.verified_by) AS f(flag)
       GROUP BY e.patient_id
    ),
    target AS (
      SELECT p.id::text AS patient_id,
             p.portal_enabled AS portal_enabled_before,
             ev.auth_uid, ev.portal_user_id, ev.verified_by
        FROM public.patients AS p
        JOIN evidence AS ev ON ev.patient_id = p.id::text
       WHERE p.portal_enabled IS NOT TRUE
         AND COALESCE(to_jsonb(p) ->> 'portal_opt_out', 'false') <> 'true'
         AND (to_jsonb(p) ->> 'merged_into') IS NULL
         AND (to_jsonb(p) ->> 'deleted_at') IS NULL
         AND COALESCE(to_jsonb(p) ->> 'is_deleted', 'false') <> 'true'
         AND (to_jsonb(p) ->> 'portal_enabled_changed_by') IS NULL
         AND NOT EXISTS (
               SELECT 1 FROM public.portal_access_backfill_log AS l
                WHERE l.patient_id = p.id::text)
         FOR UPDATE OF p
    ),
    flipped AS (
      UPDATE public.patients AS p
         SET portal_enabled = true%s
        FROM target AS t
       WHERE p.id::text = t.patient_id
         AND p.portal_enabled IS NOT TRUE
      RETURNING t.patient_id, t.portal_enabled_before, t.auth_uid,
                t.portal_user_id, t.verified_by
    ),
    logged AS (
      INSERT INTO public.portal_access_backfill_log (
        patient_id, auth_uid, portal_user_id, verified_by,
        portal_enabled_before, migration)
      SELECT f.patient_id, f.auth_uid, f.portal_user_id, f.verified_by,
             f.portal_enabled_before, $1
        FROM flipped AS f
      RETURNING patient_id
    )
    SELECT array_agg(l.patient_id ORDER BY l.patient_id) FROM logged AS l
  $sql$,
    CASE WHEN v_stamp THEN ', portal_enabled_changed_at = clock_timestamp()' ELSE '' END)
  INTO v_ids
  USING c_migration;
  PERFORM set_config('mbhr.authoritative_write', 'off', true);

  DROP TABLE pg_temp.portal_backfill_evidence;

  v_count := COALESCE(cardinality(v_ids), 0);

  IF v_count > 0 AND v_has_events THEN
    -- Late run: keep the access history complete. changed_by stays NULL
    -- (the database decided, not a person).
    INSERT INTO public.patient_portal_access_events (
      patient_id, enabled, applied, outcome, reason, source, actor_id)
    SELECT x.patient_id, true, true, 'applied', 'portal_account_backfill',
           'migration', NULL
      FROM unnest(v_ids) AS x(patient_id);
  END IF;

  IF v_count > 0 AND to_regclass('public.audit_logs') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.audit_logs (id, actor_role, action, entity, entity_id, at)
      VALUES (gen_random_uuid(), 'system', 'portal_access_backfill',
              'portal_access_backfill_log',
              format('%s: %s patient record(s) enabled', c_migration, v_count),
              now());
    EXCEPTION
      WHEN undefined_column OR undefined_table OR datatype_mismatch
           OR not_null_violation THEN
        RAISE WARNING 'portal access backfill: audit_logs schema differs; summary not written (portal_access_backfill_log has every record)';
    END;
  END IF;

  RAISE NOTICE 'portal access backfill: % patient record(s) enabled', v_count;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.app_portal_access_backfill() IS
  'One-off portal access backfill (20260924105900). Owner only; safe to re-run '
  '(turns nothing on twice). Drop once the release is verified.';

REVOKE ALL ON FUNCTION public.app_portal_access_backfill()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.app_portal_access_backfill();

-- End of migration.
