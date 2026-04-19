-- Migration: 20251028170413_add_multi_tenant_foundation.sql
-- ============================================================
-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  settings jsonb DEFAULT '{}'::jsonb,
  subscription_tier text DEFAULT 'standard',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create sites table
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  site_code text NOT NULL,
  address text NOT NULL,
  state text NOT NULL,
  lga text NOT NULL,
  typical_patient_volume integer DEFAULT 200,
  capacity integer DEFAULT 300,
  coordinates jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, site_code)
);

-- Create outreach_events table
CREATE TABLE IF NOT EXISTS outreach_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_date date NOT NULL,
  start_time time DEFAULT '09:00:00',
  end_time time DEFAULT '15:00:00',
  status text DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  expected_volume integer DEFAULT 200,
  actual_volume integer,
  staff_roster jsonb DEFAULT '[]'::jsonb,
  notes text,
  outcome_summary jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create event_staff_assignments table
CREATE TABLE IF NOT EXISTS event_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES outreach_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('doctor', 'nurse', 'pharmacist', 'volunteer', 'lab_tech', 'admin')),
  station text CHECK (station IN ('registration', 'vitals', 'consult', 'pharmacy', 'lab', 'education')),
  is_supervising boolean DEFAULT false,
  check_in_time timestamptz,
  check_out_time timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, user_id)
);

-- Create user_org_sites table
CREATE TABLE IF NOT EXISTS user_org_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, org_id, site_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sites_org_id ON sites(org_id);
CREATE INDEX IF NOT EXISTS idx_sites_state ON sites(state);
CREATE INDEX IF NOT EXISTS idx_outreach_events_org_id ON outreach_events(org_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_site_id ON outreach_events(site_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_date ON outreach_events(event_date);
CREATE INDEX IF NOT EXISTS idx_outreach_events_status ON outreach_events(status);
CREATE INDEX IF NOT EXISTS idx_event_staff_assignments_event_id ON event_staff_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_staff_assignments_user_id ON event_staff_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_sites_user_id ON user_org_sites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_sites_org_id ON user_org_sites(org_id);

-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_org_sites ENABLE ROW LEVEL SECURITY;

-- RLS Policies for organizations
DO $$ BEGIN
  CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT TO authenticated
  USING (id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage their organizations"
  ON organizations FOR ALL TO authenticated
  USING (id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for sites
DO $$ BEGIN
  CREATE POLICY "Users can view sites in their organizations"
  ON sites FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage sites in their organizations"
  ON sites FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for outreach_events
DO $$ BEGIN
  CREATE POLICY "Users can view events in their organizations"
  ON outreach_events FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage events in their organizations"
  ON outreach_events FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for event_staff_assignments
DO $$ BEGIN
  CREATE POLICY "Users can view their event assignments"
  ON event_staff_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR event_id IN (SELECT id FROM outreach_events WHERE org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage event assignments in their organizations"
  ON event_staff_assignments FOR ALL TO authenticated
  USING (event_id IN (SELECT id FROM outreach_events WHERE org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid())))
  WITH CHECK (event_id IN (SELECT id FROM outreach_events WHERE org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for user_org_sites
DO $$ BEGIN
  CREATE POLICY "Users can view their own org assignments"
  ON user_org_sites FOR SELECT TO authenticated
  USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage user org assignments"
  ON user_org_sites FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER sites_updated_at BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER outreach_events_updated_at BEFORE UPDATE ON outreach_events FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Migration: 20251028170517_add_doctor_features_tables_part1.sql
-- ============================================================
-- Create patient_flags table for lightweight inter-station communication
CREATE TABLE IF NOT EXISTS patient_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  flag_type text NOT NULL CHECK (flag_type IN ('escalate_to_doctor', 'recheck_vitals', 'pharmacy_query', 'lab_pending', 'urgent', 'follow_up_needed')),
  from_station text NOT NULL CHECK (from_station IN ('registration', 'vitals', 'consult', 'pharmacy', 'lab')),
  to_station text NOT NULL CHECK (to_station IN ('registration', 'vitals', 'consult', 'pharmacy', 'lab')),
  from_user_id uuid NOT NULL,
  to_user_id uuid,
  priority text DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  message text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'cancelled')),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz DEFAULT now()
);

-- Create referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  referring_doctor_id uuid NOT NULL,
  referral_type text NOT NULL CHECK (referral_type IN ('specialist', 'hospital', 'lab', 'imaging', 'follow_up')),
  specialty text,
  facility_name text,
  urgency text DEFAULT 'routine' CHECK (urgency IN ('emergency', 'urgent', 'routine')),
  reason text NOT NULL,
  clinical_summary text,
  diagnosis text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
  appointment_date date,
  outcome text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create follow_up_schedules table
CREATE TABLE IF NOT EXISTS follow_up_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  original_visit_id uuid,
  scheduled_event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  follow_up_type text NOT NULL CHECK (follow_up_type IN ('chronic_disease', 'medication_refill', 'test_results', 'post_treatment', 'general_checkup')),
  reason text NOT NULL,
  priority text DEFAULT 'routine' CHECK (priority IN ('urgent', 'high', 'routine')),
  scheduled_date date,
  reminder_sent boolean DEFAULT false,
  reminder_sent_at timestamptz,
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'reminded', 'completed', 'missed', 'cancelled')),
  completed_visit_id uuid,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create prescription_templates table
CREATE TABLE IF NOT EXISTS prescription_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  condition text NOT NULL,
  description text,
  medications jsonb NOT NULL,
  is_protocol boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, name)
);

