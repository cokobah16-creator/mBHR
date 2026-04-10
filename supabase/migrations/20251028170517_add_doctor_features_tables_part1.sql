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
