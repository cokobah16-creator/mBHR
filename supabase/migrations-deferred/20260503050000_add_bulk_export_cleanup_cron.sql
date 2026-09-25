/*
  # Bulk Data $export — automated cleanup of expired jobs

  TEFCA QHIN Phase E-2.

  Schedules a pg_cron job that runs every hour to:
    1. Mark bulk_export_jobs rows whose expires_at has passed and which are
       still in a non-terminal state as failed (so /bulk-status reports
       410-style consistently rather than indefinitely 202).
    2. Delete every storage.objects row in the fhir-bulk bucket whose path
       prefix matches an expired job. ON DELETE CASCADE on
       bulk_export_files takes care of the metadata.
    3. Delete the expired bulk_export_jobs rows themselves so the table
       doesn't grow unboundedly.

  Audit (tefca_access_logs) entries are NOT touched here — those are
  preserved for the full 6-year TEFCA RCE retention regardless of whether
  the underlying bulk job has been cleaned up.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION cleanup_expired_bulk_exports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_catalog
AS $$
DECLARE
  expired_job RECORD;
  cleaned_jobs int := 0;
  cleaned_objects int := 0;
BEGIN
  -- Move stuck-expired jobs into a terminal state first so /bulk-status
  -- starts reporting "expired" before we wipe their files.
  UPDATE bulk_export_jobs
     SET status = 'failed',
         error_message = COALESCE(error_message, 'expired before completion'),
         completed_at = COALESCE(completed_at, now())
   WHERE status IN ('accepted', 'in-progress')
     AND expires_at < now();

  -- Drop the actual NDJSON objects + DB rows for any expired job.
  FOR expired_job IN
    SELECT id FROM bulk_export_jobs WHERE expires_at < now()
  LOOP
    -- Storage objects are named "<jobId>/<ResourceType>.ndjson" — see
    -- supabase/functions/tefca-bulk/storage.ts:uploadNdjson
    DELETE FROM storage.objects
     WHERE bucket_id = 'fhir-bulk'
       AND name LIKE expired_job.id::text || '/%';
    GET DIAGNOSTICS cleaned_objects = ROW_COUNT;

    -- bulk_export_files cascades from bulk_export_jobs.id, but delete
    -- explicitly so the audit log carries an accurate row count.
    DELETE FROM bulk_export_files WHERE job_id = expired_job.id;
    DELETE FROM bulk_export_jobs WHERE id = expired_job.id;
    cleaned_jobs := cleaned_jobs + 1;
  END LOOP;

  IF cleaned_jobs > 0 THEN
    RAISE NOTICE 'cleanup_expired_bulk_exports: removed % jobs (% storage objects)',
      cleaned_jobs, cleaned_objects;
  END IF;
END;
$$;

COMMENT ON FUNCTION cleanup_expired_bulk_exports() IS
  'Hourly cleanup of expired FHIR Bulk Data $export jobs (Phase E-2)';

-- Schedule: every hour at minute 7. Idempotent — pg_cron rejects duplicates
-- on the same job name, so we unschedule first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup_expired_bulk_exports'
  ) THEN
    PERFORM cron.unschedule('cleanup_expired_bulk_exports');
  END IF;
  PERFORM cron.schedule(
    'cleanup_expired_bulk_exports',
    '7 * * * *',
    $cron$ SELECT public.cleanup_expired_bulk_exports(); $cron$
  );
END $$;
