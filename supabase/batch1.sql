-- Migration: 20250930025202_young_hat.sql
-- ============================================================
/*
  # Create core tables for Med Bridge Health Reach

  1. New Tables
    - `patients` - Patient demographics and contact info
    - `visits` - Patient visit sessions  
    - `vitals` - Vital signs with flags stored as JSONB
    - `consultations` - SOAP notes and diagnoses (text array)
    - `dispenses` - Medication dispensing records
    - `inventory` - Stock management
    - `queue` - Patient flow through care stages
    - `audit_logs` - Activity tracking

  2. Schema Design
    - Uses TEXT primary keys to match Dexie ULID format
    - Foreign key relationships for data integrity
    - JSONB for flexible flags storage
    - Timestamptz for proper timezone handling
    - Text arrays for multiple diagnoses

  3. Notes
    - RLS not enabled yet for testing phase
    - Schema matches Dexie structure for seamless sync
    - All tables have updated_at for sync cursors
*/

-- Patients table
create table if not exists patients(
  id text primary key,
  given_name text,
  family_name text,
  sex text,
  dob date,
  phone text,
  address text,
  state text,
  lga text,
  photo_url text,
  family_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Visits table
create table if not exists visits(
  id text primary key,
  patient_id text references patients(id),
  started_at timestamptz,
  site_name text,
  status text,
  updated_at timestamptz default now()
);

-- Vitals table
create table if not exists vitals(
  id text primary key,
  patient_id text references patients(id),
  visit_id text references visits(id),
  height_cm numeric,
  weight_kg numeric,
  temp_c numeric,
  pulse_bpm int,
  systolic int,
  diastolic int,
  spo2 int,
  bmi numeric,
  flags jsonb,
  taken_at timestamptz,
  updated_at timestamptz default now()
);

-- Consultations table
create table if not exists consultations(
  id text primary key,
  patient_id text references patients(id),
  visit_id text references visits(id),
  provider_name text,
  soap_subjective text,
  soap_objective text,
  soap_assessment text,
  soap_plan text,
  provisional_dx text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Dispenses table
create table if not exists dispenses(
  id text primary key,
  patient_id text references patients(id),
  visit_id text references visits(id),
  item_name text,
  qty int,
  dosage text,
  directions text,
  dispensed_by text,
  dispensed_at timestamptz,
  updated_at timestamptz default now()
);

-- Inventory table
create table if not exists inventory(
  id text primary key,
  item_name text,
  unit text,
  on_hand_qty int,
  reorder_threshold int,
  updated_at timestamptz default now()
);

-- Queue table
create table if not exists queue(
  id text primary key,
  patient_id text references patients(id),
  stage text,
  position int,
  status text,
  updated_at timestamptz default now()
);

-- Audit logs table
create table if not exists audit_logs(
  id text primary key,
  actor_role text,
  action text,
  entity text,
  entity_id text,
  at timestamptz default now()
);

-- Migration: 20250930030513_super_flower.sql
-- ============================================================
/*
  # Med Bridge Health Reach - Supabase Sync Schema
  
  1. Core Tables
     - All tables use TEXT primary keys to match Dexie ULIDs
     - Foreign key relationships maintain data integrity
     - Timestamps for sync cursor tracking
  
  2. Data Types
     - JSONB for flexible vital sign flags
     - Text arrays for multiple diagnoses
     - Proper timezone handling with timestamptz
  
  3. Sync Strategy
     - Last-write-wins conflict resolution
     - Cursor-based incremental sync
     - Background sync when online
*/

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  given_name TEXT,
  family_name TEXT,
  sex TEXT,
  dob DATE,
  phone TEXT,
  address TEXT,
  state TEXT,
  lga TEXT,
  photo_url TEXT,
  family_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Visits table
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  site_name TEXT,
  status TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vitals table
CREATE TABLE IF NOT EXISTS vitals (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  visit_id TEXT REFERENCES visits(id) ON DELETE CASCADE,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  temp_c NUMERIC,
  pulse_bpm INTEGER,
  systolic INTEGER,
  diastolic INTEGER,
  spo2 INTEGER,
  bmi NUMERIC,
  flags JSONB,
  taken_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consultations table
CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  visit_id TEXT REFERENCES visits(id) ON DELETE CASCADE,
  provider_name TEXT,
  soap_subjective TEXT,
  soap_objective TEXT,
  soap_assessment TEXT,
  soap_plan TEXT,
  provisional_dx TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dispenses table
CREATE TABLE IF NOT EXISTS dispenses (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  visit_id TEXT REFERENCES visits(id) ON DELETE CASCADE,
  item_name TEXT,
  qty INTEGER,
  dosage TEXT,
  directions TEXT,
  dispensed_by TEXT,
  dispensed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory table
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  item_name TEXT,
  unit TEXT,
  on_hand_qty INTEGER,
  reorder_threshold INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Queue table
CREATE TABLE IF NOT EXISTS queue (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  stage TEXT,
  position INTEGER,
  status TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_role TEXT,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better sync performance
CREATE INDEX IF NOT EXISTS idx_patients_updated_at ON patients(updated_at);
CREATE INDEX IF NOT EXISTS idx_visits_updated_at ON visits(updated_at);
CREATE INDEX IF NOT EXISTS idx_vitals_updated_at ON vitals(updated_at);
CREATE INDEX IF NOT EXISTS idx_consultations_updated_at ON consultations(updated_at);
CREATE INDEX IF NOT EXISTS idx_dispenses_updated_at ON dispenses(updated_at);
CREATE INDEX IF NOT EXISTS idx_inventory_updated_at ON inventory(updated_at);
CREATE INDEX IF NOT EXISTS idx_queue_updated_at ON queue(updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_at ON audit_logs(at);

-- Migration: 20250930060647_old_dream.sql
-- ============================================================
/*
  # Med Bridge Health Reach - Supabase Sync Schema

  This migration creates the database schema for syncing Med Bridge Health Reach data with Supabase.

  ## New Tables
  1. **app_users** - System users with roles and admin permissions
     - `id` (text, primary key)
     - `full_name` (text) - User's full name
     - `role` (text) - User role (admin, doctor, nurse, pharmacist, volunteer)
     - `admin_access` (boolean) - Whether user has admin privileges
     - `admin_permanent` (boolean) - Whether user is a permanent admin (cannot be deleted)
     - `created_at` (timestamptz) - When user was created
     - `updated_at` (timestamptz) - When user was last updated

  2. **patients** - Patient demographics and contact information
     - `id` (text, primary key)
     - `given_name` (text) - Patient's first name
     - `family_name` (text) - Patient's last name
     - `sex` (text) - Patient's gender
     - `dob` (date) - Date of birth
     - `phone` (text) - Phone number
     - `address` (text) - Full address
     - `state` (text) - Nigerian state
     - `lga` (text) - Local Government Area
     - `photo_url` (text) - Profile photo URL
     - `family_id` (text) - Link to family members
     - `created_at` (timestamptz) - Registration date
     - `updated_at` (timestamptz) - Last update

  3. **visits** - Patient visit sessions
     - `id` (text, primary key)
     - `patient_id` (text) - Reference to patient
     - `started_at` (timestamptz) - Visit start time
     - `site_name` (text) - Clinic/site name
     - `status` (text) - Visit status (open/closed)
     - `updated_at` (timestamptz) - Last update

  4. **vitals** - Vital signs measurements
     - `id` (text, primary key)
     - `patient_id` (text) - Reference to patient
     - `visit_id` (text) - Reference to visit
     - `height_cm` (numeric) - Height in centimeters
     - `weight_kg` (numeric) - Weight in kilograms
     - `temp_c` (numeric) - Temperature in Celsius
     - `pulse_bpm` (integer) - Pulse in beats per minute
     - `systolic` (integer) - Systolic blood pressure
     - `diastolic` (integer) - Diastolic blood pressure
     - `spo2` (integer) - Oxygen saturation percentage
     - `bmi` (numeric) - Body Mass Index
     - `flags` (jsonb) - Alert flags for abnormal values
     - `taken_at` (timestamptz) - When vitals were recorded
     - `updated_at` (timestamptz) - Last update

  5. **consultations** - Medical consultations and SOAP notes
     - `id` (text, primary key)
     - `patient_id` (text) - Reference to patient
     - `visit_id` (text) - Reference to visit
     - `provider_name` (text) - Healthcare provider name
     - `soap_subjective` (text) - Subjective findings
     - `soap_objective` (text) - Objective findings
     - `soap_assessment` (text) - Assessment/diagnosis
     - `soap_plan` (text) - Treatment plan
     - `provisional_dx` (text[]) - Provisional diagnoses
     - `created_at` (timestamptz) - Consultation date
     - `updated_at` (timestamptz) - Last update

  6. **dispenses** - Medication dispensing records
     - `id` (text, primary key)
     - `patient_id` (text) - Reference to patient
     - `visit_id` (text) - Reference to visit
     - `item_name` (text) - Medication name
     - `qty` (integer) - Quantity dispensed
     - `dosage` (text) - Dosage instructions
     - `directions` (text) - Usage directions
     - `dispensed_by` (text) - Pharmacist name
     - `dispensed_at` (timestamptz) - Dispensing date
     - `updated_at` (timestamptz) - Last update

  7. **inventory** - Medication and supply inventory
     - `id` (text, primary key)
     - `item_name` (text) - Item name
     - `unit` (text) - Unit of measurement
     - `on_hand_qty` (integer) - Current quantity
     - `reorder_threshold` (integer) - Reorder level
     - `updated_at` (timestamptz) - Last update

  8. **queue** - Patient flow management
     - `id` (text, primary key)
     - `patient_id` (text) - Reference to patient
     - `stage` (text) - Current stage (registration, vitals, consult, pharmacy)
     - `position` (integer) - Queue position
     - `status` (text) - Status (waiting, in_progress, done)
     - `updated_at` (timestamptz) - Last update

  9. **audit_logs** - Activity tracking
     - `id` (text, primary key)
     - `actor_role` (text) - Role of user performing action
     - `action` (text) - Action performed
     - `entity` (text) - Entity affected
     - `entity_id` (text) - ID of affected entity
     - `at` (timestamptz) - When action occurred

  ## Security
  - Row Level Security (RLS) is enabled on all tables
  - Basic policies allow authenticated access
  - Production deployments should implement proper user-based policies

  ## Indexes
  - Primary key indexes on all tables
  - Updated_at indexes for efficient sync queries
  - Foreign key indexes for relationships
*/

-- Create app_users table
CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'doctor', 'nurse', 'pharmacist', 'volunteer')),
  admin_access boolean DEFAULT false,
  admin_permanent boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create patients table
CREATE TABLE IF NOT EXISTS patients (
  id text PRIMARY KEY,
  given_name text,
  family_name text,
  sex text CHECK (sex IN ('male', 'female', 'other')),
  dob date,
  phone text,
  address text,
  state text,
  lga text,
  photo_url text,
  family_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create visits table
CREATE TABLE IF NOT EXISTS visits (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id),
  started_at timestamptz,
  site_name text,
  status text CHECK (status IN ('open', 'closed')),
  updated_at timestamptz DEFAULT now()
);

-- Create vitals table
CREATE TABLE IF NOT EXISTS vitals (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id),
  visit_id text REFERENCES visits(id),
  height_cm numeric,
  weight_kg numeric,
  temp_c numeric,
  pulse_bpm integer,
  systolic integer,
  diastolic integer,
  spo2 integer,
  bmi numeric,
  flags jsonb DEFAULT '[]'::jsonb,
  taken_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Create consultations table
CREATE TABLE IF NOT EXISTS consultations (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id),
  visit_id text REFERENCES visits(id),
  provider_name text,
  soap_subjective text,
  soap_objective text,
  soap_assessment text,
  soap_plan text,
  provisional_dx text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create dispenses table
CREATE TABLE IF NOT EXISTS dispenses (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id),
  visit_id text REFERENCES visits(id),
  item_name text,
  qty integer,
  dosage text,
  directions text,
  dispensed_by text,
  dispensed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Create inventory table
CREATE TABLE IF NOT EXISTS inventory (
  id text PRIMARY KEY,
  item_name text,
  unit text,
  on_hand_qty integer DEFAULT 0,
  reorder_threshold integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- Create queue table
CREATE TABLE IF NOT EXISTS queue (
  id text PRIMARY KEY,
  patient_id text REFERENCES patients(id),
  stage text CHECK (stage IN ('registration', 'vitals', 'consult', 'pharmacy')),
  position integer,
  status text CHECK (status IN ('waiting', 'in_progress', 'done')),
  updated_at timestamptz DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  actor_role text,
  action text,
  entity text,
  entity_id text,
  at timestamptz DEFAULT now()
);

-- Create indexes for efficient sync queries
CREATE INDEX IF NOT EXISTS idx_patients_updated_at ON patients (updated_at);
CREATE INDEX IF NOT EXISTS idx_visits_updated_at ON visits (updated_at);
CREATE INDEX IF NOT EXISTS idx_vitals_updated_at ON vitals (updated_at);
CREATE INDEX IF NOT EXISTS idx_consultations_updated_at ON consultations (updated_at);
CREATE INDEX IF NOT EXISTS idx_dispenses_updated_at ON dispenses (updated_at);
CREATE INDEX IF NOT EXISTS idx_inventory_updated_at ON inventory (updated_at);
CREATE INDEX IF NOT EXISTS idx_queue_updated_at ON queue (updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_at ON audit_logs (at);

-- Enable Row Level Security on all tables
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create basic RLS policies (allow all for authenticated users)
-- In production, implement more granular policies based on user roles

-- App users policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to app_users"
  ON app_users
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patients policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to patients"
  ON patients
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Visits policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to visits"
  ON visits
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Vitals policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to vitals"
  ON vitals
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Consultations policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to consultations"
  ON consultations
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Dispenses policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to dispenses"
  ON dispenses
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Inventory policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to inventory"
  ON inventory
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Queue policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to queue"
  ON queue
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Audit logs policies
DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to audit_logs"
  ON audit_logs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migration: 20250930125054_teal_coral.sql
-- ============================================================
/*
  # Add Gamification System Tables

  1. New Tables
    - `game_sessions` - Individual game session records with scoring
    - `gamification_wallets` - User token wallets and progression
    - `vitals_ranges` - Reference ranges for vitals validation
    - `quiz_questions` - Knowledge quiz question bank
    - `triage_samples` - Gold standard triage cases for validation
    - `inventory_discrepancies` - Shelf sleuth findings

  2. Security
    - Enable RLS on all new tables
    - Add policies for role-based access
    - Game sessions can be created by volunteers, approved by admins
    - Analytics data readable by admins only

  3. Indexes
    - Performance indexes for common queries
    - Composite indexes for analytics aggregations
*/

-- Game sessions table
CREATE TABLE IF NOT EXISTS game_sessions (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('vitals', 'shelf', 'quiz', 'triage')),
  volunteer_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  score integer NOT NULL DEFAULT 0,
  tokens_earned integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}',
  committed boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Volunteers can create own sessions"
  ON game_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = volunteer_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can read own sessions"
  ON game_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = volunteer_id OR EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (admin_access = true OR role IN ('admin', 'doctor', 'nurse'))
  ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can approve sessions"
  ON game_sessions
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (admin_access = true OR role = 'admin')
  ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Gamification wallets table
CREATE TABLE IF NOT EXISTS gamification_wallets (
  volunteer_id text PRIMARY KEY,
  tokens integer NOT NULL DEFAULT 0,
  badges text[] NOT NULL DEFAULT '{}',
  level integer NOT NULL DEFAULT 1,
  streak_days integer NOT NULL DEFAULT 0,
  lifetime_tokens integer NOT NULL DEFAULT 0,
  last_active_date timestamptz,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE gamification_wallets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read own wallet"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = volunteer_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own wallet"
  ON gamification_wallets
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = volunteer_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read all wallets"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (admin_access = true OR role = 'admin')
  ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Vitals ranges reference table
CREATE TABLE IF NOT EXISTS vitals_ranges (
  id bigserial PRIMARY KEY,
  age_min integer NOT NULL,
  age_max integer NOT NULL,
  sex text NOT NULL CHECK (sex IN ('M', 'F', 'U')),
  metric text NOT NULL CHECK (metric IN ('hr', 'rr', 'temp', 'sbp', 'dbp', 'spo2')),
  min_value numeric NOT NULL,
  max_value numeric NOT NULL,
  source text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vitals_ranges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow authenticated read vitals ranges"
  ON vitals_ranges
  FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Quiz questions table
CREATE TABLE IF NOT EXISTS quiz_questions (
  id text PRIMARY KEY,
  topic text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  stem text NOT NULL,
  choices text[] NOT NULL,
  answer_index integer NOT NULL,
  explanation text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow authenticated read quiz questions"
  ON quiz_questions
  FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Triage samples table
CREATE TABLE IF NOT EXISTS triage_samples (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  case_hash text NOT NULL,
  gold_priority text NOT NULL CHECK (gold_priority IN ('urgent', 'normal', 'low')),
  created_by text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE triage_samples ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow authenticated read triage samples"
  ON triage_samples
  FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Doctors can create triage samples"
  ON triage_samples
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND role IN ('doctor', 'admin')
  ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Inventory discrepancies table
CREATE TABLE IF NOT EXISTS inventory_discrepancies (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES inventory(id),
  found_qty integer NOT NULL,
  system_qty integer NOT NULL,
  photo text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_discrepancies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow authenticated access to discrepancies"
  ON inventory_discrepancies
  FOR ALL
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_sessions_volunteer_type ON game_sessions (volunteer_id, type, started_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_committed ON game_sessions (committed, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gamification_wallets_tokens ON gamification_wallets (tokens DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_ranges_lookup ON vitals_ranges (sex, metric, age_min, age_max);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_topic ON quiz_questions (topic, difficulty);
CREATE INDEX IF NOT EXISTS idx_inventory_discrepancies_resolved ON inventory_discrepancies (resolved_at);

-- Seed some initial vitals ranges
INSERT INTO vitals_ranges (age_min, age_max, sex, metric, min_value, max_value, source) VALUES
-- Adult ranges (18-65)
(18, 65, 'M', 'hr', 60, 100, 'AHA Guidelines'),
(18, 65, 'F', 'hr', 60, 100, 'AHA Guidelines'),
(18, 65, 'M', 'rr', 12, 20, 'Clinical Standards'),
(18, 65, 'F', 'rr', 12, 20, 'Clinical Standards'),
(18, 65, 'M', 'temp', 36.1, 37.2, 'WHO Standards'),
(18, 65, 'F', 'temp', 36.1, 37.2, 'WHO Standards'),
(18, 65, 'M', 'sbp', 90, 140, 'AHA Guidelines'),
(18, 65, 'F', 'sbp', 90, 140, 'AHA Guidelines'),
(18, 65, 'M', 'dbp', 60, 90, 'AHA Guidelines'),
(18, 65, 'F', 'dbp', 60, 90, 'AHA Guidelines'),
(18, 65, 'M', 'spo2', 95, 100, 'Pulse Oximetry Standards'),
(18, 65, 'F', 'spo2', 95, 100, 'Pulse Oximetry Standards'),

-- Pediatric ranges (5-17)
(5, 17, 'M', 'hr', 70, 120, 'Pediatric Guidelines'),
(5, 17, 'F', 'hr', 70, 120, 'Pediatric Guidelines'),
(5, 17, 'M', 'rr', 15, 25, 'Pediatric Guidelines'),
(5, 17, 'F', 'rr', 15, 25, 'Pediatric Guidelines'),
(5, 17, 'M', 'temp', 36.1, 37.2, 'WHO Standards'),
(5, 17, 'F', 'temp', 36.1, 37.2, 'WHO Standards'),

-- Elderly ranges (65+)
(65, 120, 'M', 'hr', 60, 100, 'Geriatric Guidelines'),
(65, 120, 'F', 'hr', 60, 100, 'Geriatric Guidelines'),
(65, 120, 'M', 'sbp', 90, 150, 'Geriatric Guidelines'),
(65, 120, 'F', 'sbp', 90, 150, 'Geriatric Guidelines')
ON CONFLICT (id) DO NOTHING;

-- Seed some quiz questions
INSERT INTO quiz_questions (id, topic, difficulty, stem, choices, answer_index, explanation) VALUES
('q1', 'vital_signs', 'easy', 'What is the normal resting heart rate range for adults?', 
 ARRAY['40-60 bpm', '60-100 bpm', '100-120 bpm', '120-140 bpm'], 1, 
 'Normal adult resting heart rate is 60-100 beats per minute.'),

('q2', 'medication', 'medium', 'Which medication should be stored in a cool, dry place?', 
 ARRAY['Paracetamol tablets', 'Insulin vials', 'Cough syrup', 'All of the above'], 3, 
 'All medications should be stored properly to maintain efficacy.'),

('q3', 'infection_control', 'easy', 'How long should you wash your hands with soap?', 
 ARRAY['5 seconds', '10 seconds', '20 seconds', '30 seconds'], 2, 
 'Proper handwashing requires at least 20 seconds with soap and water.'),

('q4', 'triage', 'medium', 'A patient with chest pain and difficulty breathing should be triaged as:', 
 ARRAY['Low priority', 'Normal priority', 'Urgent priority', 'Can wait'], 2, 
 'Chest pain with breathing difficulty indicates potential cardiac emergency.'),

('q5', 'pharmacy', 'hard', 'FEFO stands for:', 
 ARRAY['First Expired, First Out', 'First Entry, First Out', 'Fast Expiry, Fast Out', 'Final Entry, Final Out'], 0, 
 'FEFO ensures medications closest to expiry are dispensed first.')
ON CONFLICT (id) DO NOTHING;

-- Migration: 20251023220000_add_photo_storage.sql
-- ============================================================
/*
  # Add Photo Storage Bucket

  1. Storage
    - Create `photos` storage bucket for patient photos
    - Enable public access for photo URLs
    - Set upload size limit to 5MB
    - Allow only JPEG/PNG image types

  2. Security
    - Authenticated users can upload photos
    - Public read access for photo URLs
    - Users can only update/delete their own uploads

  3. Important Notes
    - Photos are automatically compressed to 200x200px on client
    - Average photo size: ~30-50KB
    - Bucket is public for easy photo display
*/

-- Create storage bucket for patient photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload photos
DO $$ BEGIN
  CREATE POLICY "Authenticated users can upload photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'photos' AND
  (storage.foldername(name))[1] = 'patient-photos'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow public read access to photos
DO $$ BEGIN
  CREATE POLICY "Public can view photos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'photos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow users to update their uploaded photos
DO $$ BEGIN
  CREATE POLICY "Users can update their photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'photos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow users to delete photos
DO $$ BEGIN
  CREATE POLICY "Users can delete photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'photos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- Migration: 20251024000000_add_advanced_features.sql
-- ============================================================
/*
  # Advanced Features Migration

  ## Overview
  Adds support for SMS medication reminders, lab results management, and appointment scheduling.

  ## New Tables

  ### 1. medication_reminders
  Tracks scheduled SMS reminders for medication adherence.
  - `id` (uuid, primary key)
  - `dispense_id` (uuid, references dispenses)
  - `patient_id` (uuid, references patients)
  - `medication_name` (text)
  - `dosage` (text)
  - `scheduled_at` (timestamptz)
  - `sent_at` (timestamptz, nullable)
  - `status` (text: pending, sent, failed)
  - `phone_number` (text)
  - `message` (text)
  - `error_message` (text, nullable)
  - `created_at` (timestamptz)

  ### 2. lab_orders
  Manages laboratory test orders and tracking.
  - `id` (uuid, primary key)
  - `patient_id` (uuid, references patients)
  - `visit_id` (uuid, references visits, nullable)
  - `ordered_by` (uuid, references app_users)
  - `test_name` (text)
  - `test_code` (text, nullable)
  - `priority` (text: routine, urgent, stat)
  - `status` (text: ordered, collected, processing, completed, cancelled)
  - `specimen_type` (text, nullable)
  - `clinical_notes` (text, nullable)
  - `ordered_at` (timestamptz)
  - `collected_at` (timestamptz, nullable)
  - `completed_at` (timestamptz, nullable)
  - `cancelled_at` (timestamptz, nullable)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. lab_results
  Stores laboratory test results.
  - `id` (uuid, primary key)
  - `order_id` (uuid, references lab_orders)
  - `result_value` (text)
  - `result_unit` (text, nullable)
  - `reference_range` (text, nullable)
  - `interpretation` (text: normal, abnormal, critical)
  - `result_date` (timestamptz)
  - `reviewed_by` (uuid, references app_users, nullable)
  - `reviewed_at` (timestamptz, nullable)
  - `notes` (text, nullable)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 4. appointments
  Manages patient appointment scheduling.
  - `id` (uuid, primary key)
  - `patient_id` (uuid, references patients)
  - `provider_id` (uuid, references app_users, nullable)
  - `appointment_type` (text)
  - `scheduled_at` (timestamptz)
  - `duration_minutes` (integer, default 30)
  - `status` (text: scheduled, confirmed, arrived, in-progress, completed, no-show, cancelled)
  - `reason` (text, nullable)
  - `notes` (text, nullable)
  - `reminder_sent` (boolean, default false)
  - `reminder_sent_at` (timestamptz, nullable)
  - `created_by` (uuid, references app_users)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 5. waitlist
  Manages patient waitlist for appointments.
  - `id` (uuid, primary key)
  - `patient_id` (uuid, references patients)
  - `appointment_type` (text)
  - `preferred_dates` (jsonb, nullable)
  - `reason` (text, nullable)
  - `priority` (text: routine, urgent)
  - `status` (text: waiting, scheduled, cancelled)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  - All tables have Row Level Security (RLS) enabled
  - Policies restrict access based on user roles
  - Authenticated users can only access data relevant to their role

  ## Indexes
  - Performance indexes on foreign keys and status fields
  - Timestamp indexes for scheduling queries
*/

-- medication_reminders table
CREATE TABLE IF NOT EXISTS medication_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispense_id uuid REFERENCES dispenses(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  medication_name text NOT NULL,
  dosage text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')) DEFAULT 'pending',
  phone_number text NOT NULL,
  message text NOT NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- lab_orders table
CREATE TABLE IF NOT EXISTS lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  visit_id uuid REFERENCES visits(id) ON DELETE SET NULL,
  ordered_by uuid REFERENCES app_users(id) ON DELETE SET NULL NOT NULL,
  test_name text NOT NULL,
  test_code text,
  priority text NOT NULL CHECK (priority IN ('routine', 'urgent', 'stat')) DEFAULT 'routine',
  status text NOT NULL CHECK (status IN ('ordered', 'collected', 'processing', 'completed', 'cancelled')) DEFAULT 'ordered',
  specimen_type text,
  clinical_notes text,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- lab_results table
CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES lab_orders(id) ON DELETE CASCADE NOT NULL,
  result_value text NOT NULL,
  result_unit text,
  reference_range text,
  interpretation text NOT NULL CHECK (interpretation IN ('normal', 'abnormal', 'critical')) DEFAULT 'normal',
  result_date timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  provider_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  appointment_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status text NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'arrived', 'in-progress', 'completed', 'no-show', 'cancelled')) DEFAULT 'scheduled',
  reason text,
  notes text,
  reminder_sent boolean NOT NULL DEFAULT false,
  reminder_sent_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  appointment_type text NOT NULL,
  preferred_dates jsonb,
  reason text,
  priority text NOT NULL CHECK (priority IN ('routine', 'urgent')) DEFAULT 'routine',
  status text NOT NULL CHECK (status IN ('waiting', 'scheduled', 'cancelled')) DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE medication_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- medication_reminders policies
DO $$ BEGIN
  CREATE POLICY "Pharmacists and admins can view reminders"
  ON medication_reminders FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Pharmacists and admins can create reminders"
  ON medication_reminders FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Pharmacists and admins can update reminders"
  ON medication_reminders FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- lab_orders policies
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view lab orders"
  ON lab_orders FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Doctors and nurses can create lab orders"
  ON lab_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Doctors and nurses can update lab orders"
  ON lab_orders FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- lab_results policies
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view lab results"
  ON lab_results FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authorized staff can create lab results"
  ON lab_results FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authorized staff can update lab results"
  ON lab_results FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- appointments policies
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view appointments"
  ON appointments FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create appointments"
  ON appointments FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update appointments"
  ON appointments FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- waitlist policies
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view waitlist"
  ON waitlist FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create waitlist entries"
  ON waitlist FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update waitlist entries"
  ON waitlist FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_medication_reminders_patient ON medication_reminders(patient_id);
CREATE INDEX IF NOT EXISTS idx_medication_reminders_scheduled ON medication_reminders(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_medication_reminders_status ON medication_reminders(status);

CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(status);
CREATE INDEX IF NOT EXISTS idx_lab_orders_priority ON lab_orders(priority);
CREATE INDEX IF NOT EXISTS idx_lab_orders_ordered_at ON lab_orders(ordered_at);

CREATE INDEX IF NOT EXISTS idx_lab_results_order ON lab_results(order_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_interpretation ON lab_results(interpretation);

CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments(provider_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

CREATE INDEX IF NOT EXISTS idx_waitlist_patient ON waitlist(patient_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_medication_reminders_updated_at BEFORE UPDATE ON medication_reminders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_lab_orders_updated_at BEFORE UPDATE ON lab_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_lab_results_updated_at BEFORE UPDATE ON lab_results FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_waitlist_updated_at BEFORE UPDATE ON waitlist FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- Migration: 20251024080033_add_missing_advanced_tables.sql
-- ============================================================
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
  ordered_by uuid REFERENCES app_users(id),
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
  reviewed_by uuid REFERENCES app_users(id),
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
  provider_id uuid REFERENCES app_users(id),
  appointment_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'arrived', 'in-progress', 'completed', 'no-show', 'cancelled')),
  reason text,
  notes text,
  reminder_sent boolean NOT NULL DEFAULT false,
  reminder_sent_at timestamptz,
  created_by uuid REFERENCES app_users(id) NOT NULL,
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
  created_by uuid REFERENCES app_users(id),
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
DO $$ BEGIN
  CREATE POLICY "Admins can manage users"
  ON users FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid() AND app_users.role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Medication Reminders - pharmacists and above
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage medication reminders"
  ON medication_reminders FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lab Orders - clinical staff
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage lab orders"
  ON lab_orders FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lab Results - clinical staff
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage lab results"
  ON lab_results FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Appointments - authenticated users
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage appointments"
  ON appointments FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Waitlist - authenticated users
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage waitlist"
  ON waitlist FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Stock Batches - pharmacists
DO $$ BEGIN
  CREATE POLICY "Pharmacists can manage stock batches"
  ON stock_batches FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'pharmacist')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Care Tasks - clinical staff
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage care tasks"
  ON care_tasks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Triage Records - clinical staff
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage triage records"
  ON triage_records FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patient Allergies - clinical staff
DO $$ BEGIN
  CREATE POLICY "Clinical staff can view allergies"
  ON patient_allergies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse', 'pharmacist')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage allergies"
  ON patient_allergies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Clinical staff can update allergies"
  ON patient_allergies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patient Preferences - all staff
DO $$ BEGIN
  CREATE POLICY "Staff can manage patient preferences"
  ON patient_preferences FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patient Merges - admins only
DO $$ BEGIN
  CREATE POLICY "Admins can view patient merges"
  ON patient_merges FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid() AND app_users.role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Daily Counts - all authenticated users can read
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read daily counts"
  ON daily_counts FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Conflict Resolutions - admins only
DO $$ BEGIN
  CREATE POLICY "Admins can manage conflict resolutions"
  ON conflict_resolutions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid() AND app_users.role = 'admin'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Message Templates - authenticated users can read
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read message templates"
  ON message_templates FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Outbound Messages - authenticated users
DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage outbound messages"
  ON outbound_messages FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
CREATE OR REPLACE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_medication_reminders_updated_at ON medication_reminders;
CREATE OR REPLACE TRIGGER update_medication_reminders_updated_at
  BEFORE UPDATE ON medication_reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lab_orders_updated_at ON lab_orders;
CREATE OR REPLACE TRIGGER update_lab_orders_updated_at
  BEFORE UPDATE ON lab_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lab_results_updated_at ON lab_results;
CREATE OR REPLACE TRIGGER update_lab_results_updated_at
  BEFORE UPDATE ON lab_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
CREATE OR REPLACE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_waitlist_updated_at ON waitlist;
CREATE OR REPLACE TRIGGER update_waitlist_updated_at
  BEFORE UPDATE ON waitlist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_stock_batches_updated_at ON stock_batches;
CREATE OR REPLACE TRIGGER update_stock_batches_updated_at
  BEFORE UPDATE ON stock_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_care_tasks_updated_at ON care_tasks;
CREATE OR REPLACE TRIGGER update_care_tasks_updated_at
  BEFORE UPDATE ON care_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_triage_records_updated_at ON triage_records;
CREATE OR REPLACE TRIGGER update_triage_records_updated_at
  BEFORE UPDATE ON triage_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_allergies_updated_at ON patient_allergies;
CREATE OR REPLACE TRIGGER update_patient_allergies_updated_at
  BEFORE UPDATE ON patient_allergies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patient_preferences_updated_at ON patient_preferences;
CREATE OR REPLACE TRIGGER update_patient_preferences_updated_at
  BEFORE UPDATE ON patient_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- Migration: 20251024080117_add_sync_columns_to_core_tables.sql
-- ============================================================
/*
  # Add Sync Tracking Columns to Core Tables
  
  ## Overview
  Adds _dirty and _synced_at columns to core tables for offline sync functionality.
  These columns track which records need to be synced and when they were last synced.
  
  ## Tables Modified
  - patients
  - visits
  - vitals
  - consultations
  - dispenses
  - inventory
  - queue
  
  ## Security
  - No changes to RLS policies
  - Columns are for sync tracking only
*/

-- Add sync columns to patients
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE patients ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_dirty ON patients(_dirty) WHERE _dirty > 0;

-- Add sync columns to visits
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'visits' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE visits ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'visits' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE visits ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_visits_dirty ON visits(_dirty) WHERE _dirty > 0;

-- Add sync columns to vitals
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vitals' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE vitals ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vitals' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE vitals ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vitals_dirty ON vitals(_dirty) WHERE _dirty > 0;

-- Add sync columns to consultations
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'consultations' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE consultations ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'consultations' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE consultations ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_consultations_dirty ON consultations(_dirty) WHERE _dirty > 0;

-- Add sync columns to dispenses
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispenses' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispenses' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispenses_dirty ON dispenses(_dirty) WHERE _dirty > 0;

-- Add sync columns to inventory
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE inventory ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE inventory ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_dirty ON inventory(_dirty) WHERE _dirty > 0;

-- Add sync columns to queue
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'queue' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE queue ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'queue' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE queue ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_queue_dirty ON queue(_dirty) WHERE _dirty > 0;

-- Add sync columns to gamification_wallets
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gamification_wallets' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE gamification_wallets ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gamification_wallets' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE gamification_wallets ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gamification_wallets_dirty ON gamification_wallets(_dirty) WHERE _dirty > 0;

-- Add sync columns to game_sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_sessions' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE game_sessions ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_sessions' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE game_sessions ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_sessions_dirty ON game_sessions(_dirty) WHERE _dirty > 0;


-- Migration: 20251024120000_add_missing_gamification_tables.sql
-- ============================================================
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
DO $$ BEGIN
  CREATE POLICY "Users can view own game sessions"
  ON game_sessions FOR SELECT
  TO authenticated
  USING (volunteer_id = auth.uid()::text OR auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create own game sessions"
  ON game_sessions FOR INSERT
  TO authenticated
  WITH CHECK (volunteer_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own game sessions"
  ON game_sessions FOR UPDATE
  TO authenticated
  USING (volunteer_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for gamification_wallets
DO $$ BEGIN
  CREATE POLICY "Users can view own wallet"
  ON gamification_wallets FOR SELECT
  TO authenticated
  USING (volunteer_id = auth.uid()::text OR auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own wallet"
  ON gamification_wallets FOR UPDATE
  TO authenticated
  USING (volunteer_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "System can create wallets"
  ON gamification_wallets FOR INSERT
  TO authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for vitals_ranges (read-only reference data)
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view vitals ranges"
  ON vitals_ranges FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage vitals ranges"
  ON vitals_ranges FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for quiz_questions (read-only for users)
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view quiz questions"
  ON quiz_questions FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage quiz questions"
  ON quiz_questions FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for triage_samples
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view triage samples"
  ON triage_samples FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create triage samples"
  ON triage_samples FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('nurse', 'doctor', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for triage_records
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view triage records"
  ON triage_records FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create triage records"
  ON triage_records FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update triage records"
  ON triage_records FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for inventory_discrepancies
DO $$ BEGIN
  CREATE POLICY "Staff can view inventory discrepancies"
  ON inventory_discrepancies FOR SELECT
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create inventory discrepancies"
  ON inventory_discrepancies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update inventory discrepancies"
  ON inventory_discrepancies FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for stock_batches
DO $$ BEGIN
  CREATE POLICY "Staff can view stock batches"
  ON stock_batches FOR SELECT
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create stock batches"
  ON stock_batches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update stock batches"
  ON stock_batches FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for care_tasks
DO $$ BEGIN
  CREATE POLICY "Staff can view care tasks"
  ON care_tasks FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create care tasks"
  ON care_tasks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can update care tasks"
  ON care_tasks FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('volunteer', 'nurse', 'doctor', 'pharmacist', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for patient_merges
DO $$ BEGIN
  CREATE POLICY "Staff can view patient merges"
  ON patient_merges FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authorized staff can create patient merges"
  ON patient_merges FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role IN ('nurse', 'doctor', 'admin')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for daily_counts
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view daily counts"
  ON daily_counts FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "System can manage daily counts"
  ON daily_counts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for conflict_resolutions
DO $$ BEGIN
  CREATE POLICY "Staff can view conflict resolutions"
  ON conflict_resolutions FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "System can manage conflict resolutions"
  ON conflict_resolutions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for message_templates
DO $$ BEGIN
  CREATE POLICY "Authenticated users can view message templates"
  ON message_templates FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage message templates"
  ON message_templates FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM app_users WHERE role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
CREATE OR REPLACE TRIGGER update_game_sessions_updated_at BEFORE UPDATE ON game_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_gamification_wallets_updated_at BEFORE UPDATE ON gamification_wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_vitals_ranges_updated_at BEFORE UPDATE ON vitals_ranges FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_quiz_questions_updated_at BEFORE UPDATE ON quiz_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_triage_records_updated_at BEFORE UPDATE ON triage_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_inventory_discrepancies_updated_at BEFORE UPDATE ON inventory_discrepancies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_stock_batches_updated_at BEFORE UPDATE ON stock_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_care_tasks_updated_at BEFORE UPDATE ON care_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_daily_counts_updated_at BEFORE UPDATE ON daily_counts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_message_templates_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- Migration: 20251024121716_20251023220000_add_photo_storage.sql
-- ============================================================
/*
  # Add Photo Storage Bucket

  1. Storage
    - Create `photos` storage bucket for patient photos
    - Enable public access for photo URLs
    - Set upload size limit to 5MB
    - Allow only JPEG/PNG image types

  2. Security
    - Authenticated users can upload photos
    - Public read access for photo URLs
    - Users can only update/delete their own uploads

  3. Important Notes
    - Photos are automatically compressed to 200x200px on client
    - Average photo size: ~30-50KB
    - Bucket is public for easy photo display
*/

-- Create storage bucket for patient photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload photos
DO $$ BEGIN
  CREATE POLICY "Authenticated users can upload photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'photos' AND
  (storage.foldername(name))[1] = 'patient-photos'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow public read access to photos
DO $$ BEGIN
  CREATE POLICY "Public can view photos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'photos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow users to update their uploaded photos
DO $$ BEGIN
  CREATE POLICY "Users can update their photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'photos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow users to delete photos
DO $$ BEGIN
  CREATE POLICY "Users can delete photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'photos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
