# Superseded migrations: never move back, never run

**Warning.** The files in this folder must never be moved back into
`supabase/migrations/` and must never be run against any database that
matters, production least of all. The Supabase CLI reads only
`supabase/migrations/`, so it ignores this folder. That is the only reason
these files are here rather than deleted: they record what was once intended.

Every file here was pending (never applied on production). Production
already has the objects that each one was meant to create, under another
version or in another shape, or does not need them. The few pieces that
production still lacks, and that the Wave A/B migrations, the pgTAP suite or
the live app need, were rewritten safely in
`supabase/migrations/20260924105800_legacy_schema_catchup.sql` (no policies,
RLS on, anon revoked, text ids where production uses text).

Many of these files **apply cleanly** on production as written, and in doing so
reopen anonymous or cross-patient access, replace hardened functions, or lock
staff out. The hazard column says what each one would do. The evidence is in
the reconciliation triage (legacy2025 and legacy2026a groups), run against a
fingerprint-identical copy of production's schema.

If something from one of these files is ever needed, write a **new** migration
with a version newer than production's newest, taking only that piece, with no
permissive policies and explicit anon revokes.

| Version | File | What production has instead | Moved into the catch-up | Hazard of running it |
|---|---|---|---|---|
| 20250930065243 | empty_band | Already present: all 15 tables (from old_dream / teal_coral) | none (the dispenses columns come from 20260420000000) | Applies cleanly; adds 15 `FOR ALL TO authenticated USING(true) WITH CHECK(true)` policies, 3 of them on tables Wave A never resets (gamification, notifications, daily_counters) |
| 20251023220000 | add_photo_storage | Twin: 20251024121716 (same SQL plus DROP IF EXISTS); bucket `photos` and its 4 policies exist | none | Fails with "already exists"; if it ever ran after Wave A 110300 it would bring back anon photo reads and let any signed-in user update or delete photos |
| 20251024000000 | add_advanced_features | Already present (20251024080033): all 5 tables, with uuid actor columns | none | Adds `USING(true)` PHI reads on lab_orders, lab_results, appointments, waitlist; strips the pinned search_path from `update_updated_at_column()` |
| 20251024120000 | add_missing_gamification_tables | Already present: all 13 tables in the teal_coral/080033 shape | none (game_sessions.payload_json is a follow-up, see below) | Wallet forgery (`WITH CHECK(true)`), `USING(true)` reads, `daily_counts FOR ALL USING(true)`, permanent on 6 tables Wave A never resets |
| 20251025000000 | add_patient_allergies_preferences | Already present: both tables (uuid created_by) | none | Applies cleanly; strips `update_updated_at_column()`'s search_path; 4 duplicate indexes; 8 policies on the legacy `public.users` table |
| 20251026000000 | add_clinical_decision_support | Not needed: clinical alerts live only in Dexie, no server reader | none | Applies cleanly; creates `clinical_alerts` with anon grants and broken `auth.users` policies, an anon-executable SECURITY DEFINER function without search_path, strips `update_updated_at()`'s search_path |
| 20251027000000 | fix_security_performance_issues | Not needed; production's lockdown (20260517152556 onwards) did this properly | none | The most dangerous file: applies cleanly, drops 60 indexes (every sync index), rewrites 22 policies onto `auth.users` (permission denied for staff), adds a FOR ALL policy on app_users, turns 3 functions SECURITY DEFINER |
| 20251028000000 | add_patient_portal | Already present: all 8 portal tables with text ids (`ppu_`, `pps_`, `ppal_`) | none | Fails (`uuid = text`); forced, it drops the 10 live portal policies and adds 3 anon-executable DEFINER functions without search_path |
| 20251028120000 | add_multi_tenant_foundation | Twin: 20251028170413 | none | Fails ("policy already exists"); forced, strips `update_updated_at()`'s search_path |
| 20251028121000 | add_doctor_features_tables | Twin: 20251028170517 + 20251028170617 | none | Fails; forced, adds 9 duplicate policies on tables never reset |
| 20251028180000 | add_queue_enhancements | Twin: 20251028183104 (byte-identical but for a newline) | none | None known (no change), but it is a duplicate version of applied SQL |
| 20251029000000 | add_patient_email_auth_fields | Already present: patients.email, auth_uid, contact_verified and equivalent unique indexes | none | Applies cleanly; adds an unverified email-match SELECT on patients (PHI) and an unrestricted own-row UPDATE |
| 20251030000000 | add_patient_portal_features | patient_secure_messages and patient_documents already present (other shape) | **yes**: patient_medical_conditions, patient_referrals, patient_portal_preferences (text patient/portal-user ids, no FK to legacy users), the private `patient-documents` bucket | Fails (uuid FK to text `patient_portal_users.id`); forced, drops 2 live patient_documents policies, adds dead JWT-role policies, strips `update_updated_at_column()`'s search_path |
| 20251031000000 | fix_patient_session_rls | Not needed: the `portal_session_*` RPCs (Wave A 110300) replace it | none | Applies cleanly; anon can read every session token and refresh any session (account takeover) |
| 20251031000001 | add_patient_portal_fixed | Twin: 20251026225242 (production ran this SQL under that version) | none | Applies cleanly; brings back 5 staff `USING(true)` policies the lockdown removed |
| 20251214162156 | add_palaver_room_messaging | Already present: all 3 palaver tables and the UNIQUE the app needs | none | Applies cleanly; portal patients read staff broadcasts, any signed-in account can broadcast |
| 20251214163828 | fix_palaver_room_rls_policies | Not needed; Wave A 110200 sets the palaver policies | none | Applies cleanly; 12 `TO anon, authenticated USING(true)` CRUD policies (anonymous full CRUD on messaging) |
| 20260115072241 | add_portal_enhancements_v3 | 5 of its 8 tables already present (text ids) | **yes**: portal_visible / visibility_reason / hidden_by / hidden_at on vitals, consultations, dispenses; patients auto_enrolled / auto_enrolled_at / portal_opt_out; portal_enrollment_settings (UNIQUE setting_key, seeded **false**); patient_submitted_data (text id, text portal_user_id); record_visibility_log | Applies cleanly; 22 `USING(true)` policies TO PUBLIC (anon reads OTP secrets and session tokens: account takeover); seeds auto-enrolment **true** with an INSERT OR UPDATE trigger; strips `update_updated_at_column()`'s search_path; anon-executable DEFINER functions |
| 20260116102858 | fix_patient_portal_missing_objects | Already present: all 7 columns, patient_portal_access_logs (text ids), the hardened OTP limiter on otp_rate_limit_tracking | none | Applies cleanly; **replaces the live OTP limiter** (limit 200 to 5, new table, no search_path); any signed-in account reads all portal access logs |
| 20260121145002 | add_patient_portal_registration_policy | Not needed (registration goes through RPCs) | none | Applies cleanly; `FOR SELECT TO anon USING(true)` on patients: every patient record readable with the anon key |
| 20260121150150 | add_anonymous_patient_registration_policy | Not needed | none | Applies cleanly; anon can INSERT any patient row |
| 20260125094038 | add_conflict_resolution_system | conflict_resolutions exists in its legacy 9-column shape | **yes**: conflict_resolutions id default, relaxed patient_id NOT NULL, the app's columns and widened CHECKs, conflict_audit_logs, auto_resolution_rules (text actor ids, existing `update_updated_at_column()` for triggers) | Fails (uuid FK to text id); forced, 7 policies with the uuid = text bug, a function without search_path, anon grants |
| 20260125095031 | add_enhanced_conflict_roles_and_site_settings | user_role already has auditor and lead_clinician | **yes**: site_conflict_settings and the 6 conflict_resolutions columns | Fails (uuid = text); forced, auditors could write site settings and switch off dual approval |
| 20260125095109 | add_conflict_delta_retention_and_archiving | none of its 4 tables | **yes**: conflict_change_deltas only (the other 3 tables have no user) | Fails (uuid FK to text); forced, auditors get FOR ALL on retention policies, `USING(true)` reads, anon grants |
| 20260417000000 | add_staff_roles_and_rbac | Not needed: `is_staff()` reads app_users (hotfix 20260925160000); password-reset fix is bab6072 | none | Applies cleanly and **locks every staff member out**: replaces `is_staff()` with a staff_roles lookup (empty table), plus 9 PUBLIC-role policies |
| 20260420000000 | add_inventory_nm_and_tickets | Already present: all 14 tables with identical columns, CHECKs, FKs and indexes | **yes**: dispenses.prescription_id / item_id / batch_id and their 3 FKs (prescription FK is ON DELETE RESTRICT, not CASCADE) | Applies cleanly; re-adds 15 `FOR ALL TO authenticated USING(true) WITH CHECK(true)` policies, including dispenses (PHI) and tables Wave A never resets |

## Follow-ups not taken into the catch-up

- `game_sessions.payload_json text` (from 20251024120000 L94). The live
  `src/services/enhancedSync.ts:358,370` upserts and reads it, and production
  has `payload jsonb` instead, so the game-session upload fails today. No
  migration or test needs it, so it was left out of the catch-up; add it in a
  new migration if the owner wants that sync to work.
- An admin-only write policy on `site_conflict_settings`. Wave A 110200 creates
  only the staff SELECT policy, so `updateSiteSettings` stays denied until a
  post-Wave-A migration adds `app_has_permission('users')` writes.
- `patient_data_sharing_preferences` (the portal "Data sharing" page) belongs to
  the deferred TEFCA file 20260125091118; see `../migrations-deferred/README.md`.
