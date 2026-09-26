-- pgTAP: live updates for portal messages
-- Migration under test: supabase/migrations/20260927100130_patient_messages_realtime.sql
-- Nothing is written; the checks read the catalog only.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(4);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
             AND tablename = 'patient_secure_messages'),
  'patient_secure_messages is in the supabase_realtime publication');

-- Realtime sends inserts and updates only to subscribers whose row-level
-- security allows the row, and trims deletes to the primary key only when
-- row-level security is on. Both depend on these staying true.
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_secure_messages'::regclass),
  'row-level security is on for patient_secure_messages');

SELECT ok(
  NOT has_table_privilege('anon', 'public.patient_secure_messages', 'SELECT'),
  'the anon key cannot read patient_secure_messages, so it receives no message changes');

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname)
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'public.patient_secure_messages'::regclass AND i.indisprimary),
  ARRAY['id'],
  'a delete event names only the message id (the primary key)');

SELECT * FROM finish();
ROLLBACK;
