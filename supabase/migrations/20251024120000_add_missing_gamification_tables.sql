/*
  # Add Missing Gamification and Advanced Tables

  ## Overview
  This migration adds all remaining tables that exist in Dexie but are missing in Supabase.
  Ensures complete parity between local (Dexie) and cloud (Supabase) databases.

  ## New Tables

  ### 1. game_sessions
  Tracks gamification game play sessions for volunteers.
  - Stores scores, tokens earned, and game metadata
  - Links to gamification_wallets for token accumulation

  ### 2. gamification_wallets
  Tracks user tokens, badges, levels, and streaks.
  - One wallet per volunteer
  - Accumulates lifetime tokens and maintains current balance

  ### 3. vitals_ranges
  Reference ranges for vital signs by age and sex.
  - Used for automatic flagging of abnormal vitals
  - Supports pediatric and adult ranges

  ### 4. quiz_questions
  Knowledge assessment questions for gamification.
  - Multiple choice format with explanations
  - Categorized by topic and difficulty

  ### 5. triage_samples
  Training samples for triage decision-making games.
  - Gold standard priority assignments
  - Used for education and skills assessment

  ### 6. triage_records
  Actual triage assessments performed on patients.
  - Links to visits and patients
  - Tracks priority assignment and chief complaints

  ### 7. inventory_discrepancies
  Physical inventory count discrepancies.
  - Tracks differences between system and physical counts
  - Supports photo evidence and resolution workflow

  ### 8. stock_batches
  Individual batches/lots of medications.
  - FEFO (First Expiry First Out) tracking
  - Links to inventory items

  ### 9. care_tasks
  Follow-up tasks and reminders for patient care.
  - Medication reminders, follow-up visits, lab tests
  - Status tracking and due date management

  ### 10. patient_merges
  Audit trail of patient record merges.
  - Tracks duplicate resolution
  - Preserves merge history for data integrity

  ### 11. daily_counts
  Daily operational statistics.
  - Fast analytics without scanning all tables
  - Tracks registrations, vitals, consultations, etc.

  ### 12. conflict_resolutions
  Sync conflict resolution tracking.
  - Manages data conflicts between devices
  - Supports manual and automatic resolution

  ### 13. message_templates
  SMS/WhatsApp message templates.
  - Multi-language support
  - Template variables for personalization

  ## Security
  - All tables have Row Level Security (RLS) enabled
  - Role-based access policies applied
  - Audit-friendly with timestamps

  ## Performance
  - Indexes on foreign keys and frequently queried fields
  - Optimized for offline-first sync patterns
*/

-- game_sessions table
CREATE TABLE IF NOT EXISTS game_sessions (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('vitals', 'shelf', 'quiz', 'triage')),
  volunteer_id text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  score integer NOT NULL DEFAULT 0,
  tokens_earned integer NOT NULL DEFAULT 0,
  payload_json text,
  committed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- gamification_wallets table
