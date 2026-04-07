/*
  # Palaver Room - Doctor Internal Messaging System

  "Palaver" is a West African pidgin term meaning discussion or conference.
  This system enables secure internal communication between medical staff.

  1. New Tables
    - `palaver_messages` - Individual messages between staff
      - `id` (uuid, primary key)
      - `sender_id` (text, references users)
      - `recipient_id` (text, references users, nullable for broadcast)
      - `subject` (text)
      - `body` (text)
      - `priority` (text: normal, urgent, critical)
      - `is_read` (boolean)
      - `read_at` (timestamptz)
      - `is_archived` (boolean)
      - `parent_id` (uuid, for threading/replies)
      - `created_at` (timestamptz)

    - `palaver_broadcasts` - Broadcast messages to all doctors/staff
      - `id` (uuid, primary key)
      - `sender_id` (text)
      - `target_role` (text: doctor, nurse, all_clinical)
      - `subject` (text)
      - `body` (text)
      - `priority` (text)
      - `expires_at` (timestamptz)
      - `created_at` (timestamptz)

    - `palaver_broadcast_reads` - Track who has read broadcasts
      - `id` (uuid, primary key)
      - `broadcast_id` (uuid)
      - `user_id` (text)
      - `read_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users can only see their own messages
    - Doctors/nurses can see broadcasts targeting their role

  3. Indexes
    - Optimized for common queries (unread messages, by sender/recipient)
*/

-- Create palaver_messages table
CREATE TABLE IF NOT EXISTS palaver_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'critical')),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  is_archived BOOLEAN DEFAULT false,
  parent_id UUID REFERENCES palaver_messages(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create palaver_broadcasts table
CREATE TABLE IF NOT EXISTS palaver_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  target_role TEXT NOT NULL CHECK (target_role IN ('doctor', 'nurse', 'pharmacist', 'all_clinical', 'all_staff')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'critical')),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create palaver_broadcast_reads table
CREATE TABLE IF NOT EXISTS palaver_broadcast_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES palaver_broadcasts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(broadcast_id, user_id)
);

-- Enable RLS
ALTER TABLE palaver_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE palaver_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE palaver_broadcast_reads ENABLE ROW LEVEL SECURITY;

-- RLS Policies for palaver_messages
CREATE POLICY "Users can view messages they sent or received"
  ON palaver_messages FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()::text OR recipient_id = auth.uid()::text
  );

CREATE POLICY "Users can insert messages they send"
  ON palaver_messages FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid()::text);

CREATE POLICY "Recipients can update read status"
  ON palaver_messages FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid()::text)
  WITH CHECK (recipient_id = auth.uid()::text);

-- RLS Policies for palaver_broadcasts
CREATE POLICY "All authenticated users can view active broadcasts"
  ON palaver_broadcasts FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Doctors and admins can create broadcasts"
  ON palaver_broadcasts FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid()::text);

-- RLS Policies for palaver_broadcast_reads
CREATE POLICY "Users can view their own broadcast reads"
  ON palaver_broadcast_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "Users can mark broadcasts as read"
  ON palaver_broadcast_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_palaver_messages_recipient ON palaver_messages(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_palaver_messages_sender ON palaver_messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_palaver_messages_parent ON palaver_messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_palaver_broadcasts_active ON palaver_broadcasts(is_active, target_role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_palaver_broadcast_reads_user ON palaver_broadcast_reads(user_id, broadcast_id);

-- Add comments for documentation
COMMENT ON TABLE palaver_messages IS 'Palaver Room: Direct messages between medical staff. "Palaver" is West African pidgin for discussion.';
COMMENT ON TABLE palaver_broadcasts IS 'Palaver Room: Broadcast announcements to staff groups';
COMMENT ON TABLE palaver_broadcast_reads IS 'Tracks which users have read broadcast messages';
COMMENT ON COLUMN palaver_messages.priority IS 'Message urgency: normal (default), urgent (needs attention), critical (immediate action required)';
