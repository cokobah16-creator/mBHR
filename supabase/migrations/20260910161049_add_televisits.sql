/*
  # Televisits (video visits)

  Adds a `visit_mode` discriminator to appointments and patient appointment
  requests so a booking can be either an in-person visit or a televisit, and a
  `meeting_link` on appointments holding the generated video-room URL.

  ## Changes
  1. appointments
     - visit_mode text NOT NULL DEFAULT 'in_person'
       CHECK (visit_mode IN ('in_person', 'televisit'))
     - meeting_link text (nullable; only set for televisits)
     - partial index on scheduled_at for televisit rows
  2. patient_appointment_requests
     - visit_mode text NOT NULL DEFAULT 'in_person' (same CHECK)
     - partial index on created_at for pending televisit requests
  3. RLS on appointments
     - The legacy "Patients can view own appointments" policy compared
       patient_portal_users.id to auth.uid(), which never matches a portal JWT.
       Replace the staff-only SELECT policy with a single combined policy so
       patients can read their own appointments (needed for the portal
       Telehealth page) without creating a second permissive SELECT policy on
       the table. Portal identity is matched three ways, because sessions
       differ by enrolment path: app_metadata.portal_user_id (the lockdown
       *_owner pattern), patients.auth_uid = auth.uid() (email/password portal
       login), and the JWT phone claim (legacy phone-OTP sessions, as used by
       the "Patients can view own appointment requests" policy).
     - The legacy "Appointments insertable" / "Appointments updatable"
       policies (WITH CHECK (true) / USING (true), role PUBLIC) are replaced
       by is_staff()-scoped equivalents. The existing "Staff can create/update
       appointments" policies list only guest/nurse/doctor/admin, while the
       /appointments route also admits volunteers, so is_staff() (any
       app_users role other than guest) keeps every staff role working while
       closing the PUBLIC write path.
  4. RLS on patient_appointment_requests
     - The existing owner policies match only app_metadata.portal_user_id or
       the JWT phone claim, neither of which an email/password portal session
       (patients.auth_uid = auth.uid()) carries, so such patients could not
       list or create requests and the patient-side cancel silently updated
       zero rows. Add owner SELECT and INSERT policies keyed on the auth_uid /
       phone-claim identity, plus an owner cancel (UPDATE) policy limited to
       setting status = 'cancelled' on the patient's own pending requests.
  5. message_templates
     - Ensures the `variables` column exists (the first CREATE TABLE of this
       table predates it) and seeds the `televisit_scheduled` SMS body for
       en/pcm/ha/yo/ig. (key, locale, channel) is the primary key, so
       ON CONFLICT DO NOTHING keeps any locally edited copy.

  ## Rollback
    DROP POLICY IF EXISTS "patient_appointment_requests_owner_cancel" ON public.patient_appointment_requests;
    DROP POLICY IF EXISTS "patient_appointment_requests_owner_auth_insert" ON public.patient_appointment_requests;
    DROP POLICY IF EXISTS "patient_appointment_requests_owner_auth_select" ON public.patient_appointment_requests;
    DROP POLICY IF EXISTS "appointments_select_staff_or_owner" ON public.appointments;
    DROP POLICY IF EXISTS "appointments_staff_insert" ON public.appointments;
    DROP POLICY IF EXISTS "appointments_staff_update" ON public.appointments;
    CREATE POLICY "appointments_staff_select"
      ON public.appointments FOR SELECT TO authenticated USING (public.is_staff());
    -- "Appointments insertable"/"Appointments updatable" are intentionally not
    -- recreated: they granted PUBLIC write access to every appointment.
    DROP INDEX IF EXISTS public.idx_patient_appointment_requests_televisit_pending;
    DROP INDEX IF EXISTS public.idx_appointments_televisit_scheduled;
    ALTER TABLE public.patient_appointment_requests DROP COLUMN IF EXISTS visit_mode;
    ALTER TABLE public.appointments DROP COLUMN IF EXISTS meeting_link;
    ALTER TABLE public.appointments DROP COLUMN IF EXISTS visit_mode;
    DELETE FROM public.message_templates WHERE key = 'televisit_scheduled';
*/

