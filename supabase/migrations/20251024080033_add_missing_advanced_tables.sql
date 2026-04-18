/*
  # Add Missing Advanced Feature Tables
  
  ## Overview
  This migration adds tables that are currently missing from Supabase but exist in the codebase:
  - medication_reminders (SMS medication adherence)
  - lab_orders (laboratory test tracking)
  - lab_results (lab test results)
  - appointments (patient scheduling)
  - waitlist (appointment waitlist)
  - stock_batches (FEFO pharmacy tracking)
  - care_tasks (follow-up task management)
  - triage_records (patient triage)
  - patient_allergies (allergy tracking)
  - patient_preferences (patient preferences)
  - patient_merges (deduplication audit)
  - daily_counts (analytics)
  - conflict_resolutions (sync conflicts)
  - message_templates (multi-language messaging)
  - outbound_messages (message queue)
  - users (system users with PIN authentication)

  ## Security
  - RLS enabled on all tables
  - Role-based access policies
  - Proper foreign key constraints
  
  ## Indexes
  - Performance indexes on foreign keys
  - Query optimization indexes
*/

-- ============================================================================
-- USERS TABLE (for PIN-based authentication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'doctor', 'nurse', 'pharmacist', 'volunteer', 'guest')),
  email text,
  phone text,
  pin_hash text NOT NULL,
  pin_salt text NOT NULL,
  admin_access boolean NOT NULL DEFAULT false,
  admin_permanent boolean NOT NULL DEFAULT false,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = 1;

-- ============================================================================
-- MEDICATION REMINDERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS medication_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispense_id text REFERENCES dispenses(id) ON DELETE CASCADE,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  medication_name text NOT NULL,
  dosage text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  phone_number text NOT NULL,
  message text NOT NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_med_reminders_patient ON medication_reminders(patient_id);
