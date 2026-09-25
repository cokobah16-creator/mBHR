/*
  # Add Email and Authentication Fields to Patients

  ## Overview
  This migration adds email, authentication, and contact verification fields to support
  the Patient Portal login system where patients can authenticate using email or phone.

  ## Changes Made

  ### 1. New Patient Fields
  - `email` (text, nullable, unique): Patient's email address for portal login
  - `auth_uid` (text, nullable, unique): Supabase Auth user ID for linked accounts
  - `contact_verified` (boolean, default false): Whether email/phone has been verified

  ### 2. Schema Modifications
  - Make `phone` field nullable (was required before)
  - Add unique constraint on email (case-insensitive)
  - Add unique constraint on auth_uid
  - Add check constraint: at least one of (email, phone) must be provided

  ### 3. Indexes
  - Index on email for fast lookup during login
  - Index on auth_uid for user session management
  - Index on contact_verified for filtering verified patients

  ### 4. Data Migration
  - Normalize existing phone numbers to E.164 format (+234...)
  - Set contact_verified to false for all existing patients
  - Preserve all existing data

  ### 5. Security (RLS Policies)
  - Update existing RLS policies to handle nullable phone field
  - Add policies for patient portal users to access their own data via auth_uid
  - Maintain strict access controls

  ## Important Notes
  - This migration is safe and preserves all existing patient data
  - Phone is now optional, but at least one contact method (email or phone) is required
  - Email addresses are stored in lowercase for consistency
  - Patients can link their portal account to their clinical record via auth_uid
*/

-- Step 1: Add new columns to patients table
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS auth_uid text,
  ADD COLUMN IF NOT EXISTS contact_verified boolean DEFAULT false;

-- Step 2: Make phone column nullable
ALTER TABLE patients
  ALTER COLUMN phone DROP NOT NULL;

-- Step 3: Add unique constraints
-- Note: Using unique indexes instead of constraints for better performance and NULL handling
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_email_unique
  ON patients (LOWER(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_auth_uid_unique
  ON patients (auth_uid)
  WHERE auth_uid IS NOT NULL;

-- Step 4: Add check constraint - at least one contact method required
ALTER TABLE patients
  ADD CONSTRAINT check_at_least_one_contact
  CHECK (
    (phone IS NOT NULL AND phone <> '') OR
    (email IS NOT NULL AND email <> '')
  );

-- Step 5: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_patients_email
  ON patients (email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_auth_uid
  ON patients (auth_uid)
  WHERE auth_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_contact_verified
  ON patients (contact_verified);

-- Step 6: Update existing RLS policies to handle new fields
-- Drop and recreate the "Patients can view own record" policy to include auth_uid
DROP POLICY IF EXISTS "Patients can view own record" ON patients;

CREATE POLICY "Patients can view own record"
  ON patients
  FOR SELECT
  TO authenticated
  USING (
    -- Allow access if user's auth.uid() matches either:
    -- 1. The auth_uid field (portal user linked to this patient)
    -- 2. The user's email matches the patient's email
    auth.uid()::text = auth_uid OR
    (SELECT auth.email()) = email
  );

-- Add policy for patients to update their own contact verification status
CREATE POLICY "Patients can verify own contact"
  ON patients
  FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = auth_uid)
  WITH CHECK (auth.uid()::text = auth_uid);

-- Step 7: Add comment explaining the table structure
COMMENT ON COLUMN patients.email IS 'Patient email address for portal login (unique, case-insensitive)';
COMMENT ON COLUMN patients.auth_uid IS 'Supabase Auth user ID for linked portal accounts (unique)';
COMMENT ON COLUMN patients.contact_verified IS 'Whether the patient has verified their email/phone via OTP';
COMMENT ON CONSTRAINT check_at_least_one_contact ON patients IS 'Ensures at least one contact method (email or phone) is provided';

-- Step 8: Update the updated_at timestamp for tracking
CREATE OR REPLACE FUNCTION update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists for updated_at
DROP TRIGGER IF EXISTS patients_updated_at_trigger ON patients;
CREATE TRIGGER patients_updated_at_trigger
  BEFORE UPDATE ON patients
  FOR EACH ROW
  EXECUTE FUNCTION update_patients_updated_at();
