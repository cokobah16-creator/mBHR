-- ============================================================================
-- RLS reconcile (2/5): clinical, queue, pharmacy and inventory tables
-- ============================================================================
-- Every table below first loses ALL of its policies (public.app_rls_reset),
-- then gets one clean set that follows src/auth/roles.ts through
-- public.app_has_permission(). Before this migration most of these tables
-- still carried several overlapping policies, including:
--   * patients: "Allow anonymous patient lookup for portal registration"
--     (anon SELECT USING (true)) and "Allow anonymous patient registration"
--     (anon INSERT WITH CHECK (true)) - the whole patient register was
--     readable and writable with the public anon key;
--   * "Patients can view own ..." policies comparing
--     patient_portal_users.id to auth.uid() (a different identity from the
--     portal JWT used elsewhere);
--   * is_staff()-only FOR ALL policies, which let auditors and any other
--     non-guest role write vitals, consultations and dispenses;
--   * role lists that included 'guest' (waitlist) or left out
--     lead_clinician.
-- anon loses every table privilege on these tables (defence in depth).
--
-- Shorthand used in the comments below
--   staff    = public.app_is_staff()      (any known non-guest role)
--   station  = public.app_is_station_staff() (register|vitals|consult|dispense)
--   own      = row belongs to one of the caller's portal patient records
--              (public.app_portal_patient_ids(), portal access enabled)
--   P(x)     = public.app_has_permission('x')
--
-- Deletes of clinical records are limited to the 'users' permission (admin),
-- matching PatientDetail.tsx (canDelete = admin).
--
-- Rollback: this migration drops policies by name pattern it cannot
-- recreate automatically. To roll back, restore the previous policy set from
-- a pg_dump --schema-only taken before applying, or re-run the policy
-- sections of 20260417000000, 20260520000000..07 and 20260910161049.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FHIR version history trigger
-- ----------------------------------------------------------------------------
-- fhir_record_resource_version() (20260503020000/060000) runs AFTER every
-- write to patients, visits, dispenses, prescriptions, patient_allergies,
-- conditions, ... and inserts into resource_versions. It ran as the caller,
-- but resource_versions only accepts writes from the service role, so every
-- staff write to those tables was refused by RLS ("new row violates
-- row-level security policy for table resource_versions"). The history row
-- is written by the database on the caller's behalf only after the caller's
-- own write passed that table's policies, so it now runs as the owner.
DO $$
BEGIN
  IF to_regprocedure('public.fhir_record_resource_version()') IS NOT NULL THEN
    ALTER FUNCTION public.fhir_record_resource_version()
      SECURITY DEFINER
      SET search_path = public, pg_catalog;
    REVOKE ALL ON FUNCTION public.fhir_record_resource_version() FROM PUBLIC, anon;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- patients
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('patients');

-- staff read all; a portal patient reads their own linked record.
SELECT public.app_rls_policy('patients', 'patients_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patients', 'patients_insert_register', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('register'))$p$);

SELECT public.app_rls_policy('patients', 'patients_update_clinical', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))$p$);

-- Portal patients may correct their own contact details (UpdatePHR.tsx:
-- phone, email, address and the other fields it offers). Identity (names,
-- date of birth, sex, photo used by staff to recognise the patient),
-- portal-access and linking columns are protected by the trigger below;
-- UpdatePHR.tsx does not offer name changes.
SELECT public.app_rls_policy('patients', 'patients_update_portal_self', 'UPDATE',
  $p$id::text IN (SELECT public.app_portal_patient_ids())$p$,
  $p$id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patients', 'patients_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

DROP TRIGGER IF EXISTS app_guard_patient_identity ON public.patients;
CREATE TRIGGER app_guard_patient_identity
  BEFORE UPDATE ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.app_guard_immutable_columns(
    'register',
    'id', 'auth_uid', 'portal_enabled', 'contact_verified', 'auto_enrolled',
    'auto_enrolled_at', 'portal_invited_at', 'fhir_id', 'dob', 'sex',
    'family_id', 'given_name', 'family_name', 'photo_url', 'created_at');

-- ----------------------------------------------------------------------------
-- visits
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('visits');

-- Portal patients see only closed visits (unchanged rule).
SELECT public.app_rls_policy('visits', 'visits_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR (status = 'closed'
         AND patient_id::text IN (SELECT public.app_portal_patient_ids()))$p$);

