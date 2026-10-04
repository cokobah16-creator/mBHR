/*
  # Portal logins see only their own login; sessions and files follow access

  From the signed-in functions check of 28 Sept 2026
  (/mnt/project-files/hris-transform/secdef-audit-2026-09-28.md, G5-3,
  G5-5, G5-4 and G3-4).

  ## What was wrong
  - G5-3: every portal login of a patient could read the patient's other
    logins (patient_portal_users, including otp_secret, phone, email and
    date of birth), read, change or end their portal sessions (session
    tokens and expiry included), read their access log (IP address and
    browser) and change their preferences. A login could also set its own
    session's expiry to any date.
  - G5-5: portal_session_check kept a session alive, in 24-hour steps, after
    its login was suspended or locked, or after the patient's portal access
    was switched off or the record was merged away.
  - G5-4: a portal patient could still open a stored file in their folder
    after staff moved its document to another patient. Files in the folder
    of a record merged into theirs did not open at all.
  - One carer's login could add or change the patient's pending
    submissions in another login's name, and a login could backdate its
    own access log rows.
  - G3-4: portal access is for adults, but only the device checked it: a
    direct call to set_patient_portal_access could turn it on for a child's
    record, automatic enrolment on insert (when switched on) enrolled a
    child's record with a phone number or email, and a merge, or a date of
    birth changed after access was on, left a child's record with access.

  ## Changes
  1. patient_portal_users: a portal login reads only its own row (staff
     unchanged). patient_portal_sessions: a portal login reads and ends
     only its own sessions, and cannot make or extend one directly (no
     code makes server portal sessions today; portal_session_check extends
     one by at most 24 hours; holders of 'users' unchanged).
     patient_portal_access_logs and patient_portal_preferences: a login
     reads and writes only its own rows, and adds access log rows only for
     its own records (staff and 'audit_access' unchanged).
     app_portal_user_ids, which no policy uses any more, is not callable by
     signed-in accounts.
  2. portal_session_check ends the session and returns no row when its
     login no longer has portal access (the same rule as
     app_portal_patient_ids: an active login on an unmerged adult's record
     with access on, or the record's own sign-in link).
  3. A stored file opens to a portal patient when every document that
     names it belongs to one of their records (or a record merged into
     one) and none is removed, whichever folder the file is in: a file
     whose document moved to another patient no longer opens, and a
     merged-in record's files open even after that record is deleted. A
     file no document names (an upload whose document is not saved yet)
     opens only to the login that uploaded it, in a folder of theirs.
     A document names a file however its file_path writes it
     (app_storage_object_key: backslashes, outer spaces, a storage URL or
     the bucket name in front, './', doubled, leading or trailing
     slashes); an index on that keeps the check as fast as before. The
     storage delete rule matches documents the same way.
  4. A record whose date of birth is under 18 years ago, by the date in
     Nigeria (app_patient_is_minor, whatever the session's time zone),
     gives no portal access (app_portal_patient_ids, portal_access_status
     and portal_session_check), whatever its stored flag says.
     set_patient_portal_access refuses to turn access on for one
     ('minor'), as portal_link_patient_record already refuses to link one,
     automatic enrolment on insert skips one, and portal_invitation_begin
     answers 'portal_not_enabled' for one, so no invitation reaches a
     child. Turning access off is unchanged; a record with no date of
     birth is not refused.
  5. patient_submitted_data: a portal login adds and changes only pending
     submissions in its own name (portal_user_id). A portal login's access
     log rows get the server's time (created_at).

  ## Not changed
  - Staff who may read patient_portal_users still see every column,
    otp_secret included (the staff app reads the rows with select *).
  - portal_session_check still revives a session up to 5 minutes past its
    expiry (the app's grace period). No code makes server portal sessions
    today; the session only gates the app's offline route guard.
  - set_patient_portal_access still records the device's requested_by and
    source as sent. Staff devices send 'auto_enrollment', 'merge' and
    'backfill' themselves, and actor_id and portal_enabled_changed_by
    record the real caller (G3-3).
  - The linking functions (portal_link_patient_record and the sign-up
    link) keep their own age check, by the server's date.
  - Guardian access to a child's record (legal checklist item 17) will
    need its own rule: app_portal_patient_ids now refuses every child's
    record.
  - An access log row's IP address and browser are what the device sends.
  - patient_messages (not used by the app; messages go through
    patient_secure_messages) keeps its rules.
  - merge_patients still carries the stored access flag over to a child's
    record, and staff see it on, but the record gives no access until the
    patient is 18.
  - Every existing function's signature, and every grant but
    app_portal_user_ids'.

  ## Rollback
    Re-create the nine policies from 20260924110300_rls_patient_portal.sql
    (patient_portal_users_select, and the patient_portal_sessions,
    patient_portal_access_logs and patient_portal_preferences ones);
    GRANT EXECUTE ON FUNCTION public.app_portal_user_ids() TO authenticated;
    CREATE OR REPLACE app_portal_patient_ids and portal_access_status from
    20260927100110_portal_identity_hardening.sql, portal_session_check from
    20260924110300_rls_patient_portal.sql,
    app_patient_document_file_visible_to_patient from
    20260925100700_patient_document_ownership.sql and
    set_patient_portal_access and check_auto_enrollment from
    20260925100100_portal_access_authoritative.sql,
    portal_invitation_begin from 20260925100600_registration_lead_portal_invite.sql,
    the patient_submitted_data insert and patient-update policies from
    20260924110300_rls_patient_portal.sql, and the
    patient_documents_objects_select policy and
    app_patient_document_file_unreferenced from
    20260925100700_patient_document_ownership.sql;
    DROP TRIGGER patient_portal_access_logs_server_time ON public.patient_portal_access_logs;
    DROP INDEX public.idx_patient_documents_file_key;
    the new functions (app_patient_is_minor, app_storage_object_key, the
    two-argument file check, tg_portal_access_log_server_time) can stay.
*/

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Under 18 by the date in Nigeria (Africa/Lagos), whatever the session's
-- time zone (20260927100190). A record with no date of birth is not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_patient_is_minor(p_dob date)
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT COALESCE(p_dob > ((now() AT TIME ZONE 'Africa/Lagos')::date - interval '18 years')::date, false);
$function$;