CREATE TABLE IF NOT EXISTS gamification_wallets (
  volunteer_id text PRIMARY KEY,
  tokens integer NOT NULL DEFAULT 0,
  badges jsonb NOT NULL DEFAULT '[]'::jsonb,
  level integer NOT NULL DEFAULT 1,
  streak_days integer NOT NULL DEFAULT 0,
  lifetime_tokens integer NOT NULL DEFAULT 0,
  last_active_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- vitals_ranges table
CREATE TABLE IF NOT EXISTS vitals_ranges (
  id text PRIMARY KEY,
  age_min integer NOT NULL,
  age_max integer NOT NULL,
  sex text NOT NULL CHECK (sex IN ('M', 'F', 'U')),
  metric text NOT NULL CHECK (metric IN ('hr', 'rr', 'temp', 'sbp', 'dbp', 'spo2')),
  min_value numeric NOT NULL,
  max_value numeric NOT NULL,
  source text NOT NULL DEFAULT 'WHO',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- quiz_questions table
CREATE TABLE IF NOT EXISTS quiz_questions (
  id text PRIMARY KEY,
  topic text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  stem text NOT NULL,
  choices jsonb NOT NULL,
  answer_index integer NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- triage_samples table
CREATE TABLE IF NOT EXISTS triage_samples (
  id text PRIMARY KEY,
  case_hash text NOT NULL,
  gold_priority text NOT NULL CHECK (gold_priority IN ('urgent', 'normal', 'low')),
  case_data jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- triage_records table
CREATE TABLE IF NOT EXISTS triage_records (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  visit_id text REFERENCES visits(id) ON DELETE CASCADE,
  priority text NOT NULL CHECK (priority IN ('urgent', 'normal', 'low')),
  chief_complaint text NOT NULL,
  notes text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- inventory_discrepancies table
CREATE TABLE IF NOT EXISTS inventory_discrepancies (
  id text PRIMARY KEY,
  item_id text REFERENCES inventory(id) ON DELETE CASCADE NOT NULL,
  found_qty integer NOT NULL,
  system_qty integer NOT NULL,
  difference integer GENERATED ALWAYS AS (found_qty - system_qty) STORED,
  photo_url text,
  note text,
  resolved_at timestamptz,
  resolved_by text,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- stock_batches table
CREATE TABLE IF NOT EXISTS stock_batches (
  id text PRIMARY KEY,
  drug_id text REFERENCES inventory(id) ON DELETE CASCADE NOT NULL,
  lot_number text NOT NULL,
  expiry_date date NOT NULL,
  qty_on_hand integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  supplier text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- care_tasks table
CREATE TABLE IF NOT EXISTS care_tasks (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN ('medication_reminder', 'followup_visit', 'lab_test', 'vital_check')),
  title text NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'overdue', 'cancelled')) DEFAULT 'pending',
  due_date timestamptz NOT NULL,
  completed_at timestamptz,
  completed_by text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- patient_merges table
CREATE TABLE IF NOT EXISTS patient_merges (
  id text PRIMARY KEY,
  winner_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  loser_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  merged_by text NOT NULL,
  reason text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- daily_counts table
CREATE TABLE IF NOT EXISTS daily_counts (
  day integer PRIMARY KEY,
  registrations integer NOT NULL DEFAULT 0,
  vitals integer NOT NULL DEFAULT 0,
  consultations integer NOT NULL DEFAULT 0,
  dispenses integer NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- conflict_resolutions table
CREATE TABLE IF NOT EXISTS conflict_resolutions (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN ('duplicate', 'sync_conflict', 'version_mismatch')),
  status text NOT NULL CHECK (status IN ('pending', 'resolved', 'ignored')) DEFAULT 'pending',
  local_data jsonb,
  remote_data jsonb,
  resolution_data jsonb,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- message_templates table
CREATE TABLE IF NOT EXISTS message_templates (
  key text NOT NULL,
  locale text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  subject text,
  body text NOT NULL,
  max_length integer NOT NULL DEFAULT 160,
  variables jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, locale, channel)
);

-- Enable Row Level Security
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitals_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for game_sessions
CREATE POLICY "Users can view own game sessions"
  ON game_sessions FOR SELECT
  TO authenticated
  USING (volunteer_id = auth.uid()::text OR auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));

CREATE POLICY "Users can create own game sessions"
  ON game_sessions FOR INSERT
  TO authenticated
  WITH CHECK (volunteer_id = auth.uid()::text);

CREATE POLICY "Users can update own game sessions"
  ON game_sessions FOR UPDATE
  TO authenticated
  USING (volunteer_id = auth.uid()::text);

-- RLS Policies for gamification_wallets
CREATE POLICY "Users can view own wallet"
  ON gamification_wallets FOR SELECT
  TO authenticated
  USING (volunteer_id = auth.uid()::text OR auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));

CREATE POLICY "Users can update own wallet"
  ON gamification_wallets FOR UPDATE
  TO authenticated
  USING (volunteer_id = auth.uid()::text);

CREATE POLICY "System can create wallets"
  ON gamification_wallets FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for vitals_ranges (read-only reference data)
CREATE POLICY "Authenticated users can view vitals ranges"
  ON vitals_ranges FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage vitals ranges"
  ON vitals_ranges FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));

-- RLS Policies for quiz_questions (read-only for users)
CREATE POLICY "Authenticated users can view quiz questions"
  ON quiz_questions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage quiz questions"
  ON quiz_questions FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));

-- RLS Policies for triage_samples
CREATE POLICY "Authenticated users can view triage samples"
  ON triage_samples FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can create triage samples"
  ON triage_samples FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('nurse', 'doctor', 'admin')));