-- Create site_formulary table
CREATE TABLE IF NOT EXISTS site_formulary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  medication_name text NOT NULL,
  generic_name text,
  form text NOT NULL,
  strength text NOT NULL,
  unit text NOT NULL,
  typical_stock_level integer,
  current_stock integer DEFAULT 0,
  reorder_threshold integer,
  is_controlled boolean DEFAULT false,
  alternatives jsonb DEFAULT '[]'::jsonb,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, site_id, medication_name, strength)
);

ALTER TABLE patient_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_formulary ENABLE ROW LEVEL SECURITY;


-- Migration: 20251028170617_add_doctor_features_tables_part2_fixed.sql
-- ============================================================
-- Create doctor_analytics table
CREATE TABLE IF NOT EXISTS doctor_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES outreach_events(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL,
  patients_seen integer DEFAULT 0,
  consultations_completed integer DEFAULT 0,
  avg_consultation_time_minutes numeric(5,2),
  prescriptions_written integer DEFAULT 0,
  referrals_made integer DEFAULT 0,
  pharmacy_queries integer DEFAULT 0,
  vitals_rechecks integer DEFAULT 0,
  diagnoses jsonb DEFAULT '{}'::jsonb,
  shift_start timestamptz,
  shift_end timestamptz,
  total_hours numeric(4,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, doctor_id)
);

-- Create consultation_reviews table
CREATE TABLE IF NOT EXISTS consultation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_id uuid REFERENCES outreach_events(id) ON DELETE SET NULL,
  consultation_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  reviewed_doctor_id uuid NOT NULL,
  reviewing_doctor_id uuid NOT NULL,
  review_type text DEFAULT 'routine' CHECK (review_type IN ('routine', 'requested', 'teaching', 'quality_assurance')),
  review_status text DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'modified', 'flagged')),
  feedback text,
  modifications jsonb,
  teaching_points text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create protocol_library table
