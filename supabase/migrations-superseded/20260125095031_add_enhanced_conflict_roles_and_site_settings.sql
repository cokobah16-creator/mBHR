/*
  # Enhanced Conflict Resolution: Roles and Site Settings

  1. Role Updates
    - Adds 'auditor' and 'lead_clinician' roles to app_users table
    - These roles have authority to approve high-sensitivity PHI conflict resolutions

  2. New Tables
    - `site_conflict_settings`
      - `id` (uuid, primary key)
      - `site_id` (text) - references the site
      - `name_match_threshold` (numeric) - adjustable for linguistic regions (e.g., 0.7 for Kano vs 0.85 for Delta State)
      - `phone_match_weight` (numeric) - regional phone format variations
      - `dob_match_weight` (numeric) - weight for date of birth matching
      - `auto_resolution_enabled` (boolean) - whether auto-resolution is enabled for this site
      - `high_phi_approval_required` (boolean) - whether high PHI conflicts require approval
      - `approved_auto_rules` (uuid array) - which global rules this site accepts
      - `linguistic_region` (text) - region identifier for name matching algorithms
      - Timestamps and audit fields

  3. Modified Tables
    - `conflict_resolutions`
      - Adds `required_approver_role` - specifies which role must approve
      - Adds `escalation_reason` - why escalation is needed
      - Adds `second_approver_id` and `second_approved_at` for dual-approval scenarios
      - Adds `site_id` for site-scoped conflicts
      - Adds `resolution_policy_reference` for legal/policy documentation

  4. Security
    - RLS enabled on site_conflict_settings
    - Only authenticated users with appropriate roles can modify settings
*/

-- Update app_users role check constraint to include new roles
DO $$
BEGIN
  ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
  ALTER TABLE app_users ADD CONSTRAINT app_users_role_check 
    CHECK (role = ANY (ARRAY['admin'::text, 'doctor'::text, 'nurse'::text, 'pharmacist'::text, 'volunteer'::text, 'auditor'::text, 'lead_clinician'::text]));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not update role constraint: %', SQLERRM;
END $$;

-- Create site_conflict_settings table
CREATE TABLE IF NOT EXISTS site_conflict_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL,
  site_name text,
  name_match_threshold numeric DEFAULT 0.8 CHECK (name_match_threshold >= 0 AND name_match_threshold <= 1),
  phone_match_weight numeric DEFAULT 0.9 CHECK (phone_match_weight >= 0 AND phone_match_weight <= 1),
  dob_match_weight numeric DEFAULT 0.95 CHECK (dob_match_weight >= 0 AND dob_match_weight <= 1),
  auto_resolution_enabled boolean DEFAULT true,
  high_phi_approval_required boolean DEFAULT true,
  approved_auto_rules uuid[] DEFAULT '{}',
  linguistic_region text DEFAULT 'default',
  require_dual_approval_for_patient_merge boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  UNIQUE(site_id)
);

COMMENT ON TABLE site_conflict_settings IS 'Site-level configuration for conflict resolution thresholds and auto-resolution rules';
COMMENT ON COLUMN site_conflict_settings.name_match_threshold IS 'Match threshold for name similarity (0-1). Lower values for regions with common name variations';
COMMENT ON COLUMN site_conflict_settings.linguistic_region IS 'Region identifier for name matching: default, hausa, yoruba, igbo, delta, etc.';
COMMENT ON COLUMN site_conflict_settings.require_dual_approval_for_patient_merge IS 'Requires both Lead Clinician AND Admin/Auditor for high-PHI patient merges';

ALTER TABLE site_conflict_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view site conflict settings"
  ON site_conflict_settings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage site conflict settings"
  ON site_conflict_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  );

-- Add new columns to conflict_resolutions table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'required_approver_role'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN required_approver_role text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'escalation_reason'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN escalation_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'second_approver_id'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN second_approver_id uuid REFERENCES auth.users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'second_approved_at'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN second_approved_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'site_id'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN site_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_resolutions' AND column_name = 'resolution_policy_reference'
  ) THEN
    ALTER TABLE conflict_resolutions ADD COLUMN resolution_policy_reference text;
  END IF;
END $$;

COMMENT ON COLUMN conflict_resolutions.required_approver_role IS 'Role required to approve this conflict: admin, auditor, or lead_clinician';
COMMENT ON COLUMN conflict_resolutions.escalation_reason IS 'Reason why this conflict requires escalated approval';
COMMENT ON COLUMN conflict_resolutions.second_approver_id IS 'Second approver for dual-approval scenarios (high-PHI patient merges)';
COMMENT ON COLUMN conflict_resolutions.resolution_policy_reference IS 'Reference to policy document authorizing this resolution type';

-- Add check constraint for required_approver_role
DO $$
BEGIN
  ALTER TABLE conflict_resolutions DROP CONSTRAINT IF EXISTS conflict_resolutions_required_approver_role_check;
  ALTER TABLE conflict_resolutions ADD CONSTRAINT conflict_resolutions_required_approver_role_check
    CHECK (required_approver_role IS NULL OR required_approver_role = ANY (ARRAY['admin'::text, 'auditor'::text, 'lead_clinician'::text]));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not add approver role constraint: %', SQLERRM;
END $$;

-- Create index for site-scoped conflict queries
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_site_id ON conflict_resolutions(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_required_approver ON conflict_resolutions(required_approver_role) WHERE required_approver_role IS NOT NULL;

-- Insert default global settings (site_id = 'global')
INSERT INTO site_conflict_settings (site_id, site_name, linguistic_region, name_match_threshold)
VALUES ('global', 'Global Default Settings', 'default', 0.8)
ON CONFLICT (site_id) DO NOTHING;

-- Insert example regional settings for Nigerian linguistic regions
INSERT INTO site_conflict_settings (site_id, site_name, linguistic_region, name_match_threshold)
VALUES 
  ('region_hausa', 'Hausa-Speaking Region (Kano, Kaduna)', 'hausa', 0.7),
  ('region_yoruba', 'Yoruba-Speaking Region (Lagos, Oyo)', 'yoruba', 0.75),
  ('region_igbo', 'Igbo-Speaking Region (Anambra, Enugu)', 'igbo', 0.75),
  ('region_delta', 'Niger Delta Region', 'delta', 0.85)
ON CONFLICT (site_id) DO NOTHING;