-- RLS Policies for triage_records
CREATE POLICY "Authenticated users can view triage records"
  ON triage_records FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can create triage records"
  ON triage_records FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'admin')));

CREATE POLICY "Staff can update triage records"
  ON triage_records FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'admin')));

-- RLS Policies for inventory_discrepancies
CREATE POLICY "Staff can view inventory discrepancies"
  ON inventory_discrepancies FOR SELECT
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));

CREATE POLICY "Staff can create inventory discrepancies"
  ON inventory_discrepancies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));

CREATE POLICY "Staff can update inventory discrepancies"
  ON inventory_discrepancies FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));

-- RLS Policies for stock_batches
CREATE POLICY "Staff can view stock batches"
  ON stock_batches FOR SELECT
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));

CREATE POLICY "Staff can create stock batches"
  ON stock_batches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));

CREATE POLICY "Staff can update stock batches"
  ON stock_batches FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));

-- RLS Policies for care_tasks
CREATE POLICY "Staff can view care tasks"
  ON care_tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can create care tasks"
  ON care_tasks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'pharmacist', 'admin')));

CREATE POLICY "Staff can update care tasks"
  ON care_tasks FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'pharmacist', 'admin')));

-- RLS Policies for patient_merges
CREATE POLICY "Staff can view patient merges"
  ON patient_merges FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authorized staff can create patient merges"
  ON patient_merges FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('nurse', 'doctor', 'admin')));

-- RLS Policies for daily_counts
CREATE POLICY "Authenticated users can view daily counts"
  ON daily_counts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage daily counts"
  ON daily_counts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for conflict_resolutions
CREATE POLICY "Staff can view conflict resolutions"
  ON conflict_resolutions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage conflict resolutions"
  ON conflict_resolutions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for message_templates
CREATE POLICY "Authenticated users can view message templates"
  ON message_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage message templates"
  ON message_templates FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_sessions_volunteer ON game_sessions(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_type ON game_sessions(type);
CREATE INDEX IF NOT EXISTS idx_game_sessions_started ON game_sessions(started_at);

CREATE INDEX IF NOT EXISTS idx_vitals_ranges_metric ON vitals_ranges(metric);
CREATE INDEX IF NOT EXISTS idx_vitals_ranges_age ON vitals_ranges(age_min, age_max);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_topic ON quiz_questions(topic);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_difficulty ON quiz_questions(difficulty);

CREATE INDEX IF NOT EXISTS idx_triage_records_patient ON triage_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_triage_records_visit ON triage_records(visit_id);
CREATE INDEX IF NOT EXISTS idx_triage_records_priority ON triage_records(priority);

CREATE INDEX IF NOT EXISTS idx_inventory_discrepancies_item ON inventory_discrepancies(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_discrepancies_resolved ON inventory_discrepancies(resolved_at);

CREATE INDEX IF NOT EXISTS idx_stock_batches_drug ON stock_batches(drug_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry ON stock_batches(expiry_date);

CREATE INDEX IF NOT EXISTS idx_care_tasks_patient ON care_tasks(patient_id);
CREATE INDEX IF NOT EXISTS idx_care_tasks_status ON care_tasks(status);
CREATE INDEX IF NOT EXISTS idx_care_tasks_due ON care_tasks(due_date);

CREATE INDEX IF NOT EXISTS idx_patient_merges_winner ON patient_merges(winner_id);
CREATE INDEX IF NOT EXISTS idx_patient_merges_loser ON patient_merges(loser_id);

CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_status ON conflict_resolutions(status);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_type ON conflict_resolutions(conflict_type);

-- Create updated_at triggers
CREATE TRIGGER update_game_sessions_updated_at BEFORE UPDATE ON game_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gamification_wallets_updated_at BEFORE UPDATE ON gamification_wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vitals_ranges_updated_at BEFORE UPDATE ON vitals_ranges FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quiz_questions_updated_at BEFORE UPDATE ON quiz_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_triage_records_updated_at BEFORE UPDATE ON triage_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_discrepancies_updated_at BEFORE UPDATE ON inventory_discrepancies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_stock_batches_updated_at BEFORE UPDATE ON stock_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_care_tasks_updated_at BEFORE UPDATE ON care_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_daily_counts_updated_at BEFORE UPDATE ON daily_counts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_message_templates_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
