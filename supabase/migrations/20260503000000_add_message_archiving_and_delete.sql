/*
  # Message archiving and deletion support

  Lets clinical staff resolve / remove messages in:
    - Patient Messages (patient_secure_messages)
    - Palaver Room    (palaver_messages, palaver_broadcasts)

  ## Changes
  1. Add `is_archived` column (default false) to `patient_secure_messages`
     and an index to keep filtered inbox queries fast.
  2. Add permissive RLS policies on `patient_secure_messages` so the app
     (which uses the anon key plus app-layer auth) can update / delete
     messages — mirroring the model already used for palaver_messages
     in 20251214163828_fix_palaver_room_rls_policies.sql.

  Palaver tables already have full CRUD policies and an `is_archived`
  column, so no schema changes are needed there.
*/

-- 1. patient_secure_messages: archive column ------------------------------
ALTER TABLE patient_secure_messages
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_secure_messages_active
  ON patient_secure_messages(patient_id, created_at DESC)
  WHERE is_archived = false;

-- 2. patient_secure_messages: permissive update / delete policies ---------
-- The app authenticates locally (IndexedDB) and connects to Supabase via
-- the anon key, so the existing JWT-role-based policies block updates and
-- deletes. Add open policies that match the existing palaver_messages
-- model; access control is enforced in the application layer.

DROP POLICY IF EXISTS "Allow update on patient_secure_messages"
  ON patient_secure_messages;
CREATE POLICY "Allow update on patient_secure_messages"
  ON patient_secure_messages FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete on patient_secure_messages"
  ON patient_secure_messages;
CREATE POLICY "Allow delete on patient_secure_messages"
  ON patient_secure_messages FOR DELETE
  TO anon, authenticated
  USING (true);

COMMENT ON COLUMN patient_secure_messages.is_archived IS
  'Soft-delete flag set by staff to dismiss/resolve a thread from the inbox.';
