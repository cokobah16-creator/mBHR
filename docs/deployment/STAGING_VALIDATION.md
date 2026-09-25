# Staging validation (release gate)

The owner's release gate, in this order:

> PR -> CI -> staging Supabase -> migration verification -> staging app ->
> workflow test -> production migrations -> production deployment. Do not
> apply this directly to production yet.

This checklist covers the steps from "staging Supabase" to "workflow test".
Production migrations and the production deployment start only when every
box in sections 2 to 5 is ticked and the owner has signed section 6.

Related documents: `docs/security/PRODUCTION_HARDENING_CHECKLIST.md` (the
wider release blockers), `docs/security/RLS_MATRIX.md` (section 7 has the
live-database checks), `supabase/tests/README.md` (the SQL tests),
`docs/clinical/CLINICAL_LOGIC_CHANGES.md` (clinical questions for review).

---

## 0. Things that can reach production by accident

Read these before starting. Each one can change production without anyone
meaning to.

- [ ] **`supabase/config.toml` names the production project** (`project_id`).
      A `supabase db push` from a folder linked to it changes production. Link
      the staging project explicitly (section 2.1) and check the linked
      project before every push.
- [ ] **CI applies migrations to production on a push to `main`**
      (`migrate-prod` in `.github/workflows/build.yml`, gated by the
      `production` GitHub Environment). Do not approve a `production`
      environment run until section 6 is signed. (At the time of writing the
      default branch is `mainone` and there is no `main` branch, so this job
      does not run; check again before release.)
- [ ] **Vercel deploys its production branch on every push.** Check which
      branch is set as Production Branch in the Vercel project settings. A
      merge into that branch ships the new app to production, possibly before
      the production database has the new migrations. The new app needs the
      new migrations (and the other way round: see "Update every device" in
      the hardening checklist), so hold that merge until section 6 is signed.
- [ ] **Never run the SQL tests against production.** `supabase test db`
      rolls back, but it holds row locks and the merge advisory lock while it
      runs.

---

## 1. PR and CI

| Check | Result |
| --- | --- |
| The release PR is open against the release branch and lists every migration it adds | [ ] Pass [ ] Fail |
| CI "Build, lint, test" is green (typecheck, ESLint with no warnings, unit tests, i18n check, build) | [ ] Pass [ ] Fail |
| CI "Clinical logic gate" is green (or the PR says "No clinical logic change" and that is true) | [ ] Pass [ ] Fail |
| CI "Smoke test" (Playwright login) is green | [ ] Pass [ ] Fail |
| The unit tests the review sandbox could not run (listed under "Confirm in CI" in the hardening checklist) ran and passed in CI | [ ] Pass [ ] Fail |

Tester: ______________________ Date: ______________

---

## 2. Staging Supabase and migration verification

### 2.1 Prepare the staging project

Use a separate Supabase project (or a Supabase branch) for staging. Its data
must be test data only: no real patient records.

1. [ ] Take a backup of the staging database (Dashboard, Database, Backups),
       so a failed run can be restored.
2. [ ] Link the staging project in a clean checkout of the release branch:

       supabase link --project-ref <staging-project-ref>

3. [ ] Confirm the link points at staging, not production. The project ref
       printed by `supabase link` and the one marked as linked in
       `supabase projects list` must be the staging ref.
4. [ ] List the migrations and what staging already has:

       supabase migration list

       Write down the first pending migration: ______________

### 2.2 Apply the migrations in order

