-- pgTAP: who uploaded a patient document, and removal as a soft delete
-- Migration under test: supabase/migrations/20260925100700_patient_document_ownership.sql
-- Run with `supabase test db` (see supabase/tests/README.md). Fixtures are
-- created below and everything is rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(49);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner: row-level security and the API-role
-- checks of the ownership trigger do not apply to this role)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_users (id, full_name, role) VALUES
  ('77770000-0000-4000-8000-000000000001', 'pgTAP doctor', 'doctor'),
  ('77770000-0000-4000-8000-000000000002', 'pgTAP nurse', 'nurse'),
  ('77770000-0000-4000-8000-000000000003', 'pgTAP pharmacist', 'pharmacist');

-- Two portal patients (linked by auth_uid, portal access on).
INSERT INTO public.patients (
  id, given_name, family_name, phone, auth_uid, portal_enabled, portal_enabled_changed_at)
VALUES
  ('pgtap-doc-1', 'Ada', 'Docs', '08000000071', '77770000-0000-4000-8000-0000000000a1', true, now()),
  ('pgtap-doc-2', 'Bayo', 'Docs', '08000000072', '77770000-0000-4000-8000-0000000000a2', true, now());

-- A document that existed before the migration is a clinic record: written
-- by the owner with no upload_source, it takes the default.
INSERT INTO public.patient_documents (
  id, patient_id, document_type, document_name, file_path, file_size, mime_type)
VALUES
  ('7777d0c0-0000-4000-8000-000000000001', 'pgtap-doc-1', 'lab_result', 'Clinic letter.pdf',
   'pgtap-doc-1/staff.pdf', 100, 'application/pdf'),
  ('7777d0c0-0000-4000-8000-000000000002', 'pgtap-doc-2', 'other', 'Other patient.pdf',
   'pgtap-doc-2/other.pdf', 100, 'application/pdf');

SELECT is(
  (SELECT upload_source FROM public.patient_documents
    WHERE id = '7777d0c0-0000-4000-8000-000000000001'),
  'staff',
  'a row written without upload_source is a clinic (staff) record');

SELECT throws_ok(
  $$INSERT INTO public.patient_documents (
      patient_id, document_type, document_name, file_path, upload_source)
    VALUES ('pgtap-doc-1', 'other', 'x', 'pgtap-doc-1/x.pdf', 'someone')$$,
  '23514', NULL,
  'upload_source accepts only patient or staff');

-- Storage objects in the patient-documents bucket.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('patient-documents', 'pgtap-doc-1/staff.pdf',        '77770000-0000-4000-8000-000000000001'),
  ('patient-documents', 'pgtap-doc-1/removed.pdf',      '77770000-0000-4000-8000-0000000000a1'),
  ('patient-documents', 'pgtap-doc-1/orphan.pdf',       '77770000-0000-4000-8000-0000000000a1'),
  ('patient-documents', 'pgtap-doc-1/orphan-staff.pdf', '77770000-0000-4000-8000-000000000001'),
  ('patient-documents', 'pgtap-doc-2/other.pdf',        '77770000-0000-4000-8000-0000000000a2');

-- Current Supabase storage records the uploader in owner_id (text).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'storage' AND table_name = 'objects'
                AND column_name = 'owner_id') THEN
    EXECUTE $q$UPDATE storage.objects SET owner_id = owner::text
                WHERE bucket_id = 'patient-documents' AND name LIKE 'pgtap-doc-%'$q$;
  END IF;
END $$;

-- Newer Supabase storage refuses direct DELETEs on storage.objects unless
-- this is set; row-level security is still applied.
SET LOCAL storage.allow_delete_query = 'true';

-- ---------------------------------------------------------------------------
-- Portal patient 1: upload, read, remove
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000a1","role":"authenticated"}';

