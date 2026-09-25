# Database access rules (RLS matrix)

Status: **release blocker, owner decision #4**. The database rules follow the
same role and permission matrix as the app (`src/auth/roles.ts`).

Migrations (apply in order, all new):

| File | What it does |
| --- | --- |
| `20260924105900_portal_access_backfill.sql` | Runs first. One-off portal access backfill: turns `portal_enabled` on only for records with a verified portal account already linked to them, and logs each record in the append-only `portal_access_backfill_log` (see section 4) |
| `20260924110000_rls_permission_helpers.sql` | Permission helpers, the server copy of the matrix, a trigger for locked columns, and migration-only helpers |
| `20260924110100_rls_clinical_core.sql` | Clinical record, queue, labs, pharmacy and stock, scheduling, audit log. Also fixes the FHIR version-history trigger |
| `20260924110200_rls_staff_conflicts_messaging.sql` | Staff accounts, conflict review, staff messaging (Palaver), organisation-scoped clinical tables |
| `20260924110300_rls_patient_portal.sql` | Portal tables, storage buckets, legacy RPC grants, and new portal RPCs |
| `20260924110400_rls_verify_phi_lockdown.sql` | Stops the deploy if any PHI table below lets anon in or has an always-true rule. Drops the migration-only helpers |
| `20260925100000_sync_authority_foundation.sql` | Previous definition of `public.app_role_has_permission`: adds the `queue`, `portal_manage`, `merge_patients` and `lab_release` permission keys. Later migrations (`20260925100100` to `20260925100500`) use them. Also: server clock and `row_version` on patients, queue, prescriptions and pharmacy tables; `command_receipts`; server-owned patient columns (`merged_*`, `portal_enabled_changed_*`) and `canonical_patient_id()`; `app_portal_patient_ids()` skips merged-away records |
| `20260925100100_portal_access_authoritative.sql` | Portal access decided by the server: `set_patient_portal_access()`, `portal_access_status()`, the append-only `patient_portal_access_events`, auto-enrolment on insert only |
| `20260925100200_queue_tickets_authoritative.sql` | Queue tickets numbered by the server (`queue_tickets`, leases, counters, `issue_queue_ticket()`, `lease_ticket_block()`); an upload cannot change a queue row's status or stage (status changes arrive as `queue_transitions`, applied by the server); queue writes need `queue` |
| `20260925100300_patient_merge_authoritative.sql` | Patient merges through `merge_patients()` only; `patient_merges` becomes an immutable history readable by `merge_patients` / `audit_access` holders; late writes for a merged-away record land on the kept one |
| `20260925100400_pharmacy_stock_ledger.sql` | Pharmacy stock ledger: balances written only by the `rx_*` RPCs, append-only `stock_movements`, `stock_discrepancies`, one opening-stock device per site; prescriptions inserted by prescribers only |
| `20260925100500_lab_results_release.sql` | Lab results reach the portal only after review **and** release (`lab_review_result`, `lab_release_result`, `lab_withhold_result`); patients read them only through `portal_my_lab_results()` |
| `20260925100600_registration_lead_portal_invite.sql` | **Latest definition of `public.app_role_has_permission`**: adds the `registration_lead` role (register, queue, portal_manage, portal_invite; no vitals) and the `portal_invite` permission (registration_lead, lead_clinician, admin). `app_users.role` accepts `registration_lead` (enum label, or a widened `app_users_role_check` on the text schema). `app_is_staff()` counts it. `queue_transitions` uploads now need the `queue` permission instead of a list of role names (same roles, plus registration_lead). New append-only `portal_invitation_events`. `portal_invitation_begin()` / `portal_invitation_finish()` (service role only) check and record every invitation that `send-sms-reminder` and `send-otp-email` send. Changing `patients.portal_invited_at` needs `portal_invite` |
| `20260925100700_patient_document_ownership.sql` | patient_documents: the server stamps `upload_source` / `uploaded_by_user_id`; soft delete (`deleted_at` / `deleted_by`); `portal_remove_document()` RPC; clinic records are never deleted or soft-deleted through the API; a document's file path cannot change; patient-documents storage rules keep the files of documents |

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

The Wave B migrations (`20260925100100` to `20260925100500`) have pgTAP
tests in `supabase/tests/` (portal access, patient merges, pharmacy ledger,
lab release; run with `supabase test db`, see `supabase/tests/README.md`).
`20260924105900`, `20260925100600` and `20260925100700` have them too:
`portal_access_backfill.test.sql`, `registration_lead_portal_invite.test.sql`
and `patient_document_ownership.test.sql`.
Their statements were checked against a local PostgreSQL 16 with every
migration applied, using a small stand-in for the pgTAP functions because
pgTAP was not installed there. They have not yet been run under
`supabase test db` itself. Queue tickets (`20260925100200`) have no pgTAP
file yet.

## 1. One matrix, two copies. Change them together

| Where | What |
| --- | --- |
| `src/auth/roles.ts` → `ROLE_PERMISSIONS` | App (UI and action checks) |
| `public.app_role_has_permission(role, permission)` | Database (every policy below). The latest definition is in `supabase/migrations/20260925100600_registration_lead_portal_invite.sql`; it replaces the ones in `20260925100000_sync_authority_foundation.sql` and `20260924110000_rls_permission_helpers.sql` |

**Any change to a role's permissions must change both in the same pull
request.** Reviewers: if a diff touches one and not the other, block it.
`src/auth/roleMatrixParity.test.ts` compares the two and fails when they
differ.

Also mirrored in the database:

| App | Database |
| --- | --- |
| `roleCanApprove()` in `src/features/conflicts/conflictPermissions.ts` | `public.app_role_can_approve()` |
| `getRoleTargets()` in `src/services/palaverRoom.ts` | `palaver_broadcasts_select` policy |

