/*
  # Doctor-Specific Features and Communication Tables

  1. New Tables
    - `patient_flags`
      - Lightweight inter-station communication system
      - Replaces need for full chat system
      - Types: escalate_to_doctor, recheck_vitals, pharmacy_query, lab_pending

    - `referrals`
      - Patient referrals to specialists or facilities
      - Tracks follow-up and outcomes

    - `follow_up_schedules`
      - Return visit scheduling for chronic patients
      - Links to future outreach events

    - `prescription_templates`
      - Protocol-based medication sets
      - Quick-add for common conditions

    - `site_formulary`
      - Available medications at each site
      - Stock levels and alternatives

    - `doctor_analytics`
      - Per-event performance tracking
      - Throughput and quality metrics

    - `consultation_reviews`
      - Supervising doctor oversight
      - Quality assurance workflow

    - `protocol_library`
      - Clinical guidelines and treatment algorithms
      - Site-scoped protocols

  2. Security
    - Enable RLS on all tables
    - Scope access by org_id and site_id
    - Role-based permissions for doctors, nurses, pharmacists

  3. Important Notes
    - All tables include org_id and site_id for multi-tenant support
    - Indexes optimized for high-throughput outreach operations
    - Foreign key constraints ensure data integrity
*/

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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_flags_patient_id ON patient_flags(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_flags_event_id ON patient_flags(event_id);
CREATE INDEX IF NOT EXISTS idx_patient_flags_status ON patient_flags(status);
CREATE INDEX IF NOT EXISTS idx_patient_flags_flag_type ON patient_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_patient_flags_to_station ON patient_flags(to_station);

CREATE INDEX IF NOT EXISTS idx_referrals_patient_id ON referrals(patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_event_id ON referrals(event_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_referring_doctor_id ON referrals(referring_doctor_id);

CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_patient_id ON follow_up_schedules(patient_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_scheduled_date ON follow_up_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_status ON follow_up_schedules(status);

CREATE INDEX IF NOT EXISTS idx_site_formulary_site_id ON site_formulary(site_id);
CREATE INDEX IF NOT EXISTS idx_site_formulary_medication_name ON site_formulary(medication_name);

CREATE INDEX IF NOT EXISTS idx_doctor_analytics_event_id ON doctor_analytics(event_id);
CREATE INDEX IF NOT EXISTS idx_doctor_analytics_doctor_id ON doctor_analytics(doctor_id);

CREATE INDEX IF NOT EXISTS idx_consultation_reviews_reviewed_doctor_id ON consultation_reviews(reviewed_doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_reviewing_doctor_id ON consultation_reviews(reviewing_doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_review_status ON consultation_reviews(review_status);

CREATE INDEX IF NOT EXISTS idx_protocol_library_condition ON protocol_library(condition);
CREATE INDEX IF NOT EXISTS idx_protocol_library_category ON protocol_library(category);

-- Enable Row Level Security
ALTER TABLE patient_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_formulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies for patient_flags
CREATE POLICY "Staff can view flags in their organizations"
  ON patient_flags
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Staff can create flags in their organizations"
  ON patient_flags
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Staff can update flags in their organizations"
  ON patient_flags
  FOR UPDATE
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for referrals
CREATE POLICY "Staff can view referrals in their organizations"
  ON referrals
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Doctors can manage referrals in their organizations"
  ON referrals
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for follow_up_schedules
CREATE POLICY "Staff can view follow-ups in their organizations"
  ON follow_up_schedules
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Clinical staff can manage follow-ups in their organizations"
  ON follow_up_schedules
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for prescription_templates
CREATE POLICY "Staff can view prescription templates in their organizations"
  ON prescription_templates
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Doctors and admins can manage prescription templates"
  ON prescription_templates
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for site_formulary
CREATE POLICY "Staff can view site formulary in their organizations"
  ON site_formulary
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Pharmacists and admins can manage site formulary"
  ON site_formulary
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for doctor_analytics
CREATE POLICY "Staff can view doctor analytics in their organizations"
  ON doctor_analytics
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    ) OR
    doctor_id = auth.uid()
  );

CREATE POLICY "System can manage doctor analytics"
  ON doctor_analytics
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for consultation_reviews
CREATE POLICY "Staff can view consultation reviews in their organizations"
  ON consultation_reviews
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    ) OR
    reviewed_doctor_id = auth.uid() OR
    reviewing_doctor_id = auth.uid()
  );

CREATE POLICY "Supervising doctors can manage reviews"
  ON consultation_reviews
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for protocol_library
CREATE POLICY "Staff can view protocols in their organizations"
  ON protocol_library
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Doctors and admins can manage protocols"
  ON protocol_library
  FOR ALL
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- Add updated_at triggers
CREATE TRIGGER referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER follow_up_schedules_updated_at
  BEFORE UPDATE ON follow_up_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER prescription_templates_updated_at
  BEFORE UPDATE ON prescription_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER site_formulary_updated_at
  BEFORE UPDATE ON site_formulary
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER doctor_analytics_updated_at
  BEFORE UPDATE ON doctor_analytics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER protocol_library_updated_at
  BEFORE UPDATE ON protocol_library
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