CREATE INDEX IF NOT EXISTS idx_med_reminders_status ON medication_reminders(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_med_reminders_scheduled ON medication_reminders(scheduled_at);

-- ============================================================================
-- LAB ORDERS AND RESULTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  visit_id text REFERENCES visits(id) ON DELETE SET NULL,
  ordered_by text REFERENCES app_users(id),
  test_name text NOT NULL,
  test_code text,
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'stat')),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'collected', 'processing', 'completed', 'cancelled')),
  specimen_type text,
  clinical_notes text,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES lab_orders(id) ON DELETE CASCADE NOT NULL,
  result_value text NOT NULL,
  result_unit text,
  reference_range text,
  interpretation text NOT NULL DEFAULT 'normal' CHECK (interpretation IN ('normal', 'abnormal', 'critical')),
  result_date timestamptz NOT NULL DEFAULT now(),
  reviewed_by text REFERENCES app_users(id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(status);
CREATE INDEX IF NOT EXISTS idx_lab_results_order ON lab_results(order_id);

-- ============================================================================
-- APPOINTMENTS AND WAITLIST
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  provider_id text REFERENCES app_users(id),
  appointment_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'arrived', 'in-progress', 'completed', 'no-show', 'cancelled')),
  reason text,
  notes text,
  reminder_sent boolean NOT NULL DEFAULT false,
  reminder_sent_at timestamptz,
  created_by text REFERENCES app_users(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  appointment_type text NOT NULL,
  preferred_dates jsonb,
  reason text,
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent')),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'scheduled', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments(provider_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_patient ON waitlist(patient_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);

-- ============================================================================
-- PHARMACY STOCK BATCHES (FEFO)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_batches (
  id text PRIMARY KEY,
  drug_id text NOT NULL,
  lot_number text NOT NULL,
  expiry_date date NOT NULL,
  qty_on_hand integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  supplier text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stock_batches_drug ON stock_batches(drug_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry ON stock_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_stock_batches_dirty ON stock_batches(_dirty) WHERE _dirty > 0;

-- ============================================================================
-- CARE TASKS
-- ============================================================================
CREATE TABLE IF NOT EXISTS care_tasks (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN ('follow_up', 'medication_refill', 'test_review', 'vaccination', 'checkup')),
  title text NOT NULL,
  description text,
  due_date date NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  assigned_to text,
  completed_at timestamptz,
  completed_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_care_tasks_patient ON care_tasks(patient_id);
CREATE INDEX IF NOT EXISTS idx_care_tasks_status ON care_tasks(status);
CREATE INDEX IF NOT EXISTS idx_care_tasks_due ON care_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_care_tasks_dirty ON care_tasks(_dirty) WHERE _dirty > 0;

-- ============================================================================
-- TRIAGE RECORDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS triage_records (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  visit_id text REFERENCES visits(id) ON DELETE CASCADE,
  priority text NOT NULL CHECK (priority IN ('urgent', 'normal', 'low')),
  chief_complaint text NOT NULL,
  notes text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_triage_patient ON triage_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_triage_priority ON triage_records(priority);
CREATE INDEX IF NOT EXISTS idx_triage_dirty ON triage_records(_dirty) WHERE _dirty > 0;

-- ============================================================================
-- PATIENT ALLERGIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS patient_allergies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  allergen text NOT NULL,
  allergy_type text NOT NULL CHECK (allergy_type IN ('medication', 'food', 'environmental', 'other')),
  reaction text,
  severity text NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe', 'life-threatening')),
  onset_date date,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text REFERENCES app_users(id),
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_patient_allergies_patient ON patient_allergies(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_active ON patient_allergies(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_patient_allergies_type ON patient_allergies(allergy_type);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_dirty ON patient_allergies(_dirty) WHERE _dirty > 0;

-- ============================================================================
-- PATIENT PREFERENCES
-- ============================================================================
CREATE TABLE IF NOT EXISTS patient_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text UNIQUE REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  preferred_language text,
  communication_channel text CHECK (communication_channel IN ('sms', 'whatsapp', 'call', 'in-person')),
  best_contact_time text,
  dietary_restrictions text,
  religious_cultural text,
  appointment_reminders boolean NOT NULL DEFAULT true,
  medication_reminders boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_patient_preferences_patient ON patient_preferences(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_preferences_dirty ON patient_preferences(_dirty) WHERE _dirty > 0;

-- ============================================================================
-- PATIENT MERGES (AUDIT TRAIL)
-- ============================================================================
CREATE TABLE IF NOT EXISTS patient_merges (
  id text PRIMARY KEY,
  winner_id text REFERENCES patients(id) NOT NULL,
  loser_id text NOT NULL,
  merged_by text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_merges_winner ON patient_merges(winner_id);
CREATE INDEX IF NOT EXISTS idx_patient_merges_loser ON patient_merges(loser_id);

-- ============================================================================
-- DAILY COUNTS (ANALYTICS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_counts (
  day integer PRIMARY KEY,
  registrations integer NOT NULL DEFAULT 0,
  vitals integer NOT NULL DEFAULT 0,
  consultations integer NOT NULL DEFAULT 0,
  dispenses integer NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_counts_day ON daily_counts(day DESC);

-- ============================================================================
-- CONFLICT RESOLUTIONS (SYNC)
-- ============================================================================
CREATE TABLE IF NOT EXISTS conflict_resolutions (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN ('duplicate', 'sync_conflict')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
  candidate_ids text[] NOT NULL,
  resolved_by text,
  resolved_at timestamptz,
  resolution jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_patient ON conflict_resolutions(patient_id);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_status ON conflict_resolutions(status);

-- ============================================================================
-- MESSAGE TEMPLATES
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_templates (
  key text NOT NULL,
  locale text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  subject text,
  body text NOT NULL,
  max_length integer NOT NULL DEFAULT 160,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, locale, channel)
);

CREATE INDEX IF NOT EXISTS idx_message_templates_key ON message_templates(key);

-- ============================================================================
-- OUTBOUND MESSAGES (MESSAGE QUEUE)
-- ============================================================================
CREATE TABLE IF NOT EXISTS outbound_messages (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  to_number text NOT NULL,
  locale text NOT NULL,
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  error_message text,
  _dirty integer DEFAULT 0,
  _synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_patient ON outbound_messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_status ON outbound_messages(status);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_scheduled ON outbound_messages(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_dirty ON outbound_messages(_dirty) WHERE _dirty > 0;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;

-- Users - admins only
CREATE POLICY "Admins can manage users"
  ON users FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text AND app_users.role = 'admin'
    )
  );

-- Medication Reminders - pharmacists and above
CREATE POLICY "Clinical staff can manage medication reminders"
  ON medication_reminders FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );

-- Lab Orders - clinical staff
CREATE POLICY "Clinical staff can manage lab orders"
  ON lab_orders FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Lab Results - clinical staff
CREATE POLICY "Clinical staff can manage lab results"
  ON lab_results FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Appointments - authenticated users
CREATE POLICY "Authenticated users can manage appointments"
  ON appointments FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Waitlist - authenticated users
CREATE POLICY "Authenticated users can manage waitlist"
  ON waitlist FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Stock Batches - pharmacists
CREATE POLICY "Pharmacists can manage stock batches"
  ON stock_batches FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'pharmacist')
    )
  );

-- Care Tasks - clinical staff
CREATE POLICY "Clinical staff can manage care tasks"
  ON care_tasks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Triage Records - clinical staff
CREATE POLICY "Clinical staff can manage triage records"
  ON triage_records FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Patient Allergies - clinical staff
CREATE POLICY "Clinical staff can view allergies"
  ON patient_allergies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );

CREATE POLICY "Clinical staff can manage allergies"
  ON patient_allergies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

CREATE POLICY "Clinical staff can update allergies"
  ON patient_allergies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Patient Preferences - all staff
CREATE POLICY "Staff can manage patient preferences"
  ON patient_preferences FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
    )
  );

-- Patient Merges - admins only
CREATE POLICY "Admins can view patient merges"
  ON patient_merges FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text AND app_users.role = 'admin'
    )
  );

-- Daily Counts - all authenticated users can read
CREATE POLICY "Authenticated users can read daily counts"
  ON daily_counts FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Conflict Resolutions - admins only
CREATE POLICY "Admins can manage conflict resolutions"
  ON conflict_resolutions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text AND app_users.role = 'admin'
    )
  );

