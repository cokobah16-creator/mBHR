-- ============================================================================
-- Patient documents: who uploaded them, and soft delete instead of delete
-- ============================================================================
-- Runs after the 20260924* row-level security migrations (app_is_staff,
-- app_has_any_permission, app_portal_patient_ids and the patient_documents
-- and patient-documents storage policies of 20260924110300) and
-- 20260925100000 (app_portal_patient_ids() skips merged-away records).
--
-- Owner decision: "Patient documents: add uploaded_by_user_id +
-- upload_source = patient|staff; patients may only soft-delete their own
-- uploads; never delete staff-uploaded clinical records."
--
--   1. Columns: upload_source ('patient' | 'staff', NOT NULL; every row that
--      exists before this migration is 'staff'), uploaded_by_user_id (uuid),
--      deleted_at / deleted_by (soft delete). The column names the portal
--      screen writes (document_name, file_path, mime_type) are added when
--      the table has the older file_name / storage_path / file_type layout
--      of 20251030000000, and kept in step by the trigger.
--   2. Trigger patient_documents_ownership:
--        INSERT  upload_source and uploaded_by_user_id come from the caller,
--                never from the client: a caller with register, vitals or
--                consult is 'staff', anyone else (a portal patient) is
--                'patient'. A staff account that is also a portal patient
--                therefore uploads clinic records. A new row is never
--                already removed.
--        UPDATE  upload_source, uploaded_by_user_id (and the legacy
--                uploaded_by_patient flag) never change for API callers
--                (authenticated, anon, service_role). file_path /
--                storage_path never change for signed-in callers (a
--                repointed clinic row would make its file deletable). A
--                signed-in caller may only move deleted_at from empty to
--                set, only on a patient upload (never a clinic record),
--                needs consult or users to do it, and gets the server clock
--                and their own id stamped; a removal cannot be undone or
--                rewritten (the service role can, for support).
--        DELETE  a staff-uploaded row cannot be deleted by any API caller,
--                service_role included.
--   3. Policies: a portal patient reads their own documents that are not
--      removed (staff read every row, removed ones included, so they can
--      see what a patient removed), inserts only for their own record as
--      'patient' with the file in their own folder, and has NO update or
--      delete policy. Staff rules are unchanged: insert and edit with
--      register / vitals / consult, hard delete with consult / users, now
--      limited by the trigger to patient-uploaded rows.
--   4. RPC portal_remove_document(uuid): the only way a patient removes a
--      document. It soft-deletes a patient-uploaded row of the caller's own
--      record and refuses a clinic ('staff') document. An RPC, not an
--      UPDATE policy: Postgres checks the SELECT policy against the updated
--      row, so a direct UPDATE that sets deleted_at fails ("new row violates
--      row-level security policy") while patients may not read removed rows.
--   5. Storage (bucket patient-documents): files are kept when a document
--      is removed. A patient can no longer delete files in their folder,
--      except a file they uploaded that no document row points to (the
--      portal removes its own upload when saving the row fails). Staff with
--      consult / users can delete only files no row points to, so a file
--      behind a document row, removed or not, is never deleted through the
--      API. A patient can no longer read a file whose document was removed.
--      Deleting the files of removed documents (retention) is an owner task,
--      done with the service role or the database owner.
--
-- Decision on staff soft delete (conservative): the app has no staff
-- screen for patient documents, so nothing needs it today. Clinic
-- ('staff') records cannot be removed through the API at all, not even as a
-- soft delete; a mis-filed clinic document is corrected by the service role
-- or the owner (support task). Staff with consult / users (doctor,
-- lead_clinician, admin), who could already hard-delete patient uploads,
-- may also soft-delete a patient upload. A soft delete keeps the row and
-- the file, records who and when, and cannot be undone through the API.
--
-- The legacy uploaded_by_patient flag (default true, never set reliably) is
-- not trusted and not backfilled; upload_source is the source of truth.
--
-- Not covered: deleting a whole patient record (patients DELETE, 'users'
-- holders) still cascades to its documents. Foreign-key cascades run as the
-- table owner, which this trigger does not restrict.
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   DROP POLICY patient_documents_objects_select, _insert, _delete ON
--     storage.objects and re-create them from 20260924110300;
--   DROP FUNCTION public.app_patient_document_file_visible_to_patient(text),
--     public.app_patient_document_file_unreferenced(text),
--     public.portal_remove_document(uuid);
--   DROP TRIGGER patient_documents_ownership ON public.patient_documents;
--   DROP FUNCTION public.tg_patient_documents_ownership();
--   DROP POLICY patient_documents_select, patient_documents_insert,
--     patient_documents_update_staff, patient_documents_delete_staff ON
--     public.patient_documents and re-create the four policies of
--     20260924110300.
--   The added columns can stay (nothing reads them without this migration).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_type text;
  v_con record;
  v_bad bigint;
BEGIN
  IF to_regclass('public.patient_documents') IS NULL THEN
    RAISE WARNING 'patient_documents does not exist; 20260925100700 skipped';
    RETURN;
  END IF;

  -- Column names the portal writes. No-ops on the layout of
  -- 20251026225242 / 20251028000000; on the 20251030000000 layout they are
  -- added and filled from file_name / storage_path / file_type.
  ALTER TABLE public.patient_documents
    ADD COLUMN IF NOT EXISTS document_name text,
    ADD COLUMN IF NOT EXISTS file_path text,
    ADD COLUMN IF NOT EXISTS mime_type text;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'patient_documents'
                AND column_name = 'file_name') THEN
    UPDATE public.patient_documents SET document_name = file_name
     WHERE document_name IS NULL AND file_name IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'patient_documents'
                AND column_name = 'storage_path') THEN
    UPDATE public.patient_documents SET file_path = storage_path
     WHERE file_path IS NULL AND storage_path IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'patient_documents'
                AND column_name = 'file_type') THEN
    UPDATE public.patient_documents SET mime_type = file_type
     WHERE mime_type IS NULL AND file_type IS NOT NULL;
  END IF;

  -- uploaded_by_user_id: the uploader's auth user id. A portal patient is
  -- not an app_users row, so a foreign key to app_users (20251028000000
  -- layout) would refuse every patient upload: drop it.
  ALTER TABLE public.patient_documents
    ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid;

  FOR v_con IN
    SELECT con.conname
      FROM pg_constraint AS con
      JOIN pg_attribute AS a
        ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.patient_documents'::regclass
       AND con.contype = 'f'
       AND a.attname = 'uploaded_by_user_id'
  LOOP
    EXECUTE format('ALTER TABLE public.patient_documents DROP CONSTRAINT %I', v_con.conname);
    RAISE NOTICE 'patient_documents: dropped foreign key % (uploaders include portal patients)', v_con.conname;
  END LOOP;

  -- Older layouts made it text. Make it uuid when every stored value is one;
  -- otherwise keep text (every comparison in this file casts to text).
  SELECT data_type INTO v_type
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'patient_documents'
     AND column_name = 'uploaded_by_user_id';
  IF v_type IN ('text', 'character varying') THEN
    EXECUTE $q$
      SELECT count(*) FROM public.patient_documents
       WHERE NULLIF(btrim(uploaded_by_user_id::text), '') IS NOT NULL
         AND btrim(uploaded_by_user_id::text)
             !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $q$ INTO v_bad;
    IF v_bad = 0 THEN
      BEGIN
        ALTER TABLE public.patient_documents
          ALTER COLUMN uploaded_by_user_id TYPE uuid
          USING NULLIF(btrim(uploaded_by_user_id::text), '')::uuid;
      EXCEPTION WHEN feature_not_supported OR dependent_objects_still_exist THEN
        RAISE WARNING 'patient_documents.uploaded_by_user_id kept as text (a view or rule uses it)';
      END;
    ELSE
      RAISE WARNING 'patient_documents.uploaded_by_user_id kept as text: % value(s) are not uuids', v_bad;
    END IF;
  END IF;

  -- upload_source: every existing row counts as a clinic record (owner
  -- decision), so patients cannot remove anything uploaded before this.
  ALTER TABLE public.patient_documents
    ADD COLUMN IF NOT EXISTS upload_source text DEFAULT 'staff';
  UPDATE public.patient_documents SET upload_source = 'staff' WHERE upload_source IS NULL;
  ALTER TABLE public.patient_documents ALTER COLUMN upload_source SET DEFAULT 'staff';
  ALTER TABLE public.patient_documents ALTER COLUMN upload_source SET NOT NULL;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'patient_documents_upload_source_check'
                    AND conrelid = 'public.patient_documents'::regclass) THEN
    ALTER TABLE public.patient_documents
      ADD CONSTRAINT patient_documents_upload_source_check
      CHECK (upload_source IN ('patient', 'staff'));
  END IF;

  ALTER TABLE public.patient_documents
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_by uuid;

  -- deleted_by may be empty (a removal by the service role), but never set
  -- on a row that is not removed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'patient_documents_deleted_pair'
                    AND conrelid = 'public.patient_documents'::regclass) THEN
    ALTER TABLE public.patient_documents
      ADD CONSTRAINT patient_documents_deleted_pair
      CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL);
  END IF;

  -- Storage policies look documents up by file path.
  CREATE INDEX IF NOT EXISTS idx_patient_documents_file_path
    ON public.patient_documents (file_path);

  COMMENT ON COLUMN public.patient_documents.upload_source IS
    'Who added the document: patient (portal upload) or staff (clinic record). Set by the server on insert and never changed. Rows that existed before 20260925100700 are staff.';
  COMMENT ON COLUMN public.patient_documents.uploaded_by_user_id IS
    'auth.uid() of the account that uploaded the document. Set by the server on insert and never changed.';
  COMMENT ON COLUMN public.patient_documents.deleted_at IS
    'When the document was removed (soft delete). Removed documents are hidden from the patient; the row and the file are kept.';
  COMMENT ON COLUMN public.patient_documents.deleted_by IS
    'auth.uid() of the account that removed the document, stamped by the server.';
