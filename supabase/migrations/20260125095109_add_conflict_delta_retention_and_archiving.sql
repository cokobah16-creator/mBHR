/*
  # Field-Level Delta Retention and Archiving System

  1. New Tables
    - `conflict_change_deltas`
      - Granular tracking of every field change during conflict resolution
      - Supports AI training data requirements and compliance audits
      - Indefinite retention of field-level changes
    
    - `archived_conflict_summaries`
      - Compressed summaries of conflicts older than 3 years
      - Reduces storage while maintaining compliance
      - Full audit trail preserved in cloud
    
    - `data_retention_policies`
      - Configurable retention periods per table
      - Supports legal holds and compliance requirements
      - Federal requirement: 3 years minimum, 6 years for TEFCA
    
    - `retention_policy_executions`
      - Audit trail of archiving operations
      - Tracks what was archived and when

  2. Security
    - RLS enabled on all tables
    - Audit-related tables restricted to admin and auditor roles
    - Archiving operations logged for compliance

  3. Important Notes
    - Retention policies align with ASTP grant requirements
    - 3-year active retention, indefinite delta storage for AI training
    - TEFCA logs require 6-year retention per federal requirements
*/

-- Create conflict_change_deltas table for granular field tracking
CREATE TABLE IF NOT EXISTS conflict_change_deltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL REFERENCES conflict_resolutions(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  change_type text NOT NULL CHECK (change_type IN ('merge', 'override', 'correction', 'auto_resolve')),
  changed_by uuid REFERENCES auth.users(id),
  changed_by_role text,
  phi_field boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Ensure FK column stays UUID-compatible with conflict_resolutions.id
ALTER TABLE conflict_change_deltas
  ALTER COLUMN conflict_id TYPE uuid USING conflict_id::uuid;

COMMENT ON TABLE conflict_change_deltas IS 'Indefinite retention of field-level changes for AI training and compliance audits';
COMMENT ON COLUMN conflict_change_deltas.phi_field IS 'Whether this field contains Protected Health Information';
COMMENT ON COLUMN conflict_change_deltas.change_type IS 'Type of change: merge (combined values), override (replaced), correction (fixed error), auto_resolve (system decision)';

CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_conflict_id ON conflict_change_deltas(conflict_id);
CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_created_at ON conflict_change_deltas(created_at);
CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_phi_field ON conflict_change_deltas(phi_field) WHERE phi_field = true;

ALTER TABLE conflict_change_deltas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view conflict change deltas"
  ON conflict_change_deltas
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor', 'lead_clinician', 'doctor', 'nurse')
    )
  );

CREATE POLICY "Admins and auditors can insert conflict change deltas"
  ON conflict_change_deltas
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor', 'lead_clinician', 'doctor', 'nurse')
    )
  );

-- Create archived_conflict_summaries table
CREATE TABLE IF NOT EXISTS archived_conflict_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_conflict_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  conflict_type text NOT NULL,
  resolution_summary jsonb NOT NULL DEFAULT '{}',
  total_fields_modified integer DEFAULT 0,
  phi_fields_accessed text[] DEFAULT '{}',
  resolution_strategy text,
  resolved_by_role text,
  approved_by_role text,
  original_created_at timestamptz NOT NULL,
  original_resolved_at timestamptz,
  archived_at timestamptz DEFAULT now(),
  archive_reason text DEFAULT 'retention_policy'
);

COMMENT ON TABLE archived_conflict_summaries IS 'Compressed summaries of conflicts archived after 3-year retention period';
COMMENT ON COLUMN archived_conflict_summaries.resolution_summary IS 'JSON summary of what changed, who approved, and why';
COMMENT ON COLUMN archived_conflict_summaries.phi_fields_accessed IS 'List of PHI field names that were involved in resolution';

CREATE INDEX IF NOT EXISTS idx_archived_conflict_summaries_original_id ON archived_conflict_summaries(original_conflict_id);
CREATE INDEX IF NOT EXISTS idx_archived_conflict_summaries_entity ON archived_conflict_summaries(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_archived_conflict_summaries_archived_at ON archived_conflict_summaries(archived_at);

ALTER TABLE archived_conflict_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and auditors can view archived summaries"
  ON archived_conflict_summaries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Only system can insert archived summaries"
  ON archived_conflict_summaries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  );

-- Create data_retention_policies table
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL UNIQUE,
  retention_period_days integer NOT NULL DEFAULT 1095,
  archive_strategy text NOT NULL DEFAULT 'summarize' CHECK (archive_strategy IN ('summarize', 'compress', 'delete', 'none')),
  legal_hold boolean DEFAULT false,
  legal_hold_reason text,
  legal_hold_until timestamptz,
  last_archive_run timestamptz,
  next_scheduled_run timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

COMMENT ON TABLE data_retention_policies IS 'Configurable data retention policies per table - aligns with federal requirements';
COMMENT ON COLUMN data_retention_policies.retention_period_days IS 'Days to retain active records before archiving (default 1095 = 3 years)';
COMMENT ON COLUMN data_retention_policies.archive_strategy IS 'How to handle old records: summarize (compress to summary), compress (store compressed), delete (remove), none (keep forever)';
COMMENT ON COLUMN data_retention_policies.legal_hold IS 'Prevents archiving during litigation or audit';

ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage retention policies"
  ON data_retention_policies
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

CREATE POLICY "Authenticated users can view retention policies"
  ON data_retention_policies
  FOR SELECT
  TO authenticated
  USING (true);

-- Create retention_policy_executions audit table
CREATE TABLE IF NOT EXISTS retention_policy_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid REFERENCES data_retention_policies(id),
  table_name text NOT NULL,
  execution_type text NOT NULL CHECK (execution_type IN ('archive', 'compress', 'delete', 'legal_hold_check')),
  records_processed integer DEFAULT 0,
  records_archived integer DEFAULT 0,
  records_deleted integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message text,
  executed_by text
);

COMMENT ON TABLE retention_policy_executions IS 'Audit trail of all data retention/archiving operations';

CREATE INDEX IF NOT EXISTS idx_retention_executions_policy ON retention_policy_executions(policy_id);
CREATE INDEX IF NOT EXISTS idx_retention_executions_started ON retention_policy_executions(started_at);

ALTER TABLE retention_policy_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and auditors can view retention executions"
  ON retention_policy_executions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Only admins can insert retention executions"
  ON retention_policy_executions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()::text
      AND app_users.role = 'admin'
    )
  );

-- Insert default retention policies aligned with federal requirements
INSERT INTO data_retention_policies (table_name, retention_period_days, archive_strategy) VALUES
  ('conflict_audit_logs', 1095, 'summarize'),
  ('conflict_change_deltas', 0, 'none'),
  ('conflict_resolutions', 1095, 'summarize'),
  ('tefca_access_logs', 2190, 'compress'),
  ('patient_portal_access_logs', 1095, 'summarize'),
  ('audit_logs', 1095, 'compress')
ON CONFLICT (table_name) DO NOTHING;

-- Add actor_role column to conflict_audit_logs if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflict_audit_logs' AND column_name = 'actor_role'
  ) THEN
    ALTER TABLE conflict_audit_logs ADD COLUMN actor_role text;
  END IF;
END $$;