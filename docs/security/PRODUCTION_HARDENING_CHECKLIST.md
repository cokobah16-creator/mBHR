# mBHR Production-Hardening Checklist

This file tracks the production-readiness work driven by the audit
(`/root/.claude/plans/after-doing-an-audit-immutable-bentley.md`). Items below
that require a **dashboard click** (and so cannot be done from a migration or
code) are listed at the bottom.

## Phase A — Critical security ✅

| Item                                                                                                                                   | Status | Notes                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 59 `USING (true)` RLS policies dropped + scoped replacements                                                                           | ✅     | Migration `20260520000000_lockdown_rls_and_definer.sql`                                                                                                  |
| 13 legacy SELECT-true policies tightened                                                                                               | ✅     | Migration `20260520000001_tighten_legacy_select_policies.sql` (incl. removing the anon-readable session-token leak)                                      |
| Anon UPDATE on `patient_portal_sessions` constrained                                                                                   | ✅     | Migration `20260520000002_tighten_portal_session_anon_update.sql`                                                                                        |
| `is_staff()` / `has_role()` moved to `SECURITY INVOKER` + `notifications` policy added                                                 | ✅     | Migration `20260520000003_helpers_invoker_and_notifications_policy.sql`                                                                                  |
| 6 functions: `SET search_path = public, pg_catalog`                                                                                    | ✅     | Same migration as RLS lockdown                                                                                                                           |
| `check_and_increment_otp_rate_limit` / `cleanup_expired_otp_rate_limits` revoked from anon+authenticated, granted only to service_role | ✅     | Same                                                                                                                                                     |
| `photos` storage bucket: `public = false` + scoped RLS on `storage.objects`                                                            | ✅     | Same                                                                                                                                                     |
| Sentry `captureException` wired from both error boundaries + window error/unhandledrejection handlers                                  | ✅     | `src/lib/logger.ts` `captureError`, used by `GlobalErrorBoundary.tsx`, `ErrorBoundary.tsx`, `main.tsx`                                                   |
| Generic `rate_limits` table + `check_and_increment_rate_limit()` SQL function                                                          | ✅     | Migration `20260520000004_generic_rate_limits.sql`                                                                                                       |
| Edge functions wrapped in `enforceRateLimit` + `corsHeadersFor`                                                                        | ✅     | `supabase/functions/_shared/security/{rateLimit,cors}.ts` applied to send-otp-sms, send-otp-email, send-sms-reminder, tefca-oauth, tefca-ias, tefca-bulk |

## Phase A — Manual / dashboard items

These cannot be applied via migration. Walk through them in Supabase
Dashboard for `Med Bridge Health Reach` (project ref `dlogqxzejroeyivfmgcv`).

- [ ] **Enable leaked-password protection.**
      Dashboard → Authentication → Policies → Password Settings → toggle
      "Check passwords against HaveIBeenPwned.org" **on**.
      Closes the `auth_leaked_password_protection` advisor warning.

- [ ] **Set `ALLOWED_ORIGINS` secret on each edge function.**
      Dashboard → Edge Functions → (each function) → Secrets → add
      `ALLOWED_ORIGINS=https://your-prod-domain.vercel.app,https://staging.your-domain`.
      Until set, the new CORS helper falls back to `*` and logs a warning at
      cold-start. **Set it before the next deploy.** Apply to: send-otp-sms,
      send-otp-email, send-sms-reminder, tefca-oauth, tefca-ias, tefca-bulk.

- [ ] **Confirm Supabase Auth login-throttle is enabled.**
      Dashboard → Authentication → Rate Limits. Built-in. Confirm and record
      the chosen values (defaults are usually fine for healthcare).

## Release blockers — RLS reconcile and SMS hardening (September 2026)

