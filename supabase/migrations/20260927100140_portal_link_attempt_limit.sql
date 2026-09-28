/*
  # Portal record linking: limit date-of-birth guesses, match whole numbers

  From the signed-in functions check of 28 Sept 2026
  (/mnt/project-files/hris-transform/secdef-audit-2026-09-28.md, G5-1 and
  G5-2). Must be live before any patient gets portal access or phone
  sign-in is switched on.

  ## What was wrong with portal_link_patient_record
  - The date of birth is the only second factor, and nothing limited wrong
    answers: a login whose verified phone or email matched a record could
    try every adult date of birth (about 30,000) and link on the right one.
  - Phones matched on their last 10 digits only, so +1 803 123 4567 matched
    a Nigerian 0803 123 4567.
  - A linked patient could copy another patient's phone or email onto their
    own record (the portal lets patients edit both), and from then on the
    other patient's own link was answered 'linked_elsewhere'.
  - 'portal_not_enabled', 'linked_elsewhere' and 'ambiguous' were answered
    before the date of birth was checked, telling a caller that a record
    exists for the contact and what state it is in.

  ## Changes
  1. public.app_phone_e164_digits(text): a phone number as its E.164 digits
     (no plus). Digits only; 234... kept; 0 + 10 digits and a bare 10 digits
     read as Nigerian (234 added, as src/db/outbox.ts formatPhone does); a
     00 prefix dropped; 2340 + 10 digits read as 234 + 10 digits; anything
     else keeps all its digits. A foreign number the staff app saved through
     src/utils/phone.ts normalizePhone (234 put in front, e.g.
     +23418031234567) does not match its owner's verified phone: safe, the
     owner asks staff. Internal: no grant to anon or authenticated.
  2. public.portal_link_patient_record(date, text, text, text), same
     signature and grants:
     - phones match on the whole number (app_phone_e164_digits on both
       sides, 8 to 15 digits), emails as before (lower and trim, verified
       only);
     - a record counts only when its date of birth equals the one given, for
       'linked_elsewhere', 'ambiguous', 'portal_not_enabled' and the link
       itself. So a copied phone or email no longer blocks anyone, and no
       record state is told to a caller who does not know the date of birth;
     - a wrong date of birth, when the contact matches a record, is counted
       in public.rate_limits: bucket 'portal_link_uid' per login (limit 5)
       and bucket 'portal_link_record' per matching record (limit 10, across
       logins). A count starts at the first wrong date and runs 24 hours;
       the wrong date that reaches the limit restarts the 24 hours, so every
       date, right or wrong, is refused ('needs_staff_verification') for 24
       hours after the fifth wrong one (tenth for a record). The counter rows
       are locked for the call, so parallel calls from one login wait for
       each other instead of all passing the check;
     - anon and authenticated lose their table grants on public.rate_limits
       (row-level security already gave them no rows, but TRUNCATE ignores
       it and would clear the counters). The service role and the owner keep
       theirs.
       Each wrong date writes one audit_logs row ('portal_link_dob_mismatch',
       entity 'portal_login', the login id, never the record id);
     - no new status: 'needs_staff_verification' already tells the patient
       to ask clinic staff (src/services/portalAccessRules.ts), so the
       portal needs no change. A missing date of birth now also gets it when
       a record matches (it was 'portal_not_enabled' when that record's
       access was off).
     Unchanged: 'staff_account', 'already_linked', 'contact_not_verified'
     (now answered before the lookup; it only ever happened with no match),
     'no_clinic_record', the under-18 rule, the merged-record rule, the
     audit row for a link.

  ## Not changed
  - Links that already exist. Production today has no portal-enabled
    patient and no login with a phone.
  - Supabase logins are created only by staff while sign-ups stay off.
  - A household member who knows the date of birth can still link a record
    that shares their verified phone or email: that is what the date of
    birth is for. Staff linking stays the path for anything else.

  ## Rollback
    Re-run the portal_link_patient_record body from
    20260927100110_portal_identity_hardening.sql (section 2), then
    DROP FUNCTION public.app_phone_e164_digits(text);
    DELETE FROM public.rate_limits
     WHERE bucket IN ('portal_link_uid', 'portal_link_record');
    The rate_limits grants to anon and authenticated need not come back
    (row-level security gave them no rows).
*/

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. A phone number as E.164 digits (no plus)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_phone_e164_digits(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
           WHEN d = '' THEN NULL
           WHEN d LIKE '00%' THEN NULLIF(substr(d, 3), '')
           WHEN d LIKE '2340%' AND length(d) = 14 THEN '234' || substr(d, 5)
           WHEN d LIKE '234%' THEN d
           WHEN d LIKE '0%' AND length(d) = 11 THEN '234' || substr(d, 2)
           WHEN length(d) = 10 THEN '234' || d
           ELSE d
         END
    FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS d) AS x;