SELECT lives_ok(
  $$INSERT INTO public.patient_documents (
      id, patient_id, document_type, document_name, file_path, file_size, mime_type,
      upload_source, uploaded_by_user_id, deleted_at)
    VALUES
      ('7777d0c0-0000-4000-8000-000000000011', 'pgtap-doc-1', 'medical_record', 'My scan.pdf',
       'pgtap-doc-1/removed.pdf', 100, 'application/pdf',
       'staff', '77770000-0000-4000-8000-000000000001', now()),
      ('7777d0c0-0000-4000-8000-000000000012', 'pgtap-doc-1', 'other', 'My letter.pdf',
       'pgtap-doc-1/mine.pdf', 100, 'application/pdf',
       NULL, NULL, NULL)$$,
  'a portal patient uploads two documents to their own record (one with forged ownership values)');

SELECT is(
  (SELECT count(*)::int FROM public.patient_documents
    WHERE id IN ('7777d0c0-0000-4000-8000-000000000011', '7777d0c0-0000-4000-8000-000000000012')
      AND upload_source = 'patient'
      AND uploaded_by_user_id::text = '77770000-0000-4000-8000-0000000000a1'
      AND deleted_at IS NULL AND deleted_by IS NULL),
  2,
  'the server stamps upload_source patient, the caller as uploader and not removed, whatever the client sent');

SELECT throws_ok(
  $$INSERT INTO public.patient_documents (
      patient_id, document_type, document_name, file_path)
    VALUES ('pgtap-doc-2', 'other', 'Not mine.pdf', 'pgtap-doc-2/x.pdf')$$,
  '42501', NULL,
  'a portal patient cannot add a document to another patient''s record');

SELECT throws_ok(
  $$INSERT INTO public.patient_documents (
      patient_id, document_type, document_name, file_path)
    VALUES ('pgtap-doc-1', 'other', 'Pinned.pdf', 'pgtap-doc-2/other.pdf')$$,
  '42501', NULL,
  'a portal patient cannot attach a document row to a file in another patient''s folder');

SELECT is(
  (SELECT count(*)::int FROM public.patient_documents
    WHERE patient_id IN ('pgtap-doc-1', 'pgtap-doc-2')),
  3,
  'a portal patient sees their clinic record and their own uploads, not another patient''s documents');

WITH u AS (
  UPDATE public.patient_documents SET deleted_at = now()
   WHERE id = '7777d0c0-0000-4000-8000-000000000011' RETURNING 1)
SELECT is(
  (SELECT count(*)::int FROM u),
  0,
  'a portal patient cannot soft-delete by a direct UPDATE (no update rule)');

WITH d AS (
  DELETE FROM public.patient_documents
   WHERE id IN ('7777d0c0-0000-4000-8000-000000000001', '7777d0c0-0000-4000-8000-000000000011')
   RETURNING 1)
SELECT is(
  (SELECT count(*)::int FROM d),
  0,
  'a portal patient cannot hard-delete any document, not even their own upload');

SELECT is(
  public.portal_remove_document('7777d0c0-0000-4000-8000-000000000001') ->> 'reason',
  'clinic_document',
  'portal_remove_document refuses a clinic document');

SELECT is(
  public.portal_remove_document('7777d0c0-0000-4000-8000-000000000002') ->> 'reason',
  'not_found',
  'portal_remove_document answers not_found for another patient''s document');

SELECT is(
  public.portal_remove_document('7777d0c0-0000-4000-8000-000000000011')
    - 'removed_at' - 'document_id',
  '{"outcome": "applied", "already_removed": false}'::jsonb,
  'portal_remove_document removes (soft-deletes) the patient''s own upload');

SELECT is(
  public.portal_remove_document('7777d0c0-0000-4000-8000-000000000011') ->> 'already_removed',
  'true',
  'removing it again changes nothing (already_removed)');

SELECT is(
  (SELECT count(*)::int FROM public.patient_documents
    WHERE id = '7777d0c0-0000-4000-8000-000000000011'),
  0,
  'the removed document is no longer shown to the patient');

-- Storage, as patient 1
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'patient-documents' AND name = 'pgtap-doc-1/staff.pdf'),
  1,
  'the patient can read the file of a clinic document in their folder');

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'patient-documents' AND name = 'pgtap-doc-1/removed.pdf'),
  0,
  'the patient can no longer read the file of a removed document');

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'patient-documents' AND name = 'pgtap-doc-2/other.pdf'),
  0,
  'the patient cannot read another patient''s file');

