# Privacy notice and terms of use — review status

The app serves a privacy notice at `/privacy` (`src/pages/legal/PrivacyPolicy.tsx`)
and terms of use at `/terms` (`src/pages/legal/TermsOfUse.tsx`). Their
current versions are the dates in `src/pages/legal/policyMeta.ts`.
`src/pages/legal/LegalLinks.tsx` links to both from staff sign-in,
first-run setup, portal sign-in and sign-up, and the signed-in portal menus.

To create a portal account at sign-up, a patient ticks three separate
boxes: they agree to the terms of use, confirm they have read the privacy
notice, and consent to portal access to their health records. The account
keeps the two versions they accepted and the time. Online this is stored
with the sign-in account (Supabase user metadata); offline it is stored
with the account on the device. Nothing is written to
`patient_consent_records` yet. The signed-in patient can change their own
user metadata (`supabase.auth.updateUser`), so the online copy shows what
the app recorded but is not evidence of consent until item 6 writes
`patient_consent_records` rows.

Not every portal account comes from sign-up. Staff can turn on portal
access for one patient after ticking that the patient agreed
(`src/components/PortalStatusCard.tsx`), and administrators have two pages
for many patients at once (`src/pages/admin/PortalMigration.tsx`,
`src/pages/admin/BulkPortalMigration.tsx`). None of these stores a record
of the patient's agreement. `loginPatientPortal`
(`src/services/patientPortalAuth.ts`) can create an account on a device
from a phone or email and a date of birth, without the three boxes, but no
screen calls it that way yet: `PatientLogin` always asks for a PIN. If a
screen does, no terms or privacy version is recorded for those accounts.

Where access is saved matters. The online portal checks
`patients.portal_enabled` on the server. The trigger that set it for every
patient with a phone or email is dropped
(`supabase/migrations/20260926000200_consent_defaults_off.sql`), so it
stays off for a new patient until something turns it on:

- The record page switch and PortalMigration (`enablePortalAccess` and
  `disablePortalAccess` in `src/services/portalEnrollment.ts`) save the
  change on the device. When the device is online they also send it to the
  server. The server takes it only if the patient's record has been
  uploaded and the online sign-in holds the `register` permission.
  Otherwise only that device changes, nothing retries it, and the message
  says so.
- The registration form's portal box and BulkPortalMigration use
  `enrollPatientInPortal` (`src/services/unifiedPortalEnrollment.ts`). It
  sets `portal_enabled` only after creating a `patient_portal_users` row.
  That insert sends columns the table does not have in
  `supabase/migrations`, so on a server built from them it fails and turns
  nothing on (checklist item 2).
- Other staff devices do not receive the change. They apply the server's
  value only once `portal_enabled_changed_at` is set. The app cannot set
  it; the planned `set_patient_portal_access` command will (checklist
  item 9).

Portal accounts are for adults. Sign-up asks for a date of birth, online
and offline, and refuses anyone under 18 (`isMinor` in
`src/utils/patient.ts`). Sign-up and login never link an account to a
clinic record whose date of birth shows the person is under 18: the online
sign-up and email lookup (`src/hooks/useAuth.ts`,
`src/services/patientService.ts`) and the offline registration and
date-of-birth login (`src/services/patientPortalAuth.ts`) all refuse. So
does the server: `portal_link_patient_record`, which any signed-in account
can call, refuses a child's record and never creates one for an under-18
date of birth (`20260926000210_portal_link_adults_only.sql`). A record
with no date of birth still links, and accounts already linked to a
child's record are not changed. Staff can still turn on portal access for a
child's record, and there is no guardian record or guardian consent yet
(checklist item 17).

Both were written to describe what the code actually does. **Neither has
been reviewed by a lawyer.** Before relying on them, have a qualified
Nigerian lawyer review them against at least:

- the Nigeria Data Protection Act 2023 and the NDPC's General Application
  and Implementation Directive (lawful basis for processing health data,
  data subject rights, retention, cross-border transfers — Supabase,
  Resend, Twilio, Sentry, Vercel, GitHub, jsDelivr, Statically and the
  public meet.jit.si service (8x8) may process data outside Nigeria);
- the National Health Act 2014 (confidentiality of health records);
- whether a Data Protection Impact Assessment and registration with the
  NDPC as a data controller of major importance are required;
- consent for minors and for caregivers acting for a patient.

Items that need a decision from the Foundation, not just legal review:

- a named contact (email / phone) for privacy requests — the notice
  currently says "speak to the outreach team or contact the Foundation";
- a concrete retention period for medical records;
- whether Sentry session replay should stay enabled in production.

## Readiness checklist

[`LEGAL_READINESS_CHECKLIST.md`](./LEGAL_READINESS_CHECKLIST.md) checks mBHR against 20
common legal-readiness items (privacy, consent, children's data, accessibility,
unsubscribe, deletion and more). It lists what to fix first, the file-level
steps for each item, and the decisions the Foundation must make.

## Keeping the notice accurate

Update `PrivacyPolicy.tsx` in the same change whenever you:

- add a service that receives personal data (a new SMS/email/video
  provider, analytics, error monitoring);
- add a category of data collected from patients;
- add cookies or storage used for anything other than running the app;
- change a starting sharing choice (`DEFAULT_SHARING_FLAGS` in
  `src/features/patient-portal/account/sharingChanges.ts`, and the column
  defaults on `patient_data_sharing_preferences`);
- change what the nightly backup (`.github/workflows/backup.yml`) copies
  or where it saves it.

`src/pages/legal/PrivacyPolicy.test.tsx` fails if the code uses a known
service the notice does not name, or if the notice's starting sharing
choices differ from `DEFAULT_SHARING_FLAGS`.
