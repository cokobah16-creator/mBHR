/*
  # Staff Roles & Portal RBAC

  Adds the `staff_roles` table and `is_staff()` helper function so the
  patient-portal route protection can distinguish staff from patients.

  Applies additive RLS policies on the core tables so authenticated staff
  users can read all patient data and insert vitals / medications / visits —
  without touching or breaking any existing RLS policies.

  New objects
  ───────────
  • public.staff_roles          – one row per staff auth.users account
  • public.is_staff()           – returns true when the calling user is staff
  • RLS policies on patients, vitals, consultations, dispenses, visits
*/

-- ─── staff_roles ──────────────────────────────────────────────────────────────
create table if not exists public.staff_roles (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'staff',
  created_at      timestamptz not null default now(),

  constraint staff_roles_role_check
    check (role in ('staff', 'admin', 'doctor', 'nurse', 'pharmacist', 'volunteer'))
);

create unique index if not exists staff_roles_auth_user_id_idx
  on public.staff_roles (auth_user_id);

alter table public.staff_roles enable row level security;

-- Each staff member can read their own role row
create policy "Staff reads own role"
  on public.staff_roles for select
  using (auth.uid() = auth_user_id);

-- ─── is_staff() helper ────────────────────────────────────────────────────────
create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_roles
    where auth_user_id = auth.uid()
  );
$$;

-- ─── patients – staff read-all policy ────────────────────────────────────────
drop policy if exists "Staff can read all patients" on public.patients;
create policy "Staff can read all patients"
  on public.patients for select
  using (public.is_staff());

-- ─── vitals – staff read & insert ────────────────────────────────────────────
drop policy if exists "Staff can read all vitals"  on public.vitals;
drop policy if exists "Staff can insert vitals"    on public.vitals;

create policy "Staff can read all vitals"
  on public.vitals for select
  using (public.is_staff());

create policy "Staff can insert vitals"
  on public.vitals for insert
  with check (public.is_staff());

-- ─── consultations – staff read & insert ─────────────────────────────────────
drop policy if exists "Staff can read all consultations" on public.consultations;
drop policy if exists "Staff can insert consultations"   on public.consultations;

create policy "Staff can read all consultations"
  on public.consultations for select
  using (public.is_staff());

create policy "Staff can insert consultations"
  on public.consultations for insert
  with check (public.is_staff());

-- ─── dispenses – staff read & insert ─────────────────────────────────────────
drop policy if exists "Staff can read all dispenses" on public.dispenses;
drop policy if exists "Staff can insert dispenses"   on public.dispenses;

create policy "Staff can read all dispenses"
  on public.dispenses for select
  using (public.is_staff());

create policy "Staff can insert dispenses"
  on public.dispenses for insert
  with check (public.is_staff());

-- ─── visits – staff read & insert ────────────────────────────────────────────
drop policy if exists "Staff can read all visits" on public.visits;
drop policy if exists "Staff can insert visits"   on public.visits;

create policy "Staff can read all visits"
  on public.visits for select
  using (public.is_staff());

create policy "Staff can insert visits"
  on public.visits for insert
  with check (public.is_staff());
