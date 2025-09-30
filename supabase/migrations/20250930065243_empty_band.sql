-- MBHR (Med Bridge Health Reach) Extended Schema
-- Non-medical inventory, Pharmacy, and Ticketing systems

-- Non-medical inventory
create table if not exists inventory_nm (
  id text primary key,
  item_name text not null,
  unit text not null,
  on_hand_qty int not null default 0,
  reorder_threshold int not null default 0,
  min_qty int,
  max_qty int,
  updated_at timestamptz not null default now(),
  site_id text
);
create index if not exists idx_inventory_nm_item on inventory_nm (item_name);
create index if not exists idx_inventory_nm_updated on inventory_nm (updated_at);
create index if not exists idx_inventory_nm_threshold on inventory_nm (reorder_threshold);

-- Enable RLS
alter table inventory_nm enable row level security;
create policy "Allow authenticated access to inventory_nm"
  on inventory_nm
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists stock_moves_nm (
  id text primary key,
  item_id text not null references inventory_nm(id) on delete cascade,
  qty_delta int not null,
  reason text not null check (reason in ('restock','consume','adjust')),
  actor_id text,
  note text,
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz
);
create index if not exists idx_stock_moves_nm_created on stock_moves_nm (created_at);

alter table stock_moves_nm enable row level security;
create policy "Allow authenticated access to stock_moves_nm"
  on stock_moves_nm
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists gamification (
  id text primary key,
  volunteer_id text not null,
  tokens int not null default 0,
  badges text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table gamification enable row level security;
create policy "Allow authenticated access to gamification"
  on gamification
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists restock_sessions (
  id text primary key,
  volunteer_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  deltas jsonb not null default '[]',
  tokens_earned int not null default 0,
  committed boolean not null default false
);

alter table restock_sessions enable row level security;
create policy "Allow authenticated access to restock_sessions"
  on restock_sessions
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists alerts_nm (
  id text primary key,
  item_id text not null references inventory_nm(id) on delete cascade,
  level text not null check (level in ('low','critical')),
  triggered_at timestamptz not null,
  cleared_at timestamptz
);

alter table alerts_nm enable row level security;
create policy "Allow authenticated access to alerts_nm"
  on alerts_nm
  for all
  to authenticated
  using (true)
  with check (true);

-- Pharmacy
create table if not exists pharmacy_items (
  id text primary key,
  med_name text not null,
  form text not null,
  strength text not null,
  unit text not null,
  on_hand_qty int not null default 0,
  reorder_threshold int not null default 0,
  is_controlled boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists idx_pharmacy_items_name on pharmacy_items (med_name);

alter table pharmacy_items enable row level security;
create policy "Allow authenticated access to pharmacy_items"
  on pharmacy_items
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists pharmacy_batches (
  id text primary key,
  item_id text not null references pharmacy_items(id) on delete cascade,
  lot_number text not null,
  expiry_date date not null,
  qty_on_hand int not null default 0,
  received_at date not null default now(),
  supplier text
);
create index if not exists idx_pharmacy_batches_expiry on pharmacy_batches (expiry_date);

alter table pharmacy_batches enable row level security;
create policy "Allow authenticated access to pharmacy_batches"
  on pharmacy_batches
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists prescriptions (
  id text primary key,
  visit_id text not null,
  patient_id text not null,
  prescriber_id text not null,
  lines jsonb not null,
  created_at timestamptz not null default now(),
  status text not null check (status in ('open','dispensed','partial','void'))
);

alter table prescriptions enable row level security;
create policy "Allow authenticated access to prescriptions"
  on prescriptions
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists dispenses (
  id text primary key,
  prescription_id text not null references prescriptions(id) on delete cascade,
  patient_id text not null,
  item_id text not null references pharmacy_items(id) on delete restrict,
  batch_id text not null references pharmacy_batches(id) on delete restrict,
  qty int not null,
  dispensed_by text not null,
  dispensed_at timestamptz not null default now()
);

alter table dispenses enable row level security;
create policy "Allow authenticated access to dispenses"
  on dispenses
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists stock_moves_rx (
  id text primary key,
  item_id text not null references pharmacy_items(id) on delete cascade,
  batch_id text references pharmacy_batches(id) on delete set null,
  qty_delta int not null,
  reason text not null check (reason in ('receipt','dispense','adjust')),
  actor_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_moves_rx_created on stock_moves_rx (created_at);

alter table stock_moves_rx enable row level security;
create policy "Allow authenticated access to stock_moves_rx"
  on stock_moves_rx
  for all
  to authenticated
  using (true)
  with check (true);

-- Ticketing
create table if not exists tickets (
  id text primary key,
  number text not null,
  patient_id text,
  category text not null,
  priority text not null,
  created_at timestamptz not null default now(),
  site_id text not null,
  state text not null check (state in ('waiting','in_progress','done','skipped')),
  current_stage text not null
);
create index if not exists idx_tickets_stage_state on tickets (current_stage, state);

alter table tickets enable row level security;
create policy "Allow authenticated access to tickets"
  on tickets
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists stage_events (
  id text primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  stage text not null,
  started_at timestamptz,
  finished_at timestamptz,
  actor_id text
);

alter table stage_events enable row level security;
create policy "Allow authenticated access to stage_events"
  on stage_events
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists queue_metrics (
  id text primary key,
  stage text not null,
  avg_service_sec int not null default 240,
  updated_at timestamptz not null default now()
);

alter table queue_metrics enable row level security;
create policy "Allow authenticated access to queue_metrics"
  on queue_metrics
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists notifications (
  id text primary key,
  ticket_id text not null references tickets(id) on delete cascade,
  channel text not null,
  payload jsonb not null,
  sent_at timestamptz,
  status text not null default 'queued'
);

alter table notifications enable row level security;
create policy "Allow authenticated access to notifications"
  on notifications
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists daily_counters (
  id text primary key,
  site_id text not null,
  date_str text not null,
  category text not null,
  seq int not null default 0
);

alter table daily_counters enable row level security;
create policy "Allow authenticated access to daily_counters"
  on daily_counters
  for all
  to authenticated
  using (true)
  with check (true);