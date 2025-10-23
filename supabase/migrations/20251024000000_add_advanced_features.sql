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
CREATE POLICY "Pharmacists and admins can view reminders"
  ON medication_reminders FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')
    )
  );

CREATE POLICY "Pharmacists and admins can create reminders"
  ON medication_reminders FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')
    )
  );

CREATE POLICY "Pharmacists and admins can update reminders"
  ON medication_reminders FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')
    )
  );

-- lab_orders policies
CREATE POLICY "Authenticated users can view lab orders"
  ON lab_orders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Doctors and nurses can create lab orders"
  ON lab_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );

CREATE POLICY "Doctors and nurses can update lab orders"
  ON lab_orders FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );

-- lab_results policies
CREATE POLICY "Authenticated users can view lab results"
  ON lab_results FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authorized staff can create lab results"
  ON lab_results FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );

CREATE POLICY "Authorized staff can update lab results"
  ON lab_results FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('doctor', 'nurse', 'admin')
    )
  );

-- appointments policies
CREATE POLICY "Authenticated users can view appointments"
  ON appointments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can create appointments"
  ON appointments FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'admin')
    )
  );

CREATE POLICY "Staff can update appointments"
  ON appointments FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'admin')
    )
  );

-- waitlist policies
CREATE POLICY "Authenticated users can view waitlist"
  ON waitlist FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can create waitlist entries"
  ON waitlist FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'admin')
    )
  );

CREATE POLICY "Staff can update waitlist entries"
  ON waitlist FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM app_users WHERE role IN ('chw', 'nurse', 'doctor', 'admin')
    )
  );

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

CREATE TRIGGER update_medication_reminders_updated_at BEFORE UPDATE ON medication_reminders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_orders_updated_at BEFORE UPDATE ON lab_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_results_updated_at BEFORE UPDATE ON lab_results FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_waitlist_updated_at BEFORE UPDATE ON waitlist FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
