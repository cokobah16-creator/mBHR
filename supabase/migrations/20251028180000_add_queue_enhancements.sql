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
