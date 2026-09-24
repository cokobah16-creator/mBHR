# Privacy notice and terms of use — review status

The app serves a privacy notice at `/privacy` (`src/pages/legal/PrivacyPolicy.tsx`)
and terms of use at `/terms` (`src/pages/legal/TermsOfUse.tsx`). Their
current versions are the dates in `src/pages/legal/policyMeta.ts`.

To create a portal account, a patient ticks three separate boxes: they
agree to the terms of use, confirm they have read the privacy notice, and
consent to portal access to their health records. The account keeps the
two versions they accepted and the time. Online this is stored with the
sign-in account (Supabase user metadata); offline it is stored with the
account on the device. Nothing is written to `patient_consent_records` yet.

Portal accounts are for adults. Sign-up asks for a date of birth, online
and offline, and refuses anyone under 18 (`isMinor` in
`src/utils/patient.ts`). Sign-up and login never link an account to a
clinic record whose date of birth shows the person is under 18: the online
sign-up and email lookup (`src/hooks/useAuth.ts`,
`src/services/patientService.ts`) and the offline registration and
date-of-birth login (`src/services/patientPortalAuth.ts`) all refuse. A
record with no date of birth still links, and accounts already linked to a
child's record are not changed. Staff can still turn on portal access for a
child's record, and there is no guardian record or guardian consent yet
(checklist item 17).

Both were written to describe what the code actually does. **Neither has
been reviewed by a lawyer.** Before relying on them, have a qualified
Nigerian lawyer review them against at least:

- the Nigeria Data Protection Act 2023 and the NDPC's General Application
  and Implementation Directive (lawful basis for processing health data,
  data subject rights, retention, cross-border transfers — Supabase, Resend,
  Sentry and Jitsi may process data outside Nigeria);
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
- add cookies or storage used for anything other than running the app.
