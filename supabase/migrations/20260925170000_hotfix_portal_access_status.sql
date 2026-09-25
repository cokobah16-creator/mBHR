-- ============================================================================
-- Hotfix: patient portal sign-in check (portal_access_status) before Wave B
-- ============================================================================
-- The live portal calls rpc portal_access_status() straight after every
-- password sign-in (src/services/portalSignIn.ts:25). That function comes
-- from Wave B (20260925100100 section 5), which production does not have
-- yet. The call fails, the app treats a failed check as "unavailable"
-- (src/services/portalAccessRules.ts:202) and signs the patient out again
-- with "We could not check your portal access with the clinic server"
-- (src/features/patient-portal/PatientLogin.tsx:96-97). So no patient can
-- sign in to the portal today.
--
-- Wave B's definition cannot simply be run early. It is LANGUAGE sql, so its
-- body is checked when it is created, and it reads patients.merged_into and
-- patients.portal_enabled_changed_at, which only 20260925100000 (Wave B)
-- adds.
--
-- This creates portal_access_status() with Wave B's exact signature and
-- result (patient_id text, portal_enabled boolean, changed_at timestamptz),
-- SECURITY DEFINER with a pinned search_path. It returns only the caller's
-- own patient records, found through patients.auth_uid = auth.uid(), and for
-- each whether portal access is on (patients.portal_enabled).
--
-- Differences from Wave B's function, until Wave B replaces it:
--   * No patient_portal_users match (by id, app_metadata.portal_user_id or
--     the phone claim). On production the anon key can still add and
--     activate patient_portal_users rows (patient_portal_users_register and
--     _verify, 20260520000000 L492-504), so trusting them in a SECURITY
--     DEFINER function would let a made-up row count as a clinic link. Wave
--     A drops those policies before Wave B's function uses these rows. The
--     only patients this leaves out cannot reach the portal home today
--     anyway: their profile is read by auth_uid.
--   * No merged_into column: no "merged away" test. Without the column a
--     merged-away record cannot be recognised (the read policies production
--     has today do not recognise one either).
--   * No portal_enabled_changed_at column: changed_at is NULL. The app does
--     not read it (src/services/portalAccessRules.ts:203-206).
-- It fails, and changes nothing, if patients.id, auth_uid or portal_enabled
-- is missing, or if 20260925160000 has not been applied (see below).
--
-- Why it is safe: it reads one table and writes nothing. No table, row,
-- policy or other function changes. The anon key cannot call it. It returns
-- no more than Wave B's function would. If portal_access_status() already
-- exists (Wave B's, or this hotfix from an earlier run), or Wave B's
-- patient_portal_access_events table exists, nothing is done, so a database
-- built in filename order keeps Wave B's version. When Wave B runs on
-- production later, its CREATE OR REPLACE replaces this function in place:
-- same signature and result type, same owner (the migration role), grants
-- kept.
--
-- What changes for patients (check before applying): the sign-in gate
-- becomes patients.portal_enabled, as Wave B intends.
--   * Linked and portal_enabled true: sign-in works again.
--   * Linked but portal_enabled false (the column default): refused with
--     "Your clinic has not turned on portal access for you". A portal session
--     already open on a device is signed out at its next load, where today it
--     still opens (src/App.tsx:400 PatientProtectedRoute). Staff cannot
--     turn access on from the app until Wave B (set_patient_portal_access).
--   * Not linked yet (first sign-in after sign-up): still refused, because
--     portal_link_patient_record (Wave A 20260924110300) is missing too.
-- portal_enabled is only the app's gate until Wave A: production's read
-- rules do not test it, so a linked login can still read its own record
-- through the API. To cut off a wrongly linked account, clear auth_uid.
-- Count the second group first, read-only (counts only, no patient data):
--   SELECT count(*) FILTER (WHERE portal_enabled IS TRUE)     AS enabled,
--          count(*) FILTER (WHERE portal_enabled IS NOT TRUE) AS not_enabled,
--          count(DISTINCT auth_uid)                           AS logins
--     FROM public.patients WHERE auth_uid IS NOT NULL;
--
-- Runs on its own, ahead of the older pending migrations, and only after
-- 20260925160000, for two reasons. Once this version is recorded on
-- production, 20260925160000 is no longer newer than production's newest
-- and cannot run on its own. And until 20260925160000, the anon key can make
-- itself staff and so write any patient's auth_uid, which this function
-- trusts. If 20260925160000 was applied some other way, record it first:
-- supabase migration repair --linked --status applied 20260925160000.
-- Actions > Database migrations > Run workflow, with "only" set to
-- 20260925170000: rehearse, then dry-run, then apply. Checks:
-- supabase/hotfix-checks/20260925170000.sql. Safe to re-run.
--
-- Rollback (before Wave B only; the portal then refuses every new sign-in
-- again): DROP FUNCTION IF EXISTS public.portal_access_status(); then, to
-- run this again later, supabase migration repair --linked --status
-- reverted 20260925170000.
-- ============================================================================

DO $$
DECLARE
  v_patient_cols text[];
  v_missing      text;
  v_not_merged   text;
  v_changed_at   text;
  v_body         text;
BEGIN
  IF to_regprocedure('public.portal_access_status()') IS NOT NULL THEN
    RAISE NOTICE 'portal_access_status() already exists; left as it is';
    RETURN;
  END IF;
  IF to_regclass('public.patient_portal_access_events') IS NOT NULL THEN
    RAISE WARNING 'patient_portal_access_events exists but portal_access_status() does not: '
                  '20260925100100 owns this function, so nothing was created';
    RETURN;
  END IF;

  -- The app_users hotfix must be recorded first (see the header). Nested so
  -- the history table is only read where it exists.
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                    WHERE version = '20260925160000') THEN
      RAISE EXCEPTION 'portal hotfix: apply 20260925160000 first (or, if it was applied some other way, record it with migration repair); once 20260925170000 is recorded, 20260925160000 can no longer run on its own';
    END IF;
  END IF;

  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'portal hotfix: table public.patients does not exist';
  END IF;
  SELECT array_agg(attname::text) INTO v_patient_cols
    FROM pg_attribute
   WHERE attrelid = 'public.patients'::regclass AND attnum > 0 AND NOT attisdropped;
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['id', 'auth_uid', 'portal_enabled']) AS c
   WHERE c <> ALL (v_patient_cols);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'portal hotfix: public.patients has no % column, so portal_access_status() was not created', v_missing;
  END IF;

  v_not_merged := CASE WHEN 'merged_into' = ANY (v_patient_cols)
                       THEN ' AND p.merged_into IS NULL' ELSE '' END;
  v_changed_at := CASE WHEN 'portal_enabled_changed_at' = ANY (v_patient_cols)
                       THEN 'p.portal_enabled_changed_at' ELSE 'NULL::timestamptz' END;

  -- Wave B's first branch (20260925100100 L499-504), less the absent columns.
  v_body := format($q$
  SELECT p.id::text,
         COALESCE(p.portal_enabled, false)%1$s,
         %2$s
    FROM public.patients AS p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.auth_uid::text = (SELECT auth.uid())::text
$q$, v_not_merged, v_changed_at);

  -- Check the body against the tables now, not at the first sign-in.
  PERFORM set_config('check_function_bodies', 'on', true);

  -- Plain CREATE: never replaces a function that appeared meanwhile.
  EXECUTE format($f$
CREATE FUNCTION public.portal_access_status()
RETURNS TABLE (patient_id text, portal_enabled boolean, changed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS %L$f$, v_body);

  REVOKE ALL ON FUNCTION public.portal_access_status() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.portal_access_status() TO authenticated, service_role;

  -- Runs once with no signed-in user (returns nothing), so a body that
  -- cannot run fails here.
  PERFORM count(*) FROM public.portal_access_status();

  RAISE NOTICE 'portal_access_status() created';

  -- PostgREST picks up new functions on its own; this makes sure.
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
