# Deferred TEFCA / FHIR migrations: not applied until FHIR goes live

The Supabase CLI reads only `supabase/migrations/`, so nothing in this folder
is ever applied by `supabase db push`, `migration up` or the
"Database migrations" workflow. That is the point: these files stay out of
production until the owner decides FHIR/TEFCA goes live.

## Why they are deferred

- FHIR/TEFCA is not live. There is no QHIN or other exchange partner, and the
  `/fhir/R4` gateway returns 404 while `FHIR_ENABLED` is unset
  (`api/fhir.ts`). The tefca-* edge functions have no production caller.
- Nothing outside FHIR code needs these objects. Wave A/B (20260924105900 ..
  20260926120100) reference them only through guards that skip missing
  tables (`app_rls_reset` / `app_rls_policy`, `to_regclass ... CONTINUE`,
  `to_regprocedure`, `information_schema` checks).
- Left in `supabase/migrations/`, they would sort before Wave A and
  `db push --include-all` would run them: 20260503010000 applies, then
  20260503010100 fails (`uuid = text`) and Wave A/B never runs. Recording them
  as applied would be false history (production has none of their objects).
- One non-FHIR live-app page uses a deferred table: the patient-portal
  "Data sharing" page (`src/features/patient-portal/DataSharingPreferences.tsx`)
  reads `patient_data_sharing_preferences` and `tefca_access_logs`, created
  only by 20260125091118. It already shows its error state on production;
  deferring changes nothing.

`tests/interop_foundation.test.sql` and `tests/interop_phase2.test.sql` are
the pgTAP files for 20260926110000 and 20260926130000. They live here so
`supabase test db` (which runs `supabase/tests/`) does not run them against a
database that lacks the interop schema. The FHIR CI job
(`.github/workflows/interop-fhir.yml`, with `scripts/ci/interop_db_base.py`)
still applies both migrations and runs these tests on plain PostgreSQL 16 from
this folder.

`20260926130000_interop_phase2` (FHIR Phase 2) is here for the same reason.
New FHIR migrations belong in this folder too, until FHIR goes live.

## Rules for un-deferring any file

1. **Re-version it above production's newest migration** (give it a new
   14-digit version newer than every version in
   `supabase_migrations.schema_migrations` at that time) when moving it into
   `supabase/migrations/`. Never move a file back under its old version: the old
   versions sort before Wave A, would need `--include-all`, and would then run
   after Wave A anyway, where the fixes below are required.
2. Apply the must-fix list for that file first. Every table must carry its own
   `REVOKE ALL ... FROM anon` (and PUBLIC): Wave A's 20260924110400 one-time
   anon revoke and verification ran before these tables existed, and its
   `app_rls_*` helpers are dropped, so the Wave A policies are not created for
   them either. Add permission-matrix policies (or none, service_role only),
   and attach `merge_redirect_patient` (20260925100300) to any new table with a
   `patient_id`.
3. Keep dependency order: 20260125091118 before 20260503030000;
   20260503020000 before 060000 and 070000; 010000 before 20260926110000;
   20260926110000 before 20260926130000.
4. Rehearse (db-migrations.yml `rehearse`) before `dry-run` and `apply`.

## Must-fix list per file

Sources: the reconciliation triage (legacy2026a, legacy2026b) and the plan's
fixes C4, C5 and C11-C17. Line numbers refer to the files as they are here.