-- ---------------------------------------------------------------------------
-- 1. Own login and own sessions only (G5-3)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS patient_portal_users_select ON public.patient_portal_users;
CREATE POLICY patient_portal_users_select ON public.patient_portal_users
  FOR SELECT TO authenticated
  USING (
    (SELECT public.app_is_staff())
    OR id = (SELECT auth.uid())::text
    OR id = (SELECT public.current_portal_user_id())
  );

DROP POLICY IF EXISTS patient_portal_sessions_select ON public.patient_portal_sessions;
CREATE POLICY patient_portal_sessions_select ON public.patient_portal_sessions
  FOR SELECT TO authenticated
  USING (
    portal_user_id = (SELECT public.current_portal_user_id())
    OR portal_user_id = (SELECT auth.uid())::text
    OR (SELECT public.app_has_permission('users'))
  );

-- Sessions are made and extended only by the portal session functions
-- (the app writes none directly), so a login cannot give itself a session
-- that outlives the 24-hour limit.
DROP POLICY IF EXISTS patient_portal_sessions_insert_own ON public.patient_portal_sessions;

DROP POLICY IF EXISTS patient_portal_sessions_update ON public.patient_portal_sessions;
CREATE POLICY patient_portal_sessions_update ON public.patient_portal_sessions
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_has_permission('users')))
  WITH CHECK ((SELECT public.app_has_permission('users')));

DROP POLICY IF EXISTS patient_portal_sessions_delete ON public.patient_portal_sessions;
CREATE POLICY patient_portal_sessions_delete ON public.patient_portal_sessions
  FOR DELETE TO authenticated
  USING (
    portal_user_id = (SELECT public.current_portal_user_id())
    OR portal_user_id = (SELECT auth.uid())::text
    OR (SELECT public.app_has_permission('users'))
  );

-- The login's own access log and preferences only.
DROP POLICY IF EXISTS patient_portal_access_logs_select ON public.patient_portal_access_logs;
CREATE POLICY patient_portal_access_logs_select ON public.patient_portal_access_logs
  FOR SELECT TO authenticated
  USING (
    (SELECT public.app_has_permission('audit_access'))
    OR portal_user_id = (SELECT public.current_portal_user_id())
    OR portal_user_id = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS patient_portal_access_logs_insert_own ON public.patient_portal_access_logs;
CREATE POLICY patient_portal_access_logs_insert_own ON public.patient_portal_access_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (portal_user_id = (SELECT public.current_portal_user_id())
     OR portal_user_id = (SELECT auth.uid())::text)
    AND (patient_id IS NULL OR patient_id IN (SELECT public.app_portal_patient_ids()))
  );

