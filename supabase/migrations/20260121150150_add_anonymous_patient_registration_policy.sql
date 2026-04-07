/*
  # Allow Anonymous Patient Registration

  1. Problem
    - Patient portal registration creates new patient records
    - Current RLS only allows authenticated users to insert patients
    - Registration happens before authentication (anonymous user)

  2. Solution
    - Add INSERT policy for anonymous users on patients table
    - This enables self-registration for the patient portal

  3. Security Notes
    - Anonymous users can only INSERT new patient records
    - They cannot UPDATE, DELETE, or bulk SELECT patient data
    - The SELECT policy already exists for registration lookup
*/

CREATE POLICY "Allow anonymous patient registration"
  ON patients
  FOR INSERT
  TO anon
  WITH CHECK (true);