| Version | File | Must fix before it is ever applied |
|---|---|---|
| 20260125091118 | add_tefca_audit_logs | **C4.** Cast fix at L111, L156, L163, L183 (`app_users.id = auth.uid()::text` is uuid = text and fails): use `app_users.id = (SELECT auth.uid())` or `has_role(...)`. Delete the anon `INSERT WITH CHECK(true)` on tefca_access_logs (L131-142). `REVOKE ALL ON tefca_access_logs, tefca_qhin_partners, patient_data_sharing_preferences FROM anon, PUBLIC`. **`allow_treatment_access DEFAULT false`** (L86, not true). Drop the two active demo QHIN partner seeds (L223-227) and the duplicate index (L221). Pin `search_path` on `update_tefca_updated_at()` (L229-235). |
| 20260125091822 | add_immunizations_conditions_sdoh | **C5.** Delete the six policy DO blocks (L123-238; they fail with uuid = text and give volunteers/nurses DELETE); add permission-matrix policies instead. Pin `search_path` on `update_immunizations_updated_at()`. REVOKE anon. |
| 20260503010000 | add_patient_fhir_id | Safe as written (additive `patients.fhir_id`, UNIQUE). Optionally drop the redundant `idx_patients_fhir_id`. Needed by 20260926110000's gateway. |
| 20260503010100 | add_fhir_clinical_extensions | **C11.** Delete the policy block (L126-171, uuid = text at L144). Pin `search_path` on `fhir_ext_touch_updated_at()` (L192-198). Index `procedures.encounter_id`, `document_references.context_encounter_id`, `service_requests.encounter_id`. REVOKE anon on the 5 tables. |
| 20260503010200 | extend_dispenses_for_fhir | Applies cleanly, but after Wave B its backfill UPDATEs (L64-71) fire `zz_server_stamp` on every dispense and force every device to re-sync: run the backfill as one UPDATE or accept the churn. Schema-qualify the `information_schema` checks. |
| 20260503020000 | add_resource_versions | **C12, mandatory.** Recreate `fhir_record_resource_version()` as **SECURITY DEFINER** `SET search_path = public, pg_catalog`, then `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon` (as INVOKER, every staff INSERT/UPDATE on patients, prescriptions, visits fails with an RLS error on resource_versions; tested). Cast fix at L85. Admin SELECT policy through `(SELECT public.app_current_role()) = 'admin'` (honours deactivation). Record that DELETE snapshots keep erased-patient PHI. REVOKE anon. |
| 20260503030000 | add_oauth_smart | **C13.** Needs the fixed 20260125091118 (`tefca_qhin_partners`). Cast fix at L162 (or `has_role('admin')`). Pin `search_path` on `oauth_clients_touch_updated_at()` (L169-175). **Mandatory `REVOKE ALL ... FROM anon` on all 5 oauth_* tables** (`private_key_pem` is stored in plaintext). Index `oauth_authorization_codes.client_id`, `oauth_refresh_tokens.client_id`, `oauth_access_tokens.qhin_partner_id`. |
| 20260503040000 | add_bulk_export_jobs | **C14.** Cast fix at L102-103 (`app_users.id = (SELECT auth.uid())` or `has_role('admin')`). **Delete the storage.objects policy DO block (L116-129)**: it is not needed (service_role has BYPASSRLS) and the cast fix alone still fails there on a non-owner. REVOKE anon on both tables. Useless without C13 (`bearer-auth.ts` needs `oauth_access_tokens`). |
| 20260503050000 | add_bulk_export_cleanup_cron | **C15, the cleanup.** `REVOKE EXECUTE ON FUNCTION public.cleanup_expired_bulk_exports() FROM PUBLIC, anon, authenticated; GRANT ... TO service_role` (today anon can call it over `/rpc`); prefer SECURITY INVOKER. **Remove the SQL `DELETE FROM storage.objects` (L49-51)**: storage's `protect_delete()` trigger refuses it, so every hourly run fails and expired PHI exports are never purged. Purge objects through the Storage API (`tefca-bulk/storage.ts` deleteJobObjects) and do not delete job/file rows whose objects still exist. Never set `storage.allow_delete_query`. Schema-qualify L23 and L68. Decide explicitly whether to install pg_cron (L21 `CREATE EXTENSION IF NOT EXISTS pg_cron` would install it on production). |
| 20260503060000 | extend_resource_versions_triggers | **C16.** Safe only after 020000 with C12's DEFINER fix (otherwise staff `UPDATE visits` fails). Optionally repeat the `ALTER FUNCTION ... SECURITY DEFINER SET search_path` and REVOKE at the top. Needs 020000, C5 and C11 first, or its triggers are silently skipped. |
| 20260503070000 | add_fhir_resources_writes | **C17.** Cast fix at L88 (with 020000's L85). Pin `search_path` on its 2 functions. Needs 020000 (C12). REVOKE anon on fhir_resources. |
| 20260926110000 | interop_foundation | No known defect (applies twice cleanly in the FHIR CI and passes its 42 pgTAP tests there). Needs, at call time, the Wave A helpers, 20260925100600 and 20260503010000 (`patients.fhir_id`) for the gateway. Re-version it above production's newest, together with (and after) 20260503010000. |
| 20260926130000 | interop_phase2 | No known defect (applies twice cleanly in the FHIR CI, passes its 277 pgTAP tests, and the rollback in its header returns the database to Phase 1). Needs 20260926110000 applied first and, at call time, the Wave A/B helpers it names in its header, 20260503010000 (`patients.fhir_id`) and 20260503010200 (dispense columns). Re-version it above production's newest, after 20260926110000. |
