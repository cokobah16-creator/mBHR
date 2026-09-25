/*
  # Portal linking is for adults only, on the server too

  Legal readiness checklist item 17, step 5 (docs/legal/LEGAL_READINESS_CHECKLIST.md).
  The portal sign-up and login screens already refuse to link an account to
  a clinic record for someone under 18, and refuse a sign-up with an
  under-18 date of birth (src/utils/patient.ts isMinor, 18 years). That was
  checked only in the app. portal_link_patient_record
  (20260924110300_rls_patient_portal) is granted to every signed-in user,
  so anyone could call it from the browser. It linked an unlinked child's
  record whenever portal_enabled was true and the date of birth matched.
  Children enrolled by the old auto-enrolment trigger still have
  portal_enabled true. It also created a self-registered record for an
  under-18 date of birth.

  ## Changes
  1. public.portal_link_patient_record(date, text, text, text) is replaced
     with the same signature, grants and results. It has two new refusals,
     and both return the existing status 'needs_staff_verification':
     - the one matching clinic record belongs to someone under 18;
     - no record matches and p_dob is under 18, so no record is created.
     "Under 18" means the date of birth is after today's date 18 years ago,
     the same calendar-day rule as isMinor.
  Everything else is unchanged.

  ## Not changed
  - Guardian links (patient_guardians) and staff verification. Those are
    item 17's later steps and wait on the Foundation's guardian decision.
  - Links that already exist.

  ## Rollback
    Re-run the CREATE OR REPLACE FUNCTION public.portal_link_patient_record
    block from 20260924110300_rls_patient_portal.sql.
*/

CREATE OR REPLACE FUNCTION public.portal_link_patient_record(
  p_dob date,
  p_given_name text DEFAULT NULL,
  p_family_name text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_email_verified text;
  v_phone10 text;
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

  SELECT u.email,
         CASE WHEN u.email_confirmed_at IS NOT NULL
              THEN lower(trim(u.email)) END,
         CASE WHEN u.phone_confirmed_at IS NOT NULL
              THEN right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 10) END
    INTO v_email, v_email_verified, v_phone10
    FROM auth.users AS u
   WHERE u.id = v_uid;

  IF v_phone10 IS NOT NULL AND length(v_phone10) <> 10 THEN
    v_phone10 := NULL;
  END IF;

  SELECT count(*) FILTER (WHERE c.auth_uid IS NULL),
         count(*) FILTER (WHERE c.auth_uid IS NOT NULL)
    INTO v_free, v_taken
    FROM public.patients AS c
   WHERE (v_email_verified IS NOT NULL
          AND lower(trim(c.email)) = v_email_verified)
      OR (v_phone10 IS NOT NULL
          AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = v_phone10);

  IF v_taken > 0 THEN
    RETURN jsonb_build_object('status', 'linked_elsewhere');
  END IF;
  IF v_free > 1 THEN
    RETURN jsonb_build_object('status', 'ambiguous');
  END IF;

  IF v_free = 1 THEN
    SELECT c.id::text, COALESCE(c.portal_enabled, false), c.dob
      INTO v_id, v_enabled, v_dob
      FROM public.patients AS c
     WHERE c.auth_uid IS NULL
       AND ((v_email_verified IS NOT NULL
             AND lower(trim(c.email)) = v_email_verified)
         OR (v_phone10 IS NOT NULL
             AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = v_phone10))
     LIMIT 1;

    IF NOT v_enabled THEN
      RETURN jsonb_build_object('status', 'portal_not_enabled');
    END IF;
    -- A child's record is never linked to a sign-up. Staff link it to a
    -- verified guardian instead (checklist item 17).
    IF v_dob IS NOT NULL AND v_dob > (current_date - interval '18 years')::date THEN
      RETURN jsonb_build_object('status', 'needs_staff_verification');
    END IF;
    IF p_dob IS NULL OR v_dob IS NULL OR v_dob <> p_dob THEN
      RETURN jsonb_build_object('status', 'needs_staff_verification');
    END IF;

    UPDATE public.patients AS c
       SET auth_uid = v_uid::text
     WHERE c.id::text = v_id
       AND c.auth_uid IS NULL;
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
  END IF;

  -- No clinic record matches: create a self-registered one, but only for an
  -- account with a verified email or phone. An unverified account could
  -- otherwise fill the patient register with records carrying someone
  -- else's phone number (duplicate-record and wrong-patient risk, and it
  -- would block that person's own link later as linked_elsewhere).
  IF v_email_verified IS NULL AND v_phone10 IS NULL THEN
    RETURN jsonb_build_object('status', 'contact_not_verified');
  END IF;

  IF COALESCE(trim(p_given_name), '') = ''
     OR COALESCE(trim(p_family_name), '') = ''
     OR p_dob IS NULL THEN
    RETURN jsonb_build_object('status', 'missing_details');
  END IF;

  -- Portal accounts are for adults. A record for someone under 18 is made by
  -- staff, with a guardian, never by the child's own sign-up.
  IF p_dob > (current_date - interval '18 years')::date THEN
    RETURN jsonb_build_object('status', 'needs_staff_verification');
  END IF;

  -- Only a verified phone is stored: the typed p_phone is kept when it is
  -- the account's verified number, otherwise the verified number is used.
  v_id := gen_random_uuid()::text;
  INSERT INTO public.patients (
    id, auth_uid, given_name, family_name, email, phone, dob, sex,
    address, state, lga, portal_enabled
  ) VALUES (
    v_id, v_uid::text, trim(p_given_name), trim(p_family_name),
    CASE WHEN v_email_verified IS NOT NULL THEN trim(v_email) END,
    CASE
      WHEN v_phone10 IS NULL THEN NULL
      WHEN right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10) = v_phone10
        THEN trim(p_phone)
      ELSE (SELECT u.phone FROM auth.users AS u WHERE u.id = v_uid)
    END,
    p_dob, 'other', '', '', '', true
  );

  BEGIN
    INSERT INTO public.audit_logs (id, actor_role, action, entity, entity_id, at)
    VALUES (gen_random_uuid()::text, 'patient', 'portal_self_register',
            'patient', v_id, now());
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    RAISE WARNING 'portal_link_patient_record: audit_logs schema differs; registration not audited';
  END;

  RETURN jsonb_build_object('status', 'created', 'patient_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_link_patient_record(date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_link_patient_record(date, text, text, text) TO authenticated, service_role;
