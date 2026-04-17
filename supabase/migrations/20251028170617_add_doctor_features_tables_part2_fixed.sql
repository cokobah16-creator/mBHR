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
DROP POLICY IF EXISTS "Staff can view flags in their organizations" ON patient_flags;
CREATE POLICY "Staff can view flags in their organizations" ON patient_flags FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Staff can create flags in their organizations" ON patient_flags;
CREATE POLICY "Staff can create flags in their organizations" ON patient_flags FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Staff can update flags in their organizations" ON patient_flags;
CREATE POLICY "Staff can update flags in their organizations" ON patient_flags FOR UPDATE TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for referrals
DROP POLICY IF EXISTS "Staff can view referrals in their organizations" ON referrals;
CREATE POLICY "Staff can view referrals in their organizations" ON referrals FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Doctors can manage referrals in their organizations" ON referrals;
CREATE POLICY "Doctors can manage referrals in their organizations" ON referrals FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for follow_up_schedules
DROP POLICY IF EXISTS "Staff can view follow-ups in their organizations" ON follow_up_schedules;
CREATE POLICY "Staff can view follow-ups in their organizations" ON follow_up_schedules FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
CREATE POLICY "Clinical staff can manage follow-ups" ON follow_up_schedules FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for prescription_templates
CREATE POLICY "Staff can view prescription templates" ON prescription_templates FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
CREATE POLICY "Doctors can manage prescription templates" ON prescription_templates FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for site_formulary
CREATE POLICY "Staff can view site formulary" ON site_formulary FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
CREATE POLICY "Pharmacists can manage site formulary" ON site_formulary FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for doctor_analytics
CREATE POLICY "Staff can view doctor analytics" ON doctor_analytics FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()) OR doctor_id = auth.uid());
DROP POLICY IF EXISTS "System can manage doctor analytics" ON doctor_analytics;
CREATE POLICY "System can manage doctor analytics" ON doctor_analytics FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for consultation_reviews
CREATE POLICY "Staff can view consultation reviews" ON consultation_reviews FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()) OR reviewed_doctor_id = auth.uid() OR reviewing_doctor_id = auth.uid());
DROP POLICY IF EXISTS "Supervising doctors can manage reviews" ON consultation_reviews;
CREATE POLICY "Supervising doctors can manage reviews" ON consultation_reviews FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for protocol_library
CREATE POLICY "Staff can view protocols" ON protocol_library FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));
CREATE POLICY "Doctors can manage protocols" ON protocol_library FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- Triggers
DROP TRIGGER IF EXISTS referrals_updated_at ON referrals;
CREATE TRIGGER referrals_updated_at BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS follow_up_schedules_updated_at ON follow_up_schedules;
CREATE TRIGGER follow_up_schedules_updated_at BEFORE UPDATE ON follow_up_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS prescription_templates_updated_at ON prescription_templates;
CREATE TRIGGER prescription_templates_updated_at BEFORE UPDATE ON prescription_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS site_formulary_updated_at ON site_formulary;
CREATE TRIGGER site_formulary_updated_at BEFORE UPDATE ON site_formulary FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS doctor_analytics_updated_at ON doctor_analytics;
CREATE TRIGGER doctor_analytics_updated_at BEFORE UPDATE ON doctor_analytics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS protocol_library_updated_at ON protocol_library;
CREATE TRIGGER protocol_library_updated_at BEFORE UPDATE ON protocol_library FOR EACH ROW EXECUTE FUNCTION update_updated_at();
