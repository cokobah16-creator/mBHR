# Database access rules (RLS matrix)

Status: **release blocker, owner decision #4**. The database rules follow the
same role and permission matrix as the app (`src/auth/roles.ts`).

Migrations (apply in order, all new):

| File | What it does |
| --- | --- |
| `20260924110000_rls_permission_helpers.sql` | Permission helpers, the server copy of the matrix, a trigger for locked columns, and migration-only helpers |
| `20260924110100_rls_clinical_core.sql` | Clinical record, queue, labs, pharmacy and stock, scheduling, audit log. Also fixes the FHIR version-history trigger |
| `20260924110200_rls_staff_conflicts_messaging.sql` | Staff accounts, conflict review, staff messaging (Palaver), organisation-scoped clinical tables |
| `20260924110300_rls_patient_portal.sql` | Portal tables, storage buckets, legacy RPC grants, and new portal RPCs |
| `20260924110400_rls_verify_phi_lockdown.sql` | Stops the deploy if any PHI table below lets anon in or has an always-true rule. Drops the migration-only helpers |

The migrations were run against a local PostgreSQL 16 with Supabase-style
`auth`, `storage` and roles. They were tested with both the column types in
the migration files (text `app_users.id`) and the production types (uuid
`app_users.id` and the `user_role` enum), and replayed twice to check they are
idempotent. A 73-case role-by-role test passed on both variants. It covered
anon, guest, every staff role, linked and unlinked portal patients, approvals,
message spoofing, locked columns and the RPCs.
After review fixes (conflict decisions, locked classification and lab result
values, patient name/photo lock, the five FHIR lists, verified-contact
self-registration), the migrations were re-applied on the text-id schema and
those cases re-checked by hand. The test scripts are not in the repository;
re-run the section 7 checks on a staging project before release.

## 1. One matrix, two copies. Change them together

| Where | What |
| --- | --- |
| `src/auth/roles.ts` → `ROLE_PERMISSIONS` | App (UI and action checks) |
| `public.app_role_has_permission(role, permission)` | Database (every policy below) |

**Any change to a role's permissions must change both in the same pull
request.** Reviewers: if a diff touches one and not the other, block it.
(Suggested CI guard: see "Follow-ups".)

Also mirrored in the database:

| App | Database |
| --- | --- |
| `roleCanApprove()` in `src/features/conflicts/conflictPermissions.ts` | `public.app_role_can_approve()` |
| `getRoleTargets()` in `src/services/palaverRoom.ts` | `palaver_broadcasts_select` policy |

