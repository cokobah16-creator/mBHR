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
of the patient's agreement: the tick on the record page only unlocks the
button, and the request sent to the server carries a reason code
(`staff_choice`, `bulk_enable` or `registration`), not the attestation.
`loginPatientPortal` (`src/services/patientPortalAuth.ts`) can create an
account on a device from a phone or email and a date of birth, without the
three boxes, but no screen calls it that way yet: `PatientLogin` always
asks for a PIN. If a screen does, no terms or privacy version is recorded
for those accounts.

Portal access is decided by the server. Staff changes go through
`requestPortalAccessChange` (`src/services/portalAccess.ts`): the device
shows the change as waiting and queues the `set_patient_portal_access`
command (`supabase/migrations/20260925100100_portal_access_authoritative.sql`),
which is sent only while the staff member who made it is signed in online.
The server confirms or refuses it, and other devices then apply the
server's value. A guard trigger puts back `patients.portal_enabled` when an
API write tries to change it directly. The auto-enrolment trigger runs on
insert only and never overrides a decision; it is switched off by
`auto_enrollment_enabled` = false
(`supabase/migrations/20260926000200_consent_defaults_off.sql`), so a new
patient's access stays off until staff ask for it. The registration form's
portal box and BulkPortalMigration use `enrollPatientInPortal`
(`src/services/unifiedPortalEnrollment.ts`), which, online, first inserts a
`patient_portal_users` row. That insert sends columns the table does not
have in `supabase/migrations`, so on a server built from them it fails and
access is not asked for (checklist item 2). On a device with no server,
changes stay on that device.

Portal invitations go through the server, by email (`send-otp-email`) or,
for a patient with no email, by SMS (`send-sms-reminder`), both with
purpose `portal_invitation` (`sendPortalInvitation` in
`src/services/portalEnrollment.ts`). Only roles with `portal_invite`
(registration lead, lead clinician, administrator) can send them; the
server checks this again in `portal_invitation_begin()`
(`20260925100600_registration_lead_portal_invite.sql`), sends only for
staff signed in online, only once the server has portal access on for the
patient, uses the stored email or phone, builds the text, and records who
sent it. When nothing is sent, staff get the registration link to share.
The registration form and BulkPortalMigration send no invitation.

Portal accounts are for adults. Sign-up asks for a date of birth, online
and offline, and refuses anyone under 18 before any account is made
(`isMinor` in `src/utils/patient.ts`; `src/hooks/useAuth.ts`,
`src/services/patientPortalAuth.ts`). Online, the new account is linked to
a clinic record by the server: `portal_link_patient_record` refuses a
child's record and never creates a record for an under-18 date of birth
(`20260926000210_portal_link_adults_only.sql`). It answers
`needs_staff_verification`, which the app shows as "ask clinic staff"
(`MINOR_RECORD_LINK_MESSAGE`); the account is created but not linked, and
signed out. The email lookup at portal sign-in (`src/services/patientService.ts`)
and the offline registration and date-of-birth login
(`src/services/patientPortalAuth.ts`) refuse a child's record too. A record
with no date of birth still links, and accounts already linked to a child's
record are not changed. The refusal messages send a parent or guardian to
clinic staff about access to a child's record.

Staff cannot turn on portal access for a child's record in the app:
`enablePortalAccess`, `sendPortalInvitation`, `enrollPatientInPortal` and
`canEnrollInPortal` refuse a patient under 18, the record page offers no
invitation or link for a child, the registration form's portal box is off
for a child, and PortalMigration and BulkPortalMigration leave children
out. Turning access off still works. This is checked in the app only:
`set_patient_portal_access` and `portal_invitation_begin` do not check age
on the server yet, and a child's record that already has access on keeps
it until staff turn it off. There is no guardian record or guardian consent
yet (checklist item 17).

Patients stop text-message reminders by telling clinic staff, as the
privacy notice says. Staff turn appointment or medication reminders off in
the patient's preferences (`src/components/PreferenceManager.tsx`). Every
screen and helper that reads the setting uses one rule
(`isReminderOptedOut` in `src/services/reminderEligibility.ts`): 0 or false
is off; 1, true, an empty setting or no record is not an opt-out. This
device writes 1 or 0; a setting pulled from the server can hold true or
false. The notification worker (`src/services/notificationWorker.ts`)
checks the setting on the device again right before each send: a queued
device reminder for a patient who opted out is cancelled, and a server
reminder is skipped and stays pending on the server, because the device
may not change its status. A setting that cannot be read holds the
reminder. One-time codes and televisit links are never held back. The
portal's own "Text message reminders" switch
(`src/features/patient-portal/ManageAccount.tsx`) is saved, but no sender
reads it yet.

The Resend API key that was committed to the repository has been removed
from the code and docs on both lines of work (mainone's `c7576ac`, and this
branch's `60dbf03`). It is still in the Git history, so it must be revoked
and replaced in the Resend dashboard (checklist item 1).

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