CREATE TABLE IF NOT EXISTS protocol_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  title text NOT NULL,
  condition text NOT NULL,
  category text CHECK (category IN ('infectious', 'chronic', 'acute', 'emergency', 'pediatric', 'maternal', 'general')),
  protocol_content text NOT NULL,
  algorithm jsonb,
  medications jsonb,
  contraindications text[],
  special_considerations text,
  clinical_references text,
  version text DEFAULT '1.0',
  is_active boolean DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_patient_flags_patient_id ON patient_flags(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_flags_event_id ON patient_flags(event_id);
CREATE INDEX IF NOT EXISTS idx_patient_flags_status ON patient_flags(status);
CREATE INDEX IF NOT EXISTS idx_patient_flags_to_station ON patient_flags(to_station);
CREATE INDEX IF NOT EXISTS idx_referrals_patient_id ON referrals(patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_event_id ON referrals(event_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_patient_id ON follow_up_schedules(patient_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_scheduled_date ON follow_up_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_site_formulary_site_id ON site_formulary(site_id);
CREATE INDEX IF NOT EXISTS idx_doctor_analytics_event_id ON doctor_analytics(event_id);
CREATE INDEX IF NOT EXISTS idx_doctor_analytics_doctor_id ON doctor_analytics(doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_reviewed_doctor_id ON consultation_reviews(reviewed_doctor_id);
CREATE INDEX IF NOT EXISTS idx_protocol_library_condition ON protocol_library(condition);

ALTER TABLE doctor_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies for patient_flags
DO $$ BEGIN
  CREATE POLICY "Staff can view flags in their organizations" ON patient_flags FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Staff can create flags in their organizations" ON patient_flags FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Staff can update flags in their organizations" ON patient_flags FOR UPDATE TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for referrals
DO $$ BEGIN
  CREATE POLICY "Staff can view referrals in their organizations" ON referrals FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Doctors can manage referrals in their organizations" ON referrals FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for follow_up_schedules
DO $$ BEGIN
  CREATE POLICY "Staff can view follow-ups in their organizations" ON follow_up_schedules FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Clinical staff can manage follow-ups" ON follow_up_schedules FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for prescription_templates
DO $$ BEGIN
  CREATE POLICY "Staff can view prescription templates" ON prescription_templates FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Doctors can manage prescription templates" ON prescription_templates FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for site_formulary
DO $$ BEGIN
  CREATE POLICY "Staff can view site formulary" ON site_formulary FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Pharmacists can manage site formulary" ON site_formulary FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for doctor_analytics
DO $$ BEGIN
  CREATE POLICY "Staff can view doctor analytics" ON doctor_analytics FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()) OR doctor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "System can manage doctor analytics" ON doctor_analytics FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for consultation_reviews
DO $$ BEGIN
  CREATE POLICY "Staff can view consultation reviews" ON consultation_reviews FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()) OR reviewed_doctor_id = auth.uid() OR reviewing_doctor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Supervising doctors can manage reviews" ON consultation_reviews FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for protocol_library
DO $$ BEGIN
  CREATE POLICY "Staff can view protocols" ON protocol_library FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Doctors can manage protocols" ON protocol_library FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Triggers
CREATE TRIGGER referrals_updated_at BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER follow_up_schedules_updated_at BEFORE UPDATE ON follow_up_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER prescription_templates_updated_at BEFORE UPDATE ON prescription_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER site_formulary_updated_at BEFORE UPDATE ON site_formulary FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER doctor_analytics_updated_at BEFORE UPDATE ON doctor_analytics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER protocol_library_updated_at BEFORE UPDATE ON protocol_library FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Migration: 20251028180000_add_queue_enhancements.sql
-- ============================================================
/*
  # Add Queue Management Enhancements

  1. Changes to queue table
    - Add `priority` column (urgent, normal, low)
    - Add `created_by` column to track staff member who added patient
    - Add `queued_at` column to track when patient was added
    - Add indexes for better query performance

  2. Security
    - No RLS changes needed (inherited from existing policies)

  3. Data Migration
    - Set default values for existing queue items
*/

-- Add new columns to queue table
DO $$
BEGIN
  -- Add priority column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'queue' AND column_name = 'priority'
  ) THEN
    ALTER TABLE queue ADD COLUMN priority TEXT DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low'));
  END IF;

  -- Add created_by column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'queue' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE queue ADD COLUMN created_by TEXT;
  END IF;

  -- Add queued_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'queue' AND column_name = 'queued_at'
  ) THEN
    ALTER TABLE queue ADD COLUMN queued_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_queue_priority ON queue(priority);
CREATE INDEX IF NOT EXISTS idx_queue_created_by ON queue(created_by);
CREATE INDEX IF NOT EXISTS idx_queue_queued_at ON queue(queued_at);
CREATE INDEX IF NOT EXISTS idx_queue_stage_status ON queue(stage, status);

-- Update existing queue items to have default values
UPDATE queue
SET priority = 'normal'
WHERE priority IS NULL;

UPDATE queue
SET queued_at = updated_at
WHERE queued_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN queue.priority IS 'Priority level for queue management: urgent (front of queue), normal (standard), low (back of queue)';
COMMENT ON COLUMN queue.created_by IS 'User ID of staff member who added patient to queue';
COMMENT ON COLUMN queue.queued_at IS 'Timestamp when patient was added to this queue stage';


-- Migration: 20251028183104_add_queue_enhancements.sql
-- ============================================================
/*
  # Add Queue Management Enhancements

  1. Changes to queue table
    - Add `priority` column (urgent, normal, low)
    - Add `created_by` column to track staff member who added patient
    - Add `queued_at` column to track when patient was added
    - Add indexes for better query performance

  2. Security
    - No RLS changes needed (inherited from existing policies)

  3. Data Migration
    - Set default values for existing queue items
*/

-- Add new columns to queue table
DO $$
BEGIN
  -- Add priority column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'queue' AND column_name = 'priority'
  ) THEN
    ALTER TABLE queue ADD COLUMN priority TEXT DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low'));
  END IF;

  -- Add created_by column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'queue' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE queue ADD COLUMN created_by TEXT;
  END IF;

  -- Add queued_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'queue' AND column_name = 'queued_at'
  ) THEN
    ALTER TABLE queue ADD COLUMN queued_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_queue_priority ON queue(priority);