WITH d AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'patient-documents'
     AND name IN ('pgtap-doc-1/staff.pdf', 'pgtap-doc-1/removed.pdf')
   RETURNING 1)
SELECT is(
  (SELECT count(*)::int FROM d),
  0,
  'the patient cannot delete a file a document points to (clinic or removed)');

WITH d AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'patient-documents' AND name = 'pgtap-doc-1/orphan-staff.pdf'
   RETURNING 1)
SELECT is(
  (SELECT count(*)::int FROM d),
  0,
  'the patient cannot delete a file in their folder that someone else uploaded');

WITH d AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'patient-documents' AND name = 'pgtap-doc-1/orphan.pdf'
   RETURNING 1)
SELECT is(
  (SELECT count(*)::int FROM d),
  1,
  'the patient can delete their own upload that no document points to (failed save clean-up)');

SELECT is(
  public.app_patient_document_file_unreferenced('pgtap-doc-2/nothing-here.pdf'),
  false,
  'the storage helper says nothing about another patient''s folder');

-- ---------------------------------------------------------------------------
-- Portal patient 2 and a caller with no sign-in
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-0000000000a2","role":"authenticated"}';

SELECT is(
  public.portal_remove_document('7777d0c0-0000-4000-8000-000000000012') ->> 'reason',
  'not_found',
  'another patient cannot remove patient 1''s upload');

SET LOCAL request.jwt.claims = '{"role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.portal_remove_document('7777d0c0-0000-4000-8000-000000000012')$$,
  '42501', NULL,
  'portal_remove_document needs a signed-in caller');

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT lives_ok(
  $$INSERT INTO public.patient_documents (
      id, patient_id, document_type, document_name, file_path, upload_source, uploaded_by_user_id)
    VALUES ('7777d0c0-0000-4000-8000-000000000021', 'pgtap-doc-1', 'lab_result', 'Referral.pdf',
            'pgtap-doc-1/referral.pdf', 'patient', '77770000-0000-4000-8000-0000000000a1')$$,
  'a nurse adds a document (claiming the patient uploaded it)');

SELECT is(
  (SELECT upload_source || ' ' || uploaded_by_user_id::text FROM public.patient_documents
    WHERE id = '7777d0c0-0000-4000-8000-000000000021'),
  'staff 77770000-0000-4000-8000-000000000002',
  'a staff upload is stamped staff with the nurse as uploader');

SELECT lives_ok(
  $$UPDATE public.patient_documents SET description = 'Checked'
     WHERE id = '7777d0c0-0000-4000-8000-000000000021'$$,
  'a nurse can still edit a document''s details');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET upload_source = 'patient'
     WHERE id = '7777d0c0-0000-4000-8000-000000000021'$$,
  '42501', NULL,
  'upload_source cannot be changed');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET uploaded_by_user_id = '77770000-0000-4000-8000-000000000001'
     WHERE id = '7777d0c0-0000-4000-8000-000000000012'$$,
  '42501', NULL,
  'uploaded_by_user_id cannot be changed');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET deleted_at = now()
     WHERE id = '7777d0c0-0000-4000-8000-000000000012'$$,
  '42501', NULL,
  'a nurse (no consult or users) cannot remove a patient upload');

SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT throws_ok(
  $$INSERT INTO public.patient_documents (
      patient_id, document_type, document_name, file_path)
    VALUES ('pgtap-doc-1', 'other', 'x.pdf', 'pgtap-doc-1/x.pdf')$$,
  '42501', NULL,
  'a pharmacist (no register, vitals or consult) cannot add a document');

SET LOCAL request.jwt.claims = '{"sub":"77770000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.patient_documents
    WHERE id = '7777d0c0-0000-4000-8000-000000000011' AND deleted_at IS NOT NULL),
  1,
  'staff still see a document the patient removed');

SELECT is(
  (SELECT upload_source || ' ' || deleted_by::text FROM public.patient_documents
    WHERE id = '7777d0c0-0000-4000-8000-000000000011'),
  'patient 77770000-0000-4000-8000-0000000000a1',
  'the removal records the patient as deleted_by');

