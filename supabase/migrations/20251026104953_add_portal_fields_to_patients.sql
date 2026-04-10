/*
  # Add Portal Integration Fields to Patients Table

  1. Changes
    - Add portal_enabled flag to track if patient has portal access
    - Add contact_verified flag to track if email/phone is verified
    - Add portal_invited_at timestamp for invitation tracking
    - Add indexes for portal-related queries
    - Ensure email and phone columns exist and are properly indexed

  2. Purpose
    - Enable staff to easily enroll patients in the portal
    - Track portal access status for each patient
    - Support automatic portal user creation when staff registers patients
*/

-- Add portal-related columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'portal_enabled'
  ) THEN
    ALTER TABLE patients ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'contact_verified'
  ) THEN
    ALTER TABLE patients ADD COLUMN contact_verified boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'portal_invited_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN portal_invited_at timestamptz;
  END IF;
END $$;

-- Create indexes for portal queries
CREATE INDEX IF NOT EXISTS idx_patients_portal_enabled 
  ON patients(portal_enabled) WHERE portal_enabled = true;

CREATE INDEX IF NOT EXISTS idx_patients_email_portal 
  ON patients(LOWER(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_phone_portal 
  ON patients(phone) WHERE phone IS NOT NULL;

-- Add comment explaining the fields
COMMENT ON COLUMN patients.portal_enabled IS 
  'Whether patient has been enrolled in the patient portal';

COMMENT ON COLUMN patients.contact_verified IS 
  'Whether the patient email or phone has been verified via OTP';

COMMENT ON COLUMN patients.portal_invited_at IS 
  'Timestamp when patient was invited to use the portal';