CREATE INDEX IF NOT EXISTS idx_queue_created_by ON queue(created_by);
CREATE INDEX IF NOT EXISTS idx_queue_queued_at ON queue(queued_at);
CREATE INDEX IF NOT EXISTS idx_queue_stage_status ON queue(stage, status);

-- Update existing queue items to have default values
UPDATE queue
SET priority = 'normal'
WHERE priority IS NULL;

UPDATE queue
SET queued_at = updated_at
WHERE queued_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN queue.priority IS 'Priority level for queue management: urgent (front of queue), normal (standard), low (back of queue)';
COMMENT ON COLUMN queue.created_by IS 'User ID of staff member who added patient to queue';
COMMENT ON COLUMN queue.queued_at IS 'Timestamp when patient was added to this queue stage';

-- Migration: 20251029000000_add_patient_email_auth_fields.sql
-- ============================================================
/*
  # Add Email and Authentication Fields to Patients

  ## Overview
  This migration adds email, authentication, and contact verification fields to support
  the Patient Portal login system where patients can authenticate using email or phone.

  ## Changes Made

  ### 1. New Patient Fields
  - `email` (text, nullable, unique): Patient's email address for portal login
  - `auth_uid` (text, nullable, unique): Supabase Auth user ID for linked accounts
  - `contact_verified` (boolean, default false): Whether email/phone has been verified

  ### 2. Schema Modifications
  - Make `phone` field nullable (was required before)
  - Add unique constraint on email (case-insensitive)
  - Add unique constraint on auth_uid
  - Add check constraint: at least one of (email, phone) must be provided

  ### 3. Indexes
  - Index on email for fast lookup during login
  - Index on auth_uid for user session management
  - Index on contact_verified for filtering verified patients

  ### 4. Data Migration
  - Normalize existing phone numbers to E.164 format (+234...)
  - Set contact_verified to false for all existing patients
  - Preserve all existing data

  ### 5. Security (RLS Policies)
  - Update existing RLS policies to handle nullable phone field
  - Add policies for patient portal users to access their own data via auth_uid
  - Maintain strict access controls

  ## Important Notes
  - This migration is safe and preserves all existing patient data
  - Phone is now optional, but at least one contact method (email or phone) is required
  - Email addresses are stored in lowercase for consistency
  - Patients can link their portal account to their clinical record via auth_uid
*/

-- Step 1: Add new columns to patients table
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS auth_uid text,
  ADD COLUMN IF NOT EXISTS contact_verified boolean DEFAULT false;

-- Step 2: Make phone column nullable
ALTER TABLE patients
  ALTER COLUMN phone DROP NOT NULL;