Current matrix (✓ = granted). `lab_review` is new (owner decision #2). The app
side is being added to `roles.ts` separately.

| Permission | admin | doctor | nurse | volunteer | pharmacist | auditor | lead_clinician | guest |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| register | ✓ | ✓ | ✓ | ✓ | | | ✓ | |
| vitals | ✓ | ✓ | ✓ | ✓ | | | ✓ | |
| consult | ✓ | ✓ | | | | | ✓ | |
| dispense | ✓ | | | | ✓ | | | |
| inventory | ✓ | | | | ✓ | | | |
| export | ✓ | | | | | ✓ | ✓ | |
| users | ✓ | | | | | | | |
| approve_phi_conflicts | ✓ | | | | | ✓ | ✓ | |
| audit_access | ✓ | | | | | ✓ | ✓ | |
| resolve_conflicts | ✓ | ✓ | ✓ | | | ✓ | ✓ | |
| lab_review | ✓ | ✓ | | | | | ✓ | |

## 2. Who the database thinks you are

| Caller | How it is identified | Helper |
| --- | --- | --- |
| Staff | `app_users.id = auth.uid()`. The role is `app_users.role`. A row flagged inactive (`is_active` false or 0, `active` false, `disabled`, `deactivated`, `deactivated_at`, `disabled_at`) counts as no role | `app_current_role()`, `app_has_permission(p)`, `app_has_any_permission(ps)`, `app_is_staff()` |
| "Station staff" | Any of register, vitals, consult, dispense | `app_is_station_staff()` |
| Portal patient | `patients.auth_uid = auth.uid()`, or `patient_portal_users.id` = `auth.uid()`, the `app_metadata.portal_user_id`, or the verified phone claim. **In every case the portal account must be active and staff must have enabled portal access for the patient (`patients.portal_enabled`).** | `app_portal_patient_ids()`, `app_portal_user_ids()` |
| Organisation member | `user_org_sites.user_id = auth.uid()` | `app_org_ids()` |
| Anon key, no user | Nothing. Every helper returns false or an empty set. Every PHI table has had all anon privileges revoked | none |
| Device-only PIN session | No Supabase user, so the same as anon. The device works offline and syncs only after an online sign-in (owner decision #3) | none |

All helpers are `SECURITY DEFINER`, `STABLE`, with `search_path` pinned, and
only reveal facts about the caller. `is_staff()` and `has_role()` keep their
signatures and now delegate to these helpers. They were `SECURITY INVOKER`, and
the `app_users` read policy that called `is_staff()` re-entered `app_users`
row-level security on every check.

`public.staff_roles` is legacy. The app reads it once when a new device signs
in, but no access decision uses it.

## 3. Table × operation

Abbreviations: **staff** = `app_is_staff()`; **station** = register, vitals,
consult or dispense; **own** = the row's patient is one of the caller's portal
patients; **P(x)** = holds permission x. "none" = no client may do it (the
service role and `SECURITY DEFINER` functions still can). Every policy is
`TO authenticated`. Anon has no privilege on any table listed here.

### Clinical record

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| patients | staff, or own record | P(register) | P(register \| vitals \| consult); own record (contact details only, see locked columns) | P(users) |
| visits | staff; own **closed** visits | station | station | P(users); P(consult) only for a visit with no vitals and no consultation (the `addVisit` rollback) |
| vitals | staff; own where `portal_visible` | P(vitals) | P(vitals) | P(users) |
| consultations | staff; own where `portal_visible` | P(consult) | P(consult) | P(users) |
| dispenses | staff; own where `portal_visible` | P(dispense) | P(dispense) | P(users) |
| prescriptions | staff | P(consult \| dispense)¹ | P(consult \| dispense) | P(users) |
| patient_allergies | staff; own | station | station | P(users \| consult) |
| patient_preferences | staff; own | station | station | P(users) |
| care_tasks | staff | station | station | P(users) |
| triage_records | staff | P(vitals \| consult) | P(vitals \| consult) | P(users) |
| clinical_alerts | staff | P(vitals \| consult) | P(vitals \| consult) | P(users) |
| patient_merges | staff | P(register) | none (append-only merge audit) | none |
| immunizations, conditions, sdoh_observations, procedures, document_references, care_plans, goals, service_requests | staff; own | P(consult) | P(consult) | P(users) |
| lab_orders | staff; own | P(consult) | P(vitals \| consult) | none |
| lab_results | staff; own **reviewed** results only² | P(vitals \| consult), unreviewed rows only unless P(lab_review) | **P(lab_review)** (result value, unit, range and date are locked) | none |
| audit_logs | P(audit_access) | staff | none | none |

¹ Pharmacy devices push prescriptions with an upsert, and Postgres checks an
upsert against the INSERT rule.
² There is no `released_to_patient` column yet. Until there is, "reviewed" is
the release gate.

### Queue, flow, stock

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| queue, tickets, queue_metrics | staff | station | station | station |
| stage_events | staff | station | station | P(users) |
| inventory, pharmacy_items, pharmacy_batches, stock_batches, stock_moves_rx, inventory_discrepancies | staff | P(inventory \| dispense) | P(inventory \| dispense) | P(inventory) |
| inventory_nm, stock_moves_nm, alerts_nm, restock_sessions | staff | station or P(inventory) | station or P(inventory) | P(inventory) |

### Scheduling and outbound messages

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| appointments (including televisits) | staff; own | P(register) | P(register) | none |
| waitlist | staff | P(register) | P(register) | none |
| medication_reminders | P(dispense \| consult \| vitals); own | P(dispense) | P(dispense) | P(dispense) |
| outbound_messages | P(register \| dispense \| consult \| vitals) | none (edge function) | none | none |

### Staff, conflicts, messaging, organisations

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| app_users | own row; staff (directory) | P(users) | P(users) | P(users) |
| app_users: `admin_permanent` rows (restrictive) | as above | cannot create | cannot change | cannot delete |
| staff_roles | own row | none | none | none |
| conflict_resolutions | P(resolve_conflicts \| approve_phi_conflicts) | P(resolve_conflicts), open rows only (`pending` or `needs_approval`, no decision, resolver or approver) | same as SELECT, plus the decision/approval trigger³ | none |
| conflict_audit_logs, conflict_change_deltas | P(resolve_conflicts \| approve_phi_conflicts \| audit_access) | P(resolve_conflicts \| approve_phi_conflicts) | none | none |
| archived_conflict_summaries | P(audit_access) | none (retention job) | none | none |
| auto_resolution_rules | staff | P(users) | P(users) | P(users) |
| site_conflict_settings, data_retention_policies | staff (was every signed-in account) | unchanged (admin/auditor) | unchanged | unchanged |
| palaver_messages | staff and a participant | sender = caller, and may message staff⁴ | participants (read and archive flags only) | sender |
| palaver_broadcasts | staff in the target audience, the sender, and posters | P(consult \| users), sender = caller | P(consult \| users) (hide only) | P(consult \| users) |
| palaver_broadcast_reads | own rows | own rows | own rows | own rows |
| user_org_sites | own rows; P(users) within own organisations | P(users) within own organisations | own row (default site only); P(users) within own organisations | P(users) within own organisations |
| patient_flags | staff in the organisation | P(register) in the organisation | P(register) in the organisation | none |
| referrals, consultation_reviews⁵ | staff in the organisation | P(consult) in the organisation | P(consult) in the organisation | none |
| follow_up_schedules | staff in the organisation | P(vitals \| consult) in the organisation | P(vitals \| consult) in the organisation | none |

³ `app_conflict_approval_guard` covers deciding (recording a
`resolution_strategy`, or closing as `resolved`, `ignored` or
`auto_resolved`), leaving `needs_approval` (approve or reject) and setting
`approved_by` or `second_approver_id`. It requires:
- `approve_phi_conflicts` to decide, approve or reject a high-PHI conflict,
  otherwise `resolve_conflicts` (same as `canResolveConflict()`);
- `auto_resolved` only with an active `auto_resolution_rules` row that matches
  the conflict's entity type, conflict type and strategy, and has
  `phi_allowed` when the conflict is high-PHI;
- the `required_approver_role` hierarchy (lead_clinician → lead, auditor or
  admin; auditor → auditor or admin; admin → admin) for approvals, rejections
  and for any close to `resolved` other than `ignore`, so the approval step
  cannot be skipped;
- `approved_by` and `second_approver_id` equal to the signed-in user;
- two different people for dual approval.

The conflict's classification (`phi_sensitivity`, `required_approver_role`,
`conflict_type`, `entity_type`, `entity_id`, `patient_id`, `candidate_ids`,
`conflict_details`, `site_id`) is locked after it is reported
(`app_guard_conflict_classification`). Without that, a resolver could lower
the sensitivity or clear the required approver and then decide the conflict
alone. Not enforced by the database: whether a site requires dual approval
(`site_conflict_settings`); the app still checks that.

⁴ `canMessageStaff()`: register, vitals, consult, dispense, inventory or users.
⁵ consultation_reviews can also be read by the reviewed and the reviewing
doctor.

### Patient portal

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| patient_portal_users | staff; own account (also while suspended) | P(register) | P(register); own account (settings only) | P(users) |
| patient_portal_sessions | own sessions; P(users) | own | own; P(users) | own; P(users) |
| patient_portal_access_logs | P(audit_access); own | own | none | none |
| patient_portal_preferences | staff; own | own | own | own |
| patient_secure_messages | staff; own | P(consult) with `from_patient` false; own with `from_patient` true | P(consult); own (read and archive flags only) | P(consult) |
| patient_messages (legacy) | staff; own | P(consult) as 'staff'; own as 'patient' | P(consult); own (flags only) | P(consult) |
| patient_notifications | staff; own | P(register) | P(register); own (read flags only) | none |
| patient_appointment_requests | staff; own | own, `pending`, unreviewed | P(register); own `pending` → `cancelled` | none |
| patient_documents | staff; own | P(register \| vitals \| consult); own | P(register \| vitals \| consult) | P(consult \| users); **own**⁶ |
| patient_consent_records | staff; own | P(register); own | P(register) (revocation) | none |
| patient_data_sharing_preferences | staff; own | P(register); own | P(register); own | none |
| tefca_access_logs | P(audit_access); own | staff | none | none |
| patient_submitted_data | staff; own | P(consult); own, pending and unreviewed | P(consult); own while pending | none |
| record_visibility_log | staff | P(vitals \| consult \| dispense) | none | none |
| portal_enrollment_settings | staff | P(users) | P(users) | none |
| patient_lab_results (patient-visible copy) | staff; own | **P(lab_review)** | P(lab_review) | P(users) |
| patient_medical_conditions | staff; own | P(consult); own | P(consult) | P(consult) |
| patient_referrals | staff; own | P(consult) | P(consult) | none |
| otp_rate_limits | none | none | none | none |

⁶ **patient_documents decision.** The product lets a patient delete their own
uploads (`DocumentUpload.tsx` has a delete action), so a portal patient may
delete document rows and files for their own record. No column in every
schema version reliably marks "uploaded by the patient", so a patient can also
delete a staff-uploaded file in their folder. See Follow-ups.

### Storage

| Bucket | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| photos | staff | P(register \| vitals \| consult) | P(register \| vitals \| consult) | P(register \| users) |
| patient-documents (`<patient_id>/...`) | staff; own folder | P(register \| vitals \| consult); own folder | none | P(consult \| users); own folder |

### Locked columns (trigger `app_guard_immutable_columns`)

API callers without the exempt permission get an error if they change these
columns. The service role and `SECURITY DEFINER` functions are exempt.

| Table | Exempt | Locked columns |
| --- | --- | --- |
| patients | register | id, auth_uid, portal_enabled, contact_verified, auto_enrolled, auto_enrolled_at, portal_invited_at, fhir_id, dob, sex, family_id, given_name, family_name, photo_url, created_at |
| patient_portal_users | register | id, patient_id, account_status, phone_number, email, phone/email verified, OTP fields, lockout fields |
| patient_secure_messages | consult | id, patient_id, staff_id, subject, body, from_patient, from_name, created_at |
| patient_messages | consult | id, patient_id, sender_type, sender_id, subject, message_body, parent_message_id, created_at |
| patient_notifications | register | content columns |
| patient_appointment_requests | register | id, patient_id, review fields, scheduled_appointment_id, created_at |
| palaver_messages | none | everything except is_read, read_at, is_archived, updated_at |
| palaver_broadcasts | none | everything except is_active, expires_at |
| user_org_sites | users | user_id, org_id, site_id |
| lab_results | none | id, order_id, result_value, result_unit, reference_range, result_date, created_at |
| conflict_resolutions | none | id, patient_id, conflict_type, entity_type, entity_id, candidate_ids, phi_sensitivity, required_approver_role, conflict_details, site_id, created_at |

### RPCs (new)

| Function | Callable by | Purpose |
| --- | --- | --- |
| `portal_session_check(token, extend_until?)` | anon, authenticated | Validates or refreshes one portal session by its token. Returns no row for an unknown token. Deactivates a session more than 5 minutes past expiry. Caps extensions at 24 hours |
| `portal_session_end(token)` | anon, authenticated | Portal logout |
| `portal_link_patient_record(dob, given?, family?, phone?)` | authenticated | Links the signed-in portal account to its clinic record using only an email or phone that Supabase Auth has **verified**, plus a matching date of birth, and only when staff have enabled portal access. With no match it creates a self-registered record, but only for an account with a verified email or phone (status `contact_not_verified` otherwise), and it stores only the verified phone. Returns `{status, patient_id?}` |

The legacy `SECURITY DEFINER` functions `create_patient_notification`,
`log_patient_portal_access`, `patient_has_portal_account` and
`get_patient_dashboard_counts` could be called by anyone, including anon. They
are now for the service role only. No app code calls them.

## 4. Changes and reasons

### Anonymous access to PHI (all removed)

- **patients**: `Allow anonymous patient lookup for portal registration` (anon
  `SELECT USING (true)`) and `Allow anonymous patient registration` (anon
  `INSERT WITH CHECK (true)`). With the public anon key, anyone could read and
  write the whole patient register.
- **patient_portal_sessions**: `Anyone can validate/refresh session by token`
  and `Sessions viewable/insertable/updatable`. These were `USING (true)`
  policies with no role, so every session token was readable by anyone.
  Replaced by `portal_session_check` and `portal_session_end`.
- **patient_portal_users**:
  - `Portal users can view/update own data` and `Allow insert for portal
    users` were `USING (true)` with no role.
  - Anon `register` and `verify` policies let anyone create a portal account
    for any `patient_id` and flip it to active. Through the phone-claim path,
    that gave the patient's records to whoever controlled the phone number.
- **patient_messages, patient_notifications, patient_submitted_data,
  record_visibility_log, portal_enrollment_settings**: `USING (true)` policies
  with no role. For example, anyone could change the portal enrolment settings.
- **palaver_messages, palaver_broadcasts, palaver_broadcast_reads**:
  `20251214163828` granted anon full access. The `20260520` lockdown dropped
  policies under names that never existed, so those rules stayed live.
- **app_users**: `service_role_manage_permanent_admins` was `FOR ALL TO public`
  with `... ELSE true`. Anyone, including anon, could insert, change or delete
  any non-permanent staff row, for example make themselves an admin.
- **tefca_access_logs**: anon `INSERT WITH CHECK (true)`.
- **patient_portal_access_logs**: anon insert.
- **Storage**:
  - `Public can view photos` (`TO public`) was still live because the lockdown
    dropped `photos_public_read`, a name that never existed.
  - Any signed-in account, including portal patients, could upload, replace
    or delete patient photos.

### Rules that disagreed with the app

- **patient_data_sharing_preferences**, **immunizations**, **conditions**,
  **sdoh_observations**: `patient_id = auth.uid()` compared a patient record id
  with a login id, so a patient could never see or save their own rows. They
  now use the portal link.
- **Portal identity**: four different identity checks across tables. They are
  now one helper, and it honours `portal_enabled` (owner decision #5: portal
  access is decided by the database).
- **Portal reads** now honour `portal_visible` on vitals, consultations and
  dispenses. Before, a record hidden from the portal was still readable
  through the API.
- **Portal lab results** show only reviewed results, so unreviewed critical
  values are never shown to patients (owner decisions #2 and #5).
- **Core clinical tables** had `is_staff()` `FOR ALL` rules. Auditors, and any
  other non-guest role, could write vitals, consultations and dispenses. Writes
  now need the matching permission.
- **conflict_resolutions** had admin-only, admin/doctor/nurse and a broad
  five-role `FOR ALL` policy at the same time, and any of them could approve
  anything. Now resolvers read and write, and the trigger enforces approvals.
  PIN-only callers get nothing.
- **lab_orders / lab_results**: writes follow the app (order: consult; status
  and results: vitals or consult). Review is limited to the new `lab_review`
  permission. The old rule let any admin, doctor or nurse update any field.
- **appointments / waitlist**: the old rules allowed the `guest` role and left
  out `lead_clinician`. Writes now need `register` (`canManageAppointments`).
- **medication_reminders**: pharmacy-only writes, as in the app. The broad
  `FOR ALL` rule for four roles is removed.
- **outbound_messages**: any signed-in account, portal patients included,
  could read and write every SMS with its phone number. Staff can now read
  only, and the edge function writes.
- **clinical_alerts, patient_documents (staff), patient_lab_results,
  patient_referrals, patient_medical_conditions**: the staff rules read a role
  from `auth.jwt() ->> 'role'` or `raw_app_meta_data`. That role is always
  `authenticated` or never set, so staff never had access.
- **otp_rate_limits**: the policy named "Service role can manage…" was really
  `TO authenticated USING (true)`. Any signed-in account could read phone
  identifiers and reset its own OTP limit.
- **user_org_sites**: any member could add anyone to their organisation, which
  also grants read access to its patient flags and referrals. The policy also
  queried its own table. Now only `users` manages membership.
- **app_users**: only `users` writes. A user reads their own row, and staff
  read the directory. Permanent-admin rows are service-role only.
- **procedures, document_references, care_plans, goals, service_requests**:
  the same `patient_id = auth.uid()` mistake as immunizations, and staff rules
  with a hard-coded role list (volunteers could update, lead_clinician was
  left out). They now follow the same rule as immunizations.
- **patients (portal self-edit)**: a portal patient could change their own
  name and photo through the API. UpdatePHR.tsx never offers that; names and
  the photo staff use to recognise the patient are now locked for callers
  without `register`.
- **lab_results (review)**: a reviewer could rewrite the recorded value,
  unit, range or date while marking it reviewed. These are now locked; the
  app only sets `reviewed_by` / `reviewed_at`.
- **conflict_resolutions (decisions)**: a nurse could resolve a high-PHI
  conflict directly, insert a conflict already marked resolved, or lower a
  conflict's sensitivity / clear its required approver and then approve it.
  See ³ above.
- **portal_link_patient_record**: an account with no verified email or phone
  could create patient records carrying any typed phone number. Creation now
  needs a verified contact, and only the verified phone is stored.
- **FHIR version trigger**: `fhir_record_resource_version()` ran as the caller
  and inserted into `resource_versions`, which only the service role may write.
  So every staff write to patients, visits, dispenses, prescriptions and
  allergies was refused. It now runs as the table owner.
- **is_staff() / has_role()** now delegate to the `SECURITY DEFINER` helpers.
  This ends the RLS re-entry on `app_users`.

### Policies are now reset, not patched

Each listed table first loses **all** of its policies, whatever their names.
Then it gets one clean set. Earlier migrations left duplicates under many
names, which is how the `USING (true)` rules survived the May lockdown. The
final migration fails the deploy if any PHI table:
- has row-level security off;
- has a policy for anon or public;
- has a non-service `USING (true)` or `WITH CHECK (true)` rule; or
- still grants anon a table privilege.

## 5. What the app must change

These are also listed in the change report.

1. **Portal sign-up and linking** (`src/hooks/useAuth.ts` `signup()`,
   `registerPatientPortalAccount` in `src/services/patientPortalAuth.ts`,
   `unifiedPortalEnrollment.ts`, `portalEnrollment.ts`): stop querying and
   inserting `patients` as anon or as the new patient. Call
   `supabase.rpc('portal_link_patient_record', { p_dob, p_given_name,
   p_family_name, p_phone })` after sign-in. Show a plain message for each
   status, for example "Ask clinic staff to enable portal access".
2. **Portal sessions** (`src/utils/sessionManager.ts`): replace the
   SELECT/UPDATE on `patient_portal_sessions` with
   `rpc('portal_session_check', { p_session_token, p_extend_until })` and use
   `rpc('portal_session_end')` on logout.
3. **Staff messaging (Palaver)** needs an online staff sign-in. `sender_id` and
   `recipient_id` must be Supabase user ids (`app_users.id`), not local ULIDs.
   Say so in the UI when the device is PIN-only.
4. **Sync with role-limited writes** (`src/sync/adapter.ts`,
   `src/sync/mbhrAdapter.ts`, `src/services/enhancedSync.ts`): a row the
   signed-in person may not write, such as a nurse's vitals pushed by a
   pharmacist on a shared tablet, is now refused.
   - `adapter.ts` already keeps refused rows unsent and retries. It should show
     "waiting for an authorised person to sync" instead of retrying silently.
   - `mbhrAdapter.ts` pushes whole tables in one upsert, so one refused row
     blocks the batch. It should push only changed rows, one table and row at
     a time.
   - `app_users` rows should be pushed only by `users` holders.
5. **Conflict reporting by non-resolvers**
   (`src/sync/queueConflicts.ts` / `conflictQueue.createConflict`): volunteers
   and pharmacists cannot insert or read `conflict_resolutions`. Report
   "not queued" honestly (already modelled as `notQueued`), or add a
   service-side reporting endpoint.
6. **Lab review** (`LabResultsDashboard.tsx`, `labs.ts`): gate review on
   `lab_review`, not `consult`. A patient sees a result only after review.
7. **Photos** (`src/utils/photoStorage.ts`): the bucket is private. Use
   `createSignedUrl` instead of `getPublicUrl`, which cannot work.
8. **Staff role source**: new-device online sign-in (`src/stores/auth.ts`)
   reads `staff_roles` and defaults to `volunteer`. The database decides on
   `app_users.role`, so read the role from `app_users` to avoid the UI offering
   actions the server will refuse.
9. **Conflict approvals** (`src/features/conflicts/conflictActions.ts`,
   `ConflictDashboard.tsx`): `approved_by` / `second_approver_id` must be the
   Supabase user id. `actor.id` comes from `currentUser.id`, which is the
   Supabase id only for accounts created by an online sign-in; a staff
   account created locally has a device id and its approvals are refused.
   Use the Supabase session user id for these columns.
10. **Portal sign-up**: handle the new `contact_not_verified` status from
    `portal_link_patient_record` ("Confirm your email or phone number, then
    try again").
11. **Record visibility for lab results** (`src/services/recordVisibility.ts`):
    updating `lab_results.portal_visible` now needs `lab_review`.
12. **Existing linked portal accounts** whose patient has
   `portal_enabled = false` lose portal access until staff enable it (owner
   decision #5). Tell clinic staff before release.

## 6. Follow-ups (not done here)

- Add a CI test that parses `app_role_has_permission` from the migration and
  compares it with `ROLE_PERMISSIONS` in `src/auth/roles.ts`.
- Add `released_to_patient` / review state to `lab_results` and retire the
  separate `patient_lab_results` table (owner decision #5). Then change the
  portal rule from "reviewed" to "released".
- Add an "uploaded by patient" marker to `patient_documents` so patients can
  delete only their own uploads.
- `organizations`, `sites`, `outreach_events`, `event_staff_assignments`,
  `prescription_templates`, `protocol_library`, `site_formulary`,
  `doctor_analytics`: not PHI, and left unchanged. Any organisation member can
  still edit them. Limit writes to `users` in a later pass (keep the public
  read of active sites and events).
- `gamification_wallets` lets a user update their own token balance (not PHI).
- Staff who may read `patient_portal_users` or the `app_users` directory see
  every column, including `otp_secret` and any key or PIN material stored on
  `app_users`. Row rules cannot hide columns. Move secrets to a service-only
  table, or replace the table-level SELECT grant with column grants.
- Triage (owner decision #6): any `vitals` holder may still update
  `triage_records.priority`. Once the clinical rule is agreed, add a trigger
  so that only a clinician can downgrade urgent status, and must record a
  reason.
- `lab_results.interpretation` still has a database default of `'normal'`.
  Owner decision #2 removes automatic "Normal" in the app. Dropping the
  default is a clinical-logic change for the clinical reviewer to approve.
- `audit_logs` rows are appended by any staff member and `actor_role` is not
  checked against the caller, so a row can claim another role. Add an
  `actor_id` defaulted from `auth.uid()` (and a check) when the audit log is
  server-backed.
- `lab_results.reviewed_by` is not checked against the caller (the app may
  still send device user ids). Once the app sends the Supabase user id, add
  `reviewed_by = auth.uid()` to the review rule.
- Dual approval for patient merges (`site_conflict_settings`) is enforced by
  the app only.
- `notifications` (ticket notifications) still has the older `is_staff()`
  read/write rule; no client uses it.
- Prescriptions allow INSERT for `dispense` only because of the upsert sync.
  Once prescriptions are server-backed (owner decision #5), limit INSERT to
  prescribers.

## 7. Checking a live database

```sql
-- Any PHI policy for anon/public or always true? (should return no rows)
select tablename, policyname, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and ('anon' = any(roles) or 'public' = any(roles)
        or qual = 'true' or with_check = 'true')
   and not roles = array['service_role']::name[];

-- What does the database think of me?
select public.app_current_role(), public.app_has_permission('lab_review');
```