The files run in timestamp order. The ones this release adds or depends on:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `20260924105900_portal_access_backfill.sql` | Turns portal access on for patients who already have a verified portal account linked to their record (never matched on phone or email), and logs each one in `portal_access_backfill_log`. **Must run before the 20260924* RLS files**, or those patients lose portal access. |
| 2 | `20260924110000_rls_permission_helpers.sql` | Permission helpers and the role/permission matrix in the database |
| 3 | `20260924110100_rls_clinical_core.sql` | Row-level security for clinical tables |
| 4 | `20260924110200_rls_staff_conflicts_messaging.sql` | Row-level security for staff, conflict and messaging tables |
| 5 | `20260924110300_rls_patient_portal.sql` | Portal data visible only while `portal_enabled` is on |
| 6 | `20260924110400_rls_verify_phi_lockdown.sql` | Stops the migration if any PHI table still lets anonymous users in |
| 7 | `20260924120000_add_queue_transitions_audit.sql` | Queue transition audit table |
| 8 | `20260925100000_sync_authority_foundation.sql` | Server clock and row versions, command receipts, new permission keys |
| 9 | `20260925100100_portal_access_authoritative.sql` | Portal access becomes a server decision |
| 10 | `20260925100200_queue_tickets_authoritative.sql` | Queue tickets and queue status become server-owned |
| 11 | `20260925100300_patient_merge_authoritative.sql` | Patient merges become server-owned, with a history |
| 12 | `20260925100400_pharmacy_stock_ledger.sql` | Stock ledger; balances never below zero |
| 13 | `20260925100500_lab_results_release.sql` | Lab results reach the portal only after review and release |
| 14 | `20260925100600_registration_lead_portal_invite.sql` | Registration lead role and the `portal_invite` permission |
| 15 | `20260925100700_patient_document_ownership.sql` | Who uploaded each patient document; patients can only soft-delete their own |

Steps:

1. [ ] Update every staging test device to the release build before applying
       `20260925100200` (older builds cannot change queue status once it is
       applied).
2. [ ] Apply the migrations:

       supabase db push

       If staging already has any `20260924110000`-or-later file applied, the
       CLI refuses to apply the older `20260924105900` file. In that case run
       `supabase db push --include-all`. The backfill file is written to work
       when it runs late (see its header, "Late run"); record that it ran
       late: [ ] yes [ ] no
3. [ ] Every migration completed. In particular:
       - `20260924110400` finished (it raises an error listing any PHI table
         with RLS off, an anon or PUBLIC policy, or an always-true policy).
       - `20260925100700` finished (it raises an error if patients can still
         update or delete document rows directly, or if its trigger is
         missing).
       - Copy any `WARNING` lines from the output here:
         ______________________________________________
4. [ ] `supabase migration list` shows every file above as applied on the
       remote, and nothing pending.

### 2.3 Check the results

Run these in the staging SQL editor.

| Check | Query | Expected | Result |
| --- | --- | --- | --- |
| Backfill logged | `select count(*) from public.portal_access_backfill_log;` | A number (0 is fine on a database with no verified portal accounts). Write it down: ______ | [ ] Pass [ ] Fail |
| Backfill summary in the audit log | `select at, action from public.audit_logs where action = 'portal_access_backfill';` | One row (counts only, no patient ids) if the backfill count above is more than 0; no row if it is 0 (the function writes the summary only when it turned something on). If the audit table has a different layout the migration warns instead; that is acceptable | [ ] Pass [ ] Fail |
| Backfill only turned on linked, verified accounts | Pick 3 rows (or every row, if fewer) from `portal_access_backfill_log` and check each record's `auth_uid` or portal account is verified and linked to that exact record | All checked rows correct (skip if the log is empty) | [ ] Pass [ ] Fail |
| Backfill is idempotent | Run `select public.app_portal_access_backfill();` again as the database owner | Returns 0 and adds no log rows | [ ] Pass [ ] Fail |
| No anonymous or always-true PHI policies | The first query in `docs/security/RLS_MATRIX.md` section 7 | No rows | [ ] Pass [ ] Fail |
| Batch drift is empty | `select * from public.stock_balance_drift;` | No rows (see note) | [ ] Pass [ ] Fail |
| Medicine drift is empty | `select * from public.stock_item_balance_drift;` | No rows (see note) | [ ] Pass [ ] Fail |
| Roles answer correctly | Sign in as each role and run `select public.app_current_role(), public.app_has_permission('lab_review'), public.app_has_permission('portal_invite');` | Matches `src/auth/roles.ts` for admin, doctor, nurse, volunteer, pharmacist, auditor, lead_clinician, registration_lead, and a portal patient | [ ] Pass [ ] Fail |

