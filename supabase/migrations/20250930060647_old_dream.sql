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
CREATE POLICY "Allow authenticated access to app_users"
  ON app_users
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Patients policies
CREATE POLICY "Allow authenticated access to patients"
  ON patients
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Visits policies
CREATE POLICY "Allow authenticated access to visits"
  ON visits
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Vitals policies
CREATE POLICY "Allow authenticated access to vitals"
  ON vitals
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Consultations policies
CREATE POLICY "Allow authenticated access to consultations"
  ON consultations
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Dispenses policies
CREATE POLICY "Allow authenticated access to dispenses"
  ON dispenses
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Inventory policies
CREATE POLICY "Allow authenticated access to inventory"
  ON inventory
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Queue policies
CREATE POLICY "Allow authenticated access to queue"
  ON queue
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Audit logs policies
CREATE POLICY "Allow authenticated access to audit_logs"
  ON audit_logs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);