/*
  # Multi-Tenant Foundation for Medical Outreach Platform

  1. New Tables
    - `organizations`
      - `id` (uuid, primary key)
      - `name` (text) - organization name (e.g., DIOF)
      - `slug` (text, unique) - URL-friendly identifier
      - `logo_url` (text, nullable) - organization logo
      - `settings` (jsonb) - org-specific configuration
      - `subscription_tier` (text) - for future multi-org billing
      - `is_active` (boolean) - organization status
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `sites`
      - `id` (uuid, primary key)
      - `org_id` (uuid, foreign key to organizations)
      - `name` (text) - site name (e.g., "Okpanam PHC")
      - `site_code` (text) - short code for quick reference
      - `address` (text)
      - `state` (text)
      - `lga` (text)
      - `typical_patient_volume` (integer) - expected patients per event
      - `capacity` (integer) - max patients site can handle
      - `coordinates` (jsonb, nullable) - lat/lng for mapping
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `outreach_events`
      - `id` (uuid, primary key)
      - `org_id` (uuid, foreign key to organizations)
      - `site_id` (uuid, foreign key to sites)
      - `event_name` (text)
      - `event_date` (date)
      - `start_time` (time)
      - `end_time` (time)
      - `status` (text) - planned, active, completed, cancelled
      - `expected_volume` (integer)
      - `actual_volume` (integer, nullable)
      - `staff_roster` (jsonb) - array of staff assignments
      - `notes` (text, nullable)
      - `outcome_summary` (jsonb, nullable) - post-event metrics
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `event_staff_assignments`
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to outreach_events)
      - `user_id` (uuid, foreign key to users)
      - `role` (text) - doctor, nurse, pharmacist, volunteer
      - `station` (text, nullable) - registration, vitals, consult, pharmacy
      - `is_supervising` (boolean) - for lead doctor
      - `check_in_time` (timestamptz, nullable)
      - `check_out_time` (timestamptz, nullable)
      - `created_at` (timestamptz)

    - `user_org_sites`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `org_id` (uuid, foreign key to organizations)
      - `site_id` (uuid, foreign key to sites, nullable) - null means access to all sites
      - `is_default` (boolean) - default org/site for this user
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all new tables
    - Add policies for org/site-scoped access
    - Users can only access data for their assigned organizations and sites

  3. Important Notes
    - org_id and site_id will be added to existing tables in next migration
    - First organization (DIOF) will be seeded via application code
    - RLS policies ensure complete data isolation between organizations
*/

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
  ON organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage their organizations"
  ON organizations
  FOR ALL
  TO authenticated
  USING (
    id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for sites
CREATE POLICY "Users can view sites in their organizations"
  ON sites
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage sites in their organizations"
  ON sites
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

-- RLS Policies for outreach_events
CREATE POLICY "Users can view events in their organizations"
  ON outreach_events
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Staff can manage events in their organizations"
  ON outreach_events
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

-- RLS Policies for event_staff_assignments
CREATE POLICY "Users can view their event assignments"
  ON event_staff_assignments
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    event_id IN (
      SELECT id FROM outreach_events WHERE org_id IN (
        SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Staff can manage event assignments in their organizations"
  ON event_staff_assignments
  FOR ALL
  TO authenticated
  USING (
    event_id IN (
      SELECT id FROM outreach_events WHERE org_id IN (
        SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    event_id IN (
      SELECT id FROM outreach_events WHERE org_id IN (
        SELECT org_id FROM user_org_sites WHERE user_id = auth.uid()
      )
    )
  );

-- RLS Policies for user_org_sites
CREATE POLICY "Users can view their own org assignments"
  ON user_org_sites
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage user org assignments"
  ON user_org_sites
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

-- Add updated_at trigger for organizations
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sites_updated_at
  BEFORE UPDATE ON sites
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER outreach_events_updated_at
  BEFORE UPDATE ON outreach_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
