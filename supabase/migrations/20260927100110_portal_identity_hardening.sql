/*
  # Portal identity hardening

  From the patient portal Phase 0 audit ("Server changes" items 1 and 2).
  Both must be live before public sign-up is switched back on or any portal
  invitation goes out.

  ## Changes
  1. public.app_portal_patient_ids() and public.portal_access_status() no
     longer match patient_portal_users.phone_number against the JWT's
     "phone" claim. That path trusted the claim without checking the phone
     was verified, and one number matched every record carrying it (a
     family sharing a phone). The auth_uid path and the portal-user-id paths
     (ppu.id = auth.uid(), current_portal_user_id()) are unchanged.
  2. public.portal_link_patient_record(date, text, text, text):
     - never creates a patient record. When no clinic record matches it
       returns the new status 'no_clinic_record' (the app shows its general
       "ask clinic staff" message for it until the sign-in phase adds its
       own wording). An account with neither a verified email nor a
       verified phone still gets 'contact_not_verified', as before, so the
       app keeps telling it to confirm its email first. 'created' and
       'missing_details' are no longer returned;
     - ignores merged-away records when matching and linking, so a merged
       duplicate no longer makes a link 'ambiguous' or 'portal_not_enabled'.
     Same signature and grants; every other status is unchanged.

  ## Not changed
  - Links and records that already exist, including the self-registered
    record created on production at 08:41 on 26 Sept (HRIS/Emeke decide).
  - Matching still trusts auth.users.email_confirmed_at. On production,
    email confirmation is effectively off (confirmed 0.08 s after sign-up),
    so "Confirm email" must be on in Supabase Auth before sign-up reopens.

  ## Rollback
    Re-run the function bodies from 20260925100000 (section 5),
    20260925100100 (section 5) and 20260926120100.
*/

CREATE OR REPLACE FUNCTION public.app_portal_patient_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p.id::text
    FROM public.patients AS p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.auth_uid::text = (SELECT auth.uid())::text
     AND COALESCE(p.portal_enabled, false)
     AND p.merged_into IS NULL
  UNION
  SELECT ppu.patient_id::text
    FROM public.patient_portal_users AS ppu
    JOIN public.patients AS p ON p.id::text = ppu.patient_id::text
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND COALESCE(ppu.account_status, 'active') = 'active'
     AND COALESCE(p.portal_enabled, false)
     AND p.merged_into IS NULL
     AND (
          ppu.id::text = (SELECT auth.uid())::text
       OR ppu.id::text = (SELECT public.current_portal_user_id())
     );
$$;

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
     );
$$;

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
   WHERE c.merged_into IS NULL
     AND ((v_email_verified IS NOT NULL
           AND lower(trim(c.email)) = v_email_verified)
       OR (v_phone10 IS NOT NULL
           AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = v_phone10));

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
       AND c.merged_into IS NULL
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
  END IF;

  -- No clinic record matches. A portal sign-up never creates a patient
  -- record: the clinic registers patients, and a sign-up links to that
  -- record. Creating one here made duplicates of patients whose clinic
  -- record has only a phone number or a different email, with portal access
  -- switched on and no staff decision. p_given_name, p_family_name and
  -- p_phone stay in the signature for existing callers.
  IF v_email_verified IS NULL AND v_phone10 IS NULL THEN
    RETURN jsonb_build_object('status', 'contact_not_verified');
  END IF;
  RETURN jsonb_build_object('status', 'no_clinic_record');
END;
$$;

REVOKE ALL ON FUNCTION public.portal_link_patient_record(date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_link_patient_record(date, text, text, text) TO authenticated, service_role;

-- CREATE OR REPLACE keeps existing grants; restated so the file stands alone.
REVOKE ALL ON FUNCTION public.app_portal_patient_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_portal_patient_ids() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_access_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_access_status() TO authenticated, service_role;
