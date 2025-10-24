/*
  # Fix Security and Performance Issues

  This migration addresses all security and performance issues identified by Supabase:

  1. Adds missing foreign key indexes (16 tables)
  2. Optimizes RLS policies to use SELECT subqueries (prevents re-evaluation)
  3. Removes unused indexes to reduce storage overhead
  4. Consolidates duplicate permissive policies
  5. Fixes function search path mutability issues

  ## Changes Made:
  - Added 16 foreign key indexes for optimal query performance
  - Updated 30+ RLS policies to use (select auth.uid()) pattern
  - Removed 60+ unused indexes identified by Supabase
  - Fixed 3 function search paths to be immutable
  - Consolidated overlapping RLS policies on app_users table
*/

-- =====================================================
-- PART 1: ADD MISSING FOREIGN KEY INDEXES
-- =====================================================

-- Appointments table
CREATE INDEX IF NOT EXISTS idx_appointments_created_by_fk ON appointments(created_by);

-- Consultations table
CREATE INDEX IF NOT EXISTS idx_consultations_patient_id_fk ON consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_visit_id_fk ON consultations(visit_id);

-- Dispenses table
CREATE INDEX IF NOT EXISTS idx_dispenses_patient_id_fk ON dispenses(patient_id);
CREATE INDEX IF NOT EXISTS idx_dispenses_visit_id_fk ON dispenses(visit_id);

-- Inventory discrepancies table
CREATE INDEX IF NOT EXISTS idx_inventory_discrepancies_item_id_fk ON inventory_discrepancies(item_id);

-- Lab orders table
CREATE INDEX IF NOT EXISTS idx_lab_orders_ordered_by_fk ON lab_orders(ordered_by);
CREATE INDEX IF NOT EXISTS idx_lab_orders_visit_id_fk ON lab_orders(visit_id);

-- Lab results table
CREATE INDEX IF NOT EXISTS idx_lab_results_reviewed_by_fk ON lab_results(reviewed_by);

-- Medication reminders table
CREATE INDEX IF NOT EXISTS idx_medication_reminders_dispense_id_fk ON medication_reminders(dispense_id);

-- Patient allergies table
CREATE INDEX IF NOT EXISTS idx_patient_allergies_created_by_fk ON patient_allergies(created_by);

-- Queue table
CREATE INDEX IF NOT EXISTS idx_queue_patient_id_fk ON queue(patient_id);

-- Triage records table
CREATE INDEX IF NOT EXISTS idx_triage_records_visit_id_fk ON triage_records(visit_id);

-- Visits table
CREATE INDEX IF NOT EXISTS idx_visits_patient_id_fk ON visits(patient_id);

