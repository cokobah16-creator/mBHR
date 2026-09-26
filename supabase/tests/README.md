# Database tests (pgTAP)

SQL tests for the Wave B migrations, which make clinical state
server-authoritative. Each file checks what one migration actually does,
including who may call its functions (row-level security and permissions).

| File | Migration under test | What it checks |
| --- | --- | --- |
| `portal_access.test.sql` | `20260925100100_portal_access_authoritative.sql` | Auto-enrolment on insert only; `set_patient_portal_access()` rules (a disable always applies, stale and automatic enables are refused, a repeated command id returns the stored result, PT409 for an unknown patient, 42501 for a pharmacist); updates and upserts cannot turn access back on; a portal patient can edit their address but not `portal_enabled`; `portal_access_status()`; the access history is append-only |
| `patient_merges.test.sql` | `20260925100300_patient_merge_authoritative.sql` | `merge_patients()`: history moves to the kept record, idempotent resend, cycle and `loser_merged_elsewhere` refusals, `already_merged` with the earlier merge id, late vitals uploads redirected to the kept record, portal sign-in moved only when the kept record has none, PT409, 42501 for a volunteer; who can read the history; UPDATE, DELETE and TRUNCATE refused |
| `pharmacy_ledger.test.sql` | `20260925100400_pharmacy_stock_ledger.sql` | Two dispenses of 8 from a lot of 10 (one applies, one refused, never below zero); idempotent resend; an offline shortfall is recorded and filed in `stock_discrepancies`; direct writes to balances, lots and the ledger are ignored or refused; one opening-stock device per site; the drift views stay empty after a fixed-seed mix of receipts, counts and dispenses; nurses cannot insert prescriptions; the ledger is append-only |
| `lab_release.test.sql` | `20260925100500_lab_results_release.sql` | Unreviewed, unreleased and withheld results are invisible through `portal_my_lab_results()`; portal patients cannot SELECT `lab_results` or `lab_orders`; a patient whose portal access is off, or whose record was merged away, gets zero rows; a changed value or interpretation clears the review and release; a release without a review violates `lab_results_release_requires_review`; only `lab_review` / `lab_release` holders review and release |
| `portal_access_backfill.test.sql` | `20260924105900_portal_access_backfill.sql` (runs `app_portal_access_backfill()`, the migration's own code, on the late-run path) | Only records with a verified, linked portal account are turned on (a confirmed Supabase account on `auth_uid`, or an active, verified `patient_portal_users` row); an unconfirmed account and a phone or email that merely equals a confirmed account's are not evidence; opted-out, merged, suspended, staff-disabled and staff-linked records stay off; the log names the evidence, the previous value and the migration (one row for a record with both kinds of evidence); a late run stamps `portal_enabled_changed_at` and writes an access event; one `audit_logs` summary; a second run turns nothing on and logs nothing; a staff disable stands and a logged record is never turned on again; the log refuses UPDATE, DELETE and TRUNCATE; only `audit_access` holders read it; signed-in users cannot run the backfill or write the log |
| `registration_lead_portal_invite.test.sql` | `20260925100600_registration_lead_portal_invite.sql` | The permission matrix: `registration_lead` holds exactly register, queue, portal_manage and portal_invite (no vitals); `portal_invite` holders are admin, lead_clinician and registration_lead; the confirmed policy rows (queue, merge_patients, lab_review / lab_release) and that guest, legacy chw, unknown roles and unknown permissions get nothing; `app_users` accepts the role; a registration lead reads patients, sets `portal_invited_at` and uploads queue transitions; volunteers and nurses cannot change `portal_invited_at`; `portal_invitation_begin()` / `portal_invitation_finish()` are service-role only and refuse volunteer, nurse, pharmacist, unknown accounts, patients not on the server, merged away, with portal access off or with no stored contact, and unknown channels; the recipient is the stored phone or email; requests and outcomes are recorded (one outcome per invitation); who can read the trail; the trail refuses UPDATE, DELETE and TRUNCATE |
| `patient_document_ownership.test.sql` | `20260925100700_patient_document_ownership.sql` | Existing rows are clinic (`staff`) records; the server stamps `upload_source` and `uploaded_by_user_id` whatever the client sends; a portal patient uploads only to their own record and own folder, cannot UPDATE or DELETE rows directly, and removes their own upload only through `portal_remove_document()` (`clinic_document` and `not_found` refusals, repeat is `already_removed`, removed documents are hidden from them); storage: a patient cannot read the file of a removed document or delete a file a document points to, and may delete only their own unreferenced upload; staff: a nurse cannot remove a patient upload, a pharmacist cannot add a document, a doctor cannot delete or soft-delete a clinic document or repoint its file, a doctor's soft delete is stamped by the server and cannot be undone or rewritten; the service role cannot delete a clinic document or change `upload_source`; no portal-patient UPDATE or DELETE rule; anon cannot call the RPC |
| `../migrations-deferred/tests/interop_foundation.test.sql` (deferred: not in this folder, so `supabase test db` does not run it) | `supabase/migrations-deferred/20260926110000_interop_foundation.sql` | The `interop` schema is closed to anon and authenticated (no USAGE, no table access); anon cannot call the gateway functions; `fhir_gateway_context()` returns the caller's own role and permissions from the database, nothing for non-staff, and refuses over the rate limit; `fhir_record_access()` records `auth.uid()` as the actor whatever is passed, and refuses malformed records; `fhir_terminology_lookup()` returns verified mappings only, to staff only; the audit trail refuses UPDATE, DELETE and TRUNCATE; consents cannot be deleted and a withdrawn consent must be inactive; a verified terminology mapping must name its reviewer. CI also runs it on plain PostgreSQL 16 (`.github/workflows/interop-fhir.yml`, see `docs/interoperability/testing.md`) |
| `conflict_record_types.test.sql` | `20260927100100_conflict_record_types.sql` | A new conflict must name a record type the app reports (the ten synced tables, or `server_command`); a nurse cannot file a staff-account or stock conflict, or one naming `users`, `lab_results` or no type; an admin files all three kinds and a doctor every other listed type; a pharmacist still cannot file conflicts; any update of a staff-account or stock conflict without `users` / `inventory` is refused, including one that also changes `entity_type`; patient conflicts are unaffected. Rows are built with `jsonb_populate_record()` so the same statements run on the `db reset` table shape and on the 20260125094038 shape |
| `portal_identity_hardening.test.sql` | `20260927100110_portal_identity_hardening.sql` | A verified sign-up that matches no clinic record gets `no_clinic_record` and no new patient record; an unconfirmed email still gets `contact_not_verified` and no record; a merged-away duplicate sharing the phone number no longer makes the link `ambiguous`, the kept record links and the duplicate stays unlinked; a JWT `phone` claim no longer opens a record through `app_portal_patient_ids()`, `portal_access_status()` or row-level security (a family's shared number). Fixture ids start with `7777aaaa` |
| `portal_messages_hardening.test.sql` | `20260927100120_portal_messages_hardening.sql` | A portal patient cannot archive messages, mark their own message read, mark a clinic message unread or turn their message into a clinic message, and an upsert cannot archive either; marking a clinic message read works, also when it is already read; an update that changes only `updated_at` writes nothing; on a patient insert the server sets `from_name` from the record, clears a `staff_id` that has no message to this patient (and keeps a reply's), starts `read` and `is_archived` false and sets both timestamps; a message sent on a merged-away id is stamped for the kept record; a patient cannot send as the clinic or write on another record; a doctor still marks read or unread, archives and sends with their own name; a nurse without consult cannot send; the service role is unaffected. Fixture ids start with `7777bbbb` |
| `portal_messages_realtime.test.sql` | `20260927100130_patient_messages_realtime.sql` | `patient_secure_messages` is in the `supabase_realtime` publication, and the three things its safety rests on still hold: row-level security is on (Realtime checks it per subscriber for inserts and updates, and trims deletes to the primary key), the anon key has no SELECT on the table, and the primary key is `id` alone. Reads the catalog only |

Queue tickets (`20260925100200`) have no pgTAP file yet.

The FHIR Phase 2 test (`interop_phase2.test.sql`) lives with its deferred
migration in `supabase/migrations-deferred/tests/`, so `supabase test db`
does not run it against a database that never gets that migration. The
interop CI workflow runs it (see `docs/interoperability/testing.md`).

## Running them

They target the Supabase CLI:

```bash
supabase start       # local stack
supabase db reset    # apply every migration to the local database
supabase test db     # runs every file in supabase/tests with pg_prove
```

`supabase test db` can also run against another database (for example a
staging branch) with `--db-url`; check `supabase test db --help` for your CLI
version. Never run them against production.

Each file starts with `CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA
extensions;` inside its transaction, so pgTAP is available even if the
database does not have it yet.

## Fixtures

Every file makes its own fixtures (staff accounts in `app_users`, patients,
lab orders, medicines and so on) inside **one transaction that ends in
`ROLLBACK`**, so nothing is left in the database, whatever the result. Ids
start with `pgtap-` (text ids) or with a per-file UUID prefix (`1111`,
`2222`, `3333`, `4444`, `5555`, `6666`, `7777`, `8888`), so they do not collide with real
rows. `portal_access_backfill.test.sql` and
`registration_lead_portal_invite.test.sql` both use `6666`; each file rolls
back, so they never meet.

The tests assume the schema the migration files build (`supabase db reset`),
where `patients.id` is text. The staff and patient literals also work where
`app_users.id` is a uuid.

While a test runs it holds row locks, and `patient_merges.test.sql` and
`lab_release.test.sql` (which merges two records) hold the advisory lock
`merge_patients()` takes until the rollback. On a shared database, run the
tests when nobody is merging patients.

### Acting as a user

Fixtures are written as the connecting role (`postgres`, the table owner), to
which row-level security and the API-role guard triggers do not apply. The
triggers that apply to every caller still run for fixtures: the lab release
guard, the merge redirect, the server stamp and auto-enrolment. A test then
acts as a signed-in user the way PostgREST does:

```sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<app_users.id or auth uid>","role":"authenticated"}';
```

`auth.uid()` then returns the `sub`. A staff member is someone with a row in
`app_users`; a portal patient is a `sub` that matches `patients.auth_uid`.
`RESET ROLE` goes back to the owner.

## Not covered

- **Two `rx_dispense` calls at the same moment.** pgTAP runs in one session,
  so the oversell test is sequential. The concurrent case depends on the row
  locks `rx_dispense` takes (prescription, then medicines by id, then lots by
  expiry and id). To check it by hand on a local database you can reset
  afterwards: commit a medicine with one lot of 10 and two open
  prescriptions of 8; in session A, `BEGIN`, act as a pharmacist and call
  `rx_dispense` for the first prescription without committing; in session B,
  do the same for the second. B waits on the row locks A holds (the
  medicine, then the lot). Commit A: B then returns `insufficient_stock`
  with 2 available, and the lot ends at 2.
  Run `supabase db reset` afterwards.
- Queue tickets and queue transitions (`20260925100200`).
- SMS sending (edge functions).

## How these files were checked

The statements were run against a local PostgreSQL 16 database with every
migration applied, with a small stand-in for the pgTAP functions these
files use (`plan`, `ok`, `is`, `isnt`, `throws_ok`, `lives_ok`, `is_empty`,
`isnt_empty`, `todo`, `finish`), because pgTAP was not installed there. They
have not yet been run under `supabase test db` itself; do that before
relying on them.
