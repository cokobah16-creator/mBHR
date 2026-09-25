/*
  # FHIR Bulk Data Access ($export) — schema + storage

  TEFCA QHIN Phase E-1.

  Backs the new tefca-bulk edge function:
    POST /$export                async kickoff (system-level)
    POST /Patient/$export        async kickoff (patient-level, all patients)
    POST /Group/{id}/$export     async kickoff (group; reserved for Phase E-2)
    GET  /bulk-status/{jobId}    202 in progress, 200 + manifest when complete
    GET  /bulk-files/{jobId}/{f} stream NDJSON from fhir-bulk Storage bucket
    DELETE /bulk-status/{jobId}  cancel

  Tables
    bulk_export_jobs    — job lifecycle + manifest
    bulk_export_files   — per-resource NDJSON file metadata

  Storage
    Bucket fhir-bulk    — private; service-role writes, signed-URL reads.

  Retention
    expires_at defaults to 7 days from creation. The processor + the cleanup
    cron job (Phase E-2) honor this column to drop stale exports.
*/

CREATE TABLE IF NOT EXISTS bulk_export_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       text NOT NULL,
  /** "system" | "patient" | "group" */
  type            text NOT NULL CHECK (type IN ('system','patient','group')),
  /** For type='patient' or 'group', the FHIR resource id this job is scoped to. */
  scope_id        text,
  /** RFC ISO-8601 timestamp filter (FHIR _since). */
  since           timestamptz,
  /** Optional resource type filter (FHIR _type). */
  resource_types  text[],
  status          text NOT NULL DEFAULT 'accepted' CHECK (status IN (
                    'accepted','in-progress','completed','failed','cancelled'
                  )),
  /** Final manifest JSON (FHIR Bulk Data response shape) once status='completed'. */
  manifest        jsonb,
  error_message   text,
  /** Total resources written across all output files. */
  total_resources int DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_bulk_export_jobs_client      ON bulk_export_jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_bulk_export_jobs_status      ON bulk_export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bulk_export_jobs_created_at  ON bulk_export_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_export_jobs_expires_at  ON bulk_export_jobs(expires_at);

CREATE TABLE IF NOT EXISTS bulk_export_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES bulk_export_jobs(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  storage_path  text NOT NULL,
  /** Size of the NDJSON object in bytes. */
  size_bytes    bigint NOT NULL DEFAULT 0,
  /** Number of FHIR resources represented (one per NDJSON line). */
  count         int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_export_files_job ON bulk_export_files(job_id);

ALTER TABLE bulk_export_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_export_files ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bulk_export_jobs' AND policyname = 'service_role manages bulk_export_jobs'
  ) THEN
    CREATE POLICY "service_role manages bulk_export_jobs"
      ON bulk_export_jobs FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bulk_export_files' AND policyname = 'service_role manages bulk_export_files'
  ) THEN
    CREATE POLICY "service_role manages bulk_export_files"
      ON bulk_export_files FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bulk_export_jobs' AND policyname = 'Admins read bulk_export_jobs'
  ) THEN
    CREATE POLICY "Admins read bulk_export_jobs"
      ON bulk_export_jobs FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role = 'admin'
        )
      );
  END IF;
END $$;

-- Private storage bucket for NDJSON output. Reads are gated by signed URLs
-- minted by the tefca-bulk edge function; nothing else should access the
-- objects directly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('fhir-bulk', 'fhir-bulk', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'service_role manages fhir-bulk'
  ) THEN
    CREATE POLICY "service_role manages fhir-bulk"
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'fhir-bulk')
      WITH CHECK (bucket_id = 'fhir-bulk');
  END IF;
END $$;

COMMENT ON TABLE bulk_export_jobs IS
  'FHIR Bulk Data $export job lifecycle + manifest';
COMMENT ON TABLE bulk_export_files IS
  'Per-resource NDJSON files written by a Bulk Data export job';