SELECT public.app_rls_policy('visits', 'visits_insert_station', 'INSERT',
  NULL,
  $p$(SELECT public.app_is_station_staff())$p$);

SELECT public.app_rls_policy('visits', 'visits_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);

-- Admin deletes any visit. A clinician may delete an EMPTY visit (no vitals,
-- no consultation): the rollback in patientService.addVisit() when saving
-- the consultation fails.
SELECT public.app_rls_policy('visits', 'visits_delete', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))
     OR ((SELECT public.app_has_permission('consult'))
         AND NOT EXISTS (SELECT 1 FROM public.vitals AS v
                          WHERE v.visit_id::text = visits.id::text)
         AND NOT EXISTS (SELECT 1 FROM public.consultations AS c
                          WHERE c.visit_id::text = visits.id::text))$p$);

-- ----------------------------------------------------------------------------
-- vitals / consultations / dispenses
-- ----------------------------------------------------------------------------
-- Portal reads also honour portal_visible (set by staff through
-- recordVisibility.ts); previously a hidden record was still readable.
SELECT public.app_rls_reset('vitals');

SELECT public.app_rls_policy('vitals', 'vitals_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR (COALESCE(portal_visible, true)
         AND patient_id::text IN (SELECT public.app_portal_patient_ids()))$p$);

SELECT public.app_rls_policy('vitals', 'vitals_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('vitals'))$p$);

SELECT public.app_rls_policy('vitals', 'vitals_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('vitals'))$p$,
  $p$(SELECT public.app_has_permission('vitals'))$p$);

SELECT public.app_rls_policy('vitals', 'vitals_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_reset('consultations');

SELECT public.app_rls_policy('consultations', 'consultations_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR (COALESCE(portal_visible, true)
         AND patient_id::text IN (SELECT public.app_portal_patient_ids()))$p$);

SELECT public.app_rls_policy('consultations', 'consultations_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('consult'))$p$);

SELECT public.app_rls_policy('consultations', 'consultations_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))$p$,
  $p$(SELECT public.app_has_permission('consult'))$p$);

SELECT public.app_rls_policy('consultations', 'consultations_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_reset('dispenses');

SELECT public.app_rls_policy('dispenses', 'dispenses_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR (COALESCE(portal_visible, true)
         AND patient_id::text IN (SELECT public.app_portal_patient_ids()))$p$);

SELECT public.app_rls_policy('dispenses', 'dispenses_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('dispense'))$p$);

SELECT public.app_rls_policy('dispenses', 'dispenses_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('dispense'))$p$,
  $p$(SELECT public.app_has_permission('dispense'))$p$);

SELECT public.app_rls_policy('dispenses', 'dispenses_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- ----------------------------------------------------------------------------
-- prescriptions
-- ----------------------------------------------------------------------------
-- Prescribers (consult) write; pharmacy (dispense) updates status. INSERT
-- also allows dispense because src/sync/mbhrAdapter.ts pushes with upsert,
-- and an upsert is checked against the INSERT policy.
SELECT public.app_rls_reset('prescriptions');

SELECT public.app_rls_policy('prescriptions', 'prescriptions_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);

SELECT public.app_rls_policy('prescriptions', 'prescriptions_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'dispense']))$p$);

SELECT public.app_rls_policy('prescriptions', 'prescriptions_update', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'dispense']))$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'dispense']))$p$);