Note on the drift views: balances that existed before
`20260925100400` have no ledger rows, so on a staging copy with old stock
data they are listed until each site uploads its opening stock or records a
count. They must be empty after that. On a fresh staging database they must
be empty straight away. Re-run both queries at the end of section 5.

### 2.4 Run the SQL tests

1. [ ] Make sure nobody is merging patients on staging (the tests hold the
       merge lock until they roll back).
2. [ ] Run the pgTAP files against staging:

       supabase test db --db-url "<staging connection string>"

       (Check `supabase test db --help` for the flag name in your CLI
       version.) The files are listed in `supabase/tests/README.md`; they
       make their own fixtures and end in `ROLLBACK`.
3. [ ] Every file passes. Paste the summary line: ______________________
4. [ ] Queue tickets (`20260925100200`) have no pgTAP file. Scenario 5.1
       below is their test.
5. [ ] Two dispenses at the same moment cannot be tested by pgTAP. Scenario
       5.2 below covers it through the app; the manual two-session SQL check
       in `supabase/tests/README.md` ("Not covered") is optional.

Tester: ______________________ Date: ______________

---

## 3. Staging edge functions and secrets

- [ ] Deploy the functions to staging with JWT verification on:
      `supabase functions deploy send-sms-reminder send-otp-sms send-otp-email --project-ref <staging-project-ref>`
- [ ] Set the staging secrets with `supabase secrets set --project-ref <staging-project-ref>`:
      `TERMII_API_KEY`, `TERMII_SENDER_ID`, `RATE_LIMIT_KEY_SALT`,
      `RESEND_API_KEY` (a staging key, not the production one),
      `ALLOWED_ORIGINS` (the staging app address), `PORTAL_APP_ORIGIN` (the
      staging app address, so invitation links open staging).
- [ ] Decide how SMS is tested: a handset you control, or
      `SMS_DEMO_MODE=true` (the function then logs instead of sending, without
      the number or text). Never set `SMS_DEMO_MODE` in production.
      Chosen: ______________

---

## 4. Staging app