-- Message Templates - authenticated users can read
CREATE POLICY "Authenticated users can read message templates"
  ON message_templates FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Outbound Messages - authenticated users
CREATE POLICY "Authenticated users can manage outbound messages"
  ON outbound_messages FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_medication_reminders_updated_at ON medication_reminders;
CREATE TRIGGER update_medication_reminders_updated_at
  BEFORE UPDATE ON medication_reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lab_orders_updated_at ON lab_orders;
CREATE TRIGGER update_lab_orders_updated_at
  BEFORE UPDATE ON lab_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lab_results_updated_at ON lab_results;
CREATE TRIGGER update_lab_results_updated_at
  BEFORE UPDATE ON lab_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_waitlist_updated_at ON waitlist;
CREATE TRIGGER update_waitlist_updated_at
  BEFORE UPDATE ON waitlist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_stock_batches_updated_at ON stock_batches;
CREATE TRIGGER update_stock_batches_updated_at
  BEFORE UPDATE ON stock_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_care_tasks_updated_at ON care_tasks;
CREATE TRIGGER update_care_tasks_updated_at
  BEFORE UPDATE ON care_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_triage_records_updated_at ON triage_records;
CREATE TRIGGER update_triage_records_updated_at
  BEFORE UPDATE ON triage_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_allergies_updated_at ON patient_allergies;
CREATE TRIGGER update_patient_allergies_updated_at
  BEFORE UPDATE ON patient_allergies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_preferences_updated_at ON patient_preferences;
CREATE TRIGGER update_patient_preferences_updated_at
  BEFORE UPDATE ON patient_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