| Item | Status | Notes |
| --- | --- | --- |
| RLS reconcile: database rules follow the app's role and permission matrix | 🟡 code done, **not yet verified on a live database** | Migrations `20260924110000` to `20260924110400` (RLS matrix) and `20260925100000` to `20260925100500` (sync authority; `20260925100000_sync_authority_foundation.sql` added the `queue`, `portal_manage`, `merge_patients` and `lab_release` keys), then `20260925100600` and `20260925100700`. The latest `app_role_has_permission`, which adds the `registration_lead` role and the `portal_invite` key, is in `20260925100600_registration_lead_portal_invite.sql`. `20260924105900_portal_access_backfill.sql` runs before all of them. See `docs/security/RLS_MATRIX.md`. |
| SMS hardening: server-only sending, staff sign-in, recipient from the patient record, rate limits, no double texts | 🟡 code done, **not yet deployed** | `send-sms-reminder` and `send-otp-sms` require a staff access token and an SMS role (pharmacist, doctor, nurse, lead_clinician, admin), send only to the number on the server record (Nigerian mobiles only), limit 30/min per user and 5/hour per number, return 409 `already_sent` for a reminder already sent, and record reminder outcomes with the service role. The app sends `{ patientId, message }` or `{ reminderId }` with the user's token. See `docs/deployment/SMS_SETUP_TERMII.md`. |

### Pre-release verification (do all of these before release)

- [ ] **Apply the migrations to a Supabase staging branch first**, never
      straight to production: `supabase db push` against the staging branch,
      and confirm `20260924110400_rls_verify_phi_lockdown.sql` completes (it
      stops the deploy if a PHI table still lets anon in).
- [ ] **Run the `docs/security/RLS_MATRIX.md` section 7 checks on staging**:
      the anon/always-true policy query returns no rows, and
      `app_current_role()` / `app_has_permission(...)` give the expected
      answers when signed in as each role (admin, doctor, nurse, volunteer,
      pharmacist, auditor, lead_clinician, and a portal patient). Spot-check
      a refused write (for example a pharmacist writing vitals) and that the
      app shows it as waiting for an authorised person to sync.
- [ ] **Set the SMS secrets on the server** (never as `VITE_` variables):
      `TERMII_API_KEY`, `TERMII_SENDER_ID`, `RATE_LIMIT_KEY_SALT` (random,
      e.g. `openssl rand -hex 32`). Confirm `SMS_DEMO_MODE` is unset in
      production.
- [ ] **Deploy the functions with JWT verification on**:
      `supabase functions deploy send-sms-reminder send-otp-sms` without
      `--no-verify-jwt`, and no `verify_jwt = false` for them in
      `supabase/config.toml`.
- [ ] **Run the end-to-end SMS check** on staging with a test patient whose
      phone is a handset you control:
      `MBHR_STAFF_EMAIL=... MBHR_STAFF_PASSWORD=... npm run test:sms -- <test-patient-id>`.
      Also confirm the anon key gets 401 and a volunteer account gets 403.
- [ ] **Rotate the staff PIN that was committed to the repository.** It
      appeared in the repository
      history, so treat it as public: any account (on any device) that uses
      it must be given a new PIN before release.
- [ ] **Rotate any Termii key ever exposed as a `VITE_` variable** (in `.env`
      files, git history, or Vercel/Netlify build settings): revoke it in the
      Termii dashboard, set the new key with `supabase secrets set`, and
      delete the old `VITE_` variable from every environment.
- [ ] **Rotate the Resend API key that was committed in plaintext.** It has
      been removed from the current tree but is still in the git history, so
      treat it as public: revoke it in the Resend dashboard, create a new key
      and set it only as a Supabase secret (`RESEND_API_KEY`), then redeploy
      `send-otp-email`. Whether to purge it from history is the owner's
      decision; see `docs/security/CREDENTIAL_HISTORY_REVIEW.md`. *Who:
      owner.*
- [ ] **Make "Clinical logic gate" a required status check** in the branch
      protection rules for `mainone` (and any other branch pull requests
      merge into). Until it is required, a failing gate does not block a
      merge (see `docs/clinical/CLINICAL_LOGIC_CHANGES.md`, section 1).
      *Who: repository admin.*