Current matrix (✓ = granted). `lab_review` is new (owner decision #2).
`queue`, `portal_manage`, `merge_patients` and `lab_release` were added in
`20260925100000_sync_authority_foundation.sql`. The `registration_lead` role
and `portal_invite` were added in
`20260925100600_registration_lead_portal_invite.sql` (and in `roles.ts`).

Confirmed role policy:
- `queue` = station staff who move patients through the queue: volunteer,
  registration_lead, nurse, doctor, lead_clinician and admin, plus
  pharmacists.
- `portal_manage` = register holders (they turn portal access on at
  registration).
- `merge_patients` = resolve_conflicts holders. This includes auditor and
  excludes volunteer and registration_lead.
- `lab_release` = the lab_review holders: doctor, lead_clinician, admin.
- `registration_lead` = register, queue, portal_manage and portal_invite. It
  has **no vitals**. Owner decision: the role is registration-focused, not
  clinical. It has the normal registration capabilities plus portal_invite,
  and vitals stay with staff explicitly assigned to that workflow.
- `portal_invite` = sending a patient portal invitation by SMS or email:
  registration_lead, lead_clinician and admin only. Volunteer, nurse,
  doctor, pharmacist, auditor and guest cannot send invitations. Volunteers
  still turn access on (`portal_manage`).

| Permission | admin | doctor | nurse | volunteer | registration_lead | pharmacist | auditor | lead_clinician | guest |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| register | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ | |
| vitals | ✓ | ✓ | ✓ | ✓ | | | | ✓ | |
| consult | ✓ | ✓ | | | | | | ✓ | |
| dispense | ✓ | | | | | ✓ | | | |
| inventory | ✓ | | | | | ✓ | | | |
| export | ✓ | | | | | | ✓ | ✓ | |
| users | ✓ | | | | | | | | |
| approve_phi_conflicts | ✓ | | | | | | ✓ | ✓ | |
| audit_access | ✓ | | | | | | ✓ | ✓ | |
| resolve_conflicts | ✓ | ✓ | ✓ | | | | ✓ | ✓ | |
| lab_review | ✓ | ✓ | | | | | | ✓ | |
| queue | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| portal_manage | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ | |
| merge_patients | ✓ | ✓ | ✓ | | | | ✓ | ✓ | |
| lab_release | ✓ | ✓ | | | | | | ✓ | |
| portal_invite | ✓ | | | | ✓ | | | ✓ | |

## 2. Who the database thinks you are

| Caller | How it is identified | Helper |
| --- | --- | --- |
| Staff | `app_users.id = auth.uid()`. The role is `app_users.role`. A row flagged inactive (`is_active` false or 0, `active` false, `disabled`, `deactivated`, `deactivated_at`, `disabled_at`) counts as no role | `app_current_role()`, `app_has_permission(p)`, `app_has_any_permission(ps)`, `app_is_staff()`. `app_is_staff()` lists the staff roles by name; since `20260925100600` the list includes `registration_lead`. |
| "Station staff" | Any of register, vitals, consult, dispense | `app_is_station_staff()` |
| Portal patient | `patients.auth_uid = auth.uid()`, or `patient_portal_users.id` = `auth.uid()`, the `app_metadata.portal_user_id`, or the verified phone claim. **In every case the portal account must be active and staff must have enabled portal access for the patient (`patients.portal_enabled`).** Since `20260925100000`, a record merged into another one (`merged_into` set) is never a portal patient | `app_portal_patient_ids()`, `app_portal_user_ids()` |
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
`TO authenticated`. Anon has no privilege on any table listed here (the two
stock drift views are the exception; see their row).

### Clinical record

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| patients | staff, or own record | P(register) (portal access starts off, see server-owned columns) | P(register \| vitals \| consult); own record (contact details only, see locked columns). Portal access, merge columns and a linked sign-in are kept by the server | P(users) |
| visits | staff; own **closed** visits | station | station | P(users); P(consult) only for a visit with no vitals and no consultation (the `addVisit` rollback) |
| vitals | staff; own where `portal_visible` | P(vitals) | P(vitals) | P(users) |
| consultations | staff; own where `portal_visible` | P(consult) | P(consult) | P(users) |
| dispenses | staff; own where `portal_visible` | P(dispense); a prescription dispense (`prescription_id` or `batch_id` set) only through `rx_dispense` / `rx_import_history`⁷ | P(dispense); what a prescription dispense gave is kept⁷ | P(users) |
| prescriptions | staff | P(consult)¹, saved as `open` | none (status, dispensing and voiding only through the `rx_*` RPCs) | P(users) |
| patient_allergies | staff; own | station | station | P(users \| consult) |
| patient_preferences | staff; own | station | station | P(users) |
| care_tasks | staff | station | station | P(users) |
| triage_records | staff | P(vitals \| consult) | P(vitals \| consult) | P(users) |
| clinical_alerts | staff | P(vitals \| consult) | P(vitals \| consult) | P(users) |
| patient_merges | P(merge_patients \| audit_access) (was all staff: rows hold snapshots of both records) | none (only `merge_patients()`) | none (trigger refuses, even for the owner) | none (trigger refuses DELETE and TRUNCATE, even for the owner) |
| immunizations, conditions, sdoh_observations, procedures, document_references, care_plans, goals, service_requests | staff; own | P(consult) | P(consult) | P(users) |
| lab_orders | staff (no portal read²) | P(consult) | P(vitals \| consult) | none |
| lab_results | staff (no portal read²) | P(vitals \| consult), unreviewed rows only unless P(lab_review) | **P(lab_review)** (result value, unit, range and date are locked; release columns only through the release RPCs; changing the interpretation clears the review and release) | none |
| lab_result_release_log | P(lab_review \| audit_access) | none (only the review / release / withhold RPCs) | none | none |
| audit_logs | P(audit_access) | staff | none | none |
| command_receipts | own rows (`actor_id` = caller); P(audit_access) | none (only the command RPCs) | none | none |

¹ Only prescribers (`consult`) insert prescriptions since
`20260925100400_pharmacy_stock_ledger.sql` (before, `dispense` could too,
because pharmacy devices pushed prescriptions with an upsert). The guard
trigger saves every new prescription as `open`. The app still lets nurses
write prescriptions; a nurse's prescription reaches the server only through
a prescriber's sync on the same device or with the `rx_dispense` call that
carries it (open clinical question, see
`docs/clinical/CLINICAL_LOGIC_CHANGES.md`).
² Since `20260925100500_lab_results_release.sql`, portal patients cannot
SELECT `lab_orders` or `lab_results` at all. They read results only through
`portal_my_lab_results()`: reviewed, released, not withheld and not
superseded results for their own records (portal access on, not merged
away). Order notes and staff ids are never returned. Before this migration,
a reviewed but unreleased result (including a critical one) was readable by
the patient.
⁷ `rx_guard_dispense`: an API insert with `prescription_id` or `batch_id`
set is refused (42501). An update keeps `prescription_id`, `item_id` and
`batch_id`, and for a prescription dispense also the quantity, patient,
medicine name and dispensed at / by. Staff can still change portal
visibility. Visit dispensing (no prescription) is unchanged.

### Queue, flow, stock

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| queue | staff | P(queue) | P(queue) (an upload cannot change status or stage, lower the priority or set the ticket, see server-owned columns) | P(queue) |
| queue_transitions | P(audit_access) | P(queue), and `uploaded_by = auth.uid()` (since `20260925100600`; before that it was a has_role list of the same roles without registration_lead); the server applies each row to its queue row and records `applied` / `reject_reason` | none (append-only trigger) | none (append-only trigger, also TRUNCATE) |
| queue_tickets | staff | none (only `issue_queue_ticket()`) | none | none |
| queue_ticket_leases | P(queue) | none (only `lease_ticket_block()`) | none | none |
| queue_ticket_counters | none | none | none | none |
| tickets, queue_metrics | staff | station | station | station |
| stage_events | staff | station | station | P(users) |
| inventory, stock_batches, stock_moves_rx, inventory_discrepancies | staff | P(inventory \| dispense) | P(inventory \| dispense) | P(inventory) |
| pharmacy_items | P(dispense \| inventory \| consult) | none (only `rx_register_item()`) | P(inventory): details only; `on_hand_qty` is kept by the server | none (deactivate with `rx_set_item_active()`) |
| pharmacy_batches (lots) | P(dispense \| inventory \| consult) | none (only `rx_receive_stock()`) | none | none |
| pharmacy_item_aliases | P(dispense \| inventory \| consult) | none (only `rx_register_item()`) | none | none |
| stock_movements (ledger) | P(dispense \| inventory) | none (only the `rx_*` RPCs) | none (trigger refuses, even for the owner) | none (trigger refuses DELETE and TRUNCATE, even for the owner)⁸ |
| stock_discrepancies | P(dispense \| inventory) | none (only `rx_dispense()`) | none (only `rx_resolve_discrepancy()`) | none |
| pharmacy_site_onboarding | P(inventory) | none (only `rx_receive_stock()` with `opening_balance`) | none | none |
| stock_balance_drift, stock_item_balance_drift (views) | anyone who can read lots and the ledger (`security_invoker`). Anon has no grant on these views | — | — | — |
| inventory_nm, stock_moves_nm, alerts_nm, restock_sessions | staff | station or P(inventory) | station or P(inventory) | P(inventory) |

`stock_balance_drift` and `stock_item_balance_drift` list any lot or medicine
whose balance differs from the sum of its ledger movements. Both must be
empty. Balances that existed before `20260925100400` have no movements, so
they show there until an opening balance or a count is recorded.

⁸ TRUNCATE is revoked from `authenticated` on `stock_movements`,
`stock_discrepancies`, `pharmacy_site_onboarding` and `pharmacy_item_aliases`,
and anon has no grant on them. `stock_movements` also has a TRUNCATE trigger,
so even the owner cannot empty the ledger without dropping the trigger first.

### Scheduling and outbound messages

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| appointments (including televisits) | staff; own | P(register) | P(register) | none |
| waitlist | staff | P(register) | P(register) | none |
| medication_reminders | P(dispense \| consult \| vitals); own | P(dispense) | P(dispense)³ | P(dispense) |
| outbound_messages | P(register \| dispense \| consult \| vitals) | none (edge function) | none | none |

³ Sending a reminder does not need `dispense`: the `send-sms-reminder` edge
function (service role) records the outcome after the provider answers
(`sent` + `sent_at` + the "accepted by sms provider" marker only after the
provider accepted it; `failed` with a code otherwise) and returns 409
`already_sent` for a reminder already marked sent. Devices no longer write
reminder status when sending. Staff "mark sent / mark failed" actions still
need `dispense`.

**Portal invitations and SMS purposes (`20260925100600`).** `send-sms-reminder`
takes a `purpose`:
- `medication_reminder` needs a stored `reminderId`.
- `patient_message` needs a `patientId` and no `reminderId`.
- `portal_invitation` needs a `patientId`; a `reminderId` is refused
  (`purpose_mismatch`).

Requests with no purpose (older app versions) get the purpose their ids
imply. Reminders and patient messages need a role in `SMS_SENDER_ROLES`
(pharmacist, doctor, nurse, lead_clinician, admin). A portal invitation needs
`portal_invite` instead.

`public.portal_invitation_begin()` checks three things: the sender's active
`app_users` role, the patient (on the server, not merged away, portal access
on) and the stored phone (or, for email, the stored email). It records the
request before anything is sent. If the check cannot run, nothing is sent.
`portal_invitation_finish()` records `sent` or `not_sent` with a code:
demo_mode, provider_rejected, sms_not_configured, invalid_recipient,
rate_limited or rate_limit_unavailable.

The function builds the invitation's text and link from the patient record.
Free text containing the registration link (`/patient/register`) is refused
as a patient message (`use_portal_invitation`). So a medication-reminder
sender cannot send an invitation, and a registration lead cannot send
reminders or free text.

`send-otp-email` sends invitation emails the same way:
`purpose: "portal_invitation"`, the stored `patients.email`, per-user and
per-recipient limits that fail closed, and the same audit rows. Its old
unauthenticated free-text mode (`{email, subject, message}`) is refused
(`message_mode_removed`). Only the fixed-template verification code mode
remains.

Optional secret: `PORTAL_APP_ORIGIN` (the address used in invitation links).
Without it, the app's own origin is used when it is listed in
`ALLOWED_ORIGINS`, otherwise `https://mbhr.app`.

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
| patient_documents | staff (removed rows included); own, not removed | P(register \| vitals \| consult), stamped `staff`; own, stamped `patient`, file must be in the patient's own folder (`<patient_id>/...`) (the trigger sets `upload_source` and `uploaded_by_user_id` from the caller) | P(register \| vitals \| consult); `file_path` / `storage_path` cannot change; soft delete of **patient uploads only** with P(consult \| users); own: **none** (use `portal_remove_document()`)⁶ | P(consult \| users), **patient uploads only** (the trigger refuses `staff` rows for every API caller, service_role included); own: none |
| patient_consent_records | staff; own | P(register); own | P(register) (revocation) | none |
| patient_data_sharing_preferences | staff; own | P(register); own | P(register); own | none |
| tefca_access_logs | P(audit_access); own | staff | none | none |
| patient_submitted_data | staff; own | P(consult); own, pending and unreviewed | P(consult); own while pending | none |
| record_visibility_log | staff | P(vitals \| consult \| dispense) | none | none |
| portal_enrollment_settings | staff | P(users) | P(users) | none |
| patient_portal_access_events (portal access history) | P(portal_manage \| audit_access) | none (only `set_patient_portal_access()`, the auto-enrolment trigger, `merge_patients()` and migrations) | none (trigger refuses, even for the owner) | none (trigger refuses, even for the owner) |
| portal_invitation_events (portal invitation history) | P(portal_invite \| audit_access) | none (only `portal_invitation_begin()` / `portal_invitation_finish()`, called by the service role from `send-sms-reminder` and `send-otp-email`) | none (trigger refuses, even for the owner) | none (trigger refuses DELETE and TRUNCATE, even for the owner) |
| portal_access_backfill_log (one-off portal access backfill) | P(audit_access). The policy is created by `20260925100100` section 8, or by the backfill itself when it runs after the permission helpers exist. service_role reads it; anon does not | none (only `20260924105900_portal_access_backfill.sql`, run as the table owner) | none (a trigger refuses it, even for the owner) | none (a trigger refuses it, even for the owner; TRUNCATE is refused too) |
| patient_lab_results (legacy copy, unused) | staff (portal read removed in `20260925100500`) | **P(lab_review)** | P(lab_review) | P(users) |
| patient_medical_conditions | staff; own | P(consult); own | P(consult) | P(consult) |
| patient_referrals | staff; own | P(consult) | P(consult) | none |
| otp_rate_limits | none | none | none | none |

⁶ **patient_documents ownership (`20260925100700`).** Owner decision: "add
uploaded_by_user_id + upload_source = patient|staff; patients may only
soft-delete their own uploads; never delete staff-uploaded clinical records."
- The server decides who uploaded a document. On insert, the trigger
  `patient_documents_ownership` sets `uploaded_by_user_id = auth.uid()`. It
  sets `upload_source` to `staff` when the caller has register, vitals or
  consult, and to `patient` otherwise; values sent by the client are
  ignored. Every row that existed before this migration is `staff`. Neither
  column can change afterwards, not even through the service role.
- A document's file (`file_path` / `storage_path`) cannot be changed by a
  signed-in caller. Otherwise a clinic row could be pointed at another path,
  and its file would become deletable.
- A patient removes a document with `portal_remove_document(uuid)`, which
  soft-deletes (sets `deleted_at` and `deleted_by` for) a document the
  patient uploaded to their own record. It returns `clinic_document` for a
  clinic document and `not_found` for another patient's document. Patients
  have no UPDATE or DELETE rule on the table.
- Clinic (`staff`) documents cannot be deleted or soft-deleted by any API
  caller (conservative: no app screen needs it). A clinic document filed on
  the wrong patient is corrected by the service role or the database owner
  as a support task. Staff with P(consult \| users) may soft-delete or
  hard-delete a patient upload. The server stamps when and by whom, and a
  soft delete cannot be undone by a signed-in caller (the service role can,
  for support).
- Deleting a whole patient record still cascades to all of its documents,
  clinic ones included, because foreign-key cascades run as the table owner.

### Storage

| Bucket | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| photos | staff | P(register \| vitals \| consult) | P(register \| vitals \| consult) | P(register \| users) |
| patient-documents (`<patient_id>/...`) | staff; own folder, except files of removed documents | P(register \| vitals \| consult); own folder | none | only files **that no document row points to**: P(consult \| users); a patient may delete only a file they uploaded to their own folder (clean-up after a failed save). The files of documents, active or removed, are never deleted through the API |

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

`patients.portal_invited_at` additionally needs `portal_invite`. The trigger
`app_guard_patient_portal_invited_at` (`BEFORE UPDATE OF portal_invited_at`,
runs `app_guard_immutable_columns('portal_invite', 'portal_invited_at')`)
refuses the change with 42501 for register holders who cannot send
invitations (volunteer, nurse, doctor). Device sync does not upload this
column.

### Server-owned columns (Wave B triggers)

The guard triggers below do not raise (except `rx_guard_dispense` on
insert): for API callers (`authenticated`, `anon`) they keep the server's
value and let the rest of the write through, so an upload that carries an
old copy of a row cannot undo a server decision. The `SECURITY DEFINER`
RPCs, the service role and migrations are not restricted by them.
`lab_results_release_guard`, `merge_redirect_patient` and `zz_server_stamp`
apply to every caller. On `patients`, the locked-columns trigger
(`app_guard_patient_identity`, which runs `app_guard_immutable_columns`)
fires first (name order): a portal patient who changes `portal_enabled` gets
an error (42501); a register holder's change is silently ignored.

| Trigger (table) | What an API write cannot do |
| --- | --- |
| `patients_guard_authoritative` (patients) | Insert: `merged_into`, `merged_at`, `merged_by`, `portal_enabled_changed_at` / `_by` are cleared and `portal_enabled` is forced to false (auto-enrolment may then turn it on). Update: all of these are kept, and a linked `auth_uid` stays linked |
| `trigger_auto_enrollment` + `trigger_auto_enrollment_log` (patients) | Auto-enrolment runs on INSERT only (it used to run on every UPDATE and turned access back on after a disable). It never acts on a row that already has a decision, has access on, opted out, is merged away, already exists (the insert half of an upsert) or was turned off before. When it enables, it stamps `portal_enabled_changed_at` and records the event |
| `queue_guard_authoritative` (queue) | Update: status and stage are kept (status changes arrive as `queue_transitions` rows); priority is never lowered (only a clinician's `priority_downgrade` transition can); `site_key` and `service_date` are set once. Insert or update: `ticket_id` / `ticket_number` always come from `queue_tickets` |
| `queue_transitions_apply` (queue_transitions) | Applies each uploaded transition to its queue row with a compare-and-set on the recorded "from" state. Refused rows are kept for audit with `applied = false` and a `reject_reason` (`stale_from_state`, `already_in_state`, `not_a_clinician`, ...). A `priority_downgrade` applies only when the recorded role holds `consult` and either the uploader holds `consult` or the recorded user is a clinician in `app_users` |
| `rx_guard_balance` (pharmacy_items, pharmacy_batches) | Balances start at 0 and are kept; a lot cannot move to another medicine |
| `rx_guard_prescription` (prescriptions) | Insert: status `open`, no dispense or void fields. Update: status, lines, patient, visit, prescriber, created_at, dispense and void fields are kept |
| `rx_guard_dispense` (dispenses) | See ⁷ above |
| `rx_canonical_lines` (prescriptions, insert) | Every medicine id in `lines` is replaced by the kept medicine's id (`app_rx_canonical_lines(jsonb)`, following `pharmacy_item_aliases`) |
| `lab_results_release_guard` (lab_results) | Runs for **every** caller, the service role included. Release, withhold and `patient_note` columns change only while `mbhr.lab_release` is on (the release RPCs). A direct review is credited to the caller with the server clock. A change of value, unit, range or interpretation sets `amended_at` and clears the review and the release. No review, no release |
| `merge_redirect_patient` (each table in `app_merge_child_tables()` with a text `patient_id`) | A row written for a merged-away patient is stored on the kept record. When the table has a timestamp `updated_at`, it is set to the server clock so the uploading device downloads the correction |
| `zz_server_stamp` (patients, queue, queue_tickets, prescriptions, pharmacy_items, pharmacy_batches; time only on patient_merges and stock_discrepancies) | `updated_at` is the server clock, and `row_version` goes up by one on every write. Devices compare `row_version`, not clocks |

Code that runs as the caller can opt in to a bypass with a
transaction-local setting (`mbhr.authoritative_write`, `mbhr.stock_write`,
`mbhr.queue_transition`, `mbhr.lab_release`). The RPCs set it and are
expected to turn it off before returning. `rx_dispense` and
`rx_import_history` turn `mbhr.stock_write` off before they return.

Immutable history (UPDATE and DELETE raise 42501 for every role, the owner
included): `patient_portal_access_events`, `patient_merges` (also
TRUNCATE), `stock_movements`, `queue_transitions` (also TRUNCATE),
`portal_invitation_events` (also TRUNCATE), `portal_access_backfill_log`
(also TRUNCATE). `portal_access_backfill_log` and `portal_invitation_events`
are also in `app_merge_excluded_tables()` (`20260925100300`): their history
keeps the original patient id, and a merge does not move it.
`lab_result_release_log` and `command_receipts` have no client write
privilege but no trigger.

### RPCs (new)

| Function | Callable by | Purpose |
| --- | --- | --- |
| `portal_session_check(token, extend_until?)` | anon, authenticated | Validates or refreshes one portal session by its token. Returns no row for an unknown token. Deactivates a session more than 5 minutes past expiry. Caps extensions at 24 hours |
| `portal_session_end(token)` | anon, authenticated | Portal logout |
| `app_portal_access_backfill()` | Table owner only. EXECUTE is revoked from PUBLIC, anon, authenticated and service_role | Runs the one-off portal access backfill (see section 4) and returns the number of records turned on. It exists so `supabase/tests/portal_access_backfill.test.sql` runs the same code. Drop it once the release is verified |
| `portal_remove_document(p_document_id)` | authenticated (own records only) | A portal patient removes (soft-deletes) a document they uploaded to their own record (`20260925100700`, see ⁶). Returns `{outcome: "applied", already_removed, ...}` or `{outcome: "rejected", reason: "clinic_document" \| "not_found"}` |
| `portal_link_patient_record(dob, given?, family?, phone?)` | authenticated | Links the signed-in portal account to its clinic record using only an email or phone that Supabase Auth has **verified**, plus a matching date of birth, and only when staff have enabled portal access. With no match it creates a self-registered record, but only for an account with a verified email or phone (status `contact_not_verified` otherwise), and it stores only the verified phone. Returns `{status, patient_id?}` |

The legacy `SECURITY DEFINER` functions `create_patient_notification`,
`log_patient_portal_access`, `patient_has_portal_account` and
`get_patient_dashboard_counts` could be called by anyone, including anon. They
are now for the service role only. No app code calls them.

### Wave B RPCs (server-authoritative state)

The command RPCs (`set_patient_portal_access`, `merge_patients` and the
`rx_*` functions except `rx_resolve_discrepancy`) follow one pattern. The
device queues each action with a client UUID (`p_command_id`) and sends it
through the command outbox (`src/sync/commandOutbox.ts`); resending is safe.
The RPC is
`SECURITY DEFINER` with a pinned `search_path`, checks the permission first
(missing permission: raises 42501, nothing recorded), then returns the result
stored in `command_receipts` for a command id it has already seen. Business
refusals are **returned** as `{"outcome": "rejected", "reason": ...}` and
stored, so a resend gets the same answer. A record that is not on the server
yet raises `PT409` (portal access, merge) or `MBR01` (pharmacy); nothing is
stored and the device retries after its next upload. None of the functions
below is callable by anon.

| Function | Callable by | Purpose |
| --- | --- | --- |
| `set_patient_portal_access(p_command_id, p_patient_id, p_enabled, p_reason?, p_client_at?, p_requested_by?, p_source?)` | P(portal_manage) | The only way a client changes `patients.portal_enabled` (inside the database, the insert-time auto-enrolment trigger, `merge_patients()` and `portal_link_patient_record()` also set it). Idempotent, recorded in `patient_portal_access_events`. A disable always applies. A staff enable made before a newer disable on the server is refused (`newer_decision_on_server`). An automatic enable (`backfill`, `auto_enrollment`) applies only when the server holds no decision, the patient has not opted out and access was never turned off (`server_decision_kept` otherwise). A merged-away record is refused (`patient_merged`). Every applied decision also sets `portal_opt_out = NOT p_enabled` |
| `portal_access_status()` | authenticated (own records only) | The signed-in portal user's linked records and whether access is on (off for a merged-away record or a suspended portal account). Used by the portal sign-in check (`fetchPortalAccessStatus` in `src/services/portalSignIn.ts`) |
| `canonical_patient_id(text)` | authenticated | The record an id now lives on (follows `merged_into`, at most 10 steps) |
| `lease_ticket_block(p_site_key, p_service_date, p_device_id, p_size?)` | P(queue) | Gives a device the next block of 1 to 100 ticket numbers (default 20) for a site and Africa/Lagos day (yesterday to tomorrow only), so it can issue real numbers offline |
| `issue_queue_ticket(p_ticket_id, p_site_key, p_service_date, p_patient_id, p_leased_seq?, p_provisional_label?, p_device_id?)` | P(queue) | Confirms a ticket issued on a device. Idempotent on the ticket id; one ticket per patient, site and day (two desks converge on one); keeps a leased number or a free temporary label, otherwise gives the next number (the device relabels and tells staff). Refusals: `invalid_input`, `patient_not_found` |
| `merge_patients(p_command_id, p_winner_id, p_loser_id, p_field_choices?, p_requested_by?, p_requested_at?, p_source?, p_merge_id?)` | P(merge_patients) | The only way to merge. In one transaction: applies the chosen field values (whitelisted columns) to the kept record, moves the history, moves a portal sign-in the kept record lacks, marks the merged-away record and appends the history row. Refusals: `same_record`, `invalid_request`, `cycle`, `loser_merged_elsewhere`. Merging records already merged answers `already_merged` with the earlier `merge_id`. One merge at a time (advisory lock) |
| `rx_register_item(p_command_id, p_item_id, p_item, p_requested_by?)` | P(inventory) | Adds a medicine; if the same name, form and strength exist at the site, returns that id and records the device's id as an alias |
| `rx_set_item_active(p_command_id, p_item_id, p_active, p_requested_by?)` | P(inventory) | Deactivates or reactivates a medicine (medicines are not deleted) |
| `rx_receive_stock(p_command_id, p_movement_id, p_batch, p_qty, p_reason?, p_occurred_at?, p_requested_by?, p_site_key?, p_device_id?)` | P(inventory) | A received lot (`receipt`) or a site's opening stock (`opening_balance`). The first device to upload opening stock for a site claims it; another device is refused (`opening_stock_already_uploaded`) |
| `rx_adjust_stock(p_command_id, p_movement_id, p_batch_id, p_qty_delta, p_reason?, p_note?, p_occurred_at?, p_requested_by?)` | P(inventory) | A count or an expiry write-off, as a change (counted minus shown). Refused if the lot or medicine would go below zero (`insufficient_stock`) |
| `rx_dispense(p_command_id, p_prescription_id, p_lines, p_occurred_at?, p_offline?, p_allergy_override?, p_requested_by?, p_prescription?)` | P(dispense) | Every line of the prescription in full, first-expiry-first-out from lots in date on the Africa/Lagos calendar (the device's lot choice first where that lot still has stock). Online shortfall: refused (`insufficient_stock`, with what is available). Handed over offline (`p_offline`): the covered part comes from stock, the rest is recorded as given with no lot and filed in `stock_discrepancies`. Other refusals: `prescription_not_found`, `prescription_void`, `already_dispensed`, `lines_mismatch`, `unknown_item`, `invalid_request`. Can carry a prescription not uploaded yet (`p_prescription`, saved as `open`) |
| `rx_void_prescription(p_command_id, p_prescription_id, p_reason?, p_occurred_at?, p_requested_by?)` | P(consult \| dispense) | Cancels an open prescription |
| `rx_import_history(p_command_id, p_prescription_id, p_prescription, p_dispenses?, p_requested_by?)` | P(dispense \| inventory) | Uploads prescriptions dispensed from stock that was only on a device (history only, no stock movement) |
| `rx_resolve_discrepancy(p_id)` | P(inventory) | Marks a discrepancy reconciled. Takes no command id (a repeat changes nothing) |
| `app_rx_item_id(text)`, `app_rx_canonical_lines(jsonb)` | authenticated | Alias lookups used by the triggers and RPCs |
| `lab_review_result(p_result_id, p_release?, p_patient_note?)` | P(lab_review); with `p_release`, also P(lab_release) | Marks a result reviewed, credited to the caller with the server clock (a repeat changes nothing). With `p_release`, also releases it in the same call; a release that would be refused is refused before the review is recorded. Refusals: `not_found`, `no_interpretation`, `superseded`, `note_too_long` |
| `lab_release_result(p_result_id, p_patient_note?)` | P(lab_release) | Releases a reviewed result to the portal. Refusals: `not_reviewed`, `superseded`, `no_interpretation`, `not_found`, `note_too_long`; a repeat answers `already_released`. A withheld result can be released |
| `lab_withhold_result(p_result_id, p_reason)` | P(lab_release) | Keeps a result off the portal (takes it off if released). A reason is required |
| `portal_my_lab_results(p_limit?, p_patient_id?)` | authenticated (own records only) | The only way a portal patient reads lab results: reviewed, released, not withheld, not superseded, for their own records with portal access on and not merged away. `p_patient_id` narrows to one of their own records; any other id returns nothing. At most 500 rows |

The lab RPCs take no command id: they are online-only (open question in
`docs/security/PRODUCTION_HARDENING_CHECKLIST.md`).

Internal, not executable by `anon` or `authenticated` (service role and the
`SECURITY DEFINER` functions only): `app_command_prior_result`,
`app_command_record`, `app_queue_allocate_seq`,
`app_merge_reassign_children` (moves the merged-away record's rows; used by
`merge_patients()` and the migration backfill), `app_merge_child_tables`,
`app_merge_single_tables`, `app_merge_excluded_tables`,
`app_lab_release_apply`, `app_lab_result_state`, `app_lab_release_log`,
`app_staff_role_of(uuid)`, `portal_invitation_begin(uuid, text, text)`,
`portal_invitation_finish(uuid, text, text, text, text)`, and the trigger
functions.

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
  values are never shown to patients (owner decisions #2 and #5). Since
  `20260925100500` the rule is stricter: reviewed **and** released, read
  only through `portal_my_lab_results()` (see Wave B below).
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

### Wave B: server-authoritative clinical state (`20260925100000` to `20260925100500`)

- **Portal access** could be turned back on by any upload: the auto-enrolment
  trigger ran on every UPDATE of a patient with a phone or email, and a
  device upload carried its own `portal_enabled`. Now only
  `set_patient_portal_access()` changes it for a client, auto-enrolment runs
  on insert only and never over a recorded decision, and every decision is
  kept in `patient_portal_access_events`.
- **Queue**: two devices issued the same ticket number, and an upload could
  change status or lower an urgent priority. Numbers now come from the
  server (leased blocks for offline use), status and stage change only
  through audited transitions, and writes need the `queue` permission.
- **Patient merges** were rows any register holder could insert, readable by
  all staff, and the server never moved the history. Now `merge_patients()`
  is the only path, the history is immutable and narrower to read (it holds
  snapshots of both records), and late uploads for a merged-away record are
  redirected to the kept one.
- **Pharmacy**: any `inventory` or `dispense` holder could write stock
  balances directly, and the planned device sync (`mbhrAdapter.ts`, never
  switched on) would have uploaded them as absolute numbers, so two devices
  could overwrite each other's dispensing. Balances are now written
  only by the `rx_*` RPCs under row locks, every change is in the
  append-only ledger, and `dispense` holders can no longer insert
  prescriptions.
- **Lab results**: a reviewed but unreleased result was readable by the
  patient. Release is now a separate, audited step, and patients read
  results only through `portal_my_lab_results()`.

### Portal access backfill (`20260924105900`, runs before the RLS reconcile)

Until `20260924110300`, no database rule read `patients.portal_enabled`, so a
patient who had signed up for the portal could read their records whatever
the flag said. From `20260924110300` on, portal data is visible only while
`portal_enabled` is true (`app_portal_patient_ids()`), and `20260925100100`
makes the flag server-owned. Patients who use the portal today with the flag
false or NULL would lose access.

`20260924105900_portal_access_backfill.sql` runs first. It turns the flag on
(false or NULL to true) only where a **verified portal account is already
linked to that exact record**:
- `patients.auth_uid` is a Supabase Auth account with a confirmed email or
  phone that is not deleted, banned or anonymous; or
- a `patient_portal_users` row for that record is `active` with
  `phone_verified` or `email_verified` true.

Nothing is matched on phone or email text. `patients.contact_verified` is not
used: it describes the record's contact details, not a portal account.

These records are never turned on:
- records whose `auth_uid` is a staff account (a row in `app_users`),
  whatever other evidence they have. Turning them on would open the portal
  path to that staff account;
- opted-out, merged-away or soft-deleted records;
- records with a `suspended` portal account;
- records already backfilled once (the log's `patient_id` is unique);
- records already on (left untouched);
- on a late run, records whose access was turned off by anything other than
  the `20260925100100` `state_at_migration` snapshot
  (`portal_enabled_changed_by` set, or another applied "off" access event).

Each record turned on gets a row in `portal_access_backfill_log` (patient
id, auth_uid and/or patient_portal_users id, which confirmations were seen,
previous value, migration name, time). `audit_logs` gets one summary row
with counts only.

In the normal order, `20260925100100` section 6 then stamps the backfilled
records as enabled server decisions. A later staff disable through
`set_patient_portal_access` always wins, and device backfill enables are
rejected. On a late run (after `20260925100100`), the backfill also sets
`portal_enabled_changed_at` and writes a `portal_account_backfill` access
event (source `migration`), so devices download the change. A second run
turns nothing on and logs nothing.

### Registration lead and portal invitations (`20260925100600`)

Owner decision: sending a portal invitation is a separate permission
(`portal_invite`) from turning access on (`portal_manage`). Volunteers keep
enabling access at registration but no longer send invitations. The new
`registration_lead` role is registration-focused, not clinical: it can
register patients, move them through the queue, manage portal access and
send invitations. It cannot record vital signs; vitals stay with staff
explicitly assigned to that workflow. Nurses and doctors lose the ability to
send invitations; lead clinicians and admins keep it.

The rule is enforced in three places: the app (`can(role, "portal_invite")`
in the services and screens), the database (`portal_invitation_begin()` and
the `portal_invited_at` lock) and both sending functions. `queue_transitions`
uploads now follow the `queue` permission, so a registration lead's queue
history syncs.

Deploy order: apply the migration before the app build that offers the
role, because `app_users` refuses a staff account saved with role
`registration_lead` until the migration has committed. Then redeploy
`send-sms-reminder` and `send-otp-email`.

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
   Say so in the UI when the device is PIN-only. **Done:** the Palaver Room
   acts as the online session's user id, lists only staff with an online
   account id as recipients, and shows "Sign in online to use messaging" on
   a PIN-only device.
4. **Sync with role-limited writes** (`src/sync/adapter.ts`,
   `src/sync/pharmacySync.ts`, `src/services/enhancedSync.ts`): a row the
   signed-in person may not write, such as a nurse's vitals pushed by a
   pharmacist on a shared tablet, is now refused.
   - `adapter.ts` already keeps refused rows unsent and retries. **Done:**
     permission refusals are counted by `countAwaitingAuthorisedSync()` in
     `src/sync/adapter.ts`, and the sync panel
     (`src/components/shell/SyncStatusControl.tsx`) shows "N waiting for an
     authorised person to sync" (text and icon) instead of retrying silently.
   - ~~`mbhrAdapter.ts` pushes whole tables in one upsert, so one refused row
     blocks the batch.~~ **Done:** `src/sync/mbhrAdapter.ts` is deleted. The
     pharmacy database syncs through `src/sync/pharmacySync.ts` (a sync
     participant: uploads new prescriptions, sends the queued `rx_*`
     commands, downloads the server's medicines, lots, prescriptions and
     ledger) and `src/services/pharmacyCommands.ts` (the actions that queue
     those commands). Stock is never uploaded as a number.
   - `app_users` rows should be pushed only by `users` holders.
5. **Conflict reporting by non-resolvers**
   (`src/sync/queueConflicts.ts` / `conflictQueue.createConflict`): volunteers
   and pharmacists cannot insert or read `conflict_resolutions`. Report
   "not queued" honestly (already modelled as `notQueued`), or add a
   service-side reporting endpoint.
6. **Lab review** (`LabResultsDashboard.tsx`, `labs.ts`): gate review on
   `lab_review`, not `consult`. A patient sees a result only after review.
   Since `20260925100500`, only after review **and** release: `labs.ts`
   calls `lab_review_result`, `lab_release_result` and
   `lab_withhold_result`, and the portal reads through
   `portal_my_lab_results` (`src/services/portalLabResults.ts`).
7. **Photos** (`src/utils/photoStorage.ts`): the bucket is private. Use
   `createSignedUrl` instead of `getPublicUrl`, which cannot work. **Done:**
   uploads return a short-lived signed URL (10 minutes) and `getPhotoUrl()`
   signs a stored photo again each time it is shown.
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

- ~~Add a CI test that parses `app_role_has_permission` from the migration and
  compares it with `ROLE_PERMISSIONS` in `src/auth/roles.ts`.~~ Done:
  `src/auth/roleMatrixParity.test.ts`.
- ~~Sync adapter: show permission refusals as "waiting for an authorised
  person to sync".~~ Done (section 5, item 4).
- ~~Add `released_to_patient` / review state to `lab_results` and retire the
  separate `patient_lab_results` table (owner decision #5). Then change the
  portal rule from "reviewed" to "released".~~ Done in `20260925100500`
  (release columns, portal rule "released"), except that
  `patient_lab_results` is kept: patients can no longer read it, nothing
  writes it, and `app_merge_child_tables()` still lists it. Export and review
  any rows it holds, then drop it in a later migration.
- ~~Add an "uploaded by patient" marker to `patient_documents` so patients
  can delete only their own uploads.~~ Done in `20260925100700`
  (`upload_source`, `uploaded_by_user_id`, soft delete,
  `portal_remove_document()`). The legacy `uploaded_by_patient` flag is not
  trusted and not backfilled.
- [ ] Deleting a patient (the `users` permission, or the service role)
  cascades to its clinic documents. Decide whether patient deletion should
  be blocked while clinic documents exist, or replaced by archiving.
- ~~**Merge lists.** Add `portal_access_backfill_log` to
  `app_merge_excluded_tables()` in `20260925100300`.~~ Done:
  `portal_access_backfill_log` and `portal_invitation_events` are both in
  the list, so that migration's coverage check no longer warns about them.
  Their history keeps the id it was written for, like
  `patient_portal_access_events`, and a merge does not move it.
- **Review what the backfill trusted** (`20260924105900`). It trusts
  existing links and does not re-check how they were made.
  - `phone_verified` could be set by the removed client-side demo OTP flow.
  - Until `20260924110300`, anonymous callers could write
    `patient_portal_users` rows (the anon `register` / `verify` policies,
    last re-created by `20260520000000`) and flip them to `active`.
  - The pre-Wave-B sign-up linked `auth_uid` on a typed email, or on phone
    plus date of birth.
  - The review queries are in the production checklist.
- **`locked` portal accounts** are not backfilled, because only `active`
  counts. No code sets `locked` today.
- **Drop `app_portal_access_backfill()`** once the release is verified.
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
  reason. (`queue.priority` is protected since `20260925100200`: an upload
  cannot lower it and only a clinician's `priority_downgrade` transition
  can. `triage_records` is not.)
- ~~`lab_results.interpretation` still has a database default of `'normal'`.~~
  Dropped in `20260925100500` (and `NOT NULL` added when no row lacked a
  value). Owner decision #2 removes automatic "Normal" in the app; the
  clinical reviewer still has to approve this change (listed in
  `docs/clinical/CLINICAL_LOGIC_CHANGES.md`).
- `audit_logs` rows are appended by any staff member and `actor_role` is not
  checked against the caller, so a row can claim another role. Add an
  `actor_id` defaulted from `auth.uid()` (and a check) when the audit log is
  server-backed.
- ~~`lab_results.reviewed_by` is not checked against the caller.~~ Since
  `20260925100500`, `lab_review_result` records `auth.uid()`, and the
  release guard credits a review made by a direct API write to the caller,
  whatever id the device sent.
- Dual approval for patient merges (`site_conflict_settings`) is enforced by
  the app only.
- `notifications` (ticket notifications) still has the older `is_staff()`
  read/write rule; no client uses it.
- ~~Prescriptions allow INSERT for `dispense` only because of the upsert sync.
  Once prescriptions are server-backed (owner decision #5), limit INSERT to
  prescribers.~~ Done in `20260925100400`: INSERT needs `consult`. The app
  still lets nurses prescribe (open clinical question).
- ~~`rx_dispense` and `rx_import_history` left `mbhr.stock_write` on until
  the transaction ended.~~ Fixed in `20260925100400`: both turn it off
  before returning (covered by `supabase/tests/pharmacy_ledger.test.sql`).
- ~~TRUNCATE on the pharmacy ledger tables.~~ Fixed in `20260925100400` for
  `stock_movements` (revoked, plus a TRUNCATE trigger),
  `stock_discrepancies`, `pharmacy_site_onboarding` and
  `pharmacy_item_aliases`. `authenticated` still keeps the Supabase default
  TRUNCATE privilege on most older tables (for example `patients`, `vitals`,
  `lab_results`). PostgREST cannot send TRUNCATE, so the API cannot reach
  it; revoking it everywhere is a database-owner task.
- `lab_result_release_log` and `command_receipts` have no write privilege
  for clients, but no immutability trigger either (the owner and the
  service role can change them). Add one if they must be tamper-evident.
- Queue downgrades: the server trusts a recorded `user_id` that belongs to
  a real clinician, so a `queue` holder who records a clinician's id could
  forge a downgrade. It is audited (`uploaded_by` is the real uploader).
  Checking only the uploader's role would refuse clinician downgrades synced
  later by a colleague on the same device. Owner decision.
- Pharmacy downloads are not scoped by site: every device receives every
  site's medicines, lots and prescriptions. Queue tickets and pharmacy stock
  key sites by a slug of the site name, not a stable site id.
- `patient_merges.winner_before` / `loser_before` hold full snapshots of both
  records and nothing can delete them, not even the service role, so a
  data-erasure request cannot remove them. Owner decision (see
  `docs/security/PRODUCTION_HARDENING_CHECKLIST.md`).

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

-- Pharmacy ledger: balances agree with the ledger (both should return no
-- rows once opening stock or a count is recorded for older balances)
select * from public.stock_balance_drift;
select * from public.stock_item_balance_drift;
```

For the Wave B rules, run the pgTAP files in `supabase/tests/` against a
local stack or a staging branch (`supabase test db`; see
`supabase/tests/README.md`). They create their own fixtures and roll back.