END $$;

-- ----------------------------------------------------------------------------
-- 2. Ownership and soft-delete guard
-- ----------------------------------------------------------------------------
-- Columns are read and written through to_jsonb / jsonb_populate_record where
-- the layouts differ, so a column one layout lacks is simply ignored.
-- SECURITY DEFINER functions (portal_remove_document, merge_patients) run as
-- the function owner and are not restricted here; they make their own checks.
CREATE OR REPLACE FUNCTION public.tg_patient_documents_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Signed-in or anonymous API callers (row-level security applies to them).
  v_api boolean := current_user IN ('authenticated', 'anon');
  -- Every API caller, the service role included.
  v_client boolean := current_user IN ('authenticated', 'anon', 'service_role');
  v_uid uuid := (SELECT auth.uid());
  v_new jsonb;
  v_old jsonb;
  v_col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF v_client AND OLD.upload_source = 'staff' THEN
      RAISE EXCEPTION 'Clinic documents are part of the health record and cannot be deleted'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      'document_name', COALESCE(v_new ->> 'document_name', v_new ->> 'file_name'),
      'file_name',     COALESCE(v_new ->> 'file_name', v_new ->> 'document_name'),
      'file_path',     COALESCE(v_new ->> 'file_path', v_new ->> 'storage_path'),
      'storage_path',  COALESCE(v_new ->> 'storage_path', v_new ->> 'file_path'),
      'mime_type',     COALESCE(v_new ->> 'mime_type', v_new ->> 'file_type'),
      'file_type',     COALESCE(v_new ->> 'file_type', v_new ->> 'mime_type')));

    IF v_api THEN
      -- Never trust the client: the caller decides who uploaded it.
      NEW.uploaded_by_user_id := v_uid;
      NEW.upload_source := CASE
        WHEN public.app_has_any_permission(ARRAY['register', 'vitals', 'consult'])
          THEN 'staff'
        ELSE 'patient'
      END;
      NEW.deleted_at := NULL;
      NEW.deleted_by := NULL;
      NEW := jsonb_populate_record(NEW, jsonb_build_object(
        'uploaded_by_patient', NEW.upload_source = 'patient'));
    ELSIF NEW.upload_source IS NULL THEN
      NEW.upload_source := 'staff';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF v_client THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    FOREACH v_col IN ARRAY ARRAY['upload_source', 'uploaded_by_user_id', 'uploaded_by_patient'] LOOP
      IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
        RAISE EXCEPTION 'Who uploaded a document cannot be changed (patient_documents.%)', v_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  IF v_api THEN
    -- The stored file behind a document never changes through the API.
    -- Otherwise a caller could point a clinic record at another path, which
    -- makes its file "unreferenced" and deletable under the storage rules.
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    FOREACH v_col IN ARRAY ARRAY['file_path', 'storage_path'] LOOP
      IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
        RAISE EXCEPTION 'The file of a document cannot be changed (patient_documents.%)', v_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;

    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      -- Clinic records are never removed through the API, not even as a
      -- soft delete (owner decision; no app screen needs it). The service
      -- role or the owner can, for support.
      IF OLD.upload_source = 'staff' THEN
        RAISE EXCEPTION 'Clinic documents are part of the health record and cannot be removed'
          USING ERRCODE = '42501';
      END IF;
      -- Staff soft delete of a patient upload. Portal patients use
      -- portal_remove_document().
      IF NOT public.app_has_any_permission(ARRAY['consult', 'users']) THEN
        RAISE EXCEPTION 'This account cannot remove patient documents'
          USING ERRCODE = '42501';
      END IF;
      NEW.deleted_at := clock_timestamp();
      NEW.deleted_by := v_uid;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'A removed document cannot be restored through the app'
        USING ERRCODE = '42501';
    ELSIF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
      RAISE EXCEPTION 'When and by whom a document was removed cannot be changed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_patient_documents_ownership() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.patient_documents') IS NULL THEN
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS patient_documents_ownership ON public.patient_documents;
  CREATE TRIGGER patient_documents_ownership
    BEFORE INSERT OR UPDATE OR DELETE ON public.patient_documents
    FOR EACH ROW EXECUTE FUNCTION public.tg_patient_documents_ownership();
  -- PostgREST cannot send TRUNCATE; take the privilege away from API roles
  -- anyway so no client role can empty the table.
  REVOKE TRUNCATE ON public.patient_documents FROM anon, authenticated;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Row-level security
