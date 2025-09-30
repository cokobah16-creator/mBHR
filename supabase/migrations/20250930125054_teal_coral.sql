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

CREATE POLICY "Volunteers can create own sessions"
  ON game_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = volunteer_id);

CREATE POLICY "Users can read own sessions"
  ON game_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = volunteer_id OR EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (admin_access = true OR role IN ('admin', 'doctor', 'nurse'))
  ));

CREATE POLICY "Admins can approve sessions"
  ON game_sessions
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (admin_access = true OR role = 'admin')
  ));

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

CREATE POLICY "Users can read own wallet"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = volunteer_id);

CREATE POLICY "Users can update own wallet"
  ON gamification_wallets
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = volunteer_id);

CREATE POLICY "Admins can read all wallets"
  ON gamification_wallets
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (admin_access = true OR role = 'admin')
  ));

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

CREATE POLICY "Allow authenticated read vitals ranges"
  ON vitals_ranges
  FOR SELECT
  TO authenticated
  USING (true);

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

CREATE POLICY "Allow authenticated read quiz questions"
  ON quiz_questions
  FOR SELECT
  TO authenticated
  USING (true);

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

CREATE POLICY "Allow authenticated read triage samples"
  ON triage_samples
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Doctors can create triage samples"
  ON triage_samples
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND role IN ('doctor', 'admin')
  ));

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

CREATE POLICY "Allow authenticated access to discrepancies"
  ON inventory_discrepancies
  FOR ALL
  TO authenticated
  USING (true);

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