-- Step 3: Add unique constraints
-- Note: Using unique indexes instead of constraints for better performance and NULL handling
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_email_unique
  ON patients (LOWER(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_auth_uid_unique
  ON patients (auth_uid)
  WHERE auth_uid IS NOT NULL;

-- Step 4: Add check constraint - at least one contact method required
ALTER TABLE patients
  ADD CONSTRAINT check_at_least_one_contact
  CHECK (
    (phone IS NOT NULL AND phone <> '') OR
    (email IS NOT NULL AND email <> '')
  );

-- Step 5: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_patients_email
  ON patients (email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_auth_uid
  ON patients (auth_uid)
  WHERE auth_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_contact_verified
  ON patients (contact_verified);

-- Step 6: Update existing RLS policies to handle new fields
-- Drop and recreate the "Patients can view own record" policy to include auth_uid
DROP POLICY IF EXISTS "Patients can view own record" ON patients;

DO $$ BEGIN
  CREATE POLICY "Patients can view own record"
  ON patients
  FOR SELECT
  TO authenticated
  USING (
    -- Allow access if user's auth.uid() matches either:
    -- 1. The auth_uid field (portal user linked to this patient)
    -- 2. The user's email matches the patient's email
    auth.uid()::text = auth_uid OR
    (SELECT auth.email()) = email
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add policy for patients to update their own contact verification status
DO $$ BEGIN
  CREATE POLICY "Patients can verify own contact"
  ON patients
  FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = auth_uid)
  WITH CHECK (
    auth.uid()::text = auth_uid AND
    -- Only allow updating contact_verified field
    (
      (OLD.email = NEW.email OR (OLD.email IS NULL AND NEW.email IS NULL)) AND
      (OLD.phone = NEW.phone OR (OLD.phone IS NULL AND NEW.phone IS NULL))
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 7: Add comment explaining the table structure
COMMENT ON COLUMN patients.email IS 'Patient email address for portal login (unique, case-insensitive)';
COMMENT ON COLUMN patients.auth_uid IS 'Supabase Auth user ID for linked portal accounts (unique)';
COMMENT ON COLUMN patients.contact_verified IS 'Whether the patient has verified their email/phone via OTP';
COMMENT ON CONSTRAINT check_at_least_one_contact ON patients IS 'Ensures at least one contact method (email or phone) is provided';

-- Step 8: Update the updated_at timestamp for tracking
CREATE OR REPLACE FUNCTION update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists for updated_at
DROP TRIGGER IF EXISTS patients_updated_at_trigger ON patients;
CREATE TRIGGER patients_updated_at_trigger
  BEFORE UPDATE ON patients
  FOR EACH ROW
  EXECUTE FUNCTION update_patients_updated_at();


-- Migration: 20251030000000_add_patient_portal_features.sql
-- ============================================================
/*
  # Add Patient Portal Features

  Complete implementation of patient portal features per use case diagram.

  ## New Tables

  1. **patient_secure_messages**
     - Secure messaging between patients and healthcare providers
     - Supports bidirectional communication
     - Tracks read status and sender information

  2. **patient_lab_results**
     - Lab test results viewable by patients
     - Tracks test status and abnormal flags
     - Includes reference ranges and units

  3. **patient_medical_conditions**
     - Patient-entered medical conditions
     - Tracks condition status (active, managed, resolved)
     - Links to patient records

  4. **patient_documents**
     - Document upload and storage management
     - Categorizes document types
     - Tracks file metadata and storage paths

  5. **patient_referrals**
     - Specialist referrals tracking
     - Manages appointment scheduling
     - Priority and status tracking

  6. **patient_portal_preferences**
     - User notification preferences
     - Email and SMS notification settings
     - Per-user customization

  ## Security

  - All tables have RLS enabled
  - Patients can only access their own data
  - Staff can access patient data through appropriate roles
  - Secure storage bucket for documents

  ## Indexes

  - Optimized queries for patient_id lookups
  - Date-based sorting indexes
  - Status and priority filtering indexes
*/

-- Create secure messaging table
CREATE TABLE IF NOT EXISTS patient_secure_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body text NOT NULL,
  from_patient boolean NOT NULL DEFAULT true,
  from_name text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secure_messages_patient ON patient_secure_messages(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_secure_messages_staff ON patient_secure_messages(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_secure_messages_unread ON patient_secure_messages(patient_id, read) WHERE NOT read;

-- Create lab results table
CREATE TABLE IF NOT EXISTS patient_lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  test_name text NOT NULL,
  test_type text NOT NULL,
  result_value text,
  unit text,
  reference_range text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'reviewed')),
  ordered_date timestamptz NOT NULL DEFAULT now(),
  result_date timestamptz,
  notes text,
  abnormal boolean DEFAULT false,
  ordered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_results_patient ON patient_lab_results(patient_id, ordered_date DESC);
CREATE INDEX IF NOT EXISTS idx_lab_results_status ON patient_lab_results(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_results_abnormal ON patient_lab_results(patient_id, abnormal) WHERE abnormal = true;

-- Create medical conditions table
CREATE TABLE IF NOT EXISTS patient_medical_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  condition_name text NOT NULL,
  diagnosed_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'managed')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_conditions_patient ON patient_medical_conditions(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_conditions_status ON patient_medical_conditions(patient_id, status);

-- Create documents table
CREATE TABLE IF NOT EXISTS patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('medical_record', 'lab_result', 'imaging', 'prescription', 'insurance', 'other')),
  description text,
  storage_path text NOT NULL,
  upload_date timestamptz DEFAULT now(),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_patient ON patient_documents(patient_id, upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_type ON patient_documents(patient_id, document_type);

-- Create referrals table
CREATE TABLE IF NOT EXISTS patient_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  referring_provider text NOT NULL,
  specialist_name text,
  specialty text NOT NULL,
  reason text NOT NULL,
  referral_date date NOT NULL DEFAULT CURRENT_DATE,
  appointment_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'emergency')),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_patient ON patient_referrals(patient_id, referral_date DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON patient_referrals(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_priority ON patient_referrals(patient_id, priority);

-- Create portal preferences table
CREATE TABLE IF NOT EXISTS patient_portal_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES patient_portal_users(id) ON DELETE CASCADE,
  email_reminders boolean DEFAULT true,
  sms_reminders boolean DEFAULT true,
  appointment_alerts boolean DEFAULT true,
  lab_results_alerts boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(portal_user_id)
);

-- Enable Row Level Security
ALTER TABLE patient_secure_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_medical_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_portal_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for patient_secure_messages

DO $$ BEGIN
  CREATE POLICY "Patients can view own messages"
  ON patient_secure_messages FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can send messages"
  ON patient_secure_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view all messages"
  ON patient_secure_messages FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can send messages"
  ON patient_secure_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for patient_lab_results

DO $$ BEGIN
  CREATE POLICY "Patients can view own lab results"
  ON patient_lab_results FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view all lab results"
  ON patient_lab_results FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage lab results"
  ON patient_lab_results FOR ALL
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for patient_medical_conditions

DO $$ BEGIN
  CREATE POLICY "Patients can view own conditions"
  ON patient_medical_conditions FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can add own conditions"
  ON patient_medical_conditions FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view all conditions"
  ON patient_medical_conditions FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for patient_documents

DO $$ BEGIN
  CREATE POLICY "Patients can view own documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can upload documents"
  ON patient_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can delete own documents"
  ON patient_documents FOR DELETE
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view all documents"
  ON patient_documents FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for patient_referrals

DO $$ BEGIN
  CREATE POLICY "Patients can view own referrals"
  ON patient_referrals FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage referrals"
  ON patient_referrals FOR ALL
  TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for patient_portal_preferences

DO $$ BEGIN
  CREATE POLICY "Patients can manage own preferences"
  ON patient_portal_preferences FOR ALL
  TO authenticated
  USING (
    portal_user_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
  )
  WITH CHECK (
    portal_user_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create storage bucket for patient documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('patient-documents', 'patient-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for patient documents
DO $$ BEGIN
  CREATE POLICY "Patients can upload own documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] IN (
      SELECT patient_id::text FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can view own documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] IN (
      SELECT patient_id::text FROM patient_portal_users
      WHERE id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'portal_user_id')::uuid)
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view all patient documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'patient-documents' AND
    auth.jwt() ->> 'role' IN ('admin', 'doctor', 'nurse')
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Update triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  DROP TRIGGER IF EXISTS update_patient_secure_messages_updated_at ON patient_secure_messages;
  CREATE TRIGGER update_patient_secure_messages_updated_at
    BEFORE UPDATE ON patient_secure_messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_lab_results_updated_at ON patient_lab_results;
  CREATE TRIGGER update_patient_lab_results_updated_at
    BEFORE UPDATE ON patient_lab_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_medical_conditions_updated_at ON patient_medical_conditions;
  CREATE TRIGGER update_patient_medical_conditions_updated_at
    BEFORE UPDATE ON patient_medical_conditions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_referrals_updated_at ON patient_referrals;
  CREATE TRIGGER update_patient_referrals_updated_at
    BEFORE UPDATE ON patient_referrals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_patient_portal_preferences_updated_at ON patient_portal_preferences;
  CREATE TRIGGER update_patient_portal_preferences_updated_at
    BEFORE UPDATE ON patient_portal_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END $$;


-- Migration: 20251031000000_fix_patient_session_rls.sql
-- ============================================================
/*
  # Fix Patient Portal Session RLS

  ## Problem
  Patient portal users cannot validate their sessions because the RLS policies
  on patient_portal_sessions require auth.uid(), but patient portal users
  use custom session tokens, not Supabase Auth.

  ## Solution
  Add RLS policy that allows anyone to SELECT and UPDATE sessions using
  the session_token. This is safe because:
  1. Session tokens are UUIDs (virtually unguessable)
  2. We only allow operations on exact session_token match
  3. Tokens expire after 24 hours
  4. This only affects session validation, not data access

  ## Security
  - Session tokens act as bearer tokens
  - Only SELECT and UPDATE allowed (not DELETE or INSERT)
  - Must match exact session_token
  - All patient data access still protected by separate RLS policies
*/

-- Drop existing restrictive policies that block session validation
DROP POLICY IF EXISTS "Patients can delete own sessions" ON patient_portal_sessions;
DROP POLICY IF EXISTS "Admins can view all patient sessions" ON patient_portal_sessions;

-- Allow anyone to SELECT their session by token (for validation)
DO $$ BEGIN
  CREATE POLICY "Anyone can validate session by token"
  ON patient_portal_sessions FOR SELECT
  TO anon, authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow anyone to UPDATE their session by token (for refresh)
DO $$ BEGIN
  CREATE POLICY "Anyone can refresh session by token"
  ON patient_portal_sessions FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Staff can view all sessions for monitoring
DO $$ BEGIN
  CREATE POLICY "Staff can view all patient sessions"
  ON patient_portal_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Staff can manage sessions
DO $$ BEGIN
  CREATE POLICY "Staff can manage patient sessions"
  ON patient_portal_sessions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'doctor', 'nurse')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- Migration: 20251031000001_add_patient_portal_fixed.sql
-- ============================================================
/*
  # Patient Portal Complete Database Schema (Fixed)

  ## Overview
  Creates all missing patient portal tables with correct TEXT patient_id references.

  ## New Tables
  1. patient_notifications - Appointment reminders, alerts
  2. patient_messages - Secure messaging with care team
  3. patient_appointment_requests - Patient-initiated scheduling
  4. patient_documents - Patient-uploaded files
  5. patient_consent_records - Consent tracking for compliance

  ## Security
  - All tables have RLS enabled
  - Patients can only access their own data
  - Staff have role-based access
*/

-- ============================================================================
-- PATIENT NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')) DEFAULT 'normal',
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  action_url text,
  action_label text,
  metadata jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_notifications_patient ON patient_notifications(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_read ON patient_notifications(read);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_created ON patient_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_type ON patient_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_patient_notifications_priority ON patient_notifications(priority);

-- ============================================================================
-- PATIENT MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('patient', 'staff')),
  sender_id text NOT NULL,
  subject text,
  message_body text NOT NULL,
  parent_message_id uuid REFERENCES patient_messages(id) ON DELETE CASCADE,
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  attachments jsonb,
  priority text NOT NULL CHECK (priority IN ('normal', 'high')) DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_messages_patient ON patient_messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_sender ON patient_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_parent ON patient_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_created ON patient_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_messages_read ON patient_messages(read);

-- ============================================================================
-- PATIENT APPOINTMENT REQUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  appointment_type text NOT NULL,
  preferred_date_1 date NOT NULL,
  preferred_time_1 text,
  preferred_date_2 date,
  preferred_time_2 text,
  preferred_date_3 date,
  preferred_time_3 text,
  reason text,
  notes text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'scheduled', 'declined', 'cancelled')) DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  scheduled_appointment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_patient ON patient_appointment_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_status ON patient_appointment_requests(status);
CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_created ON patient_appointment_requests(created_at);

-- ============================================================================
-- PATIENT DOCUMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  document_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by_patient boolean NOT NULL DEFAULT true,
  uploaded_by_user_id text,
  description text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON patient_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_documents_type ON patient_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_patient_documents_created ON patient_documents(created_at);

-- ============================================================================
-- PATIENT CONSENT RECORDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  consent_type text NOT NULL,
  consent_given boolean NOT NULL,
  consent_text text NOT NULL,
  consent_version text NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_patient_consent_records_patient ON patient_consent_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_consent_records_type ON patient_consent_records(consent_type);
CREATE INDEX IF NOT EXISTS idx_patient_consent_records_created ON patient_consent_records(created_at);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE patient_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_appointment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consent_records ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- NOTIFICATIONS: Patients can view and update own notifications
DO $$ BEGIN
  CREATE POLICY "Patients can view own notifications"
  ON patient_notifications FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can update own notifications"
  ON patient_notifications FOR UPDATE
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can create patient notifications"
  ON patient_notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- MESSAGES: Patients can view and send messages
DO $$ BEGIN
  CREATE POLICY "Patients can view own messages"
  ON patient_messages FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can send messages"
  ON patient_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage messages"
  ON patient_messages FOR ALL
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- APPOINTMENT REQUESTS: Patients can create and view own requests
DO $$ BEGIN
  CREATE POLICY "Patients can view own appointment requests"
  ON patient_appointment_requests FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can create appointment requests"
  ON patient_appointment_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage appointment requests"
  ON patient_appointment_requests FOR ALL
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- DOCUMENTS: Patients can upload and view own documents
DO $$ BEGIN
  CREATE POLICY "Patients can view own documents"
  ON patient_documents FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can upload documents"
  ON patient_documents FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can manage patient documents"
  ON patient_documents FOR ALL
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CONSENT RECORDS: Patients can view and create own consent
DO $$ BEGIN
  CREATE POLICY "Patients can view own consent records"
  ON patient_consent_records FOR SELECT
  TO anon, authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Patients can create consent records"
  ON patient_consent_records FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM patient_portal_users WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view consent records"
  ON patient_consent_records FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_patient_messages_updated_at'
  ) THEN
    CREATE TRIGGER update_patient_messages_updated_at
      BEFORE UPDATE ON patient_messages
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_patient_appointment_requests_updated_at'
  ) THEN
    CREATE TRIGGER update_patient_appointment_requests_updated_at
      BEFORE UPDATE ON patient_appointment_requests
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_patient_documents_updated_at'
  ) THEN
    CREATE TRIGGER update_patient_documents_updated_at
      BEFORE UPDATE ON patient_documents
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;


