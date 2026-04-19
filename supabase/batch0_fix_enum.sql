-- Fix user_role enum: add missing values if not present
DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'volunteer';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'pharmacist';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'auditor';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'lead_clinician';
EXCEPTION WHEN others THEN NULL;
END $$;
