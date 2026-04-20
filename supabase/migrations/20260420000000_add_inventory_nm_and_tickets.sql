-- MBHR (Med Bridge Health Reach) Extended Schema
-- Non-medical inventory, Pharmacy, and Ticketing systems
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY so this script
-- is safe to re-run against databases that already have some of these objects.

-- ─── Non-medical inventory ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_nm (
  id                 text         PRIMARY KEY,
  item_name          text         NOT NULL,
  unit               text         NOT NULL,
  on_hand_qty        int          NOT NULL DEFAULT 0,
  reorder_threshold  int          NOT NULL DEFAULT 0,
  min_qty            int,
  max_qty            int,
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  site_id            text
);

CREATE INDEX IF NOT EXISTS idx_inventory_nm_item      ON inventory_nm (item_name);
CREATE INDEX IF NOT EXISTS idx_inventory_nm_updated   ON inventory_nm (updated_at);
CREATE INDEX IF NOT EXISTS idx_inventory_nm_threshold ON inventory_nm (reorder_threshold);

ALTER TABLE inventory_nm ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to inventory_nm" ON inventory_nm;
CREATE POLICY "Allow authenticated access to inventory_nm"
  ON inventory_nm FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_moves_nm (
  id           text        PRIMARY KEY,
  item_id      text        NOT NULL REFERENCES inventory_nm (id) ON DELETE CASCADE,
  qty_delta    int         NOT NULL,
  reason       text        NOT NULL CHECK (reason IN ('restock','consume','adjust')),
  actor_id     text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  approved_by  text,
  approved_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stock_moves_nm_created ON stock_moves_nm (created_at);

ALTER TABLE stock_moves_nm ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to stock_moves_nm" ON stock_moves_nm;
CREATE POLICY "Allow authenticated access to stock_moves_nm"
  ON stock_moves_nm FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gamification (
  id           text        PRIMARY KEY,
  volunteer_id text        NOT NULL,
  tokens       int         NOT NULL DEFAULT 0,
  badges       text[]      NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gamification ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to gamification" ON gamification;
CREATE POLICY "Allow authenticated access to gamification"
  ON gamification FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS restock_sessions (
  id            text        PRIMARY KEY,
  volunteer_id  text        NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  deltas        jsonb       NOT NULL DEFAULT '[]',
  tokens_earned int         NOT NULL DEFAULT 0,
  committed     boolean     NOT NULL DEFAULT false
);

ALTER TABLE restock_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to restock_sessions" ON restock_sessions;
CREATE POLICY "Allow authenticated access to restock_sessions"
  ON restock_sessions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts_nm (
  id           text        PRIMARY KEY,
  item_id      text        NOT NULL REFERENCES inventory_nm (id) ON DELETE CASCADE,
  level        text        NOT NULL CHECK (level IN ('low','critical')),
  triggered_at timestamptz NOT NULL,
  cleared_at   timestamptz
);

ALTER TABLE alerts_nm ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to alerts_nm" ON alerts_nm;
CREATE POLICY "Allow authenticated access to alerts_nm"
  ON alerts_nm FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─── Pharmacy ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pharmacy_items (
  id                 text        PRIMARY KEY,
  med_name           text        NOT NULL,
  form               text        NOT NULL,
  strength           text        NOT NULL,
  unit               text        NOT NULL,
  on_hand_qty        int         NOT NULL DEFAULT 0,
  reorder_threshold  int         NOT NULL DEFAULT 0,
  is_controlled      boolean     NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_name ON pharmacy_items (med_name);

ALTER TABLE pharmacy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to pharmacy_items" ON pharmacy_items;
CREATE POLICY "Allow authenticated access to pharmacy_items"
  ON pharmacy_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pharmacy_batches (
  id           text  PRIMARY KEY,
  item_id      text  NOT NULL REFERENCES pharmacy_items (id) ON DELETE CASCADE,
  lot_number   text  NOT NULL,
  expiry_date  date  NOT NULL,
  qty_on_hand  int   NOT NULL DEFAULT 0,
  received_at  date  NOT NULL DEFAULT now(),
  supplier     text
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_batches_expiry ON pharmacy_batches (expiry_date);

ALTER TABLE pharmacy_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to pharmacy_batches" ON pharmacy_batches;
CREATE POLICY "Allow authenticated access to pharmacy_batches"
  ON pharmacy_batches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescriptions (
  id             text        PRIMARY KEY,
  visit_id       text        NOT NULL,
  patient_id     text        NOT NULL,
  prescriber_id  text        NOT NULL,
  lines          jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  status         text        NOT NULL CHECK (status IN ('open','dispensed','partial','void'))
);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to prescriptions" ON prescriptions;
CREATE POLICY "Allow authenticated access to prescriptions"
  ON prescriptions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- dispenses already exists from an earlier migration. Explicitly evolve the
-- table shape here so upgraded and fresh databases converge on the same schema.

ALTER TABLE IF EXISTS dispenses
  ADD COLUMN IF NOT EXISTS prescription_id text,
  ADD COLUMN IF NOT EXISTS item_id text,
  ADD COLUMN IF NOT EXISTS batch_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dispenses_prescription_id_fkey'
      AND conrelid = 'dispenses'::regclass
  ) THEN
    ALTER TABLE dispenses
      ADD CONSTRAINT dispenses_prescription_id_fkey
      FOREIGN KEY (prescription_id) REFERENCES prescriptions (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dispenses_item_id_fkey'
      AND conrelid = 'dispenses'::regclass
  ) THEN
    ALTER TABLE dispenses
      ADD CONSTRAINT dispenses_item_id_fkey
      FOREIGN KEY (item_id) REFERENCES pharmacy_items (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dispenses_batch_id_fkey'
      AND conrelid = 'dispenses'::regclass
  ) THEN
    ALTER TABLE dispenses
      ADD CONSTRAINT dispenses_batch_id_fkey
      FOREIGN KEY (batch_id) REFERENCES pharmacy_batches (id) ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE dispenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to dispenses" ON dispenses;
CREATE POLICY "Allow authenticated access to dispenses"
  ON dispenses FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_moves_rx (
  id          text        PRIMARY KEY,
  item_id     text        NOT NULL REFERENCES pharmacy_items (id) ON DELETE CASCADE,
  batch_id    text        REFERENCES pharmacy_batches (id) ON DELETE SET NULL,
  qty_delta   int         NOT NULL,
  reason      text        NOT NULL CHECK (reason IN ('receipt','dispense','adjust')),
  actor_id    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_moves_rx_created ON stock_moves_rx (created_at);

ALTER TABLE stock_moves_rx ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to stock_moves_rx" ON stock_moves_rx;
CREATE POLICY "Allow authenticated access to stock_moves_rx"
  ON stock_moves_rx FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─── Ticketing ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id             text        PRIMARY KEY,
  number         text        NOT NULL,
  patient_id     text,
  category       text        NOT NULL,
  priority       text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  site_id        text        NOT NULL,
  state          text        NOT NULL CHECK (state IN ('waiting','in_progress','done','skipped')),
  current_stage  text        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_stage_state ON tickets (current_stage, state);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to tickets" ON tickets;
CREATE POLICY "Allow authenticated access to tickets"
  ON tickets FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stage_events (
  id           text        PRIMARY KEY,
  ticket_id    text        NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  stage        text        NOT NULL,
  started_at   timestamptz,
  finished_at  timestamptz,
  actor_id     text
);

ALTER TABLE stage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to stage_events" ON stage_events;
CREATE POLICY "Allow authenticated access to stage_events"
  ON stage_events FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS queue_metrics (
  id               text        PRIMARY KEY,
  stage            text        NOT NULL,
  avg_service_sec  int         NOT NULL DEFAULT 240,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE queue_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to queue_metrics" ON queue_metrics;
CREATE POLICY "Allow authenticated access to queue_metrics"
  ON queue_metrics FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id         text        PRIMARY KEY,
  ticket_id  text        NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  channel    text        NOT NULL,
  payload    jsonb       NOT NULL,
  sent_at    timestamptz,
  status     text        NOT NULL DEFAULT 'queued'
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to notifications" ON notifications;
CREATE POLICY "Allow authenticated access to notifications"
  ON notifications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_counters (
  id        text  PRIMARY KEY,
  site_id   text  NOT NULL,
  date_str  text  NOT NULL,
  category  text  NOT NULL,
  seq       int   NOT NULL DEFAULT 0
);

ALTER TABLE daily_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to daily_counters" ON daily_counters;
CREATE POLICY "Allow authenticated access to daily_counters"
  ON daily_counters FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