- [ ] Deploy the release branch as a Vercel preview (or a separate staging
      project) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` of the
      **staging** project. Staging address: ______________________
- [ ] Open the app and check in the browser developer tools (Network) that
      requests go to the staging Supabase address, not production.
- [ ] Create test staff accounts on staging, one per role used below:
      admin, registration_lead, volunteer, nurse, doctor, lead_clinician,
      pharmacist. Each signs in online once on each test device and chooses a
      device PIN.
- [ ] Use two test devices (or two browsers with separate profiles), called
      **Device A** and **Device B** below, both on the same site name (queue
      tickets and pharmacy stock are keyed by the site name).
- [ ] Choose one device per site for opening stock and upload the opening
      stock from it (a second device is refused and must use the server's
      stock).

Tester: ______________________ Date: ______________

---

## 5. Workflow tests

Record every result. "Fail" means the release does not go ahead until it is
fixed or the owner accepts it in writing in section 6. Use test patients
only.

### 5.0 End-to-end: registration -> queue -> vitals -> consultation -> labs -> pharmacy -> portal

Setup: a test patient with a phone number you control (and an email address
if testing email). Device A online. Staff: registration lead, nurse, doctor,
pharmacist.

| # | Step | Expected result | Result |
| --- | --- | --- | --- |
| 1 | Registration lead registers the patient (`/register`) with portal access turned on, and syncs | Patient saved; after sync the row exists in `patients` on staging. Portal access shows as waiting for the server until the server answers, then `portal_enabled = true` on staging and `patient_portal_access_events` has a row for the decision | [ ] Pass [ ] Fail |
| 2 | Issue a queue ticket (`/tickets/issue`) and check the queue (`/queue`) | Ticket label shown; after sync `queue_tickets` has one ticket for this patient, site and day; the waiting-room display (`/display`) shows it within seconds | [ ] Pass [ ] Fail |
| 3 | Nurse records vitals (`/vitals`) and sends the patient on | Vitals saved and synced; a `queue_transitions` row with `applied = true`; the queue row moves to the next stage; priority is carried to the next stage | [ ] Pass [ ] Fail |
| 4 | Doctor opens the consultation (`/consult`), writes the note, orders a lab test and writes a prescription | Consultation, `lab_orders` row and an `open` prescription on staging | [ ] Pass [ ] Fail |
| 5 | Labs (`/labs`): collect the specimen, enter a result with an interpretation, then review it (doctor, lead clinician or admin) | A result without an interpretation cannot be saved; after review `reviewed_at`/`reviewed_by` are set; the result is not yet in the portal | [ ] Pass [ ] Fail |
| 6 | Release the result to the patient ("Release to patient") | `released_to_patient_at` set; a `lab_result_release_log` row | [ ] Pass [ ] Fail |
| 7 | Pharmacist dispenses the prescription (`/rx/dispense`) online | "Prescription dispensed ... Stock confirmed by the server."; lot quantity goes down; one `stock_movements` dispense row per lot used; drift views empty | [ ] Pass [ ] Fail |
| 8 | Registration lead sends the portal invitation (scenario 5.9 has the details) | Invitation received on the test handset or inbox | [ ] Pass [ ] Fail |
| 9 | The patient signs up from the invitation link (`/patient/register`), links the record and signs in (`/patient/login`) | Sign-in succeeds; dashboard shows the patient's record | [ ] Pass [ ] Fail |
| 10 | Patient opens Lab results and Prescriptions in the portal | The released result is shown (with the release note, if any); the dispensed prescription is shown | [ ] Pass [ ] Fail |

Tester: ______________________ Date: ______________

### 5.1 Two devices issuing queue actions concurrently

**Setup.** Device A and Device B online, both signed in online as queue staff
(nurse or volunteer), same site. One test patient waiting at the vitals
stage. A second test patient not yet in the queue.

**Steps.**
1. On both devices open the queue at the same time. On A and B press "Call"
   (or "Send on") for the same waiting patient within a second of each other.
2. Sync both devices.
3. Take both devices offline. Issue a ticket to the second patient on A, and
   on B issue a ticket to the same second patient. Issue one more ticket to a
   third patient on each device.
4. Bring both online and sync both.

**Expected result.**
- Step 2: only one transition is applied. In
  `select kind, from_status, to_status, applied, reject_reason from public.queue_transitions where queue_item_id = '<queue row id>' order by received_at;`
  the first row has `applied = true`; the other has `applied = false` with
  `reject_reason` `already_in_state` (same target) or `stale_from_state`
  (the row had already moved). After syncing, both devices show the same
  status for the patient. The patient is not duplicated in the queue.
- Step 4: the second patient has exactly one ticket for the site and day
  (`queue_tickets`); no two tickets share a label on the same site and day.
  Numbers issued offline come from each device's leased block, so the
  third-patient tickets do not collide. If a device's offline label had to
  change, staff see "Ticket X is now Y".

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.2 Two devices dispensing the final available medication quantity

**Setup.** A medicine with one in-date lot holding 10 units on the server
(check `pharmacy_batches.qty_on_hand`). Two open prescriptions for different
test patients, each for 8 units. Device A and Device B online, both signed in
online as pharmacists.

**Steps.**
1. Open `/rx/dispense` on both devices and choose one prescription on each.
2. Press Dispense on both within a second of each other.

**Expected result.**
- One device shows "Prescription dispensed ... Stock confirmed by the
  server."
- The other shows "Not dispensed." with the available quantity on the server
  (for example "2 in date on the server, 8 prescribed") and "Do not hand over
  this medicine; the stock shown has been corrected." Its prescription is open
  again.
- The lot ends at 2, never below zero. `stock_movements` has exactly one
  dispense for the lot. Both drift views return no rows.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.3 Offline dispense followed by reconciliation

**Setup.** As 5.2: one lot of 10, two open prescriptions of 8. Device A
online; Device B has synced both prescriptions and the stock, then goes
offline (airplane mode).

**Steps.**
1. On B (offline) dispense one prescription. Note the message.
2. On A (online) dispense the other prescription.
3. Bring B online and sync.
4. Open the pharmacy stock screen (`/rx/stock`) and the dispense screen.
5. Do a physical count, record it, then mark the discrepancy reconciled
   (online only).

**Expected result.**
- Step 1: "Dispensed · saved on this device ... Stock will be confirmed when
  it syncs."
- Step 2: confirmed by the server; the lot goes to 2.
- Step 3: the server does not refuse medicine already handed over. It records
  B's prescription as dispensed to the patient, takes the 2 units still in
  stock, and files the 6 units it could not cover in `stock_discrepancies`
  (status open). The lot ends at 0, never below zero.
- Step 4: "Stock discrepancies (1)" on the stock screen and an open
  discrepancy count on the dispense screen, on both devices after sync.
- Step 5: the discrepancy's status becomes resolved. Both drift views return
  no rows.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.4 Merged patient referenced by stale offline data

**Setup.** Two test records for the same person (record K to keep, record M
to merge away). Device B has synced both, then goes offline. Device A online,
signed in online as a role with the `merge_patients` permission (the same
roles as `resolve_conflicts`: for example doctor, nurse, lead clinician or
admin).

**Steps.**
1. On A, merge M into K using the duplicate-patient dialog, and sync.
2. On B (still offline, has not seen the merge), record vitals and a
   consultation note for record M.
3. Bring B online and sync. Sync once more.
4. As a portal patient linked to M (optional), try signing in.

**Expected result.**
- Step 1: `patient_merges` has one history row (who, when, which records);
  M has `merged_into = K`; M's history now belongs to K.
- Step 3: B's vitals and note land on K on the server (the redirect trigger
  points rows written for a merged-away record at the kept record). After the
  second sync B shows them under K and shows M as merged. Nothing is lost and
  nothing stays on M.
- Step 4: portal data is served for K only; a portal sign-in that belonged to
  M was moved to K if K had none.
- Repeating the merge from B returns the earlier merge (`already_merged`),
  not a second one.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.5 Portal access removed while a portal session exists

**Setup.** A test patient with portal access on and a portal account, signed
in to the portal in Browser P (online) on the dashboard. A staff member with
`portal_manage` (for example registration lead) on Device A.

**Steps.**
1. On A, turn portal access off for the patient (portal status card) and
   sync.
2. In Browser P, without reloading, open Lab results, Documents and
   Messages.
3. Reload Browser P (or close and reopen the portal).
4. Try to sign in again.
5. Optional: on a device where the patient used the offline portal sign-in,
   sync the device and try the offline portal sign-in.

**Expected result.**
- Step 1: `patients.portal_enabled = false`, and a row in
  `patient_portal_access_events` records the change and who made it.
- Step 2: the server returns no rows for the patient's records (row-level
  security uses `app_portal_patient_ids()`, which only lists records with
  portal access on). Pages show empty lists or an error, never the old data
  from the server.
- Step 3: the portal checks access with the server (`portal_access_status()`)
  and, told access is off, ends the portal sign-in and returns to the portal
  login page.
- Step 4: sign-in refused with the "not enabled" message.
- Step 5: refused with "Your clinic has not turned on portal access for you.
  Please ask clinic staff." once the device has downloaded the change.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.6 Reviewed but unreleased lab result

**Setup.** A test patient with portal access and a signed-in portal account.
A lab order for the patient.

**Steps.**
1. On the staff app enter a result (with an interpretation) and review it.
   Do not release it.
2. In the portal open Lab results.
3. In the staging SQL editor, as the portal user (see "Acting as a user" in
   `supabase/tests/README.md`), run
   `select * from public.portal_my_lab_results();` and
   `select count(*) from public.lab_results;`
4. Try to release a different result that has not been reviewed.

**Expected result.**
- Step 2: the result is not shown.
- Step 3: `portal_my_lab_results()` does not return it; the direct
  `lab_results` query returns 0 rows (portal patients cannot read the table).
- Step 4: refused (`lab_results_release_requires_review`); a result must be
  reviewed before it is released.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.7 Released lab result

**Setup.** The reviewed result from 5.6. A staff member with `lab_release`
(doctor, lead clinician or admin), and a nurse account.

**Steps.**
1. Sign in as the nurse and look for the release action.
2. Sign in as the doctor and release the result with a short note to the
   patient.
3. In the portal open Lab results.
4. On the staff app change the result's value or interpretation.
5. Reload the portal.

**Expected result.**
- Step 1: the nurse cannot release (no release action; the server refuses
  it too).
- Step 2: `released_to_patient_at` and `released_to_patient_by` set; a
  `lab_result_release_log` row.
- Step 3: the result is shown, with the note.
- Step 4: changing a reviewed result's value or interpretation clears its
  review and release.
- Step 5: the result is no longer shown until it is reviewed and released
  again.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.8 Volunteer attempting a portal invitation

**Setup.** A test patient with portal access on and a phone number. A
volunteer signed in online.

**Steps.**
1. Open the patient's portal status card.
2. Optional: call the SMS function directly with the volunteer's access
   token and `purpose: "portal_invitation"` for the patient.

**Expected result.**
- Step 1: no send action. The card says "Your role cannot send portal
  invitations." and names the roles that can. The volunteer can still turn
  portal access on at registration (`portal_manage`).
- Step 2: HTTP 403 with `error: "not_permitted"`. No SMS or email is sent.
  `portal_invitation_begin()` refuses before writing, so
  `portal_invitation_events` has no row for this attempt.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.9 Registration lead sending a portal invitation

**Setup.** A test patient on the server with portal access on and a phone
number (and email) you control. A registration lead signed in online.

**Steps.**
1. Send the invitation by SMS from the portal status card.
2. Send it by email.
3. Send one for a patient whose portal access is off, and one for a record
   that was merged away.

**Expected result.**
- Steps 1 and 2: the message arrives with a link to the staging app's
  `/patient/register`. `portal_invitation_events` has a `requested` row and a
  `sent` row for each invitation, with `actor_role = 'registration_lead'`,
  the channel, and no phone number, email address or message text.
  `patients.portal_invited_at` is set.
- Step 3: nothing is sent. Portal access off gives HTTP 409
  `portal_not_enabled`; a merged-away record gives HTTP 409
  `patient_merged` ("Send the invitation from the record that was kept.").

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.10 Patient deleting their own upload

**Setup.** A portal patient signed in.

**Steps.**
1. Upload a document in the portal (`/patient/documents`).
2. Remove it.
3. Check the row in the staging SQL editor.

**Expected result.**
- Step 1: the row has `upload_source = 'patient'` and `uploaded_by_user_id`
  equal to the patient's account, whatever the app sent.
- Step 2: the document disappears from the patient's list.
- Step 3: the row and the file are kept (soft delete): `deleted_at` and
  `deleted_by` are set. Staff can still see it, marked as removed.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.11 Patient trying to delete a staff-uploaded document

**Setup.** A document for the same patient added by staff. The app has no
staff screen for patient documents, so add it through the API signed in as a
staff account with `register`, `vitals` or `consult` (for example in the SQL
editor: `set local role authenticated`, set `request.jwt.claims` to the staff
account's id as in `supabase/tests/README.md`, insert the row, then
`commit`). Check that the row has `upload_source = 'staff'`.

**Steps.**
1. In the portal, open Documents and look for a remove action on the clinic
   document.
2. As the portal user in the SQL editor, call
   `select public.portal_remove_document('<document id>');`
3. As the portal user, try `delete from public.patient_documents where id = '<document id>';`
   and an `update` that sets `deleted_at`.

**Expected result.**
- Step 1: no remove action for a clinic document.
- Step 2: `{"outcome": "rejected", "reason": "clinic_document", ...}`; the
  row is unchanged.
- Step 3: nothing deleted or changed (patients have no delete or update
  policy on the table).
- The file in the `patient-documents` bucket is still there.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.12 Disabled staff member attempting offline access

**Setup.** Staff member S (for example a nurse) has an online account and a
device PIN on Device B. Device B is offline. An admin on Device A.

**Steps.**
1. Switch S off on the server: in the staging SQL editor set the
   deactivation column the `app_users` table has for S (for example
   `is_active = false` or `deactivated_at = now()`), or remove S's row.
   (Switching an account off in the Users screen changes only that device's
   list; the server row is what every device follows.)
2. On Device B, still offline, sign in as S with the PIN.
3. Bring Device B online. Sign in online as S.
4. Sign in online on Device B as another staff member and let it sync (this
   downloads the staff list). Log out.
5. Try the offline PIN sign-in as S on Device B again.

**Expected result.**
- Step 2: this still works. A device learns about a switched-off account
  only when it next downloads the staff list; record this known limit.
- Step 3: the online sign-in gives S no staff access (the server treats a
  switched-off account as having no role), and the server refuses S's reads
  and writes.
- Step 4: the staff list download marks S as inactive on Device B.
- Step 5: S is no longer offered or accepted for offline sign-in.
- Record what happened to anything S saved offline in step 2:
  ______________________________________________

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.13 PIN login followed by attempted sync

**Setup.** Staff member T with an online account and a device PIN on Device
A. T is logged out. Device A is online (the point is that a PIN never opens
an online session, even with internet).

**Steps.**
1. Sign in with T's PIN (Offline PIN tab).
2. Record a change (for example a vitals entry for a test patient).
3. Press Sync now, or wait for a background sync. Watch the browser Network
   tab.

**Expected result.**
- The sync status reads "Offline — sign in online to sync" and Sync now is
  off.
- The banner says the changes are saved on this device and to sign in online
  to sync them.
- No requests to the staging Supabase REST or RPC endpoints are made for
  sync. No Supabase sign-in is created (nothing new under the
  `sb-...-auth-token` key in local storage).
- The change stays on the device, waiting.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.14 Same user online login followed by sync

**Setup.** Continue from 5.13 on Device A, with T's change still waiting.

**Steps.**
1. Log out, then sign in online as T (Online tab, email and password).
2. Let sync run (or press Sync now).
3. Check the staging database.

**Expected result.**
- Step 1: sign-in succeeds; the staff list is downloaded; T keeps the device
  PIN (it is never uploaded or downloaded).
- Step 2: the sync status shows a normal sync; the waiting change uploads.
- Step 3: the change from 5.13 is on the server. No PIN reaches the
  server: the staff upload has no PIN fields.

Result: [ ] Pass [ ] Fail   Tester: ______________ Date: ______________
Notes:

### 5.15 Close-out checks

- [ ] Re-run both drift view queries: no rows.
- [ ] `select count(*) from public.stock_discrepancies where status = 'open';`
      is 0 (everything from 5.3 reconciled).
- [ ] Look through the edge function logs for the test period: no phone
      numbers, email addresses, message text or patient names.
- [ ] Look through the browser console on the test devices: no patient
      details logged.

Tester: ______________________ Date: ______________

---

## 6. Sign-off before production

Production migrations and deployment start only after this is signed.

| Item | Answer |
| --- | --- |
| Sections 1 to 5 all pass, or each failure is listed below with the owner's written acceptance | [ ] Yes |
| Failures accepted, and why | |
| Every production device updated to the release build before `20260925100200` is applied in production | [ ] Yes |
| A production backup was taken just before the production migrations | [ ] Yes |
| Production migrations applied in the same order as section 2.2, and section 2.3 re-run on production (except the idempotency and role sign-in checks, which use test accounts) | [ ] Yes |
| If production already had any `20260924110000`-or-later file applied before `20260924105900`, the backfill was applied with `supabase db push --include-all` (the CI `migrate-prod` job runs `supabase db push --linked` without it and would stop) | [ ] Yes [ ] Not needed |
| Production deployment made after the production migrations completed | [ ] Yes |

Release owner: ______________________ Date: ______________

Owner: ______________________ Date: ______________