-- ============================================================================
-- 1. appointments: visit_mode + meeting_link
-- ============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS visit_mode text NOT NULL DEFAULT 'in_person';

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS meeting_link text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_visit_mode_check'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_visit_mode_check
      CHECK (visit_mode IN ('in_person', 'televisit'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_televisit_scheduled
  ON public.appointments(scheduled_at)
  WHERE visit_mode = 'televisit';

COMMENT ON COLUMN public.appointments.visit_mode IS
  'in_person (default) or televisit. Televisits carry a meeting_link.';
COMMENT ON COLUMN public.appointments.meeting_link IS
  'Video-room URL for televisits. Random room id; must never contain patient data.';

-- ============================================================================
-- 2. patient_appointment_requests: visit_mode
-- ============================================================================

ALTER TABLE public.patient_appointment_requests
  ADD COLUMN IF NOT EXISTS visit_mode text NOT NULL DEFAULT 'in_person';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patient_appointment_requests_visit_mode_check'
      AND conrelid = 'public.patient_appointment_requests'::regclass
  ) THEN
    ALTER TABLE public.patient_appointment_requests
      ADD CONSTRAINT patient_appointment_requests_visit_mode_check
      CHECK (visit_mode IN ('in_person', 'televisit'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patient_appointment_requests_televisit_pending
  ON public.patient_appointment_requests(created_at)
  WHERE visit_mode = 'televisit' AND status = 'pending';

COMMENT ON COLUMN public.patient_appointment_requests.visit_mode IS
  'in_person (default) or televisit. Patient-initiated televisit requests use televisit.';

-- ============================================================================
-- 3. appointments RLS: staff OR owning portal patient may SELECT;
--    INSERT/UPDATE are staff-only
-- ============================================================================

DROP POLICY IF EXISTS "Patients can view own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Appointments viewable" ON public.appointments;
DROP POLICY IF EXISTS "appointments_staff_select" ON public.appointments;
DROP POLICY IF EXISTS "appointments_select_staff_or_owner" ON public.appointments;

CREATE POLICY "appointments_select_staff_or_owner"
  ON public.appointments FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
    OR patient_id IN (
      SELECT id FROM public.patients
       WHERE auth_uid = (SELECT auth.uid())::text
    )
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

DROP POLICY IF EXISTS "Appointments insertable" ON public.appointments;
DROP POLICY IF EXISTS "Appointments updatable" ON public.appointments;
DROP POLICY IF EXISTS "appointments_staff_insert" ON public.appointments;
DROP POLICY IF EXISTS "appointments_staff_update" ON public.appointments;

CREATE POLICY "appointments_staff_insert"
  ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY "appointments_staff_update"
  ON public.appointments FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ============================================================================
-- 4. patient_appointment_requests RLS: portal patient may read, create and
--    cancel own requests (auth_uid / phone-claim identity)
-- ============================================================================

DROP POLICY IF EXISTS "patient_appointment_requests_owner_auth_select"
  ON public.patient_appointment_requests;

CREATE POLICY "patient_appointment_requests_owner_auth_select"
  ON public.patient_appointment_requests FOR SELECT TO authenticated
  USING (
    patient_id IN (
      SELECT id FROM public.patients
       WHERE auth_uid = (SELECT auth.uid())::text
    )
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

DROP POLICY IF EXISTS "patient_appointment_requests_owner_auth_insert"
  ON public.patient_appointment_requests;

CREATE POLICY "patient_appointment_requests_owner_auth_insert"
  ON public.patient_appointment_requests FOR INSERT TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT id FROM public.patients
       WHERE auth_uid = (SELECT auth.uid())::text
    )
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
    )
  );

DROP POLICY IF EXISTS "patient_appointment_requests_owner_cancel"
  ON public.patient_appointment_requests;

CREATE POLICY "patient_appointment_requests_owner_cancel"
  ON public.patient_appointment_requests FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND (
      patient_id IN (
        SELECT id FROM public.patients
         WHERE auth_uid = (SELECT auth.uid())::text
      )
      OR patient_id IN (
        SELECT patient_id FROM public.patient_portal_users
         WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
      )
    )
  )
  WITH CHECK (
    status = 'cancelled'
    AND (
      patient_id IN (
        SELECT id FROM public.patients
         WHERE auth_uid = (SELECT auth.uid())::text
      )
      OR patient_id IN (
        SELECT patient_id FROM public.patient_portal_users
         WHERE phone_number = current_setting('request.jwt.claims', true)::json->>'phone'
      )
    )
  );

-- ============================================================================
-- 5. message_templates: televisit_scheduled SMS bodies
-- ============================================================================

-- 20251024080033 created message_templates without `variables`; the later
-- CREATE TABLE IF NOT EXISTS that lists it is a no-op on such databases.
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS variables jsonb;

INSERT INTO public.message_templates (key, locale, channel, body, max_length, variables)
VALUES
  (
    'televisit_scheduled', 'en', 'sms',
    'mBHR: {{patient_name}}, your video visit with {{provider_name}} is on {{date}} at {{time}}. Join: {{link}}',
    320,
    '["patient_name", "provider_name", "date", "time", "link"]'::jsonb
  ),
  (
    'televisit_scheduled', 'pcm', 'sms',
    'mBHR: {{patient_name}}, your video visit with {{provider_name}} dey for {{date}} by {{time}}. Join here: {{link}}',
    320,
    '["patient_name", "provider_name", "date", "time", "link"]'::jsonb
  ),
  (
    'televisit_scheduled', 'ha', 'sms',
    'mBHR: {{patient_name}}, ganawar bidiyo da {{provider_name}} za ta kasance a ranar {{date}} da karfe {{time}}. Shiga: {{link}}',
    320,
    '["patient_name", "provider_name", "date", "time", "link"]'::jsonb
  ),
  (
    'televisit_scheduled', 'yo', 'sms',
    'mBHR: {{patient_name}}, ipade fidio re pelu {{provider_name}} yoo waye ni {{date}} ni {{time}}. Darapo mo: {{link}}',
    320,
    '["patient_name", "provider_name", "date", "time", "link"]'::jsonb
  ),
  (
    'televisit_scheduled', 'ig', 'sms',
    'mBHR: {{patient_name}}, nleta vidiyo gi na {{provider_name}} ga-abu na {{date}} na {{time}}. Banye: {{link}}',
    320,
    '["patient_name", "provider_name", "date", "time", "link"]'::jsonb
  )
ON CONFLICT (key, locale, channel) DO NOTHING;