DROP POLICY IF EXISTS patient_portal_preferences_select ON public.patient_portal_preferences;
CREATE POLICY patient_portal_preferences_select ON public.patient_portal_preferences
  FOR SELECT TO authenticated
  USING (
    (SELECT public.app_is_staff())
    OR portal_user_id = (SELECT public.current_portal_user_id())
    OR portal_user_id = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS patient_portal_preferences_write_own ON public.patient_portal_preferences;
CREATE POLICY patient_portal_preferences_write_own ON public.patient_portal_preferences
  FOR ALL TO authenticated
  USING (
    portal_user_id = (SELECT public.current_portal_user_id())
    OR portal_user_id = (SELECT auth.uid())::text
  )
  WITH CHECK (
    portal_user_id = (SELECT public.current_portal_user_id())
    OR portal_user_id = (SELECT auth.uid())::text
  );

-- No policy uses the list of every login of the caller's records any more;
-- it is not handed to signed-in callers.
REVOKE EXECUTE ON FUNCTION public.app_portal_user_ids() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A stored file follows the documents that name it (G5-4)
-- ---------------------------------------------------------------------------
-- The object name a document's file_path stands for, however it is
-- written: backslashes, outer spaces, a storage URL or the bucket name in
-- front, './' parts, and doubled, leading or trailing slashes.
CREATE OR REPLACE FUNCTION public.app_storage_object_key(p_path text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v text := translate(p_path, E'\\', '/');
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  v := regexp_replace(v, E'^[[:space:] ﻿]+|[[:space:] ﻿]+$', '', 'g');
  IF v ~* '^[a-z][a-z0-9+.-]*://' THEN
    v := regexp_replace(v, '[?#].*$', '');
    v := COALESCE(substring(v FROM '(?i)/patient-documents/(.*)$'), v);
  END IF;
  v := regexp_replace(v, '(^|/)(\./)+', '\1', 'g');
  v := regexp_replace(v, '/{2,}', '/', 'g');
  v := regexp_replace(v, '^/+|/+$', '', 'g');
  v := regexp_replace(v, '^(patient-documents/+)+', '', 'i');
  RETURN NULLIF(v, '');
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_patient_documents_file_key
  ON public.patient_documents (public.app_storage_object_key(file_path));

-- A patient may read a stored file when every document that names it is
-- one of theirs and none is removed. A file no document names (an upload
-- whose document is not saved yet, or whose document went with a deleted
-- record) opens only to the login that uploaded it, in a folder of theirs
-- or of a record merged into theirs (20260927100190).
CREATE OR REPLACE FUNCTION public.app_patient_document_file_visible_to_patient(p_name text, p_owner text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.patient_documents AS d
                         WHERE public.app_storage_object_key(d.file_path) = public.app_storage_object_key(p_name)) THEN
             NOT EXISTS (
               SELECT 1 FROM public.patient_documents AS d
                WHERE public.app_storage_object_key(d.file_path) = public.app_storage_object_key(p_name)
                  AND (d.deleted_at IS NOT NULL
                       OR COALESCE(public.canonical_patient_id(d.patient_id::text), d.patient_id::text, '')
                            NOT IN (SELECT public.app_portal_patient_ids())))
           ELSE COALESCE(
             p_owner = (SELECT auth.uid())::text
             AND public.canonical_patient_id(
                   NULLIF(split_part(public.app_storage_object_key(p_name), '/', 1),
                          public.app_storage_object_key(p_name)))
                 IN (SELECT public.app_portal_patient_ids()),
             false)
         END;
$function$;
REVOKE ALL ON FUNCTION public.app_patient_document_file_visible_to_patient(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_patient_document_file_visible_to_patient(text, text) TO authenticated, service_role;

-- The one-argument form (the policy before this migration) knows no
-- uploader, so a file no document names does not open through it.
CREATE OR REPLACE FUNCTION public.app_patient_document_file_visible_to_patient(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT public.app_patient_document_file_visible_to_patient(p_name, NULL::text);
$function$;

-- The storage delete rule matches documents the same way.
CREATE OR REPLACE FUNCTION public.app_patient_document_file_unreferenced(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(
    (public.app_is_staff()
     OR NULLIF(split_part(p_name, '/', 1), p_name) IN (SELECT public.app_portal_patient_ids()))
    AND NOT EXISTS (
      SELECT 1 FROM public.patient_documents AS d
       WHERE public.app_storage_object_key(d.file_path) = public.app_storage_object_key(p_name)),
    false);
$function$;

DO $$
DECLARE
  -- Who uploaded a storage object: owner_id (text) on current Supabase
  -- storage, owner (uuid) on older versions (as 20260925100700).
  v_owner_expr text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE WARNING 'storage.objects does not exist; patient-documents read policy not changed';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'storage' AND table_name = 'objects'
                AND column_name = 'owner_id') THEN
    v_owner_expr := 'owner_id';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'storage' AND table_name = 'objects'
                   AND column_name = 'owner') THEN
    v_owner_expr := 'owner::text';
  ELSE
    v_owner_expr := 'NULL::text';
  END IF;

  DROP POLICY IF EXISTS "patient_documents_objects_select" ON storage.objects;
  EXECUTE format($p$
    CREATE POLICY "patient_documents_objects_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'patient-documents'
        AND ((SELECT public.app_is_staff())
             OR public.app_patient_document_file_visible_to_patient(name, %s)))
  $p$, v_owner_expr);
END $$;

-- ---------------------------------------------------------------------------
-- 4. A child's record gives no portal access (G3-4), whatever its stored
-- flag says: a later change of the date of birth, or a merge that carries
-- access over, cannot give it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_portal_patient_ids()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p.id::text
    FROM public.patients AS p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.auth_uid::text = (SELECT auth.uid())::text
     AND COALESCE(p.portal_enabled, false)
     AND p.merged_into IS NULL
     AND NOT public.app_patient_is_minor(p.dob)
  UNION
  SELECT ppu.patient_id::text
    FROM public.patient_portal_users AS ppu
    JOIN public.patients AS p ON p.id::text = ppu.patient_id::text
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND COALESCE(ppu.account_status, 'active') = 'active'
     AND COALESCE(p.portal_enabled, false)
     AND p.merged_into IS NULL
     AND NOT public.app_patient_is_minor(p.dob)
     AND (
          ppu.id::text = (SELECT auth.uid())::text
       OR ppu.id::text = (SELECT public.current_portal_user_id())
     );
$function$;

CREATE OR REPLACE FUNCTION public.portal_access_status()
 RETURNS TABLE(patient_id text, portal_enabled boolean, changed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p.id::text,
         COALESCE(p.portal_enabled, false) AND p.merged_into IS NULL
           AND NOT public.app_patient_is_minor(p.dob),
         p.portal_enabled_changed_at
    FROM public.patients AS p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.auth_uid::text = (SELECT auth.uid())::text
  UNION
  SELECT p.id::text,
         COALESCE(p.portal_enabled, false)
           AND p.merged_into IS NULL
           AND COALESCE(ppu.account_status, 'active') = 'active'
           AND NOT public.app_patient_is_minor(p.dob),
         p.portal_enabled_changed_at
    FROM public.patient_portal_users AS ppu
    JOIN public.patients AS p ON p.id::text = ppu.patient_id::text
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND (
          ppu.id::text = (SELECT auth.uid())::text
       OR ppu.id::text = (SELECT public.current_portal_user_id())
     );
$function$;

-- ---------------------------------------------------------------------------
-- 2 and 4. No portal access for a child's record (G3-4); sessions follow
-- portal access (G5-5); no automatic enrolment of a child's record (G3-4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_patient_portal_access(p_command_id uuid, p_patient_id text, p_enabled boolean, p_reason text DEFAULT NULL::text, p_client_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_requested_by text DEFAULT NULL::text, p_source text DEFAULT 'staff'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_dob date;
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
         p.portal_opt_out IS TRUE, p.merged_into::text, p.row_version, p.dob
    INTO v_id, v_enabled, v_changed_at, v_opt_out, v_merged_into, v_row_version, v_dob
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
  ELSIF p_enabled AND NOT v_enabled AND public.app_patient_is_minor(v_dob) THEN
    -- Portal access is for adults: a child's record is not turned on, as
    -- portal_link_patient_record never links one (20260927100190).
    v_refusal := 'minor';
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_session_check(p_session_token text, p_extend_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(session_id text, session_expires_at timestamp with time zone, session_active boolean, session_last_activity_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_id text;
  v_expires timestamptz;
  v_user text;
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) < 16 THEN
    RETURN;
  END IF;

  SELECT s.id::text, s.expires_at, s.portal_user_id::text
    INTO v_id, v_expires, v_user
    FROM public.patient_portal_sessions AS s
   WHERE s.session_token = p_session_token
     AND s.is_active = true
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  -- The login must still have portal access (as app_portal_patient_ids
  -- decides): a suspended or locked login, or a record whose access is off,
  -- that was merged away or that is a child's, ends the session
  -- (20260927100190).
  IF NOT EXISTS (
       SELECT 1
         FROM public.patient_portal_users AS u
         JOIN public.patients AS p ON p.id::text = u.patient_id::text
        WHERE u.id::text = v_user
          AND COALESCE(u.account_status, 'active') = 'active'
          AND COALESCE(p.portal_enabled, false)
          AND p.merged_into IS NULL
          AND NOT public.app_patient_is_minor(p.dob))
     AND NOT EXISTS (
       SELECT 1
         FROM public.patients AS p
        WHERE p.auth_uid::text = v_user
          AND COALESCE(p.portal_enabled, false)
          AND p.merged_into IS NULL
          AND NOT public.app_patient_is_minor(p.dob)) THEN
    UPDATE public.patient_portal_sessions AS s
       SET is_active = false
     WHERE s.id::text = v_id;
    RETURN;
  END IF;

  IF v_expires IS NOT NULL AND v_expires < now() - interval '5 minutes' THEN
    UPDATE public.patient_portal_sessions AS s
       SET is_active = false
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
  ELSIF p_extend_until IS NOT NULL THEN
    UPDATE public.patient_portal_sessions AS s
       SET expires_at = LEAST(p_extend_until, now() + interval '24 hours'),
           last_activity_at = now()
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
  ELSE
    UPDATE public.patient_portal_sessions AS s
       SET last_activity_at = now()
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
  END IF;

  RETURN QUERY
    SELECT s.id::text, s.expires_at, s.is_active, s.last_activity_at
      FROM public.patient_portal_sessions AS s
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_auto_enrollment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  -- Portal access is for adults: a child's record is never enrolled
  -- automatically (20260927100190).
  IF public.app_patient_is_minor(NEW.dob) THEN
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
$function$;

-- An invitation is not sent for a child's record, whatever its stored flag
-- says: it is answered as a record without portal access (20260927100190).
CREATE OR REPLACE FUNCTION public.portal_invitation_begin(p_actor uuid, p_patient_id text, p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
         p.merged_into,
         public.app_patient_is_minor(p.dob) AS is_minor
    INTO v_patient
    FROM public.patients AS p
   WHERE p.id::text = p_patient_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'patient_not_found');
  END IF;
  IF v_patient.merged_into IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'patient_merged');
  END IF;
  IF NOT v_patient.portal_enabled OR v_patient.is_minor THEN
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
$function$;

-- ---------------------------------------------------------------------------
-- 5. A login's own submissions; the server's time on access log rows (G5-3)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS patient_submitted_data_insert ON public.patient_submitted_data;
CREATE POLICY patient_submitted_data_insert ON public.patient_submitted_data
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.app_has_permission('consult'))
    OR (status = 'pending'
        AND reviewed_by IS NULL
        AND reviewed_at IS NULL
        AND patient_id IN (SELECT public.app_portal_patient_ids())
        AND (portal_user_id = (SELECT public.current_portal_user_id())
             OR portal_user_id = (SELECT auth.uid())::text))
  );

DROP POLICY IF EXISTS patient_submitted_data_update_patient ON public.patient_submitted_data;
CREATE POLICY patient_submitted_data_update_patient ON public.patient_submitted_data
  FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND patient_id IN (SELECT public.app_portal_patient_ids())
    AND (portal_user_id = (SELECT public.current_portal_user_id())
         OR portal_user_id = (SELECT auth.uid())::text)
  )
  WITH CHECK (
    status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND patient_id IN (SELECT public.app_portal_patient_ids())
    AND (portal_user_id = (SELECT public.current_portal_user_id())
         OR portal_user_id = (SELECT auth.uid())::text)
  );

CREATE OR REPLACE FUNCTION public.tg_portal_access_log_server_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_portal_access_log_server_time() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS patient_portal_access_logs_server_time ON public.patient_portal_access_logs;
CREATE TRIGGER patient_portal_access_logs_server_time
  BEFORE INSERT ON public.patient_portal_access_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_portal_access_log_server_time();