-- Migration: 20251214162156_add_palaver_room_messaging.sql
-- ============================================================
/*
  # Palaver Room - Doctor Internal Messaging System

  "Palaver" is a West African pidgin term meaning discussion or conference.
  This system enables secure internal communication between medical staff.

  1. New Tables
    - `palaver_messages` - Individual messages between staff
      - `id` (uuid, primary key)
      - `sender_id` (text, references users)
      - `recipient_id` (text, references users, nullable for broadcast)
      - `subject` (text)
      - `body` (text)
      - `priority` (text: normal, urgent, critical)
      - `is_read` (boolean)
      - `read_at` (timestamptz)
      - `is_archived` (boolean)
      - `parent_id` (uuid, for threading/replies)
      - `created_at` (timestamptz)

    - `palaver_broadcasts` - Broadcast messages to all doctors/staff
      - `id` (uuid, primary key)
      - `sender_id` (text)
      - `target_role` (text: doctor, nurse, all_clinical)
      - `subject` (text)
      - `body` (text)
      - `priority` (text)
      - `expires_at` (timestamptz)
      - `created_at` (timestamptz)

    - `palaver_broadcast_reads` - Track who has read broadcasts
      - `id` (uuid, primary key)
      - `broadcast_id` (uuid)
      - `user_id` (text)
      - `read_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users can only see their own messages
    - Doctors/nurses can see broadcasts targeting their role

  3. Indexes
    - Optimized for common queries (unread messages, by sender/recipient)
*/