$$;

COMMENT ON FUNCTION public.app_phone_e164_digits(text) IS
  'A phone number as its E.164 digits (no plus): Nigerian local and bare 10-digit numbers get 234, a 00 prefix and a trunk 0 after 234 are dropped. Used to match a verified login phone to a clinic record (20260927100140).';

REVOKE ALL ON FUNCTION public.app_phone_e164_digits(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_phone_e164_digits(text) TO service_role;

-- The counters below live in rate_limits. Row-level security gives anon and
-- authenticated no rows, but TRUNCATE ignores it.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Linking with a limit on wrong dates of birth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_link_patient_record(
  p_dob date,
  p_given_name text DEFAULT NULL,
  p_family_name text DEFAULT NULL,
  p_phone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  c_uid_limit    constant integer  := 5;
  c_record_limit constant integer  := 10;
  c_window       constant interval := interval '24 hours';
  v_uid uuid := auth.uid();
  v_email_verified text;
  v_phone text;
  v_candidates text[];
  v_locked boolean;
  v_free integer;
  v_taken integer;
  v_id text;
  v_enabled boolean;
  v_dob date;
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to the patient portal first' USING ERRCODE = '42501';
  END IF;

  IF public.app_current_role() IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'staff_account');
  END IF;

  SELECT p.id::text INTO v_id
    FROM public.patients AS p
   WHERE p.auth_uid::text = v_uid::text
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_linked', 'patient_id', v_id);
  END IF;

  SELECT CASE WHEN u.email_confirmed_at IS NOT NULL
              THEN NULLIF(lower(trim(u.email)), '') END,
         CASE WHEN u.phone_confirmed_at IS NOT NULL
              THEN public.app_phone_e164_digits(u.phone) END
    INTO v_email_verified, v_phone
    FROM auth.users AS u
   WHERE u.id = v_uid;

  IF v_phone IS NOT NULL AND length(v_phone) NOT BETWEEN 8 AND 15 THEN
    v_phone := NULL;
  END IF;

  IF v_email_verified IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status', 'contact_not_verified');
  END IF;

  -- This login's counter, locked until the call ends so parallel calls from
  -- one login are counted one after another. (Under a read-only request
  -- this INSERT fails, so nothing below runs.)
  INSERT INTO public.rate_limits AS rl (bucket, key, window_start, count, updated_at)
  VALUES ('portal_link_uid', v_uid::text, now(), 0, now())
  ON CONFLICT (bucket, key) DO NOTHING;

  SELECT rl.count >= c_uid_limit AND rl.window_start >= now() - c_window
    INTO v_locked
    FROM public.rate_limits AS rl
   WHERE rl.bucket = 'portal_link_uid' AND rl.key = v_uid::text
     FOR UPDATE;
  IF v_locked THEN
    RETURN jsonb_build_object('status', 'needs_staff_verification');
  END IF;

  -- Every unmerged record whose contact equals a verified contact of this
  -- login, whatever its date of birth.
  SELECT array_agg(c.id::text ORDER BY c.id::text)
    INTO v_candidates
    FROM public.patients AS c
   WHERE c.merged_into IS NULL
     AND ((v_email_verified IS NOT NULL
           AND lower(trim(c.email)) = v_email_verified)
       OR (v_phone IS NOT NULL
           AND public.app_phone_e164_digits(c.phone) = v_phone));

  IF v_candidates IS NULL THEN
    RETURN jsonb_build_object('status', 'no_clinic_record');
  END IF;

  -- Each matching record's counter (across logins), locked in id order.
  INSERT INTO public.rate_limits AS rl (bucket, key, window_start, count, updated_at)
  SELECT 'portal_link_record', cid, now(), 0, now()
    FROM unnest(v_candidates) AS cid
  ON CONFLICT (bucket, key) DO NOTHING;

  SELECT COALESCE(bool_or(rl.count >= c_record_limit
                          AND rl.window_start >= now() - c_window), false)
    INTO v_locked
    FROM (SELECT r.count, r.window_start
            FROM public.rate_limits AS r
           WHERE r.bucket = 'portal_link_record' AND r.key = ANY (v_candidates)
           ORDER BY r.key
             FOR UPDATE) AS rl;
  IF v_locked THEN
    RETURN jsonb_build_object('status', 'needs_staff_verification');
  END IF;

  IF p_dob IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_staff_verification');
  END IF;

  SELECT count(*) FILTER (WHERE c.auth_uid IS NULL),
         count(*) FILTER (WHERE c.auth_uid IS NOT NULL)
    INTO v_free, v_taken
    FROM public.patients AS c
   WHERE c.id::text = ANY (v_candidates)
     AND c.dob = p_dob;

  IF v_free + v_taken = 0 THEN
    -- A wrong date of birth: count it for this login and every record the
    -- contact matched. A count starts at the first wrong date (count 0 or an
    -- ended window) and the wrong date that reaches the limit restarts the
    -- window, so the refusal lasts 24 hours from that date.
    UPDATE public.rate_limits AS rl
       SET count = CASE WHEN rl.count = 0 OR rl.window_start < now() - c_window
                        THEN 1 ELSE rl.count + 1 END,
           window_start = CASE
             WHEN rl.count = 0 OR rl.window_start < now() - c_window THEN now()
             WHEN rl.count + 1 >= CASE WHEN rl.bucket = 'portal_link_uid'
                                       THEN c_uid_limit ELSE c_record_limit END THEN now()
             ELSE rl.window_start END,
           updated_at = now()
     WHERE (rl.bucket = 'portal_link_uid' AND rl.key = v_uid::text)
        OR (rl.bucket = 'portal_link_record' AND rl.key = ANY (v_candidates));

    BEGIN
      INSERT INTO public.audit_logs (id, actor_role, action, entity, entity_id, at)
      VALUES (gen_random_uuid()::text, 'patient', 'portal_link_dob_mismatch',
              'portal_login', v_uid::text, now());
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      RAISE WARNING 'portal_link_patient_record: audit_logs schema differs; attempt not audited';
    END;

    RETURN jsonb_build_object('status', 'needs_staff_verification');
  END IF;

  IF v_taken > 0 THEN
    RETURN jsonb_build_object('status', 'linked_elsewhere');
  END IF;
  IF v_free > 1 THEN
    RETURN jsonb_build_object('status', 'ambiguous');
  END IF;

  SELECT c.id::text, COALESCE(c.portal_enabled, false), c.dob
    INTO v_id, v_enabled, v_dob
    FROM public.patients AS c
   WHERE c.id::text = ANY (v_candidates)
     AND c.dob = p_dob
     AND c.auth_uid IS NULL
   LIMIT 1;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('status', 'portal_not_enabled');
  END IF;
  -- A child's record is never linked to a sign-up. Staff link it to a
  -- verified guardian instead (checklist item 17).
  IF v_dob > (current_date - interval '18 years')::date THEN
    RETURN jsonb_build_object('status', 'needs_staff_verification');
  END IF;

  UPDATE public.patients AS c
     SET auth_uid = v_uid::text
   WHERE c.id::text = v_id
     AND c.auth_uid IS NULL
     AND c.merged_into IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'linked_elsewhere');
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (id, actor_role, action, entity, entity_id, at)
    VALUES (gen_random_uuid()::text, 'patient', 'portal_link_patient_record',
            'patient', v_id, now());
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    RAISE WARNING 'portal_link_patient_record: audit_logs schema differs; link not audited';
  END;

  RETURN jsonb_build_object('status', 'linked', 'patient_id', v_id);
END;
$function$;

-- CREATE OR REPLACE keeps existing grants; restated so the file stands alone.
REVOKE ALL ON FUNCTION public.portal_link_patient_record(date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_link_patient_record(date, text, text, text) TO authenticated, service_role;
