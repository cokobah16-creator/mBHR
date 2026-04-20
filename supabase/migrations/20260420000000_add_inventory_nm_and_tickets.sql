-- Extended schema: non-medical inventory and ticketing
-- Idempotent: safe to run on databases that already have some of these objects.

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

CREATE INDEX IF NOT EXISTS idx_inventory_nm_site_id   ON inventory_nm (site_id);
CREATE INDEX IF NOT EXISTS idx_inventory_nm_updated_at ON inventory_nm (updated_at);

ALTER TABLE inventory_nm ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to inventory_nm" ON inventory_nm;
CREATE POLICY "Allow authenticated access to inventory_nm"
  ON inventory_nm FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─── Queue tickets ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id             text        PRIMARY KEY,
  number         text        NOT NULL,
  patient_id     text        REFERENCES patients (id) ON DELETE SET NULL,
  category       text        NOT NULL DEFAULT 'adult',
  priority       text        NOT NULL DEFAULT 'normal',
  created_at     timestamptz NOT NULL DEFAULT now(),
  site_id        text        NOT NULL DEFAULT '',
  state          text        NOT NULL DEFAULT 'waiting'
                             CHECK (state IN ('waiting','in_progress','done','skipped')),
  current_stage  text        NOT NULL DEFAULT 'registration'
);

CREATE INDEX IF NOT EXISTS idx_tickets_site_id    ON tickets (site_id);
CREATE INDEX IF NOT EXISTS idx_tickets_state      ON tickets (state);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets (created_at);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to tickets" ON tickets;
CREATE POLICY "Allow authenticated access to tickets"
  ON tickets FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─── Re-apply dispenses policy idempotently ───────────────────────────────────
-- Existing databases already have this policy; drop-and-recreate is safe.

DROP POLICY IF EXISTS "Allow authenticated access to dispenses" ON dispenses;
CREATE POLICY "Allow authenticated access to dispenses"
  ON dispenses FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
