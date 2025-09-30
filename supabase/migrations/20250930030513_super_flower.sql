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