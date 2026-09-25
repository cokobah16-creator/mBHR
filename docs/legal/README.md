# Privacy notice and terms of use — review status

The app serves a privacy notice at `/privacy` (`src/pages/legal/PrivacyPolicy.tsx`)
and terms of use at `/terms` (`src/pages/legal/TermsOfUse.tsx`). Patients
accept both when they create a portal account.

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
