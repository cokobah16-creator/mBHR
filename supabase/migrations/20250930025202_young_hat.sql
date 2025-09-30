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