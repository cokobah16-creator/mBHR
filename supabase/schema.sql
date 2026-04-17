-- MedBridge HealthReach (mBHR) – Supabase Schema
-- Run this in your Supabase SQL editor to create the persistent multi-user tables.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ─── patients ────────────────────────────────────────────────────────────────
-- One row per registered patient, linked to an auth.users account.
create table if not exists public.patients (
  id               uuid primary key default uuid_generate_v4(),
  auth_user_id     uuid references auth.users(id) on delete cascade,
  full_name        text not null,
  email            text,
  phone            text,
  date_of_birth    date,
  created_at       timestamptz not null default now()
);

create unique index if not exists patients_auth_user_id_idx on public.patients(auth_user_id);
create index if not exists patients_email_idx on public.patients(email);

-- RLS: patients can only read/update their own row; staff (service role) has full access
alter table public.patients enable row level security;

create policy "Patient reads own record"
  on public.patients for select
  using (auth.uid() = auth_user_id);

create policy "Patient updates own record"
  on public.patients for update
  using (auth.uid() = auth_user_id);

create policy "Patient inserts own record"
  on public.patients for insert
  with check (auth.uid() = auth_user_id);

-- ─── visits ──────────────────────────────────────────────────────────────────
create table if not exists public.visits (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  visit_date  timestamptz not null default now(),
  notes       text,
  diagnosis   text,
  created_at  timestamptz not null default now()
);

create index if not exists visits_patient_id_idx on public.visits(patient_id);

alter table public.visits enable row level security;

create policy "Patient reads own visits"
  on public.visits for select
  using (
    patient_id in (
      select id from public.patients where auth_user_id = auth.uid()
    )
  );

create policy "Staff manages visits"
  on public.visits for all
  using (auth.role() = 'service_role');

-- ─── medications ─────────────────────────────────────────────────────────────
create table if not exists public.medications (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  name         text not null,
  dosage       text,
  instructions text,
  created_at   timestamptz not null default now()
);

create index if not exists medications_patient_id_idx on public.medications(patient_id);

alter table public.medications enable row level security;

create policy "Patient reads own medications"
  on public.medications for select
  using (
    patient_id in (
      select id from public.patients where auth_user_id = auth.uid()
    )
  );

create policy "Staff manages medications"
  on public.medications for all
  using (auth.role() = 'service_role');

-- ─── vitals ──────────────────────────────────────────────────────────────────
create table if not exists public.vitals (
  id             uuid primary key default uuid_generate_v4(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  blood_pressure text,
  weight         numeric(6,2),
  temperature    numeric(5,2),
  recorded_at    timestamptz not null default now()
);

create index if not exists vitals_patient_id_idx on public.vitals(patient_id);

alter table public.vitals enable row level security;

create policy "Patient reads own vitals"
  on public.vitals for select
  using (
    patient_id in (
      select id from public.patients where auth_user_id = auth.uid()
    )
  );

create policy "Staff manages vitals"
  on public.vitals for all
  using (auth.role() = 'service_role');

-- ─── staff_roles ─────────────────────────────────────────────────────────────
-- Tracks which auth.users are staff so the app can apply different route logic.
create table if not exists public.staff_roles (
  id           uuid primary key default uuid_generate_v4(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'staff',   -- 'staff' | 'admin' | 'doctor' etc.
  created_at   timestamptz not null default now()
);

create unique index if not exists staff_roles_auth_user_id_idx on public.staff_roles(auth_user_id);

alter table public.staff_roles enable row level security;

-- Any authenticated user can check whether they are staff
create policy "Staff reads own role"
  on public.staff_roles for select
  using (auth.uid() = auth_user_id);

-- ─── Helper: is the current user a staff member? ─────────────────────────────
create or replace function public.is_staff()
returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.staff_roles where auth_user_id = auth.uid()
  );
$$;

-- Allow staff to read all patients
create policy "Staff reads all patients"
  on public.patients for select
  using (public.is_staff());

-- Allow staff to read all visits
create policy "Staff reads all visits"
  on public.visits for select
  using (public.is_staff());

-- Allow staff to read all medications
create policy "Staff reads all medications"
  on public.medications for select
  using (public.is_staff());

-- Allow staff to read all vitals
create policy "Staff reads all vitals"
  on public.vitals for select
  using (public.is_staff());

-- Allow staff to insert vitals
create policy "Staff inserts vitals"
  on public.vitals for insert
  with check (public.is_staff());

-- Allow staff to insert medications
create policy "Staff inserts medications"
  on public.medications for insert
  with check (public.is_staff());

-- Allow staff to insert visits
create policy "Staff inserts visits"
  on public.visits for insert
  with check (public.is_staff());
