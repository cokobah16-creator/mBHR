/*
  # Portal messages hardening

  From the patient portal Phase 0 audit (item 4), drafted by the portal
  thread and reviewed by HRIS (three reviews on a production-schema copy).

  Until now a signed-in patient could, through the API (never through the
  portal UI):
    a) archive any of their messages, hiding it from the staff inbox;
    b) mark their OWN messages read, so staff unread counts skipped them and
       the portal showed "Seen by the clinic team" when nobody had;
    c) choose from_name and staff_id on insert (any name, any staff id);
    d) choose created_at on insert and updated_at on update, moving a
       message to the top or bottom of the staff inbox.

  ## Changes
  1. app_guard_patient_message_update (BEFORE UPDATE): a caller without the
     'consult' permission may change only `read`, and only from false to
     true on a clinic message (from_patient false). The server sets
     updated_at. An update that changes nothing writes nothing. Staff with
     'consult', the service role and migrations are unaffected.
  2. zz_stamp_patient_message (BEFORE INSERT, named to run after
     merge_redirect_patient so it sees the kept record): for a caller without
     'consult', the row must be the patient's own message (from_patient
     true). The server then sets from_name from the patient record, keeps
     staff_id only when that staff member has written to this patient (a
     reply; otherwise null, the shared inbox), and starts read and
     is_archived false and both timestamps at now().

  The portal already sends the record's name and a reply's staff_id and
  never sends the other columns, so it behaves as before. The stored value
  can differ only where a name part is empty (the portal would send
  "Name null") or the named staff member has no message to this patient.

  ## Not changed
  - The table is not added to the supabase_realtime publication. Adding it
    is fine once the portal's channel filters on patient_id: realtime skips
    row-level security for DELETE events, so an unfiltered portal channel
    would receive the ids of messages deleted anywhere.
  - Staff with 'consult' can still write any staff_id and from_name on
    their own inserts, and authenticated still holds TRUNCATE, TRIGGER and
    REFERENCES on the table (PostgREST does not expose them). Both are for
    the queued privilege hardening.

  ## Rollback
    DROP TRIGGER IF EXISTS app_guard_patient_message_update ON public.patient_secure_messages;
    DROP TRIGGER IF EXISTS zz_stamp_patient_message ON public.patient_secure_messages;
    DROP FUNCTION IF EXISTS public.app_guard_patient_message_update();
    DROP FUNCTION IF EXISTS public.app_stamp_patient_message();
*/

-- 1. Updates by callers without 'consult': only read, false to true, on a
--    clinic message. Runs before app_guard_secure_message (name order).
CREATE OR REPLACE FUNCTION public.app_guard_patient_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.app_has_permission('consult') THEN
    RETURN NEW;
  END IF;

  IF NEW.is_archived IS DISTINCT FROM OLD.is_archived THEN
    RAISE EXCEPTION 'This account cannot archive messages' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'read' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read' - 'updated_at') THEN
    RAISE EXCEPTION 'This account can only mark clinic messages as read' USING ERRCODE = '42501';
  END IF;

  -- Nothing to change (including an updated_at-only update): write nothing.
  IF NEW.read IS NOT DISTINCT FROM OLD.read THEN
    RETURN NULL;
  END IF;
  IF COALESCE(OLD.from_patient, false) OR NOT COALESCE(NEW.read, false) THEN
    RAISE EXCEPTION 'This account can only mark clinic messages as read' USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_guard_patient_message_update ON public.patient_secure_messages;
CREATE TRIGGER app_guard_patient_message_update
  BEFORE UPDATE ON public.patient_secure_messages
  FOR EACH ROW EXECUTE FUNCTION public.app_guard_patient_message_update();

-- 2. Inserts by callers without 'consult': the server sets the sender fields.
--    SECURITY INVOKER on purpose: current_user must stay the caller's role,
--    and the patient's own read access covers both lookups (own record, own
--    messages). The trigger name sorts after merge_redirect_patient, so
--    NEW.patient_id is already the kept record.
CREATE OR REPLACE FUNCTION public.app_stamp_patient_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_name text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.app_has_permission('consult') THEN
    RETURN NEW;
  END IF;
  -- Row-level security already refuses these; this also holds if a wider
  -- insert policy is ever added.
  IF NOT COALESCE(NEW.from_patient, false) THEN
    RAISE EXCEPTION 'Only clinic staff with the consult permission can send clinic messages'
      USING ERRCODE = '42501';
  END IF;

  SELECT NULLIF(btrim(concat_ws(' ', p.given_name, p.family_name)), '')
    INTO v_name
    FROM public.patients AS p
   WHERE p.id = NEW.patient_id;
  NEW.from_name := COALESCE(v_name, 'Patient');

  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patient_secure_messages AS m
     WHERE m.patient_id = NEW.patient_id
       AND m.staff_id = NEW.staff_id
       AND NOT COALESCE(m.from_patient, false)
  ) THEN
    NEW.staff_id := NULL;
  END IF;

  NEW.read := false;
  NEW.is_archived := false;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_stamp_patient_message ON public.patient_secure_messages;
DROP TRIGGER IF EXISTS zz_stamp_patient_message ON public.patient_secure_messages;
CREATE TRIGGER zz_stamp_patient_message
  BEFORE INSERT ON public.patient_secure_messages
  FOR EACH ROW EXECUTE FUNCTION public.app_stamp_patient_message();