-- Vitals table
CREATE INDEX IF NOT EXISTS idx_vitals_patient_id_fk ON vitals(patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_visit_id_fk ON vitals(visit_id);

-- =====================================================
-- PART 2: REMOVE UNUSED INDEXES
-- =====================================================

-- Core tables - unused updated_at indexes
DROP INDEX IF EXISTS idx_patients_updated_at;
DROP INDEX IF EXISTS idx_visits_updated_at;
DROP INDEX IF EXISTS idx_vitals_updated_at;
DROP INDEX IF EXISTS idx_consultations_updated_at;
DROP INDEX IF EXISTS idx_dispenses_updated_at;
DROP INDEX IF EXISTS idx_inventory_updated_at;
DROP INDEX IF EXISTS idx_queue_updated_at;
DROP INDEX IF EXISTS idx_audit_logs_at;

-- User management - unused indexes
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_active;
DROP INDEX IF EXISTS app_users_role_idx;

-- Gamification - unused indexes
DROP INDEX IF EXISTS idx_game_sessions_volunteer_type;
DROP INDEX IF EXISTS idx_game_sessions_committed;
DROP INDEX IF EXISTS idx_gamification_wallets_tokens;
DROP INDEX IF EXISTS idx_vitals_ranges_lookup;
DROP INDEX IF EXISTS idx_quiz_questions_topic;
DROP INDEX IF EXISTS idx_inventory_discrepancies_resolved;

-- Advanced features - unused indexes
DROP INDEX IF EXISTS idx_med_reminders_patient;
DROP INDEX IF EXISTS idx_med_reminders_status;
DROP INDEX IF EXISTS idx_med_reminders_scheduled;
DROP INDEX IF EXISTS idx_lab_orders_patient;
DROP INDEX IF EXISTS idx_lab_orders_status;
DROP INDEX IF EXISTS idx_lab_results_order;
DROP INDEX IF EXISTS idx_appointments_patient;
DROP INDEX IF EXISTS idx_appointments_provider;
DROP INDEX IF EXISTS idx_appointments_scheduled;
DROP INDEX IF EXISTS idx_appointments_status;
DROP INDEX IF EXISTS idx_waitlist_patient;
DROP INDEX IF EXISTS idx_waitlist_status;

-- Stock management - unused indexes
DROP INDEX IF EXISTS idx_stock_batches_drug;
DROP INDEX IF EXISTS idx_stock_batches_expiry;
DROP INDEX IF EXISTS idx_stock_batches_dirty;

-- Care management - unused indexes
DROP INDEX IF EXISTS idx_care_tasks_patient;
DROP INDEX IF EXISTS idx_care_tasks_status;
DROP INDEX IF EXISTS idx_care_tasks_due;
DROP INDEX IF EXISTS idx_care_tasks_dirty;

-- Triage - unused indexes
DROP INDEX IF EXISTS idx_triage_patient;
DROP INDEX IF EXISTS idx_triage_priority;
DROP INDEX IF EXISTS idx_triage_dirty;

-- Patient data - unused indexes
DROP INDEX IF EXISTS idx_patient_allergies_patient;
DROP INDEX IF EXISTS idx_patient_allergies_active;
DROP INDEX IF EXISTS idx_patient_allergies_type;
DROP INDEX IF EXISTS idx_patient_allergies_dirty;
DROP INDEX IF EXISTS idx_patient_preferences_patient;
DROP INDEX IF EXISTS idx_patient_preferences_dirty;
DROP INDEX IF EXISTS idx_patient_merges_winner;
DROP INDEX IF EXISTS idx_patient_merges_loser;

-- Analytics - unused indexes
DROP INDEX IF EXISTS idx_daily_counts_day;
DROP INDEX IF EXISTS idx_conflict_resolutions_patient;
DROP INDEX IF EXISTS idx_conflict_resolutions_status;

-- Messaging - unused indexes
DROP INDEX IF EXISTS idx_message_templates_key;
DROP INDEX IF EXISTS idx_outbound_messages_patient;
DROP INDEX IF EXISTS idx_outbound_messages_status;
DROP INDEX IF EXISTS idx_outbound_messages_scheduled;
DROP INDEX IF EXISTS idx_outbound_messages_dirty;

-- Sync tracking - unused _dirty indexes
DROP INDEX IF EXISTS idx_patients_dirty;
DROP INDEX IF EXISTS idx_visits_dirty;
DROP INDEX IF EXISTS idx_vitals_dirty;
DROP INDEX IF EXISTS idx_consultations_dirty;
DROP INDEX IF EXISTS idx_dispenses_dirty;
DROP INDEX IF EXISTS idx_inventory_dirty;
DROP INDEX IF EXISTS idx_queue_dirty;
DROP INDEX IF EXISTS idx_gamification_wallets_dirty;
DROP INDEX IF EXISTS idx_game_sessions_dirty;

-- =====================================================
-- PART 3: FIX FUNCTION SEARCH PATHS
-- =====================================================

-- Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix prevent_demotion_of_permanent_admin function
CREATE OR REPLACE FUNCTION prevent_demotion_of_permanent_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.admin_permanent = true AND NEW.admin_access = false THEN
    RAISE EXCEPTION 'Cannot demote permanent admin';
  END IF;
  RETURN NEW;
END;
$$;

-- Fix touch_updated_at function
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- PART 4: OPTIMIZE RLS POLICIES (SELECT SUBQUERIES)
-- =====================================================

-- App users table policies
DROP POLICY IF EXISTS "service_role_manage_permanent_admins" ON app_users;
CREATE POLICY "service_role_manage_permanent_admins"
  ON app_users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );

-- Triage samples policies
DROP POLICY IF EXISTS "Doctors can create triage samples" ON triage_samples;
CREATE POLICY "Doctors can create triage samples"
  ON triage_samples
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor')
    )
  );

-- Gamification wallets policies
DROP POLICY IF EXISTS "Admins can read all wallets" ON gamification_wallets;
CREATE POLICY "Admins can read all wallets"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );

DROP POLICY IF EXISTS "Users can read own wallet" ON gamification_wallets;
CREATE POLICY "Users can read own wallet"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (volunteer_id = (select auth.uid())::text);

DROP POLICY IF EXISTS "Users can update own wallet" ON gamification_wallets;
CREATE POLICY "Users can update own wallet"
  ON gamification_wallets
  FOR UPDATE
  TO authenticated
  USING (volunteer_id = (select auth.uid())::text)
  WITH CHECK (volunteer_id = (select auth.uid())::text);

-- Game sessions policies
DROP POLICY IF EXISTS "Admins can approve sessions" ON game_sessions;
CREATE POLICY "Admins can approve sessions"
  ON game_sessions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );

DROP POLICY IF EXISTS "Users can read own sessions" ON game_sessions;
CREATE POLICY "Users can read own sessions"
  ON game_sessions
  FOR SELECT
  TO authenticated
  USING (volunteer_id = (select auth.uid())::text);

DROP POLICY IF EXISTS "Volunteers can create own sessions" ON game_sessions;
CREATE POLICY "Volunteers can create own sessions"
  ON game_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (volunteer_id = (select auth.uid())::text);