SELECT throws_ok(
  $$DELETE FROM public.patient_documents WHERE id = '7777d0c0-0000-4000-8000-000000000001'$$,
  '42501', NULL,
  'a doctor cannot hard-delete a clinic document');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET deleted_at = now()
     WHERE id = '7777d0c0-0000-4000-8000-000000000021'$$,
  '42501', NULL,
  'a doctor cannot soft-delete a clinic document either');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET file_path = 'pgtap-doc-1/elsewhere.pdf'
     WHERE id = '7777d0c0-0000-4000-8000-000000000001'$$,
  '42501', NULL,
  'the file behind a document cannot be repointed (it would make the clinic file deletable)');

SELECT lives_ok(
  $$UPDATE public.patient_documents
       SET deleted_at = '2000-01-01', deleted_by = '77770000-0000-4000-8000-000000000002'
     WHERE id = '7777d0c0-0000-4000-8000-000000000012'$$,
  'a doctor soft-deletes a patient upload');

SELECT is(
  (SELECT deleted_by::text || ' ' || (deleted_at > now() - interval '1 hour')::text
     FROM public.patient_documents WHERE id = '7777d0c0-0000-4000-8000-000000000012'),
  '77770000-0000-4000-8000-000000000001 true',
  'the server stamps the doctor and the server clock, not the values sent');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET deleted_at = NULL
     WHERE id = '7777d0c0-0000-4000-8000-000000000012'$$,
  '42501', NULL,
  'a removed document cannot be restored through the API');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET deleted_by = '77770000-0000-4000-8000-000000000002'
     WHERE id = '7777d0c0-0000-4000-8000-000000000011'$$,
  '42501', NULL,
  'who removed a document cannot be rewritten');

WITH d AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'patient-documents' AND name = 'pgtap-doc-1/staff.pdf'
   RETURNING 1)
SELECT is(
  (SELECT count(*)::int FROM d),
  0,
  'a doctor cannot delete the file of a clinic document');

WITH d AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'patient-documents' AND name = 'pgtap-doc-1/orphan-staff.pdf'
   RETURNING 1)
SELECT is(
  (SELECT count(*)::int FROM d),
  1,
  'a doctor can delete a file no document points to');

WITH d AS (
  DELETE FROM public.patient_documents
   WHERE id = '7777d0c0-0000-4000-8000-000000000012' RETURNING upload_source)
SELECT is(
  (SELECT string_agg(upload_source, ',') FROM d),
  'patient',
  'a doctor can still hard-delete a patient upload');

-- ---------------------------------------------------------------------------
-- Service role and the owner
-- ---------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT throws_ok(
  $$DELETE FROM public.patient_documents WHERE id = '7777d0c0-0000-4000-8000-000000000001'$$,
  '42501', NULL,
  'the service role cannot hard-delete a clinic document either');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET upload_source = 'patient'
     WHERE id = '7777d0c0-0000-4000-8000-000000000001'$$,
  '42501', NULL,
  'the service role cannot change upload_source');

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patient_documents'
      AND cmd IN ('UPDATE', 'DELETE', 'ALL')
      AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%app_portal_patient_ids%'),
  0,
  'no update or delete rule on patient_documents has a portal-patient branch');

SELECT is(
  (SELECT is_nullable || ' ' || column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patient_documents'
      AND column_name = 'upload_source'),
  'NO ''staff''::text',
  'upload_source is NOT NULL with default staff');

SELECT is(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patient_documents'
      AND column_name = 'deleted_by'),
  'uuid',
  'deleted_by is a uuid');

SELECT throws_ok(
  $$UPDATE public.patient_documents SET deleted_by = '77770000-0000-4000-8000-000000000001'
     WHERE id = '7777d0c0-0000-4000-8000-000000000002'$$,
  '23514', NULL,
  'deleted_by cannot be set on a document that is not removed');

SELECT is(
  has_function_privilege('anon', 'public.portal_remove_document(uuid)', 'EXECUTE'),
  false,
  'anon cannot call portal_remove_document');

SELECT * FROM finish();
ROLLBACK;
