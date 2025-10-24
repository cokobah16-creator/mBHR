/*
  # Add Sync Tracking Columns to Core Tables
  
  ## Overview
  Adds _dirty and _synced_at columns to core tables for offline sync functionality.
  These columns track which records need to be synced and when they were last synced.
  
  ## Tables Modified
  - patients
  - visits
  - vitals
  - consultations
  - dispenses
  - inventory
  - queue
  
  ## Security
  - No changes to RLS policies
  - Columns are for sync tracking only
*/

-- Add sync columns to patients
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE patients ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_dirty ON patients(_dirty) WHERE _dirty > 0;

-- Add sync columns to visits
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'visits' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE visits ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'visits' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE visits ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_visits_dirty ON visits(_dirty) WHERE _dirty > 0;

-- Add sync columns to vitals
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vitals' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE vitals ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vitals' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE vitals ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vitals_dirty ON vitals(_dirty) WHERE _dirty > 0;

-- Add sync columns to consultations
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'consultations' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE consultations ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'consultations' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE consultations ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_consultations_dirty ON consultations(_dirty) WHERE _dirty > 0;

-- Add sync columns to dispenses
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispenses' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispenses' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE dispenses ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispenses_dirty ON dispenses(_dirty) WHERE _dirty > 0;

-- Add sync columns to inventory
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE inventory ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE inventory ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_dirty ON inventory(_dirty) WHERE _dirty > 0;

-- Add sync columns to queue
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'queue' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE queue ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'queue' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE queue ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_queue_dirty ON queue(_dirty) WHERE _dirty > 0;

-- Add sync columns to gamification_wallets
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gamification_wallets' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE gamification_wallets ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gamification_wallets' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE gamification_wallets ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gamification_wallets_dirty ON gamification_wallets(_dirty) WHERE _dirty > 0;

-- Add sync columns to game_sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_sessions' AND column_name = '_dirty'
  ) THEN
    ALTER TABLE game_sessions ADD COLUMN _dirty integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_sessions' AND column_name = '_synced_at'
  ) THEN
    ALTER TABLE game_sessions ADD COLUMN _synced_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_sessions_dirty ON game_sessions(_dirty) WHERE _dirty > 0;