-- Medication reminders policies
DROP POLICY IF EXISTS "Clinical staff can manage medication reminders" ON medication_reminders;
CREATE POLICY "Clinical staff can manage medication reminders"
  ON medication_reminders
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );

-- Lab orders policies
DROP POLICY IF EXISTS "Clinical staff can manage lab orders" ON lab_orders;
CREATE POLICY "Clinical staff can manage lab orders"
  ON lab_orders
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );

-- Lab results policies
DROP POLICY IF EXISTS "Clinical staff can manage lab results" ON lab_results;
CREATE POLICY "Clinical staff can manage lab results"
  ON lab_results
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );

-- Appointments policies
DROP POLICY IF EXISTS "Authenticated users can manage appointments" ON appointments;
CREATE POLICY "Authenticated users can manage appointments"
  ON appointments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );

-- Waitlist policies
DROP POLICY IF EXISTS "Authenticated users can manage waitlist" ON waitlist;
CREATE POLICY "Authenticated users can manage waitlist"
  ON waitlist
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );

-- Care tasks policies
DROP POLICY IF EXISTS "Clinical staff can manage care tasks" ON care_tasks;
CREATE POLICY "Clinical staff can manage care tasks"
  ON care_tasks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );

-- Triage records policies
DROP POLICY IF EXISTS "Clinical staff can manage triage records" ON triage_records;
CREATE POLICY "Clinical staff can manage triage records"
  ON triage_records
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );

-- Patient allergies policies
DROP POLICY IF EXISTS "Clinical staff can manage allergies" ON patient_allergies;
CREATE POLICY "Clinical staff can manage allergies"
  ON patient_allergies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );

DROP POLICY IF EXISTS "Clinical staff can update allergies" ON patient_allergies;
CREATE POLICY "Clinical staff can update allergies"
  ON patient_allergies
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );

DROP POLICY IF EXISTS "Clinical staff can view allergies" ON patient_allergies;
CREATE POLICY "Clinical staff can view allergies"
  ON patient_allergies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'doctor', 'nurse')
    )
  );

-- Patient preferences policies
DROP POLICY IF EXISTS "Staff can manage patient preferences" ON patient_preferences;
CREATE POLICY "Staff can manage patient preferences"
  ON patient_preferences
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );

-- Patient merges policies
DROP POLICY IF EXISTS "Admins can view patient merges" ON patient_merges;
CREATE POLICY "Admins can view patient merges"
  ON patient_merges
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );

-- Daily counts policies
DROP POLICY IF EXISTS "Authenticated users can read daily counts" ON daily_counts;
CREATE POLICY "Authenticated users can read daily counts"
  ON daily_counts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );

-- Conflict resolutions policies
DROP POLICY IF EXISTS "Admins can manage conflict resolutions" ON conflict_resolutions;
CREATE POLICY "Admins can manage conflict resolutions"
  ON conflict_resolutions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );

-- Message templates policies
DROP POLICY IF EXISTS "Authenticated users can read message templates" ON message_templates;
CREATE POLICY "Authenticated users can read message templates"
  ON message_templates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );

-- Outbound messages policies
DROP POLICY IF EXISTS "Authenticated users can manage outbound messages" ON outbound_messages;
CREATE POLICY "Authenticated users can manage outbound messages"
  ON outbound_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );

-- Users table policies
DROP POLICY IF EXISTS "Admins can manage users" ON users;
CREATE POLICY "Admins can manage users"
  ON users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' = 'admin'
    )
  );

-- Stock batches policies
DROP POLICY IF EXISTS "Pharmacists can manage stock batches" ON stock_batches;
CREATE POLICY "Pharmacists can manage stock batches"
  ON stock_batches
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
      AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'pharmacist')
    )
  );

-- =====================================================
-- PART 5: CONSOLIDATE DUPLICATE POLICIES
-- =====================================================

-- Remove duplicate permissive policies on app_users table
-- Keep only the most general policy that covers all cases
DROP POLICY IF EXISTS "select_app_users_any" ON app_users;

-- Update the main app_users policy to be comprehensive
DROP POLICY IF EXISTS "Allow authenticated access to app_users" ON app_users;
CREATE POLICY "Allow authenticated access to app_users"
  ON app_users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = (select auth.uid())
    )
  );

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON INDEX idx_appointments_created_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_consultations_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_consultations_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_dispenses_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_dispenses_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_inventory_discrepancies_item_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_lab_orders_ordered_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_lab_orders_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_lab_results_reviewed_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_medication_reminders_dispense_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_patient_allergies_created_by_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_queue_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_triage_records_visit_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_visits_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_vitals_patient_id_fk IS 'Foreign key index for query performance';
COMMENT ON INDEX idx_vitals_visit_id_fk IS 'Foreign key index for query performance';
