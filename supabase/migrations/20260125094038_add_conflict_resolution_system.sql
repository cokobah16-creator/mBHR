/*
  # Conflict Resolution System for PHI Minimization

  1. New Tables
    - `conflict_resolutions` - Tracks all detected conflicts and their resolution status
      - `id` (uuid, primary key)
      - `conflict_type` (text) - 'sync_conflict', 'duplicate', 'data_quality'
      - `entity_type` (text) - 'patients', 'vitals', 'consultations', etc.
      - `entity_id` (text) - The primary record involved (supports legacy text IDs and UUIDs)
      - `entity_id` (text) - The primary record involved (supports legacy text PKs)
      - `candidate_ids` (uuid[]) - Related records (for duplicates)
      - `status` (text) - 'pending', 'resolved', 'ignored', 'auto_resolved'
      - `priority` (text) - 'low', 'medium', 'high', 'critical'
      - `phi_sensitivity` (text) - 'none', 'low', 'medium', 'high'
      - `conflict_details` (jsonb) - Field-level conflict information
      - `resolution_strategy` (text) - 'keep_local', 'keep_remote', 'manual', 'merge'
      - `resolution_details` (jsonb) - What was resolved and how
      - `resolved_by` (uuid) - User who resolved
      - `resolved_at` (timestamptz)
      - `approved_by` (uuid) - Secondary approver for high-PHI conflicts
      - `approved_at` (timestamptz)
      - `created_at`, `updated_at` timestamps

    - `conflict_audit_logs` - Detailed audit trail for compliance
      - `id` (uuid, primary key)
      - `conflict_id` (uuid, references conflict_resolutions)
      - `action` (text) - 'created', 'viewed', 'resolved', 'approved', 'appealed'
      - `actor_id` (uuid)
      - `actor_role` (text)
      - `field_changes` (jsonb) - Specific PHI fields accessed/modified
      - `justification` (text) - Reason for action
      - `ip_address` (text)
      - `created_at` timestamp

    - `auto_resolution_rules` - Configurable rules for automatic resolution
      - `id` (uuid, primary key)
      - `name` (text)
      - `entity_type` (text)
      - `conflict_type` (text)
      - `conditions` (jsonb) - Rule conditions
      - `resolution_strategy` (text)
      - `is_active` (boolean)
      - `phi_allowed` (boolean) - Whether rule can touch PHI fields
      - `created_by` (uuid)
      - timestamps

  2. Security
    - Enable RLS on all tables
    - Only authenticated users with admin/doctor role can access
    - Audit logs are append-only (no update/delete)

  3. Important Notes
    - PHI sensitivity tracking enables minimum necessary principle
    - Secondary approval workflow for high-sensitivity conflicts
    - Full audit trail for HIPAA compliance
*/

-- Conflict Resolutions Table
CREATE TABLE IF NOT EXISTS conflict_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_type text NOT NULL CHECK (conflict_type IN ('sync_conflict', 'duplicate', 'data_quality')),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  candidate_ids uuid[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored', 'auto_resolved', 'needs_approval')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  phi_sensitivity text NOT NULL DEFAULT 'low' CHECK (phi_sensitivity IN ('none', 'low', 'medium', 'high')),
  conflict_details jsonb NOT NULL DEFAULT '{}',
  resolution_strategy text CHECK (resolution_strategy IN ('keep_local', 'keep_remote', 'manual', 'merge', 'ignore')),
  resolution_details jsonb,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  auto_rule_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Conflict Audit Logs Table (append-only for compliance)
CREATE TABLE IF NOT EXISTS conflict_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL REFERENCES conflict_resolutions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'viewed', 'resolved', 'approved', 'rejected', 'appealed', 'auto_resolved')),
  actor_id uuid REFERENCES auth.users(id),
  actor_role text,
  field_changes jsonb DEFAULT '{}',
  justification text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto Resolution Rules Table
CREATE TABLE IF NOT EXISTS auto_resolution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  entity_type text NOT NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN ('sync_conflict', 'duplicate', 'data_quality')),
  conditions jsonb NOT NULL DEFAULT '{}',
  resolution_strategy text NOT NULL CHECK (resolution_strategy IN ('keep_local', 'keep_remote', 'keep_newer', 'keep_more_complete')),
  phi_allowed boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  priority_order int NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add columns to conflict_resolutions if created by earlier migration without them
ALTER TABLE conflict_resolutions ADD COLUMN IF NOT EXISTS entity_type text;
-- Keep fallback column text-typed for compatibility with legacy conflict rows tied to text PKs.
ALTER TABLE conflict_resolutions ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE conflict_resolutions ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_status ON conflict_resolutions(status);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_entity ON conflict_resolutions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_priority ON conflict_resolutions(priority, status);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_created ON conflict_resolutions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_audit_logs_conflict ON conflict_audit_logs(conflict_id);
CREATE INDEX IF NOT EXISTS idx_conflict_audit_logs_actor ON conflict_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_auto_resolution_rules_active ON auto_resolution_rules(is_active, entity_type);

-- Enable RLS
ALTER TABLE conflict_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_resolution_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conflict_resolutions
CREATE POLICY "Staff can view conflicts"
  ON conflict_resolutions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

CREATE POLICY "Staff can create conflicts"
  ON conflict_resolutions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

CREATE POLICY "Staff can update conflicts"
  ON conflict_resolutions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- RLS Policies for conflict_audit_logs (append-only)
CREATE POLICY "Staff can view audit logs"
  ON conflict_audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor')
    )
  );

CREATE POLICY "Staff can create audit logs"
  ON conflict_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- No UPDATE or DELETE policies for audit logs (immutable)

-- RLS Policies for auto_resolution_rules
CREATE POLICY "Admins can manage auto resolution rules"
  ON auto_resolution_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  );

CREATE POLICY "Staff can view auto resolution rules"
  ON auto_resolution_rules FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'doctor', 'nurse')
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_conflict_resolution_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_conflict_resolutions_timestamp ON conflict_resolutions;
CREATE TRIGGER update_conflict_resolutions_timestamp
  BEFORE UPDATE ON conflict_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION update_conflict_resolution_timestamp();

DROP TRIGGER IF EXISTS update_auto_resolution_rules_timestamp ON auto_resolution_rules;
CREATE TRIGGER update_auto_resolution_rules_timestamp
  BEFORE UPDATE ON auto_resolution_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_conflict_resolution_timestamp();

-- Insert default auto-resolution rules
INSERT INTO auto_resolution_rules (name, description, entity_type, conflict_type, conditions, resolution_strategy, phi_allowed, priority_order)
VALUES 
  ('Keep Newer Vitals', 'Automatically keep the more recent vital signs reading', 'vitals', 'sync_conflict', '{"field_type": "measurement"}', 'keep_newer', false, 10),
  ('Keep More Complete Patient', 'For duplicates, prefer record with more populated fields', 'patients', 'duplicate', '{"completeness_threshold": 0.8}', 'keep_more_complete', false, 20)
ON CONFLICT DO NOTHING;