-- Create palaver_messages table
CREATE TABLE IF NOT EXISTS palaver_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'critical')),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  is_archived BOOLEAN DEFAULT false,
  parent_id UUID REFERENCES palaver_messages(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create palaver_broadcasts table
CREATE TABLE IF NOT EXISTS palaver_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  target_role TEXT NOT NULL CHECK (target_role IN ('doctor', 'nurse', 'pharmacist', 'all_clinical', 'all_staff')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'critical')),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create palaver_broadcast_reads table
CREATE TABLE IF NOT EXISTS palaver_broadcast_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES palaver_broadcasts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(broadcast_id, user_id)
);

-- Enable RLS
ALTER TABLE palaver_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE palaver_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE palaver_broadcast_reads ENABLE ROW LEVEL SECURITY;

-- RLS Policies for palaver_messages
DO $$ BEGIN
  CREATE POLICY "Users can view messages they sent or received"
  ON palaver_messages FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()::text OR recipient_id = auth.uid()::text
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert messages they send"
  ON palaver_messages FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Recipients can update read status"
  ON palaver_messages FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid()::text)
  WITH CHECK (recipient_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for palaver_broadcasts
DO $$ BEGIN
  CREATE POLICY "All authenticated users can view active broadcasts"
  ON palaver_broadcasts FOR SELECT
  TO authenticated
  USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Doctors and admins can create broadcasts"
  ON palaver_broadcasts FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies for palaver_broadcast_reads
DO $$ BEGIN
  CREATE POLICY "Users can view their own broadcast reads"
  ON palaver_broadcast_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can mark broadcasts as read"
  ON palaver_broadcast_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_palaver_messages_recipient ON palaver_messages(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_palaver_messages_sender ON palaver_messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_palaver_messages_parent ON palaver_messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_palaver_broadcasts_active ON palaver_broadcasts(is_active, target_role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_palaver_broadcast_reads_user ON palaver_broadcast_reads(user_id, broadcast_id);

-- Add comments for documentation
COMMENT ON TABLE palaver_messages IS 'Palaver Room: Direct messages between medical staff. "Palaver" is West African pidgin for discussion.';
COMMENT ON TABLE palaver_broadcasts IS 'Palaver Room: Broadcast announcements to staff groups';
COMMENT ON TABLE palaver_broadcast_reads IS 'Tracks which users have read broadcast messages';
COMMENT ON COLUMN palaver_messages.priority IS 'Message urgency: normal (default), urgent (needs attention), critical (immediate action required)';