- [ ] **Apply the portal access backfill before the RLS migrations.**
      `20260924105900_portal_access_backfill.sql` must run before
      `20260924110000` to `20260924110400`. Otherwise patients who use the
      portal today with `portal_enabled` false or NULL see an empty portal
      from `20260924110300` on. Nothing is deleted; they lose access.
  - First run `supabase migration list --linked` to see what the production
    database has applied.
  - **Normal case** (no `20260924*` or later migration on the remote): a
    plain `supabase db push` applies the files in filename order, backfill
    first.
  - **If production already applied `20260924110000` or later**:
    `supabase db push` refuses the older file ("Found local migration files
    to be inserted before the last migration on remote database"). Use one
    of these:
    - run `supabase db push --include-all`; or
    - run the file by hand first with
      `psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20260924105900_portal_access_backfill.sql`,
      then `supabase migration repair --status applied 20260924105900 --linked`.
      Re-applying it is harmless: a record is never turned on twice.
  - **What a late run means**:
    - From the moment `20260924110300` was applied until the backfill runs,
      those patients saw an empty portal, and their messages and uploads
      were refused.
    - If `20260925100100` was also applied, it recorded their "off" as a
      'state_at_migration' server decision, and devices showed access off.
    - The late backfill turns them on, stamps a new decision time and writes
      a `portal_account_backfill` access event. Devices pick it up at their
      next sync.
    - A staff disable made in between is kept.
  - *Who: release owner.*
- [ ] **Deploy in a quiet window.** Until `20260925100000`/`20260925100100`
      are applied, an upload from an older app version can still write
      `portal_enabled` and undo a backfilled value. Deploy when no device is
      syncing. *Who: release owner, with site leads.*
- [ ] **After the deploy, check the backfill** (SQL editor):
  - `SELECT count(*) FROM public.portal_access_backfill_log;` should match
    the count in the `audit_logs` row with
    `action = 'portal_access_backfill'` (the count is in its `entity_id`
    text; there is no such row when nothing was turned on).
  - Backfilled records that are off again:
    `SELECT l.patient_id FROM public.portal_access_backfill_log l JOIN public.patients p ON p.id::text = l.patient_id WHERE NOT COALESCE(p.portal_enabled, false);`
    Expect none, unless staff turned them off through the app
    (`set_patient_portal_access`).
  - *Who: release owner.*
- [ ] **Review the links the backfill trusted** with a clinic lead.
  - (a) Rows with `portal_user_id` set: `phone_verified` may have been set
    by the removed demo OTP flow.
  - (b) Linked accounts whose confirmed email is not the record's email (the
    old sign-up linked on phone plus date of birth):
    `SELECT l.patient_id FROM public.portal_access_backfill_log l JOIN public.patients p ON p.id::text = l.patient_id JOIN auth.users u ON u.id::text = l.auth_uid WHERE lower(COALESCE(u.email, '')) IS DISTINCT FROM lower(COALESCE(p.email, ''));`
  - Turn off any that look wrong from the app.
  - A staff "disable" made in an app version before Wave B was never
    recorded by the server, so the backfill cannot see it. Re-disable those
    patients where needed.
  - *Who: owner, with data protection.*
- [ ] **Registration lead deploy order.** Apply
      `20260925100600_registration_lead_portal_invite.sql` before the app
      build that offers the `registration_lead` role (`app_users` refuses
      that role until the migration has committed), then redeploy
      `send-sms-reminder` and `send-otp-email`. Optionally set
      `PORTAL_APP_ORIGIN` for invitation links (see
      `docs/security/RLS_MATRIX.md`, "Portal invitations and SMS purposes").
      *Who: release owner.*

## Wave B — server-authoritative clinical state (September 2026)

