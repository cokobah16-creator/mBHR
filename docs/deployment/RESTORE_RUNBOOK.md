# mBHR Restore Runbook

How to restore production data from the logical dumps produced by
`.github/workflows/backup.yml`. Each nightly run writes four files with the
same timestamp:

| File | Holds |
| --- | --- |
| `mbhr-backup-<ts>-schema.sql.gz` | Tables, functions, triggers and policies (no rows) |
| `mbhr-backup-<ts>-data.sql.gz` | Rows of the app schemas (patients, visits, staff records, ...) as `COPY` blocks |
| `mbhr-backup-<ts>-auth-data.sql.gz` | Rows of the `auth` and `storage` schemas (sign-in accounts, the storage object list) |
| `mbhr-backup-<ts>-roles.sql.gz` | Database roles |

Files kept in Storage buckets (patient photos, portal documents) are **not**
in these dumps; they need their own copy. Files named
`mbhr-backup-<ts>.sql.gz` (no suffix) from before this layout are
schema-only and hold no patient rows.

The data files hold patient records: keep them off shared drives and chat,
and never attach them to an issue or a GitHub artifact.

> **When to use this:** you've lost the production Supabase project, or you
> need to rebuild a staging/test environment from a known-good production
> snapshot. For everyday "I deleted one row" recovery, use Supabase
> Point-in-Time Recovery (PITR) from the dashboard instead — it's faster and
> finer-grained.

## Prerequisites

- A target Supabase project (either freshly created or paused/restored). The
  project must be empty or you must be OK with the restore overwriting
  matching tables.
- Local copies of the four dump files (`.sql.gz`) of one run. The nightly
  job writes them to the `backups` Storage bucket of the production
  project; you can download them with `supabase storage cp`. That bucket is
  in the same project it backs up, so losing the project loses the backups
  too: keeping a copy outside the production project (another provider or
  another account's storage) is recommended.
- `psql` (any 14+ version is fine).
- The target project's database password (Supabase dashboard → Project
  Settings → Database → "Database password").

## Step 1 — Pull the dump

```bash
# List available backups
supabase --project-ref dlogqxzejroeyivfmgcv storage ls ss:///backups

# Download the four files of one run
TS=20260520T030000Z
for part in schema data auth-data roles; do
  supabase --project-ref dlogqxzejroeyivfmgcv storage cp \
    "ss:///backups/mbhr-backup-${TS}-${part}.sql.gz" "./${part}.sql.gz"
  gunzip -f "${part}.sql.gz"   # → <part>.sql
done
```

## Step 2 — Dry-run inspect

Check the files without printing their rows:

```bash
# Schema: tables and policies are there
grep -c '^CREATE TABLE' schema.sql            # expect ~100+
grep -c '^CREATE POLICY' schema.sql           # expect a lot

# Data: the baseline. Rows per table in the dump (the lines between each
# COPY statement and its closing "\."). Save this output; Step 4 compares
# the restored database against it.
awk '/^COPY / { t = $2; n[t] = 0; inside = 1; next }
     inside && /^\\\.$/ { inside = 0; next }
     inside { n[t]++ }
     END { for (t in n) print t, n[t] }' data.sql | sort > baseline.txt
grep -E 'patients|visits|consultations|dispenses|app_users' baseline.txt
# expect public.patients to match the patient_rows count in that night's
# GitHub Actions log, and non-zero counts for the other tables

# Auth data: sign-in accounts are there
grep -Ec '^COPY "?auth"?\."?users"? ' auth-data.sql   # expect 1
```

If `data.sql` has no `COPY public.patients` block, the file holds no patient
records: do not restore from it.

## Step 3 — Restore into the target project

Restore in this order: roles, schema, app data, auth and storage data.

```bash
TARGET_HOST=db.<target-ref>.supabase.co
TARGET_PASSWORD=<dashboard password>
run_psql() {
  PGPASSWORD="${TARGET_PASSWORD}" psql \
    --host="${TARGET_HOST}" --port=5432 --username=postgres --dbname=postgres "$@"
}

# Roles: a fresh project already has Supabase's own roles, so "already
# exists" errors here are expected; this step does not stop on them.
run_psql --file=roles.sql 2>&1 | tee restore-roles.log

# Schema, then rows. Triggers and foreign-key checks are off while rows load
# (session_replication_role = replica), so tables can load in any order.
run_psql --single-transaction --variable=ON_ERROR_STOP=1 \
  --file=schema.sql 2>&1 | tee restore-schema.log
run_psql --single-transaction --variable=ON_ERROR_STOP=1 \
  --command='SET session_replication_role = replica' \
  --file=data.sql 2>&1 | tee restore-data.log
run_psql --single-transaction --variable=ON_ERROR_STOP=1 \
  --command='SET session_replication_role = replica' \
  --file=auth-data.sql 2>&1 | tee restore-auth.log
```

`--single-transaction` makes each file one BEGIN…COMMIT, so a failure part
way through a file leaves the target as it was before that file.
`ON_ERROR_STOP=1` halts on the first error. Restore into an empty project:
rows that already exist make the data steps fail.

## Step 4 — Post-restore verification

Run these checks against the target before flipping any DNS / clients:

```sql
-- Row counts on critical tables. Each must equal the count for that table
-- in baseline.txt from Step 2 (the rows the dump holds).
SELECT
  (SELECT count(*) FROM public.patients)       AS patients,
  (SELECT count(*) FROM public.visits)         AS visits,
  (SELECT count(*) FROM public.consultations)  AS consultations,
  (SELECT count(*) FROM public.dispenses)      AS dispenses,
  (SELECT count(*) FROM public.app_users)      AS staff,
  (SELECT count(*) FROM auth.users)            AS sign_in_accounts;

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
