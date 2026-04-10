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
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT TO authenticated
  USING (id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage their organizations"
  ON organizations FOR ALL TO authenticated
  USING (id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for sites
CREATE POLICY "Users can view sites in their organizations"
  ON sites FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage sites in their organizations"
  ON sites FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for outreach_events
CREATE POLICY "Users can view events in their organizations"
  ON outreach_events FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

CREATE POLICY "Staff can manage events in their organizations"
  ON outreach_events FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

-- RLS Policies for event_staff_assignments
CREATE POLICY "Users can view their event assignments"
  ON event_staff_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR event_id IN (SELECT id FROM outreach_events WHERE org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid())));

CREATE POLICY "Staff can manage event assignments in their organizations"
  ON event_staff_assignments FOR ALL TO authenticated
  USING (event_id IN (SELECT id FROM outreach_events WHERE org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid())))
  WITH CHECK (event_id IN (SELECT id FROM outreach_events WHERE org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid())));

-- RLS Policies for user_org_sites
CREATE POLICY "Users can view their own org assignments"
  ON user_org_sites FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage user org assignments"
  ON user_org_sites FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()));

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