Migrations `20260925100100` (portal access), `20260925100200` (queue
tickets), `20260925100300` (patient merges), `20260925100400` (pharmacy
ledger) and `20260925100500` (lab release), on top of `20260925100000`.
Nothing below is done yet unless it says so. Each item names who decides or
does it. Clinical questions are listed separately in
`docs/clinical/CLINICAL_LOGIC_CHANGES.md` ("Wave B: questions for clinical
review").

### Before and during deployment

- [ ] **Apply the Wave B migrations to staging and run the SQL tests.**
      The package reviews checked the migrations to different depths (for
      example, the lab-release migration was reviewed by reading only, and
      the portal-access reviewer re-ran only its backfill section). The SQL
      tests in `supabase/tests/` passed on a local PostgreSQL 16 with every
      migration applied, using a stand-in for pgTAP (one TODO check fails as
      expected; see the last section); they have not run under
      `supabase test db`. Apply `20260925100000` to `20260925100500` on a
      staging branch, then run `supabase test db` (the tests roll back).
      *Who: release owner.*
- [ ] **Confirm in CI that these unit tests pass.** They could not run in
      the review sandbox: `PatientLogin.test.tsx` (needs jsdom),
      `queueManagement.test.ts`, `notificationWorker.test.ts`,
      `televisits.test.ts`, `portalAccess.test.ts` and
      `patientPortalAuth.test.ts`. *Who: release owner.*
- [ ] **Update every device before applying `20260925100200`.** A device on
      an app version from before Wave A cannot change queue status on the
      server once it is applied (uploads can no longer change status).
      Merging to `main` applies every pending migration in CI (`migrate-prod`,
      `supabase db push --linked`) as soon as someone approves the
      `production` environment, before the new app is deployed; do not
      approve it until the devices are updated. *Who: site leads, with the
      release owner.*
- [ ] **Queue numbers on upgrade day.** Older versions numbered tickets per
      device (every device had a `Q-001`). On upgrade day the server gives
      those tickets new numbers and staff see "Ticket X is now Y". Decide
      whether that is acceptable, or keep legacy labels with a device
      prefix. *Who: owner.*
- [ ] **One site name per camp.** Queue tickets and pharmacy stock key a
      site by a slug of the active site name, not a site id. Devices at the
      same camp must use the same spelling; renaming a site breaks its
      opening-stock claim and its medicines' site key. Decide whether a
      stable site id is needed. *Who: owner; site leads set the names.*
- [ ] **Pharmacy opening stock.** Choose one device per site to upload
      opening stock (the server refuses a second device). Before relying on
      the ledger, check that `stock_balance_drift` and
      `stock_item_balance_drift` are empty (balances from before the
      migration show there until counted). *Who: pharmacy lead.*
- [ ] **Two outreach sites at once.** Pharmacy downloads are not scoped by
      site: every device gets every site's medicines, lots and
      prescriptions, so the Dispense list and the medicine list show other
      sites' records. Decide before running two sites at the same time.
      *Who: owner.*
- [ ] **Device time zone.** Set every device to West Africa Time: the server
      judges lot expiry on the Africa/Lagos date. *Who: site leads.*
- [ ] **Tell the pharmacy team how SMS reminders change.** A reminder now
      goes only to the phone number on the patient's record, once that
      record has synced; a number typed in the reminder form is not used.
      Owner-approved; staff need to know before release. *Who: pharmacy
      lead.*
- [ ] **Link staff records to online accounts.** Palaver drafts and unsent
      messages are now keyed by the online account id; a colleague whose
      staff record on a device still has a device id cannot be picked as a
      recipient until it is linked. *Who: admin.*
- [ ] **Legacy `patient_lab_results` table.** Patients can no longer read
      it and nothing writes it. Export and review any rows it holds, then
      drop it in a later migration. *Who: owner, then release owner.*

### Owner decisions

#### Portal access

- [ ] **Auto-enrolment when the portal box was left unticked.** The server
      still turns portal access on for a new patient with a phone or email
      (when auto-enrolment is on), even if the registrar left "Enable
      patient portal access" unticked; the device upload does not carry that
      choice. It now happens only on insert and never after a recorded
      decision. Keep, or stop auto-enrolling device uploads. *Who: owner,
      with data protection.*
- [ ] **`portal_opt_out` on staff decisions.** Every staff decision sets
      `portal_opt_out = NOT enabled`, so a staff disable also counts as an
      opt-out in any report that reads that column. Confirm. *Who: owner.*
- [ ] **Self-registered linked patients whose access is off** were stamped
      as a server decision by the migration, so only a staff enable can turn
      them on (a backfill or auto-enrolment cannot). Confirm this
      conservative choice. *Who: owner.*
- [ ] **How long a device trusts its own portal value** for PIN-only portal
      accounts on a device with a server: at most 7 days after the last
      download or server decision. Confirm or change the window. *Who:
      owner.*
- [ ] **Commands for a record deleted before upload** (portal access and
      merges) raise PT409 and are retried forever (at most every 30
      minutes), holding that patient's later commands. Decide whether they
      should give up and be shown for review. *Who: owner.*
- [ ] **Backfill skips.** The backfill (`20260924105900`) does not turn on:
  - records whose `patient_portal_users` account is `suspended` (even with a
    confirmed Supabase account linked);
  - records whose `auth_uid` is a staff (`app_users`) account (even with a
    verified portal row);
  - `locked` portal accounts.

  Confirm these conservative choices. *Who: owner.*

#### Queue

- [ ] **Pharmacists and queue actions.** Pharmacists hold `queue` on the
      server, but the app's `canManageQueue` still needs `register`, so the
      UI blocks them. Decide which is right. *Who: owner.*
- [ ] **Queue edit conflicts are last-writer-wins** (no conflict review for
      queue rows; the server still protects status, stage, ticket and urgent
      priority). Confirm. *Who: owner.*
- [ ] **Refused queue changes are silent.** When the server refuses a status
      change as stale (for example two desks called the same ticket), the
      device takes the server's state at the next sync and staff are not
      told; the refusal is kept in `queue_transitions`. Decide whether staff
      should see it. *Who: owner.*
- [ ] **Downgrades named after a clinician.** The server accepts a priority
      downgrade whose recorded user is a real clinician, even when a
      non-clinician uploads it (audited by uploader). Checking only the
      uploader's role would refuse clinician downgrades synced later by a
      colleague. Decide. *Who: owner, with the clinical lead.*

#### Patient merges

- [ ] **Patient details in the merge history and erasure requests.**
      `patient_merges` keeps full snapshots of both records and nothing can
      delete them, not even the service role. Decide whether data-erasure
      requests get a narrow exception (for example a function that clears
      the snapshots). *Who: owner, with data protection.*
- [ ] **Deleting a kept record** sets `merged_into` to null on the records
      merged into it, so they become active again. Confirm or change.
      *Who: owner.*
- [ ] **Both records have a portal sign-in.** The kept record keeps its own;
      the merged-away record's portal account loses access. Decide whether
      the merge should be refused, or the portal account moved. *Who: owner.*
- [ ] **Who downloads the merge history.** Only `merge_patients` and
      `audit_access` holders can read `patient_merges`, so volunteer and
      pharmacist devices do not download it (they still see the merge on
      the patient record). Confirm. *Who: owner.*

#### Pharmacy

- [ ] **Other stock tables.** The main-database `inventory` table and
      `stockBatches` still upload absolute quantities (last writer wins).
      Decide whether they become read-only or move onto the ledger. *Who:
      owner.*
- [ ] **Undo a dispense.** `rx_reverse_dispense` (put stock back) was not
      built because there is no screen for it. Decide whether to schedule
      it. *Who: owner, with the pharmacy lead.*
- [ ] **Counts are changes, not totals.** `rx_adjust_stock` applies
      "counted minus shown", so a count taken while another device's
      dispense of that lot is unsynced can be off until the next count.
      Decide whether an absolute "set to counted" action is needed. *Who:
      owner, with the pharmacy lead.*

#### Lab results

- [ ] **Lab review and release offline.** `lab_review_result` and
      `lab_release_result` are online-only and take no command id. Decide
      whether they should go through the command outbox. *Who: owner.*
- [ ] **Tell the patient when a result is released.** No portal
      notification is created on release. Decide whether to add one. *Who:
      owner.*

#### Patient documents

- [ ] **Decide retention for removed patient documents (owner task).** Since
      `20260925100700`, removing a patient document is a soft delete. The
      `patient_documents` row (with `deleted_at` / `deleted_by`) and its
      file in the `patient-documents` bucket are both kept. The patient can
      no longer see them, staff still can, and no API caller can delete the
      file. Decide how long removed documents are kept. Then run the
      clean-up with the service role or the database owner: delete the
      files through the storage API with the service key, then delete the
      rows as the owner, not through PostgREST. Clinic (`staff`) rows are
      clinical records and follow the medical-record retention policy. Also
      decide whether orphan files (no document row, for example from an
      interrupted upload whose clean-up failed) should be swept regularly.
      *Who: owner.*

#### Messaging

- [ ] **Two devices can send the same reminder** if they start within about
      a second of each other. Closing this needs an atomic claim (a
      `sending` status), which means a migration changing the
      `medication_reminders` status check. Decide. *Who: owner.*
- [ ] **SMS not configured.** Server reminders now stay `pending` and are
      retried on every run while SMS sending is not set up (they used to be
      marked failed). Decide whether they should be marked failed instead.
      *Who: owner.*
- [ ] **Who can see and send from the Message outbox.** The server allows
      SMS for pharmacist, doctor, nurse, lead clinician and admin. The
      panel is shown only to `export` holders (admin, auditor, lead
      clinician), so an auditor can see it but not send, and pharmacists,
      doctors and nurses do not see it. Decide who should see it, and check
      the app's send gate still matches the server. *Who: owner.*

### Found while writing the SQL tests (fix before release)

- [x] **`rx_dispense` and `rx_import_history` left `mbhr.stock_write` on**
      until the transaction ended. Fixed in `20260925100400`: both turn it
      off before returning (asserted in
      `supabase/tests/pharmacy_ledger.test.sql`).
- [ ] **TRUNCATE privilege.** Revoked on the pharmacy ledger tables, and
      `stock_movements` has a TRUNCATE trigger (`20260925100400`).
      `authenticated` still keeps the Supabase default TRUNCATE privilege on
      most older tables (for example `patients`, `vitals` and
      `lab_results`). PostgREST cannot send TRUNCATE, so the API cannot
      reach it; revoke it everywhere. *Who: database owner.*

### Found in the offline-PIN review (fix before release)

- [x] **Expired session on app start keeps the online sign-in.** *Fixed in
      the staff session model PR: the expired branch now also ends the
      online sign-in.* In
      `src/stores/auth.ts`, the `onRehydrateStorage` branch for a session
      past its grace period clears the local session but leaves the stored
      online (Supabase) sign-in in place. It should end that online sign-in
      too, as a PIN sign-in does. *Who: release owner.*
- [x] **Record sync must run as the signed-in staff member.** *Fixed in the
      staff session model PR: `checkCloudSession()` counts a stored sign-in
      only when it is the signed-in staff member's own, from an online
      sign-in in this session (`authMode === "online"`).* Record sync
      (`syncNow` in `src/sync/adapter.ts`, and `enhancedSync`) should
      require the online account to be the signed-in staff member
      (`currentCommandSender()`, as the command outbox does), not any
      online sign-in stored on the device. *Who: release owner.*
- [x] **Online sign-in can reactivate a staff record deactivated on this
      device (decision 4 gap, for the owner of PR #126).** *Fixed in the
      staff session model PR: online sign-in is refused for such a record
      and leaves it for the administrator's review.* Online sign-in in
      `src/stores/auth.ts` looks up the local record with
      `isActive === 1`, so a deactivated record is not found; it then writes
      a fresh, active user record with the same id (`db.users.put`) over the
      deactivated one, bypassing the admin review. *Who: owner of PR #126.*
- [x] **Delete the dead `src/services/supabaseSync.ts`.** *Deleted in the
      staff session model PR.* Nothing imports
      it, and its `syncAll` is not gated on the signed-in staff member.
      *Who: release owner.*

## Phase B — Observability + CI/CD ✅

| Item                                                    | Status | Notes                                                                                                                                        |
| ------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| CI: preview deploy job (per PR)                         | ✅     | `.github/workflows/build.yml` `deploy-preview` job — needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` repo secrets to actually run |
| CI: smoke test against the deployed preview URL         | ✅     | `smoke-test` job runs `e2e/login.spec.ts` with `PLAYWRIGHT_BASE_URL`                                                                         |
| CI: production deploy gated by `production` Environment | ✅     | `migrate-prod` + `deploy-prod` jobs                                                                                                          |
| CI: DB migrations applied on prod deploy                | ✅     | `supabase/setup-cli` + `supabase db push --linked`; needs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`            |
| Sticky PR comment with preview URL                      | ✅     | `marocchino/sticky-pull-request-comment@v2`                                                                                                  |
| Centralised Supabase call wrapper                       | ✅     | `src/services/supabaseQuery.ts` + 7 unit tests                                                                                               |
| `supabase/config.toml` project_id corrected             | ✅     | Was `xxbbafonflieyqcwaeyx`, now `dlogqxzejroeyivfmgcv`                                                                                       |
| Zod env validation at app boot                          | ✅     | `src/config/env.ts`; throws in dev, reports + falls back in prod                                                                             |

## Phase B — Manual / dashboard items

- [ ] **Create the `production` GitHub Environment** with required reviewer(s)
      before merging anything to `main` — otherwise `migrate-prod` + `deploy-prod`
      will run automatically.
- [ ] **Add the following GitHub Action secrets** to the repository:
      `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
      `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (use
      `dlogqxzejroeyivfmgcv`), `SUPABASE_DB_PASSWORD`.
- [ ] **(Recommended) Raise vitest coverage threshold** in
      `vitest.config.ts` from 60 → 75% in two PRs. Backfill the most
      under-tested service first — likely `src/services/portalEnrollment.ts`
      or `src/services/messaging.ts`.

## Phase C — Resilience ✅

| Item                                                                 | Status | Notes                                                                                                                                       |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Nightly `pg_dump` workflow uploading to private storage              | ✅     | `.github/workflows/backup.yml` (runs at 03:00 UTC; manual `workflow_dispatch` also supported)                                               |
| Restore runbook with verification queries                            | ✅     | `docs/RESTORE_RUNBOOK.md`                                                                                                                   |
| Opportunistic background sync (≤ 60s push of dirty rows when online) | ✅     | `startBackgroundSync()` in `src/sync/adapter.ts`, kicked off from `src/main.tsx` after seed; exponential backoff up to 5 min on repeat fail |
| Symmetric JSON export → import round-trip                            | ✅     | `src/utils/import.ts` (counterpart to `src/utils/export.ts`); 6 unit tests covering shape, idempotency, dirty-flag stamping                 |
| Device-key escrow for tablet-loss recovery                           | 🔬     | Deferred to a follow-up spike doc — requires real cryptographic protocol design + UX work; see Phase D / WS13 spike for adjacent context.   |

## Phase C — Manual / dashboard items

- [ ] **Confirm Supabase Point-in-Time Recovery is enabled** for the prod
      project. The nightly logical dump is a second line of defence; PITR is
      the first (and finer-grained). PITR requires the Pro plan or higher.
- [ ] **Create the private `backups` Storage bucket** once:
      `supabase storage buckets create backups --public=false`. The nightly
      job assumes it exists.
- [ ] **Run the quarterly restore drill** documented in
      `docs/RESTORE_RUNBOOK.md` (Step 7) — drift in pg_dump / Supabase CLI
      behaviour is real; rehearsing once a quarter is the cheapest
      production incident.

## Phase D — Polish ✅ (partial — see follow-ups)

| Item                                                                                      | Status | Notes                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 37 FK indexes added                                                                       | ✅     | Migration `20260520000005_fk_indexes_and_dup_drops.sql`                                                                                                                                                                                                                              |
| 4 duplicate indexes dropped                                                               | ✅     | Same migration                                                                                                                                                                                                                                                                       |
| Workbox runtime caching tuned (NetworkFirst + StaleWhileRevalidate + CacheFirst per host) | ✅     | `vite.config.ts`                                                                                                                                                                                                                                                                     |
| Caching/CDN strategy documented                                                           | ✅     | `docs/CACHING_STRATEGY.md`                                                                                                                                                                                                                                                           |
| Scaling readiness documented                                                              | ✅     | `docs/SCALING_PLAN.md`                                                                                                                                                                                                                                                               |
| PHI encryption spike doc (WS13)                                                           | ✅     | `docs/PHI_ENCRYPTION_SPIKE.md` — threat model + field inventory + crypto sketch + cost (~17 days) + conditional-GO recommendation                                                                                                                                                    |
| 94 `auth_rls_initplan` policies wrapped in `(SELECT auth.<fn>())`                         | ✅     | Migration `20260520000006_wrap_auth_uid_in_rls_policies.sql`. Verified: 0 bare `auth.uid()` references remain in any RLS policy.                                                                                                                                                     |
| 79 `multiple_permissive_policies` consolidated                                            | 🟡     | 19 of 75 combos cleared in migration `20260520000007_consolidate_multiple_permissive_policies.sql`. Remaining 56 are intentional dual policies (patient-portal owner+staff and care_tasks/triage_records role-set mismatches) — load-bearing; documented for case-by-case follow-up. |
| 129 unused indexes audited + dropped (ring-fenced)                                        | ⏳     | Follow-up — needs 1-week `pg_stat_user_indexes` confirmation that they really are unused before dropping.                                                                                                                                                                            |

## Phase D — Manual / dashboard items

- [ ] **Re-run `mcp__supabase__get_advisors(type=performance)` after**
      the follow-up perf migration lands and confirm both
      `auth_rls_initplan` and `multiple_permissive_policies` drop to zero.
- [ ] **Lighthouse run** post-Workbox-tuning: expect PWA ≥ 90, Performance
      ≥ 80 on mid-tier Android (Pixel 5 in dev tools).