SELECT public.app_rls_policy('prescriptions', 'prescriptions_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- ----------------------------------------------------------------------------
-- Queue and flow (owner decision #1: calling and moving patients is
-- operational; any station may advance a patient)
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('queue');
SELECT public.app_rls_policy('queue', 'queue_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('queue', 'queue_insert_station', 'INSERT',
  NULL, $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('queue', 'queue_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('queue', 'queue_delete_station', 'DELETE',
  $p$(SELECT public.app_is_station_staff())$p$);

SELECT public.app_rls_reset('tickets');
SELECT public.app_rls_policy('tickets', 'tickets_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('tickets', 'tickets_insert_station', 'INSERT',
  NULL, $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('tickets', 'tickets_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('tickets', 'tickets_delete_station', 'DELETE',
  $p$(SELECT public.app_is_station_staff())$p$);

-- stage_events is the hand-off trail: station staff add and (because sync
-- upserts) update rows; only admin deletes.
SELECT public.app_rls_reset('stage_events');
SELECT public.app_rls_policy('stage_events', 'stage_events_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('stage_events', 'stage_events_insert_station', 'INSERT',
  NULL, $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('stage_events', 'stage_events_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('stage_events', 'stage_events_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_reset('queue_metrics');
SELECT public.app_rls_policy('queue_metrics', 'queue_metrics_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('queue_metrics', 'queue_metrics_insert_station', 'INSERT',
  NULL, $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('queue_metrics', 'queue_metrics_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('queue_metrics', 'queue_metrics_delete_station', 'DELETE',
  $p$(SELECT public.app_is_station_staff())$p$);

-- ----------------------------------------------------------------------------
-- Medicines stock (inventory + dispense)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory', 'pharmacy_items', 'pharmacy_batches', 'stock_batches',
    'stock_moves_rx', 'inventory_discrepancies'
  ] LOOP
    PERFORM public.app_rls_reset(t);
    PERFORM public.app_rls_policy(t, t || '_select_staff', 'SELECT',
      $p$(SELECT public.app_is_staff())$p$);
    PERFORM public.app_rls_policy(t, t || '_insert_pharmacy', 'INSERT',
      NULL,
      $p$(SELECT public.app_has_any_permission(ARRAY['inventory', 'dispense']))$p$);
    PERFORM public.app_rls_policy(t, t || '_update_pharmacy', 'UPDATE',
      $p$(SELECT public.app_has_any_permission(ARRAY['inventory', 'dispense']))$p$,
      $p$(SELECT public.app_has_any_permission(ARRAY['inventory', 'dispense']))$p$);
    PERFORM public.app_rls_policy(t, t || '_delete_inventory', 'DELETE',
      $p$(SELECT public.app_has_permission('inventory'))$p$);
  END LOOP;
END $$;

-- Non-medical supplies: volunteers restock these (RestockGame), so any
-- station staff or inventory holder may write.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_nm', 'stock_moves_nm', 'alerts_nm', 'restock_sessions'
  ] LOOP
    PERFORM public.app_rls_reset(t);
    PERFORM public.app_rls_policy(t, t || '_select_staff', 'SELECT',
      $p$(SELECT public.app_is_staff())$p$);
    PERFORM public.app_rls_policy(t, t || '_insert_supplies', 'INSERT',
      NULL,
      $p$(SELECT public.app_has_any_permission(
           ARRAY['register', 'vitals', 'consult', 'dispense', 'inventory']))$p$);
    PERFORM public.app_rls_policy(t, t || '_update_supplies', 'UPDATE',
      $p$(SELECT public.app_has_any_permission(
           ARRAY['register', 'vitals', 'consult', 'dispense', 'inventory']))$p$,
      $p$(SELECT public.app_has_any_permission(
           ARRAY['register', 'vitals', 'consult', 'dispense', 'inventory']))$p$);
    PERFORM public.app_rls_policy(t, t || '_delete_inventory', 'DELETE',
      $p$(SELECT public.app_has_permission('inventory'))$p$);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Patient safety and care records
-- ----------------------------------------------------------------------------
-- Allergies / preferences: any station may record (AllergyManager.tsx,
-- PreferenceManager.tsx); every staff role reads allergies (safety data);
-- a portal patient reads their own.
SELECT public.app_rls_reset('patient_allergies');
SELECT public.app_rls_policy('patient_allergies', 'patient_allergies_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);
SELECT public.app_rls_policy('patient_allergies', 'patient_allergies_insert_station', 'INSERT',
  NULL, $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('patient_allergies', 'patient_allergies_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('patient_allergies', 'patient_allergies_delete_clinician', 'DELETE',
  $p$(SELECT public.app_has_any_permission(ARRAY['users', 'consult']))$p$);

SELECT public.app_rls_reset('patient_preferences');
SELECT public.app_rls_policy('patient_preferences', 'patient_preferences_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);
SELECT public.app_rls_policy('patient_preferences', 'patient_preferences_insert_station', 'INSERT',
  NULL, $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('patient_preferences', 'patient_preferences_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('patient_preferences', 'patient_preferences_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_reset('care_tasks');
SELECT public.app_rls_policy('care_tasks', 'care_tasks_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('care_tasks', 'care_tasks_insert_station', 'INSERT',
  NULL, $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('care_tasks', 'care_tasks_update_station', 'UPDATE',
  $p$(SELECT public.app_is_station_staff())$p$,
  $p$(SELECT public.app_is_station_staff())$p$);
SELECT public.app_rls_policy('care_tasks', 'care_tasks_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- Triage is recorded at the vitals station and by clinicians.
SELECT public.app_rls_reset('triage_records');
SELECT public.app_rls_policy('triage_records', 'triage_records_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('triage_records', 'triage_records_insert', 'INSERT',
  NULL, $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$);
SELECT public.app_rls_policy('triage_records', 'triage_records_update', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$);
SELECT public.app_rls_policy('triage_records', 'triage_records_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- Clinical alerts: the old policies read a role from
-- auth.users.raw_app_meta_data, which the app never sets (dead policies).
SELECT public.app_rls_reset('clinical_alerts');
SELECT public.app_rls_policy('clinical_alerts', 'clinical_alerts_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('clinical_alerts', 'clinical_alerts_insert', 'INSERT',
  NULL, $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$);
SELECT public.app_rls_policy('clinical_alerts', 'clinical_alerts_update', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$);
SELECT public.app_rls_policy('clinical_alerts', 'clinical_alerts_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- Patient merges are the merge audit trail (owner decision #5): append-only.
-- Merging is gated by 'register' in the app (patientDeduplication UI).
SELECT public.app_rls_reset('patient_merges');
SELECT public.app_rls_policy('patient_merges', 'patient_merges_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('patient_merges', 'patient_merges_insert_register', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('register'))$p$);

-- FHIR-style clinical lists (written today only by edge functions with the
-- service role). The old "Patients can view own ..." policies compared
-- patient_id (a patient record id) with auth.uid() and never matched. The
-- procedures / document_references / care_plans / goals / service_requests
-- staff policies also used a hard-coded role list (volunteers could update,
-- lead_clinician was left out) instead of the permission matrix.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'immunizations', 'conditions', 'sdoh_observations', 'procedures',
    'document_references', 'care_plans', 'goals', 'service_requests'
  ] LOOP
    PERFORM public.app_rls_reset(t);
    PERFORM public.app_rls_policy(t, t || '_select', 'SELECT',
      $p$(SELECT public.app_is_staff())
         OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);
    PERFORM public.app_rls_policy(t, t || '_insert_consult', 'INSERT',
      NULL, $p$(SELECT public.app_has_permission('consult'))$p$);
    PERFORM public.app_rls_policy(t, t || '_update_consult', 'UPDATE',
      $p$(SELECT public.app_has_permission('consult'))$p$,
      $p$(SELECT public.app_has_permission('consult'))$p$);
    PERFORM public.app_rls_policy(t, t || '_delete_admin', 'DELETE',
      $p$(SELECT public.app_has_permission('users'))$p$);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Labs (owner decision #2)
-- ----------------------------------------------------------------------------
-- Orders: prescribers order (LabOrderForm: consult); recording staff move the
-- order through collected/completed (LabResultsDashboard: vitals).
SELECT public.app_rls_reset('lab_orders');
SELECT public.app_rls_policy('lab_orders', 'lab_orders_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);
SELECT public.app_rls_policy('lab_orders', 'lab_orders_insert_consult', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('consult'))$p$);
SELECT public.app_rls_policy('lab_orders', 'lab_orders_update_clinical', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))$p$);

-- Results: vitals/consult holders record; only 'lab_review' holders may
-- review (the only UPDATE the app makes) or insert an already-reviewed row.
-- A portal patient sees a result only after review; there is no separate
-- released_to_patient column yet (owner decision #5 follow-up).
SELECT public.app_rls_reset('lab_results');
SELECT public.app_rls_policy('lab_results', 'lab_results_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR (reviewed_at IS NOT NULL
         AND order_id::text IN (
           SELECT lo.id::text FROM public.lab_orders AS lo
            WHERE lo.patient_id::text IN (SELECT public.app_portal_patient_ids())))$p$);
SELECT public.app_rls_policy('lab_results', 'lab_results_insert_record', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))
     AND ((reviewed_at IS NULL AND reviewed_by IS NULL)
          OR (SELECT public.app_has_permission('lab_review')))$p$);
SELECT public.app_rls_policy('lab_results', 'lab_results_update_review', 'UPDATE',
  $p$(SELECT public.app_has_permission('lab_review'))$p$,
  $p$(SELECT public.app_has_permission('lab_review'))$p$);

-- Review marks a result reviewed; it does not rewrite the recorded result.
-- The app never updates these columns (labs.ts reviewLabResult sets only
-- reviewed_by / reviewed_at), so no API caller may change them. A wrong
-- value is corrected by recording a new result. interpretation stays
-- editable for the reviewer (owner decision #2: a clinician chooses it).
DO $$
BEGIN
  IF to_regclass('public.lab_results') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_lab_result_values ON public.lab_results;
    CREATE TRIGGER app_guard_lab_result_values
      BEFORE UPDATE ON public.lab_results
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        '', 'id', 'order_id', 'result_value', 'result_unit',
        'reference_range', 'result_date', 'created_at');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Scheduling and reminders
-- ----------------------------------------------------------------------------
-- Booking is front-desk work (canManageAppointments: register). The
-- televisit policies from 20260910161049 are folded in here.
SELECT public.app_rls_reset('appointments');
SELECT public.app_rls_policy('appointments', 'appointments_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);
SELECT public.app_rls_policy('appointments', 'appointments_insert_register', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('register'))$p$);
SELECT public.app_rls_policy('appointments', 'appointments_update_register', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))$p$,
  $p$(SELECT public.app_has_permission('register'))$p$);

-- The old write policies included the 'guest' role.
SELECT public.app_rls_reset('waitlist');
SELECT public.app_rls_policy('waitlist', 'waitlist_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('waitlist', 'waitlist_insert_register', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('register'))$p$);
SELECT public.app_rls_policy('waitlist', 'waitlist_update_register', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))$p$,
  $p$(SELECT public.app_has_permission('register'))$p$);

-- Medication reminders hold phone numbers and medicine names. Pharmacy
-- (dispense) manages them; clinicians read; a portal patient reads own.
SELECT public.app_rls_reset('medication_reminders');
SELECT public.app_rls_policy('medication_reminders', 'medication_reminders_select', 'SELECT',
  $p$(SELECT public.app_has_any_permission(ARRAY['dispense', 'consult', 'vitals']))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);
SELECT public.app_rls_policy('medication_reminders', 'medication_reminders_insert', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('dispense'))$p$);
SELECT public.app_rls_policy('medication_reminders', 'medication_reminders_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('dispense'))$p$,
  $p$(SELECT public.app_has_permission('dispense'))$p$);
SELECT public.app_rls_policy('medication_reminders', 'medication_reminders_delete', 'DELETE',
  $p$(SELECT public.app_has_permission('dispense'))$p$);

-- Server SMS outbox. Previously any signed-in account (including portal
-- patients) could read and write every row. No client writes it; the
-- send-sms-reminder edge function uses the service role.
SELECT public.app_rls_reset('outbound_messages');
SELECT public.app_rls_policy('outbound_messages', 'outbound_messages_select_staff', 'SELECT',
  $p$(SELECT public.app_has_any_permission(ARRAY['register', 'dispense', 'consult', 'vitals']))$p$);

-- ----------------------------------------------------------------------------
-- audit_logs: every staff member appends; audit_access reads; no edits.
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('audit_logs');
SELECT public.app_rls_policy('audit_logs', 'audit_logs_insert_staff', 'INSERT',
  NULL, $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('audit_logs', 'audit_logs_select_audit', 'SELECT',
  $p$(SELECT public.app_has_permission('audit_access'))$p$);

-- End of migration.
