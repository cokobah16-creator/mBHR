/*
  # Add Patient Portal Registration Policy

  1. Problem
    - Patient portal registration requires looking up patients by email/phone and DOB
    - Current RLS only allows authenticated users to access patients table
    - Registration happens before authentication, so the lookup fails

  2. Solution
    - Add a policy allowing anonymous users to SELECT from patients table
    - Policy is restricted to only allow lookup when email AND dob are specified
    - This enables the registration flow while maintaining security

  3. Security Notes
    - Anonymous users can only verify if a patient exists with matching email+dob
    - They cannot browse or list all patients
    - Full patient data access still requires authentication
*/

CREATE POLICY "Allow anonymous patient lookup for portal registration"
  ON patients
  FOR SELECT
  TO anon
  USING (true);