-- ----------------------------------------------------------------------------
-- Written out here: the migration-only helpers app_rls_reset() and
-- app_rls_policy() were dropped in 20260924110400.
DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass('public.patient_documents') IS NULL THEN
    RETURN;
  END IF;
  FOR v_policy IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'patient_documents'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.patient_documents', v_policy.policyname);
  END LOOP;
  ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.patient_documents FROM anon;

  -- Staff see every row (removed ones too); a patient sees their own
  -- documents that are not removed.
  CREATE POLICY patient_documents_select ON public.patient_documents
    FOR SELECT TO authenticated
    USING ((SELECT public.app_is_staff())
           OR (deleted_at IS NULL
               AND patient_id::text IN (SELECT public.app_portal_patient_ids())));

  -- upload_source is stamped by the trigger before this check runs.
  CREATE POLICY patient_documents_insert ON public.patient_documents
    FOR INSERT TO authenticated
    WITH CHECK (
      ((SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))
       AND upload_source = 'staff')
      OR (upload_source = 'patient'
          AND deleted_at IS NULL
          AND patient_id::text IN (SELECT public.app_portal_patient_ids())
          -- The file must be in this patient's own folder, so a patient
          -- cannot attach a row to (and pin) a file of another patient.
          AND split_part(file_path, '/', 1) = patient_id::text));

  -- Staff edits. Soft delete inside it is limited by the trigger.
  CREATE POLICY patient_documents_update_staff ON public.patient_documents
    FOR UPDATE TO authenticated
    USING ((SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult'])))
    WITH CHECK ((SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult'])));

  -- No patient branch any more. The trigger refuses staff-uploaded rows, so
  -- this reaches patient uploads only.
  CREATE POLICY patient_documents_delete_staff ON public.patient_documents
    FOR DELETE TO authenticated
    USING ((SELECT public.app_has_any_permission(ARRAY['consult', 'users'])));
END $$;

-- ----------------------------------------------------------------------------
-- 4. Patient removal (soft delete)
-- ----------------------------------------------------------------------------
-- Returns {outcome: 'applied', already_removed, document_id, removed_at} or
-- {outcome: 'rejected', reason: 'not_found' | 'clinic_document', document_id}.
-- not_found covers documents of other patients (nothing is revealed about
-- them) and records whose portal access is off or that were merged away.
CREATE OR REPLACE FUNCTION public.portal_remove_document(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  r record;
  v_removed_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to remove a document' USING ERRCODE = '42501';
  END IF;

  SELECT d.id, d.upload_source, d.deleted_at
    INTO r
    FROM public.patient_documents AS d
   WHERE d.id = p_document_id
     AND d.patient_id::text IN (SELECT public.app_portal_patient_ids())
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'not_found',
                              'document_id', p_document_id);
  END IF;

  IF r.upload_source IS DISTINCT FROM 'patient' THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'clinic_document',
                              'document_id', p_document_id);
  END IF;

  IF r.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'applied', 'already_removed', true,
                              'document_id', p_document_id, 'removed_at', r.deleted_at);
  END IF;

  UPDATE public.patient_documents
     SET deleted_at = clock_timestamp(),
         deleted_by = v_uid
   WHERE id = p_document_id
  RETURNING deleted_at INTO v_removed_at;

  RETURN jsonb_build_object('outcome', 'applied', 'already_removed', false,
                            'document_id', p_document_id, 'removed_at', v_removed_at);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_remove_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_remove_document(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.portal_remove_document(uuid) IS
  'Portal patient removes (soft-deletes) a document they uploaded to their own record. Clinic documents are refused. The row and the file are kept.';

-- ----------------------------------------------------------------------------
-- 5. Storage: bucket patient-documents (files under "<patient_id>/...")
-- ----------------------------------------------------------------------------
-- Both helpers answer only for staff or for a file in one of the caller's
-- own folders, so they reveal nothing about other patients' files. A path
-- is matched with and without the bucket prefix.

-- A patient may read a file in their folder unless a removed document
-- points to it.
CREATE OR REPLACE FUNCTION public.app_patient_document_file_visible_to_patient(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    NULLIF(split_part(p_name, '/', 1), p_name) IN (SELECT public.app_portal_patient_ids())
    AND NOT EXISTS (
      SELECT 1 FROM public.patient_documents AS d
       WHERE d.file_path IN (p_name, 'patient-documents/' || p_name)
         AND d.deleted_at IS NOT NULL),
    false);
$$;

-- No document row (removed or not) points to the file. False for callers
-- who are neither staff nor the folder's patient.
CREATE OR REPLACE FUNCTION public.app_patient_document_file_unreferenced(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (public.app_is_staff()
     OR NULLIF(split_part(p_name, '/', 1), p_name) IN (SELECT public.app_portal_patient_ids()))
    AND NOT EXISTS (
      SELECT 1 FROM public.patient_documents AS d
       WHERE d.file_path IN (p_name, 'patient-documents/' || p_name)),
    false);
$$;

REVOKE ALL ON FUNCTION public.app_patient_document_file_visible_to_patient(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_patient_document_file_unreferenced(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_patient_document_file_visible_to_patient(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_patient_document_file_unreferenced(text) TO authenticated, service_role;

DO $$
DECLARE
  -- Who uploaded a storage object: owner_id (text) on current Supabase
  -- storage, owner (uuid) on older versions.
  v_owner_expr text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE WARNING 'storage.objects does not exist; patient-documents storage policies skipped';
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
  DROP POLICY IF EXISTS "patient_documents_objects_insert" ON storage.objects;
  DROP POLICY IF EXISTS "patient_documents_objects_delete" ON storage.objects;

  CREATE POLICY "patient_documents_objects_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'patient-documents'
      AND ((SELECT public.app_is_staff())
           OR public.app_patient_document_file_visible_to_patient(name)));

  -- Unchanged from 20260924110300. There is still no UPDATE policy, so
  -- nobody can overwrite a stored file through the API.
  CREATE POLICY "patient_documents_objects_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'patient-documents'
      AND ((SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))
           OR (storage.foldername(name))[1] IN (SELECT public.app_portal_patient_ids())));

  EXECUTE format($p$
    CREATE POLICY "patient_documents_objects_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'patient-documents'
        AND public.app_patient_document_file_unreferenced(name)
        AND ((SELECT public.app_has_any_permission(ARRAY['consult', 'users']))
             OR ((storage.foldername(name))[1] IN (SELECT public.app_portal_patient_ids())
                 AND %s = (SELECT auth.uid())::text)))
  $p$, v_owner_expr);
END $$;

-- ----------------------------------------------------------------------------
-- 6. Check
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.patient_documents') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'patient_documents'
                AND cmd IN ('UPDATE', 'DELETE', 'ALL')
                AND (COALESCE(qual, '') LIKE '%app_portal_patient_ids%'
                     OR COALESCE(with_check, '') LIKE '%app_portal_patient_ids%')) THEN
    RAISE EXCEPTION 'patient_documents still lets portal patients update or delete rows directly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.patient_documents'::regclass
                    AND tgname = 'patient_documents_ownership'
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'patient_documents_ownership trigger is missing';
  END IF;
END $$;

-- End of migration.
