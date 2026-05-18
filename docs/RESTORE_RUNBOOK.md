# mBHR Restore Runbook

How to restore production data from a logical `pg_dump` produced by
`.github/workflows/backup.yml`.

> **When to use this:** you've lost the production Supabase project, or you
> need to rebuild a staging/test environment from a known-good production
> snapshot. For everyday "I deleted one row" recovery, use Supabase
> Point-in-Time Recovery (PITR) from the dashboard instead — it's faster and
> finer-grained.

## Prerequisites

- A target Supabase project (either freshly created or paused/restored). The
  project must be empty or you must be OK with the restore overwriting
  matching tables.
- Local copy of the dump file (`.sql.gz`) you want to restore from. The
  nightly job writes them to the `backups` Storage bucket of the production
  project; you can also download them with `supabase storage cp`.
- `psql` (any 14+ version is fine).
- The target project's database password (Supabase dashboard → Project
  Settings → Database → "Database password").

## Step 1 — Pull the dump

```bash
# List available backups
supabase --project-ref dlogqxzejroeyivfmgcv storage ls ss:///backups

# Download the one you want
supabase --project-ref dlogqxzejroeyivfmgcv storage cp \
  ss:///backups/mbhr-backup-20260520T030000Z.sql.gz ./restore.sql.gz

# Decompress
gunzip restore.sql.gz   # → restore.sql
```

## Step 2 — Dry-run inspect

```bash
# Sanity-check the dump file
head -50 restore.sql
grep -c '^CREATE TABLE' restore.sql           # expect ~100+
grep -c '^CREATE POLICY' restore.sql           # expect a lot
```

## Step 3 — Restore into the target project

```bash
TARGET_HOST=db.<target-ref>.supabase.co
TARGET_PASSWORD=<dashboard password>

PGPASSWORD="${TARGET_PASSWORD}" psql \
  --host="${TARGET_HOST}" \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --single-transaction \
  --variable=ON_ERROR_STOP=1 \
  --file=restore.sql 2>&1 | tee restore.log
```

`--single-transaction` means the whole restore is one BEGIN…COMMIT, so a
mid-restore failure leaves the target unchanged. `ON_ERROR_STOP=1` halts on
the first error.

## Step 4 — Post-restore verification

Run these checks against the target before flipping any DNS / clients:

```sql
-- Row counts on critical tables (compare to a sanity baseline)
SELECT
  (SELECT count(*) FROM public.patients)       AS patients,
  (SELECT count(*) FROM public.visits)         AS visits,
  (SELECT count(*) FROM public.consultations)  AS consultations,
  (SELECT count(*) FROM public.dispenses)      AS dispenses,
  (SELECT count(*) FROM public.app_users)      AS staff;

-- RLS is enabled on every table we expect
SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('patients','visits','vitals','consultations','dispenses')
 ORDER BY tablename;
-- Expect rowsecurity = true for all.

-- Critical helper functions exist and are SECURITY INVOKER
SELECT proname, prosecdef FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND proname IN ('is_staff','has_role');
-- Expect prosecdef = false for both.

-- Storage `photos` bucket should be private
SELECT id, public FROM storage.buckets WHERE id = 'photos';
-- Expect public = false.
```

## Step 5 — Re-apply Auth + dashboard config

Logical `pg_dump` does **not** carry Supabase Auth settings (leaked-password
protection, SMS provider, redirect URLs) or edge-function secrets. Walk
through the target project's dashboard and reapply them from
`docs/PRODUCTION_HARDENING_CHECKLIST.md`. Common ones:

- Authentication → Policies → Password Settings → enable leaked-password
  protection.
- Authentication → URL Configuration → set Site URL + redirect URLs.
- Edge Functions → set `ALLOWED_ORIGINS`, `TWILIO_*`, `RESEND_API_KEY`,
  any TEFCA OAuth keys.

## Step 6 — Cutover

Once verification passes, point clients at the new project:

- Vercel project → Environment Variables → update `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` to the new project. Trigger a redeploy.
- Mobile/tablet clients pick up new env on next service-worker update.

## Rollback if the restore is wrong

If verification flags a problem, **do not** drop the target's schema —
instead, abandon the target project (it's empty / wrong) and re-run from
Step 1 with a different dump.

## Test the runbook quarterly

Drift in the dump format / Supabase CLI behaviour is real. Once per quarter,
run Steps 1-4 against a throwaway Supabase **branch** (via
`mcp__supabase__create_branch` or the dashboard's branches UI), then drop the
branch. A failed quarterly drill is the cheapest production incident you can
have.
