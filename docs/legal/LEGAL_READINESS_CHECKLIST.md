# Legal readiness checklist

*Audited 24 September 2026 against `mainone` at `ff32aca`. This checklist is not legal advice. Have a qualified Nigerian lawyer review the notices and terms before relying on them (see [the review status](./README.md)).*

This checklist takes a common list of 20 things an app should do so it doesn't get sued, and checks each one against mBHR as it is today. For each item it says where mBHR stands, what to change and in which files, how to prove the change works, and what the Foundation has to decide first.

The findings were produced by reading the code, then checked a second time by opening every cited file. Line numbers are correct as of the commit above and will drift as the code changes.

## Progress

*Updated 25 September 2026.* The fixes that needed no decision by the Foundation are in the code on branch `claude/list-creation-implementation-izwdi5`. That branch was then merged with `mainone` at `68e6da0`. `mainone` had meanwhile made portal access a server decision, built portal invitations on the server and sent SMS with the staff member's token. Where the two overlapped, `mainone`'s design was kept and this branch's rules were put back on top of it; the last row of the table says where. Each item below has a **Done in the code** paragraph that says which steps are done and which remain.

| Change | Items | Where |
|---|---|---|
| Resend key removed from the repository, and `send-otp-email` limited to signed-in staff | Fix these first | Lane mB, merge `433177f`. `mainone` removed the key too (`c7576ac`) and rebuilt `send-otp-email` around server-built invitations (`57ae804`) |
| Reminder opt-outs checked right before every send, and a pulled `false` counts | 18, 9 | Lane mC, merge `37eb105` |
| Auto-enrolment switched off, treatment sharing off by default, and staff tick that the patient agreed before turning portal access on | 9, 6 | Lane mA, merge `ef67701`. After the merge the trigger is kept (`mainone` made it insert-only) and its setting turns it off; the tick is not stored |
| Three separate sign-up boxes, with the accepted versions kept | 6, 2 | Lane mA, merge `ef67701` |
| Portal sign-up and linking for adults only, in the app and on the server | 17 | Lane mA, merge `ef67701`; `441eac3` |
| Privacy notice names every processor, has a Children section, and is linked from staff sign-in and the portal | 1 | Lane mA, merge `ef67701`; `458b0b9` |
| Children's records refused portal access, invitations and enrolment by staff and admin tools; one opt-out rule for reminder settings on every screen | 17, 9, 18 | `2bbc676` to `011da0d`. The "no SMS invitation" wording from this range was dropped in the merge: `mainone` sends SMS invitations |
| Merged with `mainone`: portal access decided by the server through a queued `set_patient_portal_access` command (`20260925100100`, `64b0a20`), invitations checked and built by the server for `portal_invite` roles (`20260925100600`, `57ae804`), SMS sent with the staff member's token (`ccc25eb`). Re-applied on top: the admin-only code email, the staff attestation, the adults-only rules, the send-time opt-out check and consent defaults off | Fix these first, 6, 9, 17, 18 | Merge `66f7ae6`, then `73cfd83` to `85062c9` |

Still to do by the Foundation:
- Revoke the old Resend key. It was removed from the code on both lines of work, but it is still in git history.
- Decide whether patients who were enrolled automatically keep portal access. Nothing was reversed.
- The decisions under [Before you start](#before-you-start): the controller and contacts, retention periods, the "AI training" purpose, guardian verification, and two-way SMS.
- Have a native speaker check the new Hausa, Yoruba, Igbo and Pidgin labels for the legal links (`legal.links.*` in `src/i18n/locales`).

Unit tests, the type check and the build could not run where this work was done, because the npm registry was blocked. CI runs them on a pull request.

## Fix these first

These two problems are not on the list of 20, but they carry more risk than most items on it.

1. **A Resend API key is committed to the repository.** The same key, starting `re_YFFH`, appeared 16 times in five files:
   - `scripts/set-resend-key.sh:8`
   - `docs/guides/QUICK_REFERENCE_CARD.md:22,44,51`
   - `docs/archive/development-history/EMAIL_NOW_WORKING.md:5,37,82`
   - `docs/archive/development-history/RESEND_API_KEY_SETUP.md:3,29,51,72,145,211`
   - `docs/archive/development-history/NEXT_STEPS.md:16,58,71`

   The repository is on GitHub, so treat the key as exposed. Revoke it in the Resend dashboard, issue a new one, and store the new key only as the `RESEND_API_KEY` Edge Function secret. Replace every occurrence in these files with a placeholder such as `re_your_api_key`. Removing the key from git history is optional once it is revoked.

   **Done in the code:** every copy is now the placeholder `re_your_api_key`, and `scripts/set-resend-key.sh` reads the key from `RESEND_API_KEY` or a hidden prompt and never prints it. `mainone` removed the key independently (`c7576ac`) and reviewed the history in `docs/security/CREDENTIAL_HISTORY_REVIEW.md`. The merge keeps this branch's script, which hands the key to the Supabase CLI in a temporary env-file only the user can read, never on the command line. **Still to do by the Foundation:** revoke the old key in the Resend dashboard and set a new one. It is still in git history.

2. **`send-otp-email` will send any message to any address.** `supabase/functions/send-otp-email/index.ts` checks only an IP rate limit (`:18`). It then accepts `email`, `subject` and `message` from the caller (`:32`) and sends them through the Foundation's Resend account. Anyone holding the public anon key can use it to send mail in the Foundation's name. The message is inserted into the HTML without escaping (`:138`), and so is the code (`:120`). In demo mode it also logs the recipient and the code (`:66`). To fix it:
   1. Require a signed-in staff session for message mode, using `supabase/functions/_shared/security/staffAuth.ts`, which the SMS functions already use.
   2. Accept only a 4 to 8 digit `otp`, and HTML-escape every value placed in the email.
   3. Stop logging the address and the code.

   **Done in the code:** after the merge, the function follows `mainone`'s design (`57ae804`). A portal invitation is a request with `purpose: "portal_invitation"` and a patient id, from a signed-in staff member whose role holds `portal_invite` (registration lead, lead clinician, administrator), checked in the database by `portal_invitation_begin()`. The server looks up the stored address and builds the subject, text and link, so the caller chooses neither the recipient nor the words. The old free-text mode is refused with `message_mode_removed`. On top of that design, this branch's rules are back: the verification code email is admin only (`requireStaff` with `OTP_SENDER_ROLES`, checked before the address or the code is looked at, in `supabase/functions/_shared/security/emailRequest.ts`) and accepts a 4 to 8 digit code; every value placed in HTML is escaped with `supabase/functions/_shared/security/html.ts`, which the invitation email now uses too; no log line holds an address (masked or not), a code, or the caller's user id or role; anything but POST gets 405, and the rate limit answers with a JSON 429. The app sends the signed-in staff member's token. **Still to do by the Foundation:** deploy the function.

The migrations used to give anonymous users read and insert access to every row in `patients`. The row-level security rework in `supabase/migrations/20260924110100_rls_clinical_core.sql` removed that, and a read-only check of the live database on 24 September 2026 found no such policy. No action is needed.

## Status at a glance

**P0** means live exposure today: someone's data or money is affected now, or a required disclosure is missing. **P1** means before public launch or the next release. **P2** is hygiene. Effort is **S** for under half a day, **M** for one to two days and **L** for more. 5 items are P0, 9 are P1 and 6 are P2.

| # | Item | Status | Priority | Effort |
|---|---|---|---|---|
| 1 | [Add a privacy policy](#1-add-a-privacy-policy) | Partial | P0 | M |
| 2 | [Add terms of service](#2-add-terms-of-service) | Partial | P1 | L |
| 3 | [Add a refund policy](#3-add-a-refund-policy) | Not applicable | P2 | S |
| 4 | [Add a cookie policy](#4-add-a-cookie-policy) | Partial | P1 | M |
| 5 | [Add a cookie consent banner](#5-add-a-cookie-consent-banner) | Missing | P1 | S |
| 6 | [Check your form consents](#6-check-your-form-consents) | Partial | P0 | L |
| 7 | [Don't collect unnecessary data](#7-dont-collect-unnecessary-data) | Partial | P1 | L |
| 8 | [Audit your third-party SDKs](#8-audit-your-third-party-sdks) | Partial | P1 | M |
| 9 | [Remove dark patterns](#9-remove-dark-patterns) | Partial | P0 | L |
| 10 | [Remove hidden fees](#10-remove-hidden-fees) | Not applicable | P2 | S |
| 11 | [Remove fake reviews](#11-remove-fake-reviews) | Done | P2 | S |
| 12 | [Remove unsupported claims](#12-remove-unsupported-claims) | Partial | P1 | M |
| 13 | [Add accessibility alt text](#13-add-accessibility-alt-text) | Partial | P2 | M |
| 14 | [Fix your color contrast ratio](#14-fix-your-color-contrast-ratio) | Partial | P1 | L |
| 15 | [Add keyboard navigation](#15-add-keyboard-navigation) | Partial | P2 | M |
| 16 | [Add your business details](#16-add-your-business-details) | Partial | P1 | M |
| 17 | [Get age consent if you collect kids' data](#17-get-age-consent-if-you-collect-kids-data) | Missing | P0 | L |
| 18 | [Add an unsubscribe link to your emails](#18-add-an-unsubscribe-link-to-your-emails) | Partial | P0 | L |
| 19 | [License any fonts and images you use](#19-license-any-fonts-and-images-you-use) | Partial | P2 | M |
| 20 | [Add a data deletion request option](#20-add-a-data-deletion-request-option) | Partial | P1 | L |

## The 20 items

### 1. Add a privacy policy

**Status:** partial · **Priority:** P0 · **Effort:** M

**Where it stands.** The app serves `/privacy` (`src/App.tsx:413-416`). It is linked from the home footer (`src/pages/Home.tsx:80`), the staff sidebar (`src/components/Layout.tsx:482`) and portal sign-up (`src/features/patient-portal/account/AuthShell.tsx:42-47`, `src/features/patient-portal/PatientRegister.tsx:509`). Staff sign-in (`src/pages/Login.tsx:455-488`), `src/pages/FirstRunSetup.tsx` and the signed-in portal shell `src/features/patient-portal/PatientPortalLayout.tsx` have no link. The processor list (`src/pages/legal/PrivacyPolicy.tsx:70-75`) leaves out Twilio (`supabase/functions/_shared/sms/provider.ts:50-54`), Vercel, the jsDelivr and Statically map fetch (`public/nigeria-loader.js:194-199`) and the nightly `pg_dump` on GitHub Actions (`.github/workflows/backup.yml:26`). It also does not say that televisits default to the public `meet.jit.si` (`src/config/env.ts:43`). The notice says records are shared only when the patient agrees (`PrivacyPolicy.tsx:77-78`), but sharing is on by default (`src/features/patient-portal/DataSharingPreferences.tsx:60-61`). It also leaves out the "AI training" purpose of `conflict_change_deltas` (`supabase/migrations/20260125095109_add_conflict_delta_retention_and_archiving.sql:49`). It names no controller or contact. It gives no lawful basis and says nothing about staff data or transfers abroad. Retention is vague (`:94-99`), and the rights section leaves out the right to complain to the NDPC (`:102-109`).

**How to add it.**
1. Create `src/pages/legal/policyMeta.ts` (new) with `PRIVACY_VERSION` and `PRIVACY_CONTACT`. Use it for `updated` at `PrivacyPolicy.tsx:11`. Also write it to `patient_consent_records.consent_version` when a patient signs up.
2. In `PrivacyPolicy.tsx`, add `LegalSection` blocks for the controller and contact, the lawful basis, and staff data (name, role, PIN hash, audit logs and `queue_transitions` logs). Add emergency contact, blood type and uploaded documents to the patient list.
3. At `:70-75`, name Twilio (fallback SMS), Vercel (hosting) and GitHub Actions (nightly backup). Also name jsDelivr and Statically (map outline), unless items 5, 8 and 19 have already removed that fetch. Say that televisits use the public `meet.jit.si` service, run by 8x8. Keep the Sentry line conditional: `vercel.json:24` allows no Sentry origin.
4. Add a "Transfers outside Nigeria" section. Name the country for each provider and the NDPA safeguard relied on.
5. Replace `:77-78` with the list of recipients, rendered from `SHARING_OPTIONS` (`src/features/patient-portal/account/sharingChanges.ts`). Say that sharing for treatment and with health apps stays on until the patient turns it off at `/patient/data-sharing`.
6. Replace `:94-99` with the seeded periods (`20260125095109_...sql:233-240`): audit logs and portal access logs 3 years, TEFCA logs 6 years (as in `src/config/tefca.ts:54`). Add the agreed period for medical records.
7. Create `supabase/migrations/20260926000300_limit_conflict_deltas.sql` (new, shared with item 7). Set `COMMENT ON TABLE conflict_change_deltas` to the real purpose. Then `UPDATE data_retention_policies` where `table_name` is `conflict_change_deltas`. Do not INSERT: `table_name` is UNIQUE (`:139`) and the row is already seeded. If the AI-training use stays, say so in the notice instead.
8. Add a "Children" section that matches the code. Staff registration has no guardian field (`src/components/PatientForm.tsx`). A portal user can add a child profile from a name and date of birth only (`src/features/patient-portal/CaregiverSetup.tsx:34,67`).
9. At `:102-109`, add restriction, objection, portability (`/patient/export`), withdrawing consent, a response time and the right to complain to the NDPC. Change `:106` to say that staff stop reminders on request. Nothing reads the portal toggle (`src/features/patient-portal/ManageAccount.tsx:153`), and `src/services/messaging.ts:72-73` checks the staff-side preference instead.
10. Create `src/pages/legal/LegalLinks.tsx` (new) from the Privacy and Terms links at `AuthShell.tsx:42-56`. Render it in `LoginShell` (`Login.tsx:455`), after the form in `FirstRunSetup.tsx`, and in the "More" sheet of `PatientPortalLayout.tsx`. Reuse it in `Home.tsx`, `Layout.tsx`, `LegalPage.tsx` and `AuthShell.tsx`.
11. Add a `/privacy` link to the invitation email footer (`supabase/functions/send-otp-email/index.ts:129,157`).
12. In the same commit, update `docs/legal/README.md`. Fix `:4-5`: it says every patient accepts the notice at sign-up, which is not true for accounts that staff enable. Send the result to a Nigerian lawyer.

**Done in the code (lane mA).** Steps 1, 3, 8 and 10 are done, and so are parts of steps 5 and 12.
- `src/pages/legal/policyMeta.ts` holds `PRIVACY_VERSION` and `TERMS_VERSION`, and the pages take their dates from it.
- A "Service providers" section names:
  - Twilio as the SMS fallback
  - Vercel, including the contact detail an invitation link carries
  - GitHub Actions for the backup
  - jsDelivr or Statically for the map outline
  - `meet.jit.si` (8x8) for televisits
- A "Your sharing choices" section lists the starting choices, from the same `DEFAULT_SHARING_FLAGS` the page uses.
- A "Children" section matches the age rules in item 17.
- `LegalLinks` is on staff sign-in and the device-PIN step, first-run setup, portal sign-in and sign-up, and the signed-in portal menus.
- `docs/legal/README.md` says which accounts have no recorded acceptance.

The version is not yet written to `patient_consent_records` (item 6). Steps 2, 4, 6, 7, 9 and 11 are still open, and a lawyer has not reviewed the notice. Steps 2, 6 and 7 need the controller, retention and AI-training decisions. Since the merge with `mainone`, the invitation email is built on the server (`invitationEmail` in `supabase/functions/_shared/security/portalInvitation.ts`), so step 11's footer link belongs there.

**How to check it.**
- `src/pages/legal/PrivacyPolicy.test.tsx` (new): reuse the `import.meta.glob` scan from `src/test/startupChunks.test.ts:24`, and read `public/` with `node:fs`. Look for `api.twilio.com`, `api.ng.termii.com`, `api.resend.com`, `meet.jit.si`, `cdn.jsdelivr.net` and `@sentry/react`. Render the page in a `MemoryRouter`. Fail if a provider found in the code is not named.
- `e2e/legal-pages.spec.ts` (new), using `bootApp` from `e2e/login.spec.ts:45`: in a fresh context, assert a privacy link on `/`, `/login`, `/setup` and `/patient/register`. `/login` no longer redirects on an empty device (`Login.tsx:73-94`), so no seeding is needed.
- After the migration runs, `obj_description('conflict_change_deltas'::regclass)` no longer mentions AI training.

**Decision needed.** The Foundation must give its legal name, address and CAC number. It must also give a named privacy contact; confirm `support@mbhr.health` from `docs/patient-portal/PATIENT_PORTAL_USER_GUIDE.md:406` before using it. It must set retention periods for medical records and for `conflict_change_deltas`. It must decide whether the AI-training use is real, whether sharing becomes opt-in and whether to self-host Jitsi. A lawyer must confirm the lawful basis and the transfer safeguards.

**Risk if left.** The notice covers children's health data but leaves out processors, transfers abroad, an AI-training purpose and a contact. That breaches the transparency duties in the NDPA 2023 and the GAID and exposes the Foundation to NDPC enforcement and fines. Not legal advice.

### 2. Add terms of service

**Status:** partial · **Priority:** P1 · **Effort:** L

**Where it stands.** `/terms` is public and precached (`src/App.tsx:420-427`, `vite.config.ts:133`), but `src/pages/Login.tsx` and `src/pages/FirstRunSetup.tsx` neither link to it nor ask staff to accept it. `src/pages/legal/TermsOfUse.tsx:14-76` covers only portal use, staff use, availability and privacy. Portal sign-up needs one combined checkbox (`src/features/patient-portal/PatientRegister.tsx:484-521`), but no path records it. `src/services/patientPortalAuth.ts:84` hard-codes `consentGiven: true`, `src/hooks/useAuth.ts:97` stores only `full_name`, and `src/components/PortalStatusCard.tsx:141` and `src/services/portalEnrollment.ts:528` assume consent (`src/services/autoEnrollment.ts` is dead code). Since the audit, `supabase/migrations/20260924110300_rls_patient_portal.sql:324-337` has given portal patients an owner insert policy on `patient_consent_records`, so no new policy is needed.

**How to add it.**
1. Create `src/pages/legal/policyMeta.ts` (new) with `TERMS_VERSION` and `PRIVACY_VERSION`. Use them for `updated` at `TermsOfUse.tsx:7` and `PrivacyPolicy.tsx:11`.
2. Add `LegalSection`s to `TermsOfUse.tsx` for: operator and contact; eligibility, including caregivers acting for children; acceptable use; televisits; SMS and email; fees (there is no online payment, see `BillingPayments.tsx:97`); liability that keeps FCCPA rights; termination; changes; Nigerian governing law and disputes.
3. Split the checkbox at `PatientRegister.tsx:484-521` into the three boxes item 6 describes: terms, privacy, and portal access to health records.
4. Extend `SignUpData` (`useAuth.ts:18-25`). Add `terms_version`, `privacy_version` and `terms_accepted_at` to `options.data` at `useAuth.ts:97`.
5. Link the patient through `portal_link_patient_record` (`20260924110300_rls_patient_portal.sql:686`), which has no caller in `src/` yet. RLS now refuses the direct `patients` writes at `useAuth.ts:164-189` (`20260924110100_rls_clinical_core.sql:68-70`). Then record `terms_of_use` and `privacy_notice` through item 6's `recordConsent`, which writes `patient_consent_records`.
6. Add `termsAcceptedVersion`, `privacyAcceptedVersion` and `acceptedAt` to `LocalPortalUser` (`patientPortalAuth.ts:27-44`). Set them at `:262` and return the stored value at `:84`. Leave them empty for the date-of-birth auto-create at `:385`. These accounts exist only on the device, so keep the record local.
7. In `PatientProtectedRoute` (`App.tsx:314-395`), compare the version in `session.user.user_metadata` or `LocalPortalUser` with `TERMS_VERSION`. On a mismatch, redirect to `/patient/accept-terms` (new, built on `AuthShell`). Both sources are on the device, so the check works offline.
8. Stop auto-ticking `portalEnabled` (`PatientForm.tsx:53-60`). Pass `termsAccepted` from `PatientForm.tsx:102-111` into `enrollPatientInPortal`.
9. In the insert at `unifiedPortalEnrollment.ts:116-128`, drop the undefined `given_name`, `family_name`, `dob` and `sex` columns. Write `consent_given`, `consent_given_at`, `terms_accepted_version` and `terms_accepted_at`.
10. Replace the hard-coded `termsAccepted: true` at `PortalStatusCard.tsx:141` with an attestation checkbox. Make bulk enable (`portalEnrollment.ts:526-528`) send invitations only.
11. Create `supabase/migrations/20260926000100_record_portal_consent.sql` (new, shared with item 6). Use the `captured_by` column from item 6, and add a unique index on `(patient_id, consent_type, consent_version) WHERE revoked_at IS NULL`. Add a `SECURITY INVOKER` trigger that sets `created_at` to `now()` and fills `captured_by` for staff. Add no policy and no definer RPC.
12. Add `termsAcceptedVersion` and `termsAcceptedAt` to `User` (`src/db/index.ts:6-19`) without a new `db.version()`. Pulls keep fields that exist only on the device (`src/sync/adapter.ts:947-950`). Do not map these fields to `app_users`, because only the service role can change permanent-admin rows (`20260924110200_rls_staff_conflicts_messaging.sql:62-64`).
13. Add a required terms checkbox before the submit button at `FirstRunSetup.tsx:211`. Store the version through `createFirstAdmin` (`src/db/firstRun.ts:65`) and leave `adminPermanent` untouched.
14. Make `ProtectedRoute` (`App.tsx:290-298`) redirect staff to a new `/accept-terms` screen when their version is stale. Link `/terms` from `LoginShell` (`Login.tsx:455`).
15. Change `consented` to `consent_given` at `src/services/fhir/tefcaAuth.ts:193,196` and `supabase/functions/_shared/fhir/audit.ts:52`.
16. In the same commit, update `PrivacyPolicy.tsx` to say that the acceptance version and time are kept, and correct `docs/legal/README.md:3-5`.

**How to check it.**
- `PatientRegister.test.tsx` (mocked offline at `:21-24`): `registerPatientPortalAccount` receives the versions. A new online test file that mocks `isSupabaseEnabled: true` asserts that `options.data` holds them.
- `patientPortalAuth.test.ts`: the date-of-birth auto-create returns `consentGiven: false`.
- `unifiedPortalEnrollment.test.ts`, `portalEnrollment.test.ts:104-145` and a new `PortalStatusCard.test.tsx`: consent is written only after attestation.
- `firstRun.test.ts`: the version is stored and `adminPermanent` stays `true`.
- SQL, signed in as a linked portal patient: an insert for the patient's own record succeeds, an insert for another patient fails, and a duplicate returns `23505`.
- Manual, in airplane mode: bump `TERMS_VERSION` and confirm that both apps show the accept screen and that `/terms` loads.

**Decision needed.** The owner must supply the Foundation's legal name, CAC number, address and contact. The owner must also set the minimum age, the caregiver rules, the court or state for disputes and any mediation step. A Nigerian lawyer must sign off before release.

**Risk if left.** Without a recorded, versioned acceptance, the Foundation cannot demonstrate consent under the NDPA 2023 or prove that the terms bind anyone, and the missing liability, fees and governing-law clauses invite FCCPA 2018 unfair-term challenges. Not legal advice.

### 3. Add a refund policy

**Status:** not applicable · **Priority:** P2 · **Effort:** S

**Where it stands.** The app takes no money. `package.json` has no payment SDK. At `ff32aca`, a search of `src`, `supabase`, `public`, `scripts`, `e2e` and `index.html` for `paystack|flutterwave|stripe|monnify|remita|refund` finds nothing. The staff prize shop spends game tokens, not money (`src/features/inventory/PrizeShop.tsx:87`, `:95`). The portal page `BillingPayments` says there is no online payment (`src/features/patient-portal/BillingPayments.tsx:28-31`). It always shows an empty bill list (`BillingPayments.tsx:47-49`) and tells patients to pay at the clinic desk (`BillingPayments.tsx:96-99`, `:117`). The page is still routed at `/patient/billing` (`src/App.tsx:155-158`, `src/App.tsx:474`). Its only link is in `src/features/patient-portal/PatientQuickLinks.tsx:20-25`, which is dead code because no file imports it. The terms have no fees section (`src/pages/legal/TermsOfUse.tsx:14-76`).

**How to add it.**
1. In `src/pages/legal/TermsOfUse.tsx`, add a `LegalSection` titled "Fees" after "Availability" (after line 66). Say that the app takes no payments. Say that any charge is paid, receipted and refunded at the clinic desk. Only say that outreach care is free once the Foundation confirms it. Nothing in the code settles this. The only related statement is "Creating an account is free." (`src/features/patient-portal/PatientPortalLanding.tsx:302`).
2. Change the `updated` date at `src/pages/legal/TermsOfUse.tsx:7`.
3. In `docs/legal/README.md`, record that the Fees section is new and has not been legally reviewed. Add "is outreach care free?" to the Foundation decisions list at lines 20-25.
4. Remove the `/billing` route at `src/App.tsx:474` and its lazy import at `src/App.tsx:155-158` until a billing source exists. No unit or e2e test uses either.
5. Delete `src/features/patient-portal/BillingPayments.tsx`. Once the route is gone, nothing imports it, and git history keeps it. Leave `formatNaira` and `billStatusDisplay` in `src/features/patient-portal/account/displayStatus.ts`. They have tests.
6. Delete `src/features/patient-portal/PatientQuickLinks.tsx`, which is dead code.
7. Add `src/pages/legal/TermsOfUse.test.tsx` (new). Use `render` from `src/test/utils.tsx`, and check that a "Fees" heading renders and says no payments are taken.
8. If the app ever takes money, ship the refund policy in the same change as the payment code:
   - Create `src/pages/legal/RefundPolicy.tsx` (new) with `LegalPage` and `LegalSection`.
   - Add a lazy import next to `src/App.tsx:26-28` and a `/refunds` route next to `/privacy` and `/terms` (`src/App.tsx:413-424`).
   - Link the page from the `LegalPage` nav (`src/pages/legal/LegalPage.tsx:20-27`), from each legal footer (`src/components/Layout.tsx:485`, `src/pages/Home.tsx:83`, `PatientPortalLanding.tsx:329`, `src/features/patient-portal/account/AuthShell.tsx:52`) and next to the pay button.
   - Today, cancelling updates Supabase directly through `updateAppointmentDetails` (`src/services/appointments.ts:349`, called from `AppointmentCalendar.tsx:668` and `TelevisitManager.tsx:547`). Never call a payment provider from those paths. Queue the refund with `enqueueCommand` (`src/sync/commandOutbox.ts:315`), and have a Supabase edge function call the provider.
   - Add the provider to `PrivacyPolicy.tsx:70-75` and to `docs/legal/README.md:13-14`.
   - In `vercel.json:24`, add the provider to `connect-src`, `script-src` and a new `frame-src`. Update `docs/architecture/CACHING_STRATEGY.md:18-20` to match.
   - Add a `NetworkOnly` rule ahead of the Supabase REST `NetworkFirst` rule in `vite.config.ts:141-150`, so bill status is never served stale.

**How to check it.**
- `npx vitest run src/pages/legal/TermsOfUse.test.tsx` passes.
- `rg -il "paystack|flutterwave|stripe|monnify|remita" src supabase package.json` returns nothing. This is the proof that the item is not applicable.
- `rg -n "patient/billing|PatientQuickLinks|BillingPayments" src e2e` returns nothing after steps 4 to 6.
- `npm run build` and `npm run lint` pass. Open `/terms` and read the Fees section.

**Decision needed.** The Foundation must say whether outreach care is free. It must also say whether the clinic desk ever charges fees, and if so, what its refund rule is. The Fees wording depends on both answers.

**Risk if left.** No money is taken, so no refund policy is required today. But the terms say nothing about fees while a portal page tells patients to pay at the desk. If fees are charged, that gap could draw a disclosure complaint under the FCCPA 2018. Not legal advice.

### 4. Add a cookie policy

**Status:** partial · **Priority:** P1 · **Effort:** M

**Where it stands.** `src/pages/legal/PrivacyPolicy.tsx:84-92` has a "Cookies and device storage" section, but it lists no keys or lifetimes. It also skips a banner because all storage is "necessary" (lines 89-90). The app sets no cookies (`src/main.tsx:69` strips them from error reports). It does write 17 localStorage keys, one sessionStorage key, four IndexedDB databases (`src/db/index.ts:716`, `src/db/mbhr.ts:179`, `src/db/outbox.ts:42`, `src/db/gamification.ts:108`) and three runtime caches (`vite.config.ts:144,157,170`). Some of these hold personal data: `mbhr-auth` keeps the full staff record, including `pinHash` and `pinSalt` (`src/stores/auth.ts:260,520`), and `supabase-rest` keeps API responses for 24 hours (`vite.config.ts:146`). Sentry tracing and session replay start at boot whenever a DSN is set, with no opt-in (`src/main.tsx:25-38`). No sign-out path clears Cache Storage. That covers the portal `handleLogout` (`src/features/patient-portal/PatientPortalLayout.tsx:332-359`), staff `logout` (`src/stores/auth.ts:402-428`) and `wipeDevice` (`src/db/deviceReset.ts:33-39`); `wipeDevice` also leaves `mbhr`, `mbhr_outbox` and `gamification_db` behind. The `logout` in `src/hooks/useAuth.ts:202-208` is dead code.

**How to add it.**
1. Create `src/pages/legal/storageInventory.ts` (new). Export a typed array of `{ name, kind, purpose, personalData, lifetime, essential, clearedBy, setIn }`.
2. Fill it from live code only.
   - localStorage: `sb-<ref>-auth-token` and `-code-verifier` (`src/lib/supabaseAuthStorage.ts:14-16`), `mbhr-auth` (staff name, contacts, PIN hash and salt; 12-hour session, `src/stores/auth.ts:36`), `mbhr-operations-queue`, `mbhr-sync-store`, `mbhr-locale`, `mbhr-accessibility`, `mbhr-audio-settings`, `mbhr.nav.collapsed`, `pwa-install-dismissed` (7 days), `mbhr-sync`, `patient_portal_user`, `patient_active_profile`, `mbhr_portal_users` (date of birth, contacts, PIN hash, managed children, 24-hour token, `src/services/patientPortalAuth.ts:15-16`), `patient_message_queue`, `patient_cached_outreach(_at)`.
   - sessionStorage: `patient_session_token`, and Sentry's `sentryReplaySession`.
   - IndexedDB: `mbhr_v5`, `mbhr`, `mbhr_outbox`, `gamification_db`.
   - Cache Storage: the Workbox precache, `supabase-rest` (24 hours), `supabase-storage` (7 days), `jsdelivr` (30 days).
   - Third party: the map fetch from jsDelivr or Statically (`public/nigeria-loader.js:193-198`), and Jitsi Meet.
3. Leave out keys that only dead code writes. Either delete the dead code or exclude those keys by name in the drift test. The dead code is the unused `SessionManager` class (`src/utils/sessionManager.ts`), `src/services/fhir/smartLauncher.ts`, and `loadLocale` and `clearLocaleCache` (`src/i18n/load.ts`).
4. In `PrivacyPolicy.tsx:84-92`, render the inventory as a table inside the existing `LegalSection` (`src/pages/legal/LegalPage.tsx:41-48`). State that no cookies are set. Rewrite lines 89-90 to match the Sentry decision, and bump `updated` at line 11.
5. Add "What signing out removes" to the same section. Portal sign-out removes the three portal keys and the `sb-*` keys. Staff sign-out blanks the `mbhr-auth` session and ends the online sign-in. `mbhr_portal_users` and `patient_message_queue` stay on the device.
6. Create `src/lib/clearCachedApiData.ts` (new). It deletes `supabase-rest` and `supabase-storage` by name, checks `"caches" in window`, and never throws. Do not copy `src/components/ErrorBoundary.tsx:50-51`: that code also deletes the Workbox precache, which would break offline start.
7. Call it in the `finally` block of `handleLogout` (`PatientPortalLayout.tsx:352-358`).
8. Call it in staff `logout` after the local reset (`src/stores/auth.ts:417-423`).
9. Call it in `wipeDevice`. Delete `mbhr`, `mbhr_outbox` and `gamification_db` there with `Dexie.delete(name)`, and correct the comment at `src/db/deviceReset.ts:28-31`.
10. Create `src/pages/legal/storageInventory.test.ts` (new).
    - Reuse the raw `import.meta.glob` from `src/test/startupChunks.test.ts:24`. Add raw globs for `/vite.config.ts` and `/public/nigeria-loader.js`.
    - Resolve `*_KEY` constants, template keys, multi-line `setItem(` calls, zustand `name:`, i18next `lookupLocalStorage`, Dexie `super(...)` and `cacheName`.
    - Allow-list the keys that libraries set (`sb-*`, `sentryReplaySession`, `workbox-precache-*`).
    - Fail on any name missing from the inventory.
11. In `docs/legal/README.md:34-41`, point "Keeping the notice accurate" at `storageInventory.ts`. Record that the notice is English-only until legal review.

**How to check it.**
- `npx vitest run src/pages/legal/storageInventory.test.ts` passes. It then fails after you add a stray `localStorage.setItem("mbhr-probe", "1")`.
- A unit test with a fake `caches` object shows that `clearCachedApiData` deletes the two named caches and keeps `workbox-precache-*`. Extend `src/stores/auth.test.ts` and `src/db/deviceReset.test.ts` to check that it runs.
- Manual check:
  1. Build with `VITE_SENTRY_DSN` set and run `npm run preview`.
  2. Sign in as staff and as a patient, and compare DevTools > Application with the table.
  3. Sign out and confirm both caches are gone.
  4. Go offline and reload. The app must still start.

**Decision needed.** The Foundation must decide whether Sentry session replay stays (`docs/legal/README.md:25`). If it stays, put it behind an opt-in that is off by default. In the same commit as the notice, add the Sentry ingest origin to `connect-src` in `vercel.json:24`; today the CSP blocks uploads. If it goes, remove `replayIntegration` and set `replaysSessionSampleRate` to 0 (`src/main.tsx:31-38`). The Foundation should also decide whether to self-host the map outline.

**Risk if left.** Under the NDPA 2023 and the NDPC GAID, a notice that leaves out device storage and session replay weakens transparency and consent, and children's health data left in browser caches on shared devices is a security-of-processing exposure. Not legal advice.

### 5. Add a cookie consent banner

**Status:** missing · **Priority:** P1 · **Effort:** S

**Where it stands.** No consent state, banner or withdrawal control exists anywhere in `src`. When `VITE_SENTRY_DSN` is set, `src/main.tsx:29-38` starts `browserTracingIntegration()` and `replayIntegration()` without asking the user. Because `replaysOnErrorSampleRate: 1.0` (line 38), replay buffers every session, not the 10% claimed in `docs/deployment/DEPLOYMENT_GUIDE.md:182-186`. The notice says all storage is necessary and "there is no cookie banner" (`src/pages/legal/PrivacyPolicy.tsx:84-92`), yet it also mentions Sentry "screen recordings" (lines 73-74). On Vercel, `vercel.json:24` lists no Sentry host in `connect-src` and sets `worker-src 'self'`, so replay cannot upload. The Netlify option (`DEPLOYMENT_GUIDE.md:195-224`) ships no `netlify.toml` or `public/_headers`, so nothing blocks it there. All other storage is strictly necessary (`src/i18n/index.ts:44-45`, `src/components/AccessibilityControls.tsx:27`), and the app loads no analytics, ad or font scripts.

**How to add it.** The approved route removes the trackers, so no banner is needed.
1. In `src/main.tsx:29-35`, delete the `integrations` array, which holds `browserTracingIntegration()` and `replayIntegration()`.
2. In `src/main.tsx:36-38`, delete `tracesSampleRate`, `replaysSessionSampleRate` and `replaysOnErrorSampleRate`.
3. Delete `beforeSendTransaction` (`src/main.tsx:60-63`), which only served tracing. Keep `stripUrlSecrets` (line 23), `beforeBreadcrumb` and `beforeSend` (lines 44-84) so that scrubbed error capture still works.
4. In `src/pages/legal/PrivacyPolicy.tsx:72-74`, drop the "screen recordings" clause. Keep lines 84-92, which will then be true. Change `updated` at line 11.
5. Save the Nigeria GeoJSON under `public/` and point `SRCS` in `public/nigeria-loader.js:193-196` at it. This removes an unnamed third-party request from every cold start, and a network dependency from boot. If you keep the CDNs, name jsDelivr and statically.io in `PrivacyPolicy.tsx:69-75` instead.
6. After step 5, remove the `jsdelivr` runtime cache (`vite.config.ts:165-176`, wrongly labelled "Google Fonts") and the two CDN hosts in `vercel.json:24`.
7. Mark the open decision at `docs/legal/README.md:25` as resolved.
8. Rewrite `DEPLOYMENT_GUIDE.md:182-186` to say "errors only, no tracing or replay". Remove `tracesSampleRate` from the snippet at lines 479-494.
9. Commit steps 1 to 8 together, as `docs/legal/README.md:36-41` requires.

*Only if the Foundation keeps replay (effort M), add it back behind consent after step 9:*

10. Create `src/lib/telemetryConsent.ts` (new) with a default-off `mbhr-telemetry-consent` key. Follow the `STORAGE_KEY` pattern in `AccessibilityControls.tsx:27`.
11. In `src/main.tsx`, call `Sentry.addIntegration(Sentry.replayIntegration(...))` only after opt-in. Call `Sentry.getReplay()?.stop()` on withdrawal.
12. Create `src/components/ConsentBanner.tsx` (new). Give Accept and Decline equal weight, link to `/privacy`, and add its strings to all five `src/i18n/locales/*.json` files. Import nothing from `src/features/patient-portal/` or `src/pages/admin/`, or `src/test/startupChunks.test.ts:10-20` fails.
13. Mount it next to `<PWAInstallPrompt />` at `src/App.tsx:407`.
14. Put the withdraw control on `/privacy`. Do not put it in `src/pages/admin/Settings.tsx`, which is admin-only (`src/App.tsx:793-795`).
15. Clear the key in `logout` (`src/stores/auth.ts:402`), because staff share tablets.
16. Send uploads through a Supabase edge function set as the Sentry `tunnel`. Add `worker-src blob:` to `vercel.json:24`. Add a matching CSP in `public/_headers` or delete Netlify Option A.

**How to check it.**
- Add `src/test/telemetryConfig.test.ts` (new). Load `/src/main.tsx` with `import.meta.glob(..., { query: "?raw" })`, as `src/test/startupChunks.test.ts:24-28` does. Assert that it contains no `replayIntegration`, `browserTracingIntegration` or `tracesSampleRate`. Run `npx vitest run src/test/telemetryConfig.test.ts`.
- Manual: build with a dummy `VITE_SENTRY_DSN` and run `npm run preview`. In DevTools, confirm there are no cookies and no `sentryReplaySession` key in session storage.
- Replay route only: add a Playwright spec in `e2e/` (new) that finds the banner and checks that Decline leaves `sentryReplaySession` absent. CI serves a prebuilt `dist/` (`playwright.config.ts:46-53`), so the build job needs the dummy DSN. The consent key must be pre-seeded in `e2e/login.spec.ts`, `e2e/patient-registration.spec.ts` and `e2e/vitals-entry.spec.ts`.

**Decision needed.** The Foundation must decide whether session replay stays. That question is still open at `docs/legal/README.md:25`. The owner must also confirm which hosts set `VITE_SENTRY_DSN`. If any of them lacks the Vercel CSP, this item is P0 until step 1 ships.

**Risk if left.** Session replay on a children's health app starts without opt-in while the notice says no banner is needed, and the NDPC could treat that as non-transparent processing of sensitive health data without a valid lawful basis under the NDPA 2023 and the GAID. Not legal advice.

### 6. Check your form consents

**Status:** partial · **Priority:** P0 · **Effort:** L

**Where it stands.** Portal sign-up has one required, unticked box that bundles the terms, the privacy notice and access to health records under one label (`src/features/patient-portal/PatientRegister.tsx:484-521`), and its value is never saved (`:114-121`, `:175-182`). The staff form ticks portal access by itself once a phone or email is typed (`src/components/PatientForm.tsx:53-61`) and takes an unnamed attestation (`:614-626`), with no photo consent although `src/pages/legal/PrivacyPolicy.tsx:24` promises one. `src/components/SimplePatientForm.tsx:138` and the caregiver dialog (`src/features/patient-portal/CaregiverSetup.tsx:391-427`) ask for nothing, while `src/components/PortalStatusCard.tsx:141`, `src/services/portalEnrollment.ts:528` and `src/services/patientPortalAuth.ts:84` hard-code consent. The server trigger `trigger_auto_enrollment` still enables anyone with a phone or email (`supabase/migrations/20260115072241_add_portal_enhancements_v3.sql:540-589`). New RLS lets `register` staff and linked portal patients insert into `patient_consent_records` (`supabase/migrations/20260924110300_rls_patient_portal.sql:324-337`), but nothing in `src` writes to it.

**How to add it.**
1. Import `PRIVACY_VERSION` and `TERMS_VERSION` from `src/pages/legal/policyMeta.ts` (new, items 1 and 2). Use them for the `updated` prop at `PrivacyPolicy.tsx:11` and `TermsOfUse.tsx:7`.
2. Create `supabase/migrations/20260926000100_record_portal_consent.sql` (new, shared with item 2). Add `capture_method`, `subject_role`, `relationship` and `captured_by` to `patient_consent_records`, and keep the `20260924110300` policies.
3. In that migration, add a `BEFORE UPDATE` trigger calling `public.app_guard_immutable_columns('', ...)` on every column except `revoked_at`.
4. In that migration, drop `trigger_auto_enrollment` and set `auto_enrollment_enabled` to `false`.
5. Add a `consents` table in a new `this.version(19)` in `src/db/index.ts` (the latest is `version(18)` at `:1505`).
6. In `src/sync/adapter.ts`, add `patient_consent_records` to `Tbl` (`:54-66`), `mapToDB`, `tables` (`:394`), `localTableMap` (`:410`) and `APPEND_ONLY` (`:77`). Append-only rows upload once and are never pulled, so no `updated_at` is needed.
7. Create `src/services/consent.ts` (new) with `recordConsent(...)`, modelled on `src/services/queueAudit.ts`. It writes to Dexie with `_dirty: 1` and needs no network. Use `crypto.randomUUID()` for `id`: the server column is `uuid`, and `generateId()` returns a ULID.
8. In `PatientRegister.tsx:484-521`, split the box into three unticked, separately labelled boxes: terms, privacy notice, and portal access to records. Add each to both zod schemas (`:19-69`).
9. Call `recordConsent` for each box on both sign-up paths. Online, also send the versions in `signUp` `options.data` (`src/hooks/useAuth.ts:92-99`), because there may be no session before email confirmation, and insert the rows once the account is linked to its patient record. Offline, remove `consentGiven: true` at `patientPortalAuth.ts:84`.
10. In `PatientForm.tsx`, delete the effect at `:53-61`. Add a required fieldset: consent to record, who consented (patient or guardian), and a separate photo box. Call `recordConsent` with `capturedBy` from `currentUser` in `src/stores/auth.ts:14`.
11. Add a `consent` step to `SimplePatientForm.tsx:138` with `isValid` and `audioKey: "patient.consent"`. Add its strings to all five `src/i18n/locales/*.json`; CI runs `npm run i18n:check` (`.github/workflows/build.yml:44`).
12. Replace `termsAccepted: true` at `PortalStatusCard.tsx:141` with a required attestation box in its existing `ConfirmDialog` (`:35`).
13. Gate `bulkEnablePortalAccess` (`portalEnrollment.ts:501`) and `bulkEnrollPatients` (`src/services/unifiedPortalEnrollment.ts:290`) on a consent row. Make the warnings at `src/pages/admin/PortalMigration.tsx:625` and `src/pages/admin/BulkPortalMigration.tsx:423` required boxes.
14. In `CaregiverSetup.tsx:391-427`, add a required guardian attestation. Have `addManagedPatient` (`patientPortalAuth.ts:551`) record a consent with `consent_type = 'guardian_consent'` (see item 17).
15. In the same commit, update "Your choices and rights" (`PrivacyPolicy.tsx:102`) and correct `docs/legal/README.md:3-5`.

**Done in the code (lane mA).** Steps 1, 8 and 12 are done, and so are parts of steps 9, 10 and 15.
- Portal sign-up has three unticked, separately labelled, required boxes: the terms, the privacy notice, and portal access to records.
- Offline, the accepted versions and time are stored on the `LocalPortalUser`. The hard-coded `consentGiven: true` is gone.
- Online, they go in `signUp` `options.data`. The patient can edit that user metadata, so it is not yet evidence of consent.
- The staff form no longer ticks portal access by itself.
- `PortalStatusCard` asks staff to tick that the patient agreed before turning access on ("Turn on access" stays disabled until then). After the merge with `mainone`, the change is queued as a `set_patient_portal_access` command and the server decides. The tick is not stored anywhere: the command carries only the reason code `staff_choice`.
- `docs/legal/README.md` is corrected.

Nothing is written to `patient_consent_records` yet. Steps 2 to 7 (migration `000100`, the Dexie `consents` table and `recordConsent`), 11, 13 and 14 are still open. Step 4 no longer needs to drop the trigger: see item 9.

**How to check it.**
- Extend `src/features/patient-portal/PatientRegister.test.tsx` (it clicks `#consent` at `:103`): submit fails until all three boxes are ticked, and `recordConsent` gets each kind and version.
- Add `src/services/consent.test.ts` (new), mocking `db` as `src/services/queueManagement.test.ts:46` does, and consent cases in `src/validation/schemas.test.ts`.
- SQL on a Supabase branch: a new patient with a phone keeps `portal_enabled` false, and a portal patient's `UPDATE` of `consent_version` fails with `42501`.
- Run `e2e/patient-registration.spec.ts` locally with the fieldset ticked; CI runs only `e2e/login.spec.ts` (`.github/workflows/build.yml:114`).

**Decision needed.** Whether staff attestation is enough for portal access, or only the patient's own acceptance counts. The age at which a child consents alone, and what proof of guardianship staff accept. A lawyer should approve the wording in all five languages.

**Risk if left.** Without specific, unbundled and recorded consent for sensitive health data, including children's, the Foundation cannot show the NDPC a lawful basis under the NDPA 2023, and bundled terms may draw FCCPA 2018 scrutiny. Not legal advice.

### 7. Don't collect unnecessary data

**Status:** partial · **Priority:** P1 · **Effort:** L

**Where it stands.** Sentry sets `sendDefaultPii: false` and strips request data, exception values and messages (`src/main.tsx:43-86`), but replay still records 10% of sessions and every error session by default (`src/main.tsx:31-38`). The new `beforeSendTransaction` strips only the query and fragment of `event.request.url` (`src/main.tsx:60-63`), so transaction names keep ULID patient and visit IDs (`src/App.tsx:567`, `src/db/index.ts:1518`), and navigation breadcrumbs keep their query strings (`src/main.tsx:56-58`). Photos are taken with no consent step (`src/components/SimplePatientForm.tsx:140-173`, `src/components/PatientForm.tsx:209-245`) and sync as base64 through `photoUrl: "photo_url"` (`src/sync/adapter.ts:114`); `src/utils/photoStorage.ts` is dead code that calls `getPublicUrl` on a private bucket (`src/utils/photoStorage.ts:43-47`), and so is `src/services/supabaseSync.ts`. Address is required in `src/validation/schemas.ts:50` but optional in `src/components/SimplePatientForm.tsx:304-310`, and `conflict_change_deltas` keeps PHI old and new values "for AI training" (`supabase/migrations/20260125095109_add_conflict_delta_retention_and_archiving.sql:49`, `src/services/conflictQueue.ts:713-726`) while nothing reads `data_retention_policies`. Invitation links carry the patient's email or phone (`src/services/portalEnrollment.ts:207-212`), `send-otp-email` no longer logs any recipient address (masked or not), code, user id or role, even in demo mode (see [Fix these first](#fix-these-first), item 2), and no per-field data inventory exists.

**How to add it.**
1. Create `docs/legal/DATA_INVENTORY.md` (new) with one row per personal-data field: purpose, lawful basis, required or optional, retention, recipients. Cover `Patient` (`src/db/index.ts:48`), `patientSchema`, the portal sign-up fields and the Supabase-only columns (`sdoh_observations`, portal `device_fingerprint`, `ip_address`, `user_agent`). Link it from `docs/legal/README.md`.
2. Move the Sentry options into `src/lib/sentryConfig.ts` (new), after item 5 removes tracing and replay. If the Foundation keeps replay, add it back only behind consent, as item 5 describes. Update `src/pages/legal/PrivacyPolicy.tsx:73-74` in the same commit.
3. In the same file, in `beforeBreadcrumb`, strip query strings from navigation `data.from` and `data.to`, and replace ULIDs and UUIDs with `:id`. Item 5 deletes tracing and `beforeSendTransaction`, so transactions need no change.
4. Send a bare `/patient/register` link from `src/services/portalEnrollment.ts:207-212`, and remove the prefill at `src/features/patient-portal/PatientRegister.tsx:83-84`.
5. Done: `send-otp-email` logs no address (masked or not), code, user id or role (see [Fix these first](#fix-these-first), item 2). Do not add a recipient log line.
6. Apply the address decision. Either make `schemas.ts:50` optional and drop the asterisks at `PatientForm.tsx:434` and `PatientDetail.tsx:595`, or document the purpose and require it in `SimplePatientForm.tsx`.
7. Add `photoConsentAt` and `photoPath` to `Patient`. Gate the camera in both forms behind a required "patient or guardian agreed to a photo for identification" checkbox. Fix the duplicate `simple.tapCameraToAddPhoto` key (`src/i18n/locales/en.json:118` and `:239`).
8. Rewrite `src/utils/photoStorage.ts` to upload to the private `photos` bucket, return the object path, display through `createSignedUrl`, and throw instead of returning the data URL.
9. Keep the base64 thumbnail in Dexie `photoUrl` for offline display. At `src/sync/adapter.ts:114`, map `photoPath` and `photoConsentAt` instead of `photoUrl`, and upload pending photos during the sync run.
10. Add `src/db/migrations/0006-photo-upload-backfill.ts` (new), registered in `migration-runner.ts`, to queue existing data-URL photos for upload.
11. Create `supabase/migrations/20260926000300_limit_conflict_deltas.sql` (shared with item 1). Drop "AI training" from the table comment. `UPDATE` the existing `data_retention_policies` row (line 235 of `20260125095109`; an insert is skipped) to `archive_strategy = 'delete'`. Add a `SECURITY DEFINER` purge function that logs to `retention_policy_executions`, scheduled like `20260503050000_add_bulk_export_cleanup_cron.sql:71-83`. Add `patients.photo_consent_at`.
12. In `src/services/conflictQueue.ts:713-726`, write `null` to `old_value` and `new_value` when `phi_field` is true.
13. Extend `src/validation/schemas.test.ts` to pin exactly which `patientSchema` fields are required.

**How to check it.**
- `src/lib/sentryConfig.test.ts` (new): there is no tracing or replay integration, `sendDefaultPii` is false, a navigation breadcrumb to `/patients/<ULID>` becomes `/patients/:id`, and a breadcrumb to `/patient/register?email=x` loses its query.
- `npx vitest run`: the required-fields test passes, and a failed photo upload throws.
- SQL: `SELECT jobname FROM cron.job` lists the purge job. Run it on a seeded old delta and confirm the row is gone and a `retention_policy_executions` row exists.
- Manual: register a patient offline with a photo, reconnect, and confirm `patients.photo_url` holds a storage path, not `data:`.

**Decision needed.** The owner must set the `conflict_change_deltas` retention period. The owner must also say whether address and photos are clinically needed and whether to drop `sdoh_observations` and the unwritten portal session columns. The replay question at `docs/legal/README.md:25` also needs closing.

**Risk if left.** Required fields with no stated purpose, children's photos taken without recorded consent, and PHI kept indefinitely for undisclosed AI training breach the NDPA 2023 minimisation, purpose-limitation and storage-limitation principles for sensitive health data. Not legal advice.

### 8. Audit your third-party SDKs

**Status:** partial · **Priority:** P1 · **Effort:** M

**Where it stands.** There is no inventory. `docs/legal/README.md:11-14` only names four vendors that may process data outside Nigeria. The notice lists Supabase, Termii, Resend, Jitsi Meet and Sentry (`src/pages/legal/PrivacyPolicy.tsx:70-75`). It leaves out five recipients:

- Twilio, the fallback SMS provider (`supabase/functions/_shared/sms/provider.ts:50-54,126`).
- Vercel, which hosts the app.
- The GitHub runner that dumps the full database every night (`.github/workflows/backup.yml:27,57-58`).
- Slack (`.github/workflows/backup.yml:89-106`).
- The two CDNs the map loader calls (`public/nigeria-loader.js:193-196`).

The browser Termii gateway has been deleted (`src/services/messaging.ts:23-28`). Even so, `vercel.json:24` still allows `api.ng.termii.com`. It also lacks the Sentry ingest host that `src/main.tsx:25-38` needs.

**How to add it.**
1. Create `docs/legal/THIRD_PARTIES.md` (new) with these columns: service, code location, purpose, data sent, region, DPA, named in notice, CSP entry.
2. Add a row for each recipient: Supabase, Sentry, Termii, Twilio, Resend, Jitsi (`src/config/env.ts:43`), jsDelivr, Statically, Vercel, GitHub Actions, Slack (file name and size only), TEFCA OAuth clients (`supabase/functions/tefca-oauth/register.ts`) and browser speech (`src/hooks/useT.ts`, UI labels only). Record that SMS bodies carry the patient's name, medicine and televisit link (`src/services/messaging.ts:77-87`, `src/services/televisits.ts:745-754`).
3. Link the file from `docs/legal/README.md:34` and `docs/README.md:43`. Extend the rule at `docs/legal/README.md:34` so that a new service also updates `THIRD_PARTIES.md` and the CSP in the same change.
4. In the same commit, add Twilio, Vercel and GitHub to `src/pages/legal/PrivacyPolicy.tsx:70-75`, and bump `updated=` on line 11. At lines 77-79, name exchange partners without promising consent. The reason: `supabase/functions/_shared/fhir/bearer-auth.ts:102-103` defaults to `individual-access`, which skips the consent check.
5. After the licence check (item 19), save the GeoJSON as `public/geo/nigeria-states.json` (new), the name item 19 uses. Point `SRCS` in `public/nigeria-loader.js:193-196` at it.
6. Add `json` to `globPatterns` at `vite.config.ts:133`. The current pattern would not precache the file, which breaks offline-first.
7. Remove `cdn.jsdelivr.net`, `cdn.statically.io` and `api.ng.termii.com` from `connect-src` in `vercel.json:24`. Delete the jsDelivr cache rule at `vite.config.ts:165-177`.
8. Update `docs/architecture/CACHING_STRATEGY.md:18-20,37` and `docs/deployment/SMS_SETUP_TERMII.md:89-91` to match.
9. Let Sentry reports through the CSP. Either add the DSN's ingest origin to `connect-src`, or set `tunnel` in `Sentry.init` (`src/main.tsx:26`). Item 5 removes replay. If the Foundation keeps it, allow its `blob:` worker as item 5 step 16 describes.
10. Confirm `VITE_TERMII_API_KEY` is unset in every Vercel environment. If it was ever set, rotate the Termii key. `src/config/env.ts:52` reads the whole `import.meta.env`, so Vite puts every `VITE_` value into the bundle.
11. Rotate the Resend key that starts with `re_YFFH`. Replace each copy with a placeholder: `scripts/set-resend-key.sh:8`, `docs/guides/QUICK_REFERENCE_CARD.md:22,44,51` and three files in `docs/archive/development-history/`.
12. Add `src/test/thirdPartyInventory.test.ts` (new). Reuse the `import.meta.glob` `?raw` pattern from `src/test/startupChunks.test.ts:24`. Scan these files for `https://` and `wss://` hosts: `/src/**/*.{ts,tsx}` (not tests), `/public/*.js`, `/index.html` and `/supabase/functions/**/*.ts`. Skip placeholder hosts (`app.test`, `*.example.com`, `test.supabase.co`, `example.supabase.co`, `*.invalid`). Assert that every other host is listed in `THIRD_PARTIES.md`.
13. In the same test, assert that every host browser code fetches from is in the `vercel.json` `connect-src`. Match the host at `index.html:25` against `*.supabase.co`. Exempt three kinds of host:
    - `meet.jit.si`, which only opens with `window.open` (`src/features/patient-portal/Telehealth.tsx:228`).
    - The plain links in `src/pages/admin/EmailDiagnostics.tsx:429,473,482`.
    - Hosts that only the server functions call.

**How to check it.**
- `npm run test:run` passes. Adding `fetch("https://new-vendor.io")` to any `src` file makes the new test fail.
- Manual check on a Vercel preview: load the app once, go offline and reload. The map renders, DevTools shows no CDN request, and a test error reaches Sentry with no CSP violation.
- `git grep -n re_YFFH -- ':!docs/legal/LEGAL_READINESS_CHECKLIST.md'` returns nothing (this checklist names the prefix on purpose), and the Resend dashboard shows the old key as revoked.

**Decision needed.** The Foundation must sign or accept a DPA with each of Supabase, Sentry, Resend, Termii, Twilio, Vercel and GitHub, and confirm where each one stores data. It must also decide whether to keep Twilio and Sentry replay (`docs/legal/README.md:25`), and whether to self-host Jitsi.

**Risk if left.** The app sends phone numbers, full health-record backups and visitor IP addresses to processors the notice does not name, with no recorded basis for sending data abroad. This risks breaching the transparency and cross-border transfer duties in the NDPA 2023 and the NDPC GAID, and an incomplete provider list may be misleading under the FCCPA 2018. Not legal advice.

### 9. Remove dark patterns

**Status:** partial · **Priority:** P0 · **Effort:** L

**Where it stands.** Portal sign-up starts unticked (`src/features/patient-portal/PatientRegister.tsx:96`), and no confirm-shaming or false urgency was found. `trigger_auto_enrollment` still turns the portal on for any patient with a phone or email (`supabase/migrations/20260115072241_add_portal_enhancements_v3.sql:540-589`), and the server grants portal reads on that flag (`supabase/migrations/20260925100000_sync_authority_foundation.sql:449`). The staff form ticks portal access by itself (`src/components/PatientForm.tsx:53-61`), treatment sharing is pre-ticked (`src/features/patient-portal/DataSharingPreferences.tsx:61`) and SMS is opt-out (`src/services/reminderEligibility.ts:35`). Staff "Turn off access" only edits Dexie (`src/services/portalEnrollment.ts:134-150`), the portal SMS opt-out is ignored (`src/features/patient-portal/ManageAccount.tsx:280-289`), and patients cannot close their account; `src/services/autoEnrollment.ts` is dead code.

**How to add it.**
1. Create `supabase/migrations/20260926000200_consent_defaults_off.sql` (new). Make it idempotent, with a Rollback header like `20260910164216_drop_legacy_appointment_write_policies.sql`. Drop `trigger_auto_enrollment` and `check_auto_enrollment()`. Set `auto_enrollment_enabled` and `send_welcome_notification` to `'false'::jsonb`.
2. In that file, set `portal_enabled` to false and stamp `portal_enabled_changed_at` wherever `auto_enrolled` is true and no unrevoked `portal_access` row exists in `patient_consent_records`. The stamp makes devices apply the change (`src/sync/adapter.ts:345-350`).
3. In that file, default these columns to false: `patient_data_sharing_preferences.allow_treatment_access`, `patient_preferences.appointment_reminders` and `medication_reminders`, and the four alert columns of `patient_portal_preferences`.
4. In that file, add `'closed'` to the `account_status` CHECK (`supabase/migrations/20251028000000_add_patient_portal.sql:97`). Add a `SECURITY DEFINER` function, `close_portal_account()`. It sets that status, sets `portal_opt_out`, clears `portal_enabled` and revokes consent rows. Patients cannot write `account_status` themselves (`supabase/migrations/20260924110300_rls_patient_portal.sql:76-86`).
5. In that file, add a `SECURITY DEFINER` trigger that copies `patient_portal_preferences.sms_reminders` into `patient_preferences`. The pull at `src/services/enhancedSync.ts:532-570` brings the value to staff devices. `src/services/messaging.ts:72-73` and `:109-110` then check it offline.
6. Delete the auto-tick `useEffect` at `src/components/PatientForm.tsx:53-61`.
7. Make `disablePortalAccess` (`src/services/portalEnrollment.ts:134-150`) queue a `set_patient_portal_access` command with `p_enabled: false` and `portalPending: 1`, as `src/db/migrations/0004-portal-access-backfill.ts:36-39` does. This replaces the plan's `enhancedSync.ts` step, because `portal_enabled` is now pull-only (`src/sync/adapter.ts:250-257`).
8. Pass the staff attestation in the enable command's arguments, so offline registrations keep it. The `set_patient_portal_access` RPC belongs to the portal-access package and is not in `supabase/migrations` yet. It must store the attestation in `patient_consent_records`, set `portal_opt_out` on disable, and refuse an enable that has no consent.
9. Make `bulkEnablePortalAccess` (`src/services/portalEnrollment.ts:528`) and `bulkEnrollPatients` (`src/services/unifiedPortalEnrollment.ts:290`) skip patients with no consent.
10. Add a "patient agreed" column for each patient to `src/pages/admin/PortalMigration.tsx` and `src/pages/admin/BulkPortalMigration.tsx`.
11. Add an unticked "Patient agrees to SMS reminders" box to `PatientForm.tsx` and `SimplePatientForm.tsx`, saved with `createOrUpdatePreference`. Change the default to 0 in `src/services/preferences.ts:52-53` and `src/components/PreferenceManager.tsx:86-89`.
12. In `src/services/reminderEligibility.ts:26-38`, return a new `no_consent` reason when there is no preference record. Call `reminderSkipReason` in `src/features/notifications/ScheduleReminderForm.tsx:205`.
13. In `ManageAccount.tsx`, delete the caveat at `:280-289`. Default the toggles at `:92-97` and `:123-126` to false.
14. Add "Close my portal account" to the security tab (`:395`) with `./account/ConfirmDialog`. It calls `close_portal_account()` and then signs the patient out.
15. Set `allow_treatment_access: false` at `DataSharingPreferences.tsx:61`. Change the nonexistent `consented` column to `consent_given` in `supabase/functions/_shared/fhir/audit.ts:52` and `src/services/fhir/tefcaAuth.ts:193-196`.
16. Split the sign-up box (`PatientRegister.tsx:484-521`) into the three unticked boxes item 6 describes: terms, privacy notice, and portal access to records. Store each in `patient_consent_records`. Update `PatientRegister.test.tsx:103`, `:134`, `:163` and `:197`.
17. Add the STOP line or preferences link from item 18 step 11 to every non-transactional message in `scripts/seed/data/messageTemplates.ts` and `src/services/messageTemplates.ts:16`. Shorten any message that would then go over 160 characters.
18. In the same commit, update `src/pages/legal/PrivacyPolicy.tsx:77-78` and `:102-109`, and `docs/legal/README.md:5-6`.

**Done in the code (lanes mA and mC).** Steps 1, 6 and 16 are done, and so are parts of steps 3, 12, 15 and 18.
- Migration `000200` sets `auto_enrollment_enabled` and `send_welcome_notification` to `false`. It does not drop `trigger_auto_enrollment` or `check_auto_enrollment()`: `mainone`'s `20260925100100_portal_access_authoritative.sql` made the trigger run on insert only, never override a decision, an opt-out or an earlier disable, and enrol only while that setting is true, and `supabase/tests/portal_access.test.sql` expects it. With the setting off it enrols no one.
- Step 7 is done by `mainone` (`64b0a20`): `enablePortalAccess` and `disablePortalAccess` queue `set_patient_portal_access` through `src/services/portalAccess.ts`, and a disable always applies on the server.
- It defaults `allow_treatment_access` to false. `DataSharingPreferences` starts it unticked.
- `reminderSkipReason` now treats a pulled `false` as an opt-out (lane mC).
- `ScheduleReminderForm`, `PreferenceManager` and `src/services/preferences.ts` read reminder settings with that same rule (`isReminderOptedOut`). A setting pulled as `true` shows as On and is saved as 1. It is no longer read as Off, and saving no longer silently opts the patient out.

Step 2 is not done, and deliberately so: whether patients who were enrolled automatically keep access is the Foundation's decision. Step 3's reminder and alert defaults, and steps 4, 5, 8 to 11, 13, 14 and 17, are still open. Step 8 in particular: the command carries a reason code, not the staff attestation, and the server does not refuse an enable without consent. With auto-enrolment off, a new patient's server access changes only through `set_patient_portal_access`, which staff queue, and `portal_link_patient_record` for a self-registered record.

**How to check it.**
- `npm run test:run -- src/services/reminderEligibility.test.ts src/services/portalEnrollment.test.ts src/features/patient-portal/PatientRegister.test.tsx` passes with three new tests: a missing record gives `no_consent`, `disablePortalAccess` queues one `p_enabled: false` command, and all three sign-up boxes start unticked.
- `src/components/PatientForm.test.tsx` (new): typing a phone number leaves "Enable patient portal access" unticked.
- SQL after `supabase db reset`: `pg_trigger` has `trigger_auto_enrollment` as a `BEFORE INSERT` trigger only, and `auto_enrollment_enabled` is `false`. A patient inserted with a phone keeps `portal_enabled = false`. `information_schema.columns` shows `false` as the default for each column in step 3.
- Manual: turn SMS off in the portal and sync a staff device. Go offline and confirm `/sms-reminders` refuses the reminder.

**Decision needed.** The owner and a lawyer must decide whether patients who already have portal access keep it or must confirm again. This includes access switched on by the device backfill (`src/db/migrations/backfillPlans.ts:45-67`). They must also decide whether `allow_ias_access` (the patient's own access) stays on by default.

**Risk if left.** Auto-enrolment, pre-ticked sharing and opt-out SMS mean consent to process health data, including children's, is not the clear affirmative act that the NDPA 2023 and the NDPC GAID require, and these defaults may be an unfair practice under the FCCPA 2018. Not legal advice.

### 10. Remove hidden fees

**Status:** not applicable · **Priority:** P2 · **Effort:** S

**Where it stands.** The app shows no price and takes no payment. No payment provider appears in `src`, `supabase`, `scripts` or `docs`. No migration creates a bill, invoice or payment table, and the Dexie schema up to `version(18)` (`src/db/index.ts:1505`) has no price or bill fields. `BillingPayments.tsx` hard-codes `setBills([])` (`src/features/patient-portal/BillingPayments.tsx:47-49`) and sits on an orphan route (`src/App.tsx:474`) with no nav link. The only link to it is in `PatientQuickLinks` (`src/features/patient-portal/PatientQuickLinks.tsx:58`), which is dead code that nothing imports. The page copy still implies that charges exist (`:71`, `:96-98`, `:117`). The only cost claims are in the `outreach_announcement` SMS template. Its fallback says "Treatment and medicines at no cost" (`src/services/messageTemplates.ts:21-22`), and the seeded bodies say "free" in all five locales (`scripts/seed/data/messageTemplates.ts:100-140`). Nothing sends that key today, because `outboxTemplateFor` (`src/features/notifications/smsOutbox.ts:729-776`) maps only to `medication_reminder` and `follow_up_reminder`.

**How to add it.**
1. Get the Foundation's written answer on whether outreach care is free (see Decision needed). Item 3 needs the same fix, so do the work once.
2. Create `src/services/costClaims.ts` (new) with `isOutreachCareConfirmedFree()` and `setOutreachCareConfirmedFree(on)`. Store the flag in the Dexie `settings` table under the key `outreach_care_confirmed_free`, copying the pattern in `src/services/activeSite.ts:16-40`. This works offline. It needs no Dexie version bump and no Supabase migration.
3. Add a "Cost claims" panel with one checkbox to `src/pages/admin/Settings.tsx`. Label it "The Foundation has confirmed in writing that outreach care is free." The route is already admin-only (`src/App.tsx:793-797`). The helper text must say the flag applies to this device only.
4. Add an `outreach_announcement_neutral` key to `SmsTemplateKey` and `FALLBACK_BODIES` in `src/services/messageTemplates.ts:5-30`. Give it a body with no cost claim, for example "mBHR: Medical outreach on {{date}} at {{site_name}}. Bring your card if you have one."
5. Add matching `outreach_announcement_neutral` rows for `en`, `ha`, `yo`, `ig` and `pcm` to `scripts/seed/data/messageTemplates.ts`, next to `:100-140`. This is seed data, not a migration.
6. In `composeSms` (`src/services/messageTemplates.ts:77-84`), use `outreach_announcement_neutral` in place of `outreach_announcement` unless `isOutreachCareConfirmedFree()` returns true. Putting the guard here means any future sender inherits it.
7. Item 3 deletes `BillingPayments.tsx`, its route at `src/App.tsx:474` and its lazy import at `:155-158`. If the page is kept instead, rewrite the three lines that imply charges (`:71`, `:96-98`, `:117`) so they say something true, such as "mBHR does not take payments. If anyone asks you to pay at an outreach, ask for an itemised receipt."
8. Once the Foundation confirms, extend the "Fees" `LegalSection` that item 3 adds to `src/pages/legal/TermsOfUse.tsx` between "Availability" (`:59-66`) and "Privacy" (`:68`). It should say that the portal and confirmed outreach care are free. It should also say that the patient's network may charge for SMS and for the mobile data a video visit uses. Update `updated` at `:7`. This adds no new data flow, so `PrivacyPolicy.tsx` stays as it is.
9. Do not build billing now. If billing is added later, open a new item for it. That item must cover itemised `bill_items` in kobo, a synced Dexie table, a grand total shown before any payment instruction, and the provider added to `src/pages/legal/PrivacyPolicy.tsx:69-75`, as `docs/legal/README.md:36-41` requires.

**How to check it.**
- `src/services/messageTemplates.test.ts` (new): mock `supabase` as `null` and leave the flag unset. Then `composeSms("outreach_announcement", "en", { date, site_name })` must not match `/free|no cost/i`. Set the flag, and the "no cost" body must come back.
- In the same test, assert that no `outreach_announcement_neutral` seed row matches `/\b(free|no cost|kyauta|ofe|n'efu)\b/i`. Run `npm run test:run -- messageTemplates`.
- Manual check: sign in as an admin and confirm the checkbox shows on `/admin/settings`. Then open `/patient/billing` in the portal and confirm that the page is gone, or, if it was kept, that no text mentions charges.
- `grep -rniE "paystack|flutterwave|stripe|remita|interswitch|monnify" src supabase` still returns nothing.

**Decision needed.** The Foundation must confirm in writing whether consultations, tests and medicines are free at every outreach or only at some. It must also name who may tick the confirmation on each device. It should decide whether to keep the "Health insurance and payment" sharing option (`src/features/patient-portal/account/sharingChanges.ts:34-38`), because it implies that care can be paid for.

**Risk if left.** A "free care" SMS that turns out to be untrue could be treated as a false or misleading price representation under the FCCPA 2018. So could a portal page that talks about charges no one was shown. Not legal advice.

### 11. Remove fake reviews

**Status:** done · **Priority:** P2 · **Effort:** S

**Where it stands.** No reachable screen shows a testimonial, rating, logo, star count or "trusted by" claim, and no testimonial feature exists that would need governing. The public home page (`src/pages/Home.tsx:4-91`, routed at `src/App.tsx:410`) and the portal landing (`src/features/patient-portal/PatientPortalLanding.tsx:20-76` and `:112-340`, routed at `src/App.tsx:445`) show only entry points, features, steps and FAQs. Invented content survives in dead code. `getTeamChallenges` hard-codes `currentProgress: 450` and rewards such as "Featured in Newsletter" (`src/services/volunteerEngagement.ts:568-600`). `getCertificationPaths` promises "Official certification" and "Training stipend eligibility" (`:603-700`). `getVolunteerStories` returns made-up stories with invented like counts (`:714-755`). `calculateVolunteerROI` claims dollar training values (`:758-788`). `src/services/patientEngagement.ts:366-372` hard-codes engagement rates as if they were measured. Both services are dead code. The only importer of `volunteerEngagement.ts` is `src/features/volunteers/VolunteerDashboard.tsx:2` and `:8`, which is itself unrouted. Nothing imports `VolunteerDashboard.tsx` or `patientEngagement.ts`, so Vite does not bundle any of them.

**How to add it.**
1. Run `grep -rn "volunteerEngagement\|patientEngagement\|VolunteerDashboard" src`. Confirm the only hits are inside the three files themselves.
2. Delete `src/features/volunteers/VolunteerDashboard.tsx` and the `src/features/volunteers/` folder, which will then be empty. Commit `6f3ffee` ("delete unrouted pharmacy and vitals screens") set the precedent for this.
3. Delete `src/services/volunteerEngagement.ts`. This also removes the inflated `livesImpacted` multiplier (`:173`). It also removes `submitVolunteerStory` (`:703-712`), which takes a story with no consent step, no approval step and no storage.
4. Delete `src/services/patientEngagement.ts`.
5. Remove the `volunteerEngagement.ts` row from the file table in `docs/archive/development-history/SYSTEM_CHECK.md:132`. Leave the other archived design notes alone. They are history and are not shown to users.
6. In `docs/legal/README.md`, add "whether to publish patient or volunteer stories" to the Foundation decision list at `:20`. Add "publish testimonials or stories" to the list under "Keeping the notice accurate" at `:34-41`. This puts the governance rule in writing.
7. Only if the owner later approves stories, build them as a separate change. Add a Supabase migration timestamped after `20260925100000`. It needs a table with consent, guardian-consent and approval columns. Give it one public SELECT policy limited to rows that are published, consented and approved, modelled on `supabase/migrations/20260813180000_public_read_upcoming_outreach.sql`. Limit writes with `public.app_is_staff()` (`supabase/migrations/20260924110000_rls_permission_helpers.sql:137`). Write the policies directly, because `20260924110400_rls_verify_phi_lockdown.sql` drops the `app_rls_policy` helper. When `isSupabaseEnabled` is false or the device is offline, show `src/components/ui/EmptyState.tsx`. Update `src/pages/legal/PrivacyPolicy.tsx` and `src/pages/legal/TermsOfUse.tsx` in the same commit.

**How to check it.**
- `npm run typecheck`, `npm run lint` and `npm run build` pass once the three files are gone.
- `npx vitest run` passes. No test imports the deleted files.
- `grep -rniE "testimonial|trusted by|Sarah Johnson|Featured in Newsletter|training value" src dist` returns nothing after a build.
- Manual: turn the network off, open `/` and `/patient`, and confirm that no quotes, ratings, logos or user counts appear.

**Decision needed.** The Foundation must decide whether it will ever publish patient or volunteer stories. If it will, the owner and a lawyer must set four things: the consent wording, how a guardian consents for a child, who approves each story, and how a person withdraws a published story.

**Risk if left.** Nothing fabricated is shown today. If someone routed the dormant stories, dollar values or certification promises, they could be misleading representations under the FCCPA 2018. Publishing a real patient's story without explicit consent would breach the NDPA 2023 rules on sensitive health data. Not legal advice.

### 12. Remove unsupported claims

**Status:** partial · **Priority:** P1 · **Effort:** M

**Where it stands.** Patient screens still call the portal "secure" (`src/features/patient-portal/account/AuthShell.tsx:59`, `src/features/patient-portal/PatientRegister.tsx:238`, `src/components/PatientForm.tsx:573`). Yet PHI on the device is plaintext, `encryption_v1` is set to `"off"` (`src/db/index.ts:1493`), and `installEncryptionHooks` (`src/db/encryptionHooks.ts:79`) is dead code. `PatientForm.tsx:605` promises "login instructions via email/SMS", but `enrollPatientInPortal` returns `invitationSent: false` (`src/services/unifiedPortalEnrollment.ts:158`) and nothing reads the `sendInviteNow` box (`PatientForm.tsx:636`). The SMS branch of the invitation code (`src/services/portalEnrollment.ts:246-268`) is now dead too: the rewritten `send-otp-sms` refuses any request that has no `otp` (`supabase/functions/send-otp-sms/index.ts:134-141`). The user guide claims SMS two-factor sign-in, encryption at rest, a 30-minute timeout and logging of record views (`docs/patient-portal/PATIENT_PORTAL_USER_GUIDE.md:63-98`, `:368-371`, `:385-395`), but `logAccess`, `requestOTP` and `verifyOTP` are stubs (`src/services/patientPortalAuth.ts:605-647`), and patients see "Basic TEFCA API endpoint" marked ready (`src/config/tefca.ts:91-95`, `src/features/patient-portal/HealthDataExport.tsx:478`).

**How to add it.**
1. Edit `AuthShell.tsx:59` to "Med Bridge Health Reach · Patient portal". Edit `PatientRegister.tsx:238` to "in one place".
2. Edit `PatientForm.tsx:573-575` to drop "secure" and "phone". Sign-in is by email only.
3. In `PatientForm.tsx` `onSubmit` (`:102-131`), call `enablePortalAccess(patientId, { termsAccepted, sendInviteNow })` from `src/services/portalEnrollment.ts` once `enrollPatientInPortal` succeeds. Do not call `sendPortalInvitation` alone: it fails at `portalEnrollment.ts:171-176` because the local `portalEnabled` flag is unset. When the result has `demoOTP`, show the copyable link using the panel in `src/components/PortalStatusCard.tsx:400-445`. The other option is to delete the checkbox at `:634-653` and say "No message is sent from here. Open the patient's record and use Send portal invitation."
4. Change the toast at `PatientForm.tsx:124-129` to "Portal account created. The patient still needs to register at /patient/register with an email and password."
5. Correct the registration steps in `portalEnrollment.ts:230` and `PortalStatusCard.tsx:456-458`. Delete the dead SMS text at `portalEnrollment.ts:254`.
6. In `src/pages/legal/PrivacyPolicy.tsx:55`, replace "a secure database" with plain facts: access is limited by role through row-level security (`supabase/migrations/20260924110100_rls_clinical_core.sql`), and mBHR does not encrypt records on staff devices.
7. Rewrite `PATIENT_PORTAL_USER_GUIDE.md:27`, `:55-100`, `:320-335`, `:366-395`, `:402-421` and `:425-435`. Remove SMS codes, two-factor, at-rest encryption and view/IP logging. Delete the 30-minute line, or make it true by running `src/utils/sessionManager.ts` and `src/components/SessionWarning.tsx` in `PatientPortalLayout.tsx` (an on-device timer, so it works offline). Make the same fixes in `PATIENT_PORTAL_SPEC.md:575`, `:597` and `PATIENT_PORTAL_IMPLEMENTATION.md:292-318`, `:499-518`.
8. Change `PatientPortalLanding.tsx:116` to "Menus and dashboard available in…". Or move the landing copy into `portal.landing.*` keys, render them with `useT` (`src/hooks/useT.ts`) and add `LanguageSelector`.
9. Remove the `TEFCA_ROADMAP` block from `HealthDataExport.tsx:466-497` and set phase1 `status` in `tefca.ts:91` to `"in-progress"`. Change `supabase/functions/tefca-ias/capability.ts:72` to "Bearer token required".
10. Qualify `README.md:7`, `:111` and `:116`, and add Pidgin at `:125`. Fix `scripts/acceptance.js:130`, `src/services/volunteerEngagement.ts:643` (NDPA, not HIPAA) and the comment at `src/features/doctor/unsentMessages.ts:7`.
11. Add `src/test/claims.test.ts` (new). It reads non-test `src/**/*.{ts,tsx}`, `src/i18n/locales/*.json`, `supabase/functions/**/*.ts` and `docs/patient-portal/*.md` with `node:fs`. It fails on `/\b(secure|encrypted|compliant|HIPAA|bank-grade|guaranteed?)\b|\b100\s?%(?!")/i`. Allow-list by file and matched text, with a reason (the SpO2 limit in `schemas.ts`, `ExportButtons.tsx`, `BulkFHIRExport.tsx`, `PrescriptionRefills.tsx`, `patient_secure_messages`).
12. Add the rule to "Keeping the notice accurate" in `docs/legal/README.md:34`.

**How to check it.**
- `npx vitest run src/test/claims.test.ts` passes. It fails if "Secure" goes back into `AuthShell.tsx`.
- Manual check, offline: register a patient with portal access and "send now" ticked. You see a copyable link, the record card shows access on, and no text mentions phone sign-in.
- `grep -nE "SMS code|Two-factor|at rest|support@mbhr" docs/patient-portal/PATIENT_PORTAL_USER_GUIDE.md` returns nothing.

**Decision needed.** The owner decides three things. Should "send now" be wired up or removed? Should the patient idle timeout be built or the claim dropped? What are the real support email and phone for the guide (see item 16)?

**Risk if left.** Telling patients, including parents of children, that records are secure, encrypted or protected by two-factor sign-in when they are not is a misleading representation under the FCCPA 2018. It also weakens the Foundation's position on transparency and security under the NDPA 2023 after any breach. Not legal advice.

### 13. Add accessibility alt text

**Status:** partial · **Priority:** P2 · **Effort:** M

**Where it stands.** Every `<img>` in `src` has an `alt` today. The patient record uses `` `Photo of ${fullName}` `` (`src/pages/PatientDetail.tsx:706`). The camera preview uses "Captured photo of the patient" (`src/components/PhotoCapture.tsx:167`). Both registration forms use a generic "Patient" (`src/components/PatientForm.tsx:215`, `src/components/SimplePatientForm.tsx:150`). The thumbnails next to a visible name correctly use `alt=""` (`src/features/tickets/TicketIssuer.tsx:292`, `src/components/PatientSearch.tsx:146`). The brand marks use `alt="" aria-hidden` (e.g. `src/components/Layout.tsx:420`, `src/pages/Login.tsx:476`, `src/pages/FirstRunSetup.tsx:113`). All alt text is hard-coded English. The only photo key is `patient.photo` (`src/i18n/locales/en.json:48`). `<html lang="en">` (`index.html:2`) never changes, and `src/i18n/index.ts:29-47` has no `languageChanged` handler. Nothing enforces any of this. `eslint.config.js:16-19` registers only `react-hooks` and `react-refresh`, and no test queries images. `docs/patient-portal/PATIENT_PORTAL_SPEC.md:658` claims "All images have descriptive alt text" with nothing to back it.

**How to add it.**
1. Add `eslint-plugin-jsx-a11y` (6.9 or later, for `flatConfigs`) to `devDependencies` in `package.json`.
2. In `eslint.config.js`, register it as `'jsx-a11y'` next to `'react-hooks'`. Turn on only `'jsx-a11y/alt-text': 'error'` and `'jsx-a11y/aria-props': 'error'`. Do not spread `flatConfigs.recommended.rules`. With `--max-warnings=0` (`package.json:10`), 12 `autoFocus` props, the backdrop `onClick` divs at `src/pages/DoctorDashboard.tsx:465` and `:477`, and alt text containing "photo" would all fail CI. A `'warn'` rule fails CI too.
3. Create `src/components/patient/PatientPhoto.tsx` (new), next to `PatientContextHeader`. Props: `photoUrl`, `name?`, `decorative?`. When `decorative` is set, render `alt=""`. Otherwise take the alt from `t()`.
4. Add `patient.photoAlt` and `patient.photoPreviewAlt` to `src/i18n/locales/en.json` next to `patient.photo`. Avoid the words "photo", "image" and "picture" (e.g. `{{name}}` and "Patient being registered") so `jsx-a11y/img-redundant-alt` can be turned on later.
5. Translate the new keys by hand in `ha.json`, `yo.json`, `ig.json` and `pcm.json`. `scripts/i18n-verify.ts:104-113` fills missing keys with `[EN] ` placeholders and still passes, so `npm run i18n:check` does not prove a translation exists.
6. Replace the `<img>` at `PatientDetail.tsx:704`, `PatientForm.tsx:213`, `SimplePatientForm.tsx:148` and `PhotoCapture.tsx:165` with `PatientPhoto`.
7. Replace the `<img>` at `TicketIssuer.tsx:290` and `PatientSearch.tsx:144` with `<PatientPhoto decorative />`.
8. Add explicit `aria-hidden` to the heroicons at `src/components/PullToRefresh.tsx:98`, `src/components/AudioButton.tsx:47`, and `PatientDetail.tsx:686` and `:695`. Leave `PatientSearch.tsx:151` and `src/components/PatientDedupeModal.tsx:236`/`:238` alone. Their wrappers are already hidden (`PatientSearch.tsx:150`, `PatientDedupeModal.tsx:231-234`).
9. Create `src/components/patient/PatientPhoto.test.tsx` (new). Import `@/i18n` (`src/i18n/index.ts`) and call `i18n.changeLanguage('en')`. Neither `src/test/setup.ts` nor `src/test/utils.tsx` sets up i18n. Without it the accessible name is the raw key.
10. Keep `lang` in step with the language only after the photo screens are translated. `PhotoCapture.tsx`, `PatientSearch.tsx`, `TicketIssuer.tsx` and `PatientDetail.tsx` have no `t()` calls. `PatientForm.tsx:227`, `:236` and `:243` are English. Then set `document.documentElement.lang` in `src/i18n/index.ts` after `init` and on `languageChanged`. If you sync it sooner, mark each untranslated block `lang="en"`.
11. Add an "Images" row to the Components table in `docs/development/DESIGN_SYSTEM.md:53-69`. Meaningful images use `PatientPhoto`. Decorative ones use `alt=""` and `aria-hidden`.
12. Reword `docs/patient-portal/PATIENT_PORTAL_SPEC.md:658` so it claims only what the lint rule and the test prove.

This change adds no data flow, so the privacy notice does not need to change.

**How to check it.**
- `npm run lint` passes. Delete one `alt` as a quick local test: `jsx-a11y/alt-text` fails. Then restore it.
- `npm run test:run` passes. `PatientPhoto.test.tsx` finds `getByRole('img', { name: /ada/i })` in meaningful mode. It finds `queryByRole('img')` is `null` in decorative mode.
- `grep '"\[EN\] ' src/i18n/locales/*.json` shows no `patient.photoAlt` or `patient.photoPreviewAlt` entries.
- Manual: open the patient record and registration in TalkBack with Hausa selected. Each photo is announced by the patient's name in Hausa. Search and ticket thumbnails are skipped.

**Risk if left.** Blind or low-vision patients and parents could lose access to health information as the UI changes. That could be raised under the Discrimination Against Persons with Disabilities (Prohibition) Act 2018. The unverified "all images have descriptive alt text" claim could also be read as misleading under FCCPA 2018. Not legal advice.

### 14. Fix your color contrast ratio

**Status:** partial · **Priority:** P1 · **Effort:** L

**Where it stands.** Text tokens pass AA. For example, `ink.muted` is 5.43:1 on white (`tailwind.config.js:63`), and every `*-fg` on its `*-soft` and the rail text also pass. Controls fail 3:1. `.input-field` and `.input` use `border-line-strong` (`src/index.css:209`, `:216`), which is `#C8CDC5` at 1.62:1 (`tailwind.config.js:55`). `docs/development/DESIGN_SYSTEM.md:30` sets that rule. Focus is weak too. The input ring is `ring-primary/40`, about 1.82:1 (`src/index.css:211`, `:218`), and the global outline (`src/index.css:150`) is 2.23:1 on the rail (`src/components/Layout.tsx:342-348`, `:466-487`). High-contrast mode (`src/index.css:413-437`) restyles four classes and nothing else. The `.dark` block (`:398-411`) is dead code. The toggle only shows below 768px or at 1024px and up (`Layout.tsx:448`, `:524`), never in the portal, and `src/main.tsx` never applies saved settings. CI has no contrast or axe step (`.github/workflows/build.yml:34-44`, `:114`). No tenant palette exists today.

**How to add it.**
1. In `tailwind.config.js`, add `line.control: '#858D87'` (3.41:1 on white). Mirror it as `--color-line-control` in the `:root` block of `src/index.css`.
2. Use `border-line-control` in `.input-field` and `.input`, and use `bg-line-control` for the off tracks at `AccessibilityControls.tsx:105` and `PortalStatusCard.tsx:346`. Do the same for `.btn`, `.btn-secondary` and `LanguageSelector.tsx:65` as best practice. Update `DESIGN_SYSTEM.md:30`.
3. Replace `focus:ring-primary/40` at `src/index.css:211` and `:218` with `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`.
4. After `src/index.css:150`, add `nav.bg-rail :focus-visible { outline-color: #E3EFE8 }` (10.29:1 on the rail).
5. Fix the comment at `tailwind.config.js:9-13` and `DESIGN_SYSTEM.md:32`. `critical.fg` is text on solid `critical`, not on `critical-soft` (1.24:1).
6. Map `ink.*`, `line.*`, `primary` and `*-fg` to `rgb(var(--…) / <alpha-value>)`. Rewrite `.high-contrast` to override those variables, and delete the no-op `--tw-*-opacity` lines.
7. Apply the same overrides under `@media (prefers-contrast: more)`. Add an `@media (forced-colors: active)` block that keeps outlines (`Highlight`) and control borders.
8. Delete the `.dark` block.
9. Export `loadSettings` and `applySettings` (`AccessibilityControls.tsx:36`, `:49`). Call them in `src/main.tsx` before `createRoot` (`:169`). Both read `localStorage`, so this works offline.
10. Change `Layout.tsx:524` to `hidden md:block`. Render `<AccessibilityControls />` beside `<LanguageSelector />` at `PatientPortalLayout.tsx:464`.
11. Localise the hard-coded labels in `AccessibilityControls.tsx`. Reuse the keys at `en.json:217-222`, add the missing ones in all five locales, and translate `ig.json:115`. `npm run i18n:check` only checks that keys exist.
12. Retire latent failures. Switch `getFlagColor` (`src/utils/vitals.ts:76-91`) to badge tokens and update `vitals.test.ts:215-220`. Delete the uncalled `getRoleColor` (`src/auth/roles.ts:224-245`) and the unimported `CarePlanManager.tsx`.
13. Create `scripts/contrast-check.ts` (new). It must import `tailwind.config.js` and must not write files. It asserts text pairs at 4.5:1 or more, and UI and focus pairs (including the high-contrast set) at 3:1 or more. Add the npm script `a11y:contrast`, then add a CI step after `build.yml:43-44`.
14. Move `bootApp`, `seedStaffUser` and `openLoginWithSeededUser` (`e2e/login.spec.ts:45`, `:64`, `:127`) into `e2e/helpers/firstRun.ts` (new) and export them.
15. Add `@axe-core/playwright`. Create `e2e/a11y.spec.ts` (new) to scan `/`, `/login`, `/privacy`, `/terms` and `/patient` with the `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa` tags. Run it once as normal and once with `mbhr-accessibility` set to `{"contrast":"high"}` via `addInitScript`. Add it to `build.yml:114`.
16. Link `PATIENT_PORTAL_SPEC.md:656` to these checks and tick `PATIENT_PORTAL_IMPLEMENTATION.md:404`.

**How to check it.**
- `npm run a11y:contrast` exits 0. It fails if `line.control` is set back to `#C8CDC5`.
- `npx playwright test e2e/a11y.spec.ts --project=chromium` reports zero violations in both modes.
- Manual: tab through the rail at 1280px and confirm the outline is visible. At 800px, the toggle is visible. Reload `/patient` with high contrast saved and confirm `<html>` has `high-contrast`. Emulate `forced-colors` in DevTools.

**Risk if left.** Faint input borders and near-invisible rail focus put low-vision staff and patients at a disadvantage, which cuts against the Discrimination Against Persons with Disabilities (Prohibition) Act 2018, and the "WCAG AA" claim at `PATIENT_PORTAL_SPEC.md:656` could be challenged as misleading under FCCPA 2018. Not legal advice.

### 15. Add keyboard navigation

**Status:** partial · **Priority:** P2 · **Effort:** M

**Where it stands.** A skip link exists at `src/components/Layout.tsx:396-401`, but its text is hard-coded English and its `<main>` target at `src/components/Layout.tsx:555-559` has no `tabIndex={-1}`. A global `:focus-visible` outline sits at `src/index.css:149-153`. The shared `useDialogFocus` (`src/features/appointments/useDialogFocus.ts:13-16`) traps and restores focus, but it runs only on mount (deps `[ref]` at `:85`) and only three appointment and televisit dialogs use it. These modals handle Escape only, with no Tab trap: `src/components/PatientDedupeModal.tsx:135-137`, `src/components/PhotoCapture.tsx:139-141`, `src/features/patient-portal/PreVisitForms.tsx:125-130`, `src/features/pharmacy/PharmacyStock.tsx:874-876`, `:1046-1048`, `:1171-1173` and `src/pages/PatientDetail.tsx:946-948`. Other gaps remain: the closed phone drawer (`src/components/Layout.tsx:412-418`) is only moved off-screen, so its links stay tabbable; the Queue stage tabs (`src/pages/Queue.tsx:404-447`) have no arrow keys; the shortcuts in `docs/guides/QUICK_REFERENCE.md:182-185` and `docs/guides/USER_GUIDE.md:494-497` do not exist; no test presses a key; and `PatientFlagsPanel.tsx`, `SessionWarning.tsx` and `BottomSheet.tsx` in `src/components` are dead code.

**How to add it.**
1. Move `useDialogFocus.ts` to `src/hooks/useDialogFocus.ts`. Update its three importers: `AppointmentFormDialog.tsx:21`, `CancelAppointmentDialog.tsx:3` and `ScheduleTelevisitDialog.tsx:14`.
2. Add a third parameter, `active = true`. Return early when it is false, and change the deps at `:85` to `[ref, active]`.
3. In `PatientDedupeModal.tsx`, replace the effect at `:48-50` and the `onKeyDown` at `:135-137` with `useDialogFocus(dialogRef, () => { if (!loading) onCancel(); })`.
4. In `PhotoCapture.tsx`, add a ref to the dialog `div` at `:134`. Replace `:139-141` with `useDialogFocus(ref, handleCancel)`.
5. In `PreVisitForms.tsx`, call the hook with `active = showFormModal`. Delete the effect at `:94-100` and `onDialogKeyDown` at `:125-130`. Mark the first field `data-autofocus`.
6. In `PharmacyStock.tsx`, give the dialogs at `:870`, `:1042` and `:1166` a ref each. Call the hook with `active` set to `showAddItem`, `showAddBatch` and `!!deleteTarget`, keeping each "not while saving" guard in `onEscape`.
7. Do the same for the alertdialog at `PatientDetail.tsx:940`, with `active = showDeleteConfirm`.
8. In `Layout.tsx`, read `isMobile` from `src/hooks/useMobile.ts`. In an effect, call `navRef.current.toggleAttribute("inert", isMobile && !mobileMenuOpen)` on the `<nav>`. React 18.3 has no boolean `inert` prop.
9. For the open drawer, call `useDialogFocus(navRef, close, isMobile && mobileMenuOpen)`, or `usePanelFocus` (`src/features/doctor/usePanelFocus.ts:16-21`). Focus returns to "Open navigation" at `:499-504`. Never use a mount-only trap here: the nav is always mounted, so it would trap Tab on desktop.
10. Add `tabIndex={-1}` and `focus:outline-none` to `<main>` at `Layout.tsx:555`, matching `PatientPortalLayout.tsx:577`.
11. Replace the skip-link text at `Layout.tsx:400` with `t("nav.skipToContent")`. Add the key to all five `src/i18n/locales` files and run `npm run i18n:check`.
12. Render the Queue stage tabs through `src/components/ui/Tabs.tsx`. Its `label` accepts a `ReactNode` (`Tabs.tsx:4-9`), so the stage counts can move into it.
13. In `StepperForm.tsx`, add a ref and `tabIndex={-1}` to the `<h2>` at `:140`. Focus it when `currentStep` changes, skipping the first render, as `PharmacyOverlay` does at `Layout.tsx:50-52`.
14. Return focus to the trigger on Escape in `SyncStatusControl.tsx:61` and `ActiveSiteControl.tsx:25`, copying `LanguageSelector.tsx:54-56`.
15. Delete the `Ctrl` rows at `QUICK_REFERENCE.md:182-185` and `:349-351` and at `USER_GUIDE.md:494-497`. Keep `Esc`.
16. Add `src/hooks/useDialogFocus.test.tsx` (new) using `@testing-library/user-event` and `src/test/utils.tsx`.
17. Move `bootApp`, `seedStaffUser` and `openLoginWithSeededUser` from `e2e/login.spec.ts:45-133` into `e2e/helpers/firstRun.ts` (new), the file item 14 creates.
18. Add `e2e/keyboard.spec.ts` (new) and list it in the smoke step at `.github/workflows/build.yml:114`.

**How to check it.**
- `useDialogFocus.test.tsx` passes. It checks: `[data-autofocus]` gets initial focus; Tab and Shift+Tab wrap; Escape is ignored on an `aria-expanded="true"` target; focus returns on unmount; and the trap starts when `active` flips to true after mount.
- `keyboard.spec.ts`, signed in as the seeded admin: the first Tab focuses the skip link, and Enter focuses `#main-content`. On `/rx/stock`, "Add medicine" keeps Tab inside the dialog, and Escape returns focus to the button. A `test.use({ ...devices["Pixel 5"] })` block shows the closed drawer's links are unreachable. CI runs only `--project=chromium`, so the viewport must be set inside the spec.
- Manual: on the Queue page, Arrow, Home and End keys move between stages.

**Risk if left.** Dialogs that leak focus and a hidden but focusable nav drawer can block keyboard and switch users, or lead them to act on the wrong child's record. That invites complaints under the Discrimination Against Persons with Disabilities (Prohibition) Act 2018 and strains the NDPA 2023 accuracy principle. Not legal advice.

### 16. Add your business details

**Status:** partial · **Priority:** P1 · **Effort:** M

**Where it stands.** The trade name "Dr. Isioma Okobah Foundation" appears at `src/pages/Home.tsx:34`, `src/pages/legal/PrivacyPolicy.tsx:13-14`, `src/pages/legal/TermsOfUse.tsx:10-11`, `src/features/patient-portal/PatientPortalLanding.tsx:318` and `supabase/functions/send-otp-email/index.ts:129`. No surface shows a registered name, CAC number, address, email or phone. The privacy notice only says "contact the Dr. Isioma Okobah Foundation" (`PrivacyPolicy.tsx:106-108`), and `docs/legal/README.md:20-23` still lists the privacy contact as an open decision. `LegalPage.tsx:11-39` has no footer. `AuthShell.tsx:58-60` and the staff `LoginShell` (`src/pages/Login.tsx:455-488`) show no operator at all, and `PatientPortalLayout.tsx` has no footer. `env.VITE_ORGANIZATION` (`src/config/env.ts:29`) is dead: no component reads it, while `src/config/tefca.ts:29` reads the raw variable with a different fallback. The translated key `app.subtitle` (`src/i18n/locales/en.json:282`) is also dead.

**How to add it.**
1. Record the Foundation's answers in `docs/legal/README.md:20-23`.
2. In `src/config/env.ts`, add `VITE_OPERATOR_LEGAL_NAME`, `VITE_OPERATOR_REG_NO`, `VITE_OPERATOR_ADDRESS`, `VITE_OPERATOR_EMAIL` and `VITE_OPERATOR_PHONE` to `envSchema` after `:29`. List each one in `readRaw()` (`:54-61`) too. Vite replaces `import.meta.env` statically, so a missing key silently falls back to its default.
3. Declare the keys in `src/vite-env.d.ts` next to `:10`, and add them to `.env.example` after `:33`.
4. Create `src/config/operator.ts` (new). It exports one `OPERATOR` object built from `env`. Point `src/config/tefca.ts:29` at it.
5. Create `src/pages/legal/OperatorDetails.tsx` (new). Give it a full `<address>` variant (legal name, "CAC reg. no.", address, `mailto:` and `tel:` links) and a one-line strip. It reads only `OPERATOR`, never Supabase, so it works offline.
6. In `LegalPage.tsx`, add a `<footer>` after `</main>` (`:36`) that renders the full block.
7. In `PrivacyPolicy.tsx`, add a "Who we are and how to contact us" `LegalSection` before `:19` that names the controller. Replace `:106-108` with the privacy email and phone. Bump `updated` at `:11`.
8. Name the legal entity in `TermsOfUse.tsx:10-11` and bump `updated` at `:7`.
9. Render the strip in `Home.tsx:78`, `PatientPortalLanding.tsx:317-319` and `AuthShell.tsx:58-60`. Put the email and phone in `PatientPortalLanding.tsx:335-338`.
10. In `LoginShell` (`Login.tsx:455-488`), add a footer below `{children}` with Privacy and Terms links and the strip.
11. In `PatientPortalLayout.tsx`, add a footer after `{children}` inside `<main>` (`:575-581`), so the `pb-24` padding keeps it above the mobile nav. The file uses `t()`, so add the new keys to all five `src/i18n/locales/{en,ha,yo,ig,pcm}.json` files. Reuse `app.subtitle`.
12. In `send-otp-email/index.ts`, read `OPERATOR_CONTACT_EMAIL` and `OPERATOR_CONTACT_PHONE` next to `:60-61`. Use them at `:126`, in the footers at `:129` and `:157`, and in the plain-text body at `:135`.
13. Replace `support@mbhr.health`, `feedback@mbhr.health` and `[Support Phone Number]` in `docs/patient-portal/PATIENT_PORTAL_USER_GUIDE.md:406-407,420` and `docs/patient-portal/PATIENT_PORTAL_ACCESS_GUIDE.md:242-243,425`.
14. Multi-tenant: do this only when a second organisation goes live. Add `supabase/migrations/20260926000800_org_legal_identity.sql` with typed identity columns on `organizations` (`20251028120000_add_multi_tenant_foundation.sql:79-89`). Cache the row in Dexie, show it beside the platform operator through a `tenant` prop, and name it in the privacy notice. Until then, the one `OPERATOR` covers both platform and tenant.
15. Create `src/pages/legal/LegalPage.test.tsx` (new). It renders both legal pages through `render` from `src/test/utils.tsx`, with `@/config/operator` mocked. Extend `src/pages/Login.test.tsx` to assert the new links.

**How to check it.**
- `npx vitest run src/pages/legal/LegalPage.test.tsx src/pages/Login.test.tsx` passes.
- `npm run i18n:check` passes (`.github/workflows/build.yml:43-44`).
- Build with real values and load the app once. Go offline, then open `/`, `/login`, `/patient`, `/patient/login`, `/privacy`, `/terms` and one signed-in portal page. Each one shows the operator.
- Send a code from `src/pages/admin/EmailDiagnostics.tsx`. Confirm that both the HTML and the plain-text email show the contact.
- `grep -rn "Support Phone Number" docs/patient-portal` returns nothing.

**Decision needed.** The Foundation must confirm five things: the exact registered name, the CAC registration number, the registered address, a monitored privacy email and a phone number. It must also say whether it owns `mbhr.health`, and whether any host partner counts as a separate operator.

**Risk if left.** Patients and parents cannot identify or reach the controller of their children's health records. That falls short of the transparency duties in the NDPA 2023 and GAID, and of the identification norms in CAMA 2020 and the FCCPA 2018. Not legal advice.

### 17. Get age consent if you collect kids' data

**Status:** missing · **Priority:** P0 · **Effort:** L

**Where it stands.** The app holds children's records: `src/services/smartMedication.ts:383` doses by `age < 18`, and `src/components/SimplePatientForm.tsx:226` accepts any age from 1. No code checks for a minor or stores a guardian, and `src/validation/schemas.ts:17-27` only requires a past DOB. A portal account can claim a child's record by email (`src/hooks/useAuth.ts:151-160`), by contact plus DOB (`src/services/patientPortalAuth.ts:193-225`, `319-345`), or through the new, not yet called `portal_link_patient_record` (`supabase/migrations/20260924110300_rls_patient_portal.sql:686`). The "add a child" dialog asks for no attestation (`src/features/patient-portal/CaregiverSetup.tsx:391-427`), and the notice says only "any caregiver you add" (`src/pages/legal/PrivacyPolicy.tsx:68`).

**How to add it.**
1. Add `isMinor(dob, now, threshold = 18): boolean | null` beside `patientAge` in `src/utils/patient.ts:9`. Treat `null` (no DOB) as "needs review".
2. Create `supabase/migrations/20260926000400_add_patient_guardians.sql` (new) with `patient_guardians`: `patient_id` (FK, cascade), `guardian_name`, `guardian_phone`, `relationship` (`parent`, `legal_guardian`, `other_authorised`), `guardian_portal_user_id`, `verified_by_staff`, `verified_at`, `consent_record_id` (FK to `patient_consent_records`), timestamps and `revoked_at`.
3. In it, enable RLS, revoke `anon`, and write policies with `app_is_staff()`, `app_has_permission('register')` and `app_portal_patient_ids()`. Write `CREATE POLICY` directly: `app_rls_policy` was dropped at `20260924110400_rls_verify_phi_lockdown.sql:101`.
4. Do not recreate `check_auto_enrollment()` (`20260115072241_add_portal_enhancements_v3.sql:540-589`). Item 9 drops it and its trigger in `20260926000200_consent_defaults_off.sql`, so no patient, adult or minor, is enrolled automatically.
5. In it, replace `portal_link_patient_record` so it returns `needs_staff_verification` for a minor's record and never self-creates one for a minor `p_dob`. **Done early**, in its own migration, `20260926000210_portal_link_adults_only.sql`.
6. Store the consent in the existing `patient_consent_records` as `consent_type = 'guardian_consent'`. Staff with `register` can already insert there (`20260924110300_rls_patient_portal.sql:330-332`).
7. Add `patientGuardians` (`id, patientId, _dirty, _syncedAt`) to the Dexie `version(19)` that item 6 adds after `src/db/index.ts:1505`. Keep consent rows in item 6's `consents` table.
8. Register both in `src/sync/adapter.ts` (`Tbl` 54, `mapToDB` 94, `tables` 394, `localTableMap` 410), with `patient_consent_records` in `APPEND_ONLY` (77).
9. Create `src/services/guardianConsent.ts` (new). Its `recordGuardianConsent()` writes both rows in one Dexie transaction with `_dirty: 1` and never calls Supabase.
10. Refine `patientSchema` (`src/validation/schemas.ts:10`) to require `guardianName`, `guardianRelationship` and `guardianConsent === true` when `isMinor(dob)`.
11. In `src/components/PatientForm.tsx`, show a guardian block after DOB (341-367) for minors and call `recordGuardianConsent()` on submit.
12. For minors in the same form, give the attestation (615-631) guardian wording and skip the auto-enable (53-61) and `enrollPatientInPortal` (103).
13. In `src/components/SimplePatientForm.tsx`, allow age 0 (226) via a months field, add a guardian step when `formData.age < 18`, and add its keys to all five `src/i18n/locales` files.
14. In `src/features/patient-portal/PatientRegister.tsx`, require DOB in `onlineSchema` (28-32) and `offlineSchema` (54-59) and block minors, pointing to "People you care for".
15. Refuse links when the matched record's own `dob` is a minor's: `canLinkPatient` (`src/hooks/useAuth.ts:160`), and registration (193-225) and login fallback (319-345) in `patientPortalAuth.ts`.
16. Add a required, unticked attestation to the `ConfirmDialog` in `CaregiverSetup.tsx` (391-427), and disable "Add to my account" until ticked.
17. In `addManagedPatient` (`patientPortalAuth.ts:551-592`), set `_dirty: 1` (the row never syncs today) and call `recordGuardianConsent()`.
18. Exclude minors from `isEligibleForAutoEnrollment` (`src/services/autoEnrollment.ts:103-123`), `findEligiblePatients` (`src/services/portalEnrollment.ts:458-490`) and the bulk `termsAccepted: true` default (528).
19. Make the planned `set_patient_portal_access` RPC (`src/db/migrations/backfillPlans.ts:8`, no server function yet) refuse minors without a verified guardian.
20. Add a "Guardians" panel to `src/pages/PatientDetail.tsx` beside `PortalStatusCard` (930), not inside it, for staff verification.
21. At portal login, on the device, ask a guardian-linked patient who has turned 18 for their own consent, then set `revoked_at` on the link.
22. In the same commit, add a "Children and people who cannot consent for themselves" section to `src/pages/legal/PrivacyPolicy.tsx`, bump `updated` (line 11), add guardian wording to `src/pages/legal/TermsOfUse.tsx:28-35`, and update `docs/legal/README.md:18`.

**Done in the code (lane mA).** Steps 1, 5, 14 and 15 are done, and part of step 22.
- `isMinor` and `ADULT_AGE` are in `src/utils/patient.ts`. `patientAge` reads a date of birth as a calendar day.
- Portal sign-up requires a date of birth, online and offline, and refuses anyone under 18.
- After the merge with `mainone`, online sign-up is linked to a clinic record by the server (`portal_link_patient_record`, called through `src/services/portalSignIn.ts`). It refuses a child's record and never creates a record for an under-18 date of birth (migration `000210`), and the app shows its `needs_staff_verification` answer as "ask clinic staff". The email lookup, offline registration and the date-of-birth login refuse a child's record too.
- Staff cannot turn on portal access, send an invitation or enrol a child's record (`enablePortalAccess`, `sendPortalInvitation`, `enrollPatientInPortal`, `canEnrollInPortal`). The record page offers no invitation or link for a child. The registration form and both admin pages leave children out, and the bulk server page filters them before its 100-row limit. Turning access off still works for a child. This covers steps 12 and 18.
- These staff-side refusals are in the app only. `mainone`'s `set_patient_portal_access` and `portal_invitation_begin` do not check age on the server yet (step 19).
- Step 4 holds in effect: the auto-enrolment trigger is kept but switched off by its setting (item 9).
- The privacy notice has a "Children" section.

A record with no date of birth still links, and existing links and existing access are unchanged. Everything to do with guardians waits on the guardian decision: steps 2 to 4, 6 to 11, 13, 16, 17 and 19 to 21, and the terms wording in step 22.

**How to check it.**
- `npm run test:run` with new cases: 17 years 364 days and exactly 18 (`src/utils/patient.test.ts`), a minor without a guardian (`src/validation/schemas.test.ts`), and a blocked minor (`src/services/autoEnrollment.test.ts`, `src/features/patient-portal/PatientRegister.test.tsx`).
- New `src/features/patient-portal/CaregiverSetup.test.tsx`: Confirm stays disabled until ticked, and saved rows carry `_dirty: 1`.
- After `supabase db reset`, insert a 10-year-old with a phone. Check `portal_enabled` is false and `has_table_privilege('anon', 'public.patient_guardians', 'SELECT')` is false.
- `npm run test:e2e` with a minor registered offline in `e2e/patient-registration.spec.ts`.

**Decision needed.** A lawyer should confirm the age threshold (18 under the Child Rights Act 2003), whether older teens may consent to some care alone, what proof of guardianship staff accept, and the attestation wording.

**Risk if left.** Holding children's health data with no age check or recorded parent or guardian consent is unlikely to meet section 31 of the NDPA 2023 or the NDPC GAID, and exposes the Foundation to NDPC enforcement. Not legal advice.

### 18. Add an unsubscribe link to your emails

**Status:** partial · **Priority:** P0 · **Effort:** L

**Where it stands.** No email has an unsubscribe link or a `List-Unsubscribe` header. Both footers say only "automated message" (`supabase/functions/send-otp-email/index.ts:128-131`, `:156-159`), and the Resend body has no `headers` (`:172-178`). That function checks callers only by IP (`:18-23`) and sends any subject and message it is given (`:44-45`). Since the audit, `send-sms-reminder` requires signed-in SMS staff (`supabase/functions/send-sms-reminder/index.ts:100`), but it still calls `sendSms` (`:285`) without an opt-out check, and nothing receives STOP replies. Opt-outs are checked only when a reminder is queued (`src/services/messaging.ts:72-74`, `:109-111`), not in the send loops (`src/services/notificationWorker.ts:292-356`, `:358-418`, `:470-547`, `:693-744`). A pulled `false` is also ignored, because `src/services/enhancedSync.ts:564-565` keeps the boolean while `src/services/reminderEligibility.ts:35` tests `=== 0`. Portal choices reach no sender (`src/features/patient-portal/ManageAccount.tsx:284-287`), and `src/services/preferences.ts:113-125` is dead code.

**How to add it.**
1. Create `supabase/functions/_shared/messaging/categories.ts` (new). It holds `MessageCategory` (`transactional`, `care_reminder`, `service`, `promotional`), a category for every template key and device key, and `reminderKindForTemplateKey`. Re-export it from `src/services/messageTemplates.ts` the way `src/services/fhir/types.ts:9` does.
2. Create `supabase/migrations/20260926000500_message_categories_and_suppressions.sql` (new), using the header and rollback style of `20260910161049_add_televisits.sql`. Add `category` to `message_templates` and `medication_reminders`. Add `cancelled` and `suppressed` to the status CHECK at `20251024000000_add_advanced_features.sql:106`. Leave `outbound_messages` alone.
3. In the same migration, create `message_suppressions` (`channel`, `address`, `patient_id`, `scope`, `source`) with RLS. Only `service_role` writes; `public.app_is_staff()` reads.
4. In the same migration, add `patient_id` to `patient_portal_preferences` with an owner policy on `public.app_portal_patient_ids()` (`20260924110000_rls_permission_helpers.sql:168`). The upstream RLS change (`20260924110300_rls_patient_portal.sql:138-144`) accepts the auth uid, but `ManageAccount.tsx:151` still writes it into a foreign key to `patient_portal_users(id)`. Add a trigger that copies `sms_reminders = false` into `patient_preferences` and `message_suppressions`.
5. In `send-sms-reminder/index.ts`, accept `category`. Before `sendSms` (`:285`), refuse suppressed or opted-out non-transactional sends with `error: "suppressed"`. Send promotional traffic on Termii `generic`, not the `dnd` default (`_shared/sms/provider.ts:45`).
6. In `notificationWorker.ts`, run `reminderSkipReason` on the Dexie preference before each `sendSMS` call (`:294`, `:377`, `:497`, `:721`). Use `reminderKindForTemplateKey`, because `outboxTemplateFor` returns kind `text`. On `opted_out`, write `status: "cancelled"`. Pass `category` in the body (`:176-180`). This check works offline.
7. Add a `patient_preferences` case to `transformPulled` (`src/sync/adapter.ts:340`) that maps the reminder booleans to 1 or 0, as `:349` does for `portal_enabled`. Do the same at `enhancedSync.ts:564-565`.
8. In `src/services/televisits.ts:757-766`, send the session token, `patientId` and category `transactional`. The anon key it sends now gets a 401.
9. In `src/services/portalEnrollment.ts:247-256`, send the invitation through `send-sms-reminder` as `service`. `send-otp-sms` now rejects it (`send-otp-sms/index.ts:134-152`).
10. Create `supabase/functions/sms-inbound/index.ts` and `supabase/functions/_shared/sms/keywords.ts` (new). Check `SMS_INBOUND_SECRET`, parse STOP and START in all five locales, and write the suppression.
11. Add a STOP line or a preferences link to non-transactional bodies in `scripts/seed/data/messageTemplates.ts` and `FALLBACK_BODIES`. Seed with `ON CONFLICT (key, locale, channel) DO UPDATE`.
12. In `send-otp-email/index.ts`, replace free-form mode with `kind` (`otp`, `portal_invitation`). Call `requireStaff` (`_shared/security/staffAuth.ts:85`), check `otp` with `validOtp`, and escape the values at `:120` and `:138`. Keep `src/pages/admin/EmailDiagnostics.tsx:137-141` working.
13. For `portal_invitation`, check suppressions and sign a token with `UNSUBSCRIBE_SIGNING_KEY`. Send the `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, and add a visible footer link.
14. Create `supabase/functions/email-unsubscribe/index.ts` (new). It handles a one-click POST with no login, and a GET that redirects to `/unsubscribe`.
15. Create `src/pages/legal/Unsubscribe.tsx` (new) on `LegalPage`, and route it beside `/privacy` (`src/App.tsx:413`).
16. In the same commit, add the Twilio fallback to `src/pages/legal/PrivacyPolicy.tsx:71` and describe STOP and the email link at `:106`. Document the new secrets in `docs/deployment/SMS_SETUP_TERMII.md` and `docs/deployment/EMAIL_SETUP_GUIDE.md`.
17. Remove the disclaimer at `ManageAccount.tsx:284-287`, and hide "Email reminders".

**Done in the code (first pass, no migration).** Step 6 and the device half of step 7 are done. `reminderSkipReason` now treats a pulled `false` as an opt-out, as it already did `0` (`src/services/reminderEligibility.ts`, `isReminderOptedOut`), and `ScheduleReminderForm` blocks it too. `notificationWorker.ts` reads the patient's setting on this device right before each of its four send paths. An opted-out reminder in the device outbox or queue ends `cancelled` and is never sent. After the merge with `mainone` (`ccc25eb`), the device no longer writes a server `medication_reminders` row: only the `send-sms-reminder` function records its outcome. So an opted-out server reminder is skipped on the device in each run and stays pending on the server; Send now refuses it and writes nothing. When the setting cannot be read, the reminder is held, not sent. `reminderKindForTemplateKey` and `TRANSACTIONAL_TEMPLATE_KEYS` live in `src/features/notifications/smsOutbox.ts`, so codes and televisit links are never suppressed. `mainone` did step 9: invitations go through `send-sms-reminder` with purpose `portal_invitation` (`57ae804`). Step 12 is done: `mainone` replaced the free-form mode with a purpose (`portal_invitation`), and this branch's rules keep the code email admin only, check the code with `validOtp` and escape every value (see [Fix these first](#fix-these-first)). The server side is still open: steps 1 to 5, 8, 10 and 11. So are the email headers, the unsubscribe page and STOP handling in steps 13 to 17, which wait on the decision below. `send-sms-reminder` does not check opt-outs itself yet (step 5).

**How to check it.**
- `src/services/notificationWorker.test.ts`: a reminder for an opted-out patient ends `cancelled` and `fetch` is never called. Cover a local opt-out and one pulled as `medication_reminders: false`.
- Vitest suites for `keywords.ts`, the token helper, and category coverage of every key.
- Deno tests: `send-sms-reminder` returns `suppressed`, and `send-otp-email` rejects anon callers and a non-numeric `otp`.
- POST a fixture token to `email-unsubscribe`, then query `message_suppressions` for the new row.
- `e2e/unsubscribe.spec.ts` (new) opens `/unsubscribe?t=<fixture>` and checks the confirmation.

**Decision needed.** Replies to an alphanumeric sender ID may never reach a webhook. The owner must choose a two-way number or a preferences link only. The owner must also decide whether `outreach_announcement` should ever be sent (nothing sends it today) and approve the STOP words in each language.

**Risk if left.** Patients who opted out still get health texts, and unlabelled promotional texts can go out. That invites complaints under the NDPA 2023 right to object, the NDPC GAID direct-marketing rules and the FCCPA 2018. Not legal advice.

### 19. License any fonts and images you use

**Status:** partial · **Priority:** P2 · **Effort:** M

**Where it stands.** Fonts are fine but undocumented: the app uses only the system stack (`src/index.css:116-121`) and the CSP blocks outside fonts (`vercel.json:24`). The repo has no `LICENSE` or attribution file, `README.md:227-229` states no licence, and the SVGs in `public/brand/` record no owner (`nigeria-flag-stripe.svg` there is unused). State outlines load from the third-party repo `iamspruce/intro-d3` with no recorded licence (`public/nigeria-loader.js:193-196`). The favicon `/vite.svg` (`index.html:5`) and the PWA icons named at `vite.config.ts:186-190` do not exist, and every file under `public/audio/` is a text placeholder (`public/audio/ha/auth_login.mp3:1`). The only upload term is `src/pages/legal/TermsOfUse.tsx:32-35`, and `src/features/patient-portal/DocumentUpload.tsx:300-304` does not link it.

**How to add it.**
1. Create `ATTRIBUTION.md` (new) at the repo root: path, what it is, source, licence, permitted use, proof. Add rows for the brand SVGs (Claude Design output for the Foundation, commit `236e191`), the in-house fallback polygon `FB` (`public/nigeria-loader.js:3-43`), the boundary data, the audio placeholders (`en`, `ha`, `yo`, `pcm`), `@heroicons/react` (MIT), the PWA icons, and "system fonts only" citing `src/index.css:116-121` and `vercel.json:24`.
2. Delete `public/brand/nigeria-flag-stripe.svg`, or give it a row.
3. Create `LICENSE` (new) and replace `README.md:227-229` with links to `LICENSE` and `ATTRIBUTION.md`.
4. Check the licence and origin of `nigeria_state_boundaries.geojson` in `iamspruce/intro-d3`. If it is not clearly open, commit an openly licensed set as `public/geo/nigeria-states.json` (new).
5. Point `SRCS` in `public/nigeria-loader.js:193-196` at `/geo/nigeria-states.json`.
6. Add `json` to `globPatterns` at `vite.config.ts:133` so the file is precached for offline use.
7. Delete the jsdelivr `runtimeCaching` block at `vite.config.ts:165-177`, drop `cdn.jsdelivr.net` and `cdn.statically.io` from `connect-src` in `vercel.json:24`, and fix the "fonts" wording in `docs/architecture/CACHING_STRATEGY.md:37`. If item 1 has named jsDelivr and Statically in the privacy notice, remove them in the same commit.
8. Export `public/pwa-192x192.png`, `public/pwa-512x512.png` and `public/pwa-512x512-maskable.png` (new) from `public/brand/mbhr-mark.svg`. Point `index.html:5` at `/brand/mbhr-mark.svg`.
9. Add "Recording and licensing audio prompts" to `docs/development/MULTILINGUAL_GUIDE.md` after line 159. Require a signed voice release or the TTS vendor's output licence before real audio replaces a placeholder. Rule out recording browser `speechSynthesis` (`scripts/generate-audio-prompts.ts:18-20`).
10. Expand `TermsOfUse.tsx:32-35`: the uploader confirms they have the right to share the file and that it is lawful, lets the Foundation store it and share it with treating clinicians, and accepts that it may be removed. Bump `updated=` on line 7.
11. Add a Staff use bullet after `TermsOfUse.tsx:47`: photograph patients only with consent, as `src/pages/legal/PrivacyPolicy.tsx:24` promises. The live flows are `src/components/PatientForm.tsx:701-705` and `src/components/SimplePatientForm.tsx:166`; `src/utils/photoStorage.ts:15` is dead code.
12. In `DocumentUpload.tsx`, add a required "I have the right to share this document" checkbox at lines 300-304 with a `<Link to="/terms">`, as in `src/features/patient-portal/account/ExportParts.tsx:32`. Disable upload until ticked. Staff-enrolled patients never see the terms otherwise: `src/components/PortalStatusCard.tsx:141` and `src/services/portalEnrollment.ts:528` hardcode `termsAccepted: true`.
13. Correct `docs/legal/README.md:4-5`, which says every patient accepts the terms at signup.
14. Add `rollup-plugin-license` to `plugins` at `vite.config.ts:128` to emit `dist/third-party-licenses.txt`.
15. Add a licence step after "Security audit" in `.github/workflows/build.yml:57-58` allowing MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD and Zlib. Record `jszip` (`package-lock.json:7546`) as used under MIT.
16. Add `src/test/assetAttribution.test.ts` (new): take `Object.keys(import.meta.glob('/public/**/*.{svg,png,ico,mp3,json,js}'))`, import `/ATTRIBUTION.md?raw`, and assert each path minus `/public` appears.
17. Link `ATTRIBUTION.md` from `docs/README.md:43-45` and `docs/legal/README.md`, and add assets and upload terms to the lawyer-review list.

**How to check it.**
- `npx vitest run src/test/assetAttribution.test.ts` passes, then fails after adding an unlisted `public/test.svg`.
- The CI licence step fails when a GPL-only package is added.
- `npm run build && npm run preview`: DevTools lists three manifest icons without errors. Offline, the loader still draws state outlines and nothing requests `cdn.jsdelivr.net`.
- Manual: portal upload stays disabled until the rights box is ticked, and `/terms` shows the new bullets.

**Decision needed.** The Foundation must choose the project licence, confirm it owns the Claude Design brand output, and pick the boundary dataset and a voice or TTS supplier. A lawyer should approve the upload clause.

**Risk if left.** Map data, brand art and future audio with no recorded licence invite claims under the Copyright Act 2022, and thin upload terms leave the Foundation carrying infringing uploads and weaken its terms under the FCCPA 2018. Not legal advice.

### 20. Add a data deletion request option

**Status:** partial · **Priority:** P1 · **Effort:** L

**Where it stands.** The privacy notice promises deletion "where the law allows" but gives no contact and no in-app path (`src/pages/legal/PrivacyPolicy.tsx:94-109`). Nothing records requests. The only erasure path is the admin delete (`src/pages/PatientDetail.tsx:257-305`). It skips `queue` and most other tables, and it runs the cloud deletes in parallel (`:272-278`), so a partial cloud copy can remain. The server now allows only admins to delete (`supabase/migrations/20260924110100_rls_clinical_core.sql:85-86`), but three rules still block full erasure:
- every delete now writes a snapshot to `resource_versions` (`:48-56`);
- `queue_transitions` refuses all deletes (`20260924120000_add_queue_transitions_audit.sql:105-127`);
- deleting a surviving record un-merges its merged copies (`20260925100000_sync_authority_foundation.sql:300-327`).

Sync never deletes rows on pull and uploads with upsert (`src/sync/adapter.ts:930-966`, `:777`), so another device can re-create an erased record.

**How to add it.**
1. Create `supabase/migrations/20260926000600_add_data_subject_requests.sql` (new) with a `data_subject_requests` table: type, status, channel, `legal_hold`, and decision and completion fields. Write plain `CREATE POLICY` statements, because the `app_rls_policy` helper was dropped (`20260924110400_rls_verify_phi_lockdown.sql:101-102`). Portal rows use `app_portal_patient_ids()`. Staff reads use `app_is_staff()`. Updates use `app_has_permission('users')`.
2. In the same file, add a `record_data_subject_request(p_command_id uuid, ...)` RPC built on `app_command_record` (`20260925100000_sync_authority_foundation.sql:236-293`).
3. Add a "Record a deletion request" button next to Delete (`src/pages/PatientDetail.tsx:421-428`). Queue it with `enqueueCommand` (`src/sync/commandOutbox.ts:315`) so it works offline.
4. Create `src/features/patient-portal/DeletionRequest.tsx` (new) using `account/ConfirmDialog.tsx`. Route it next to `/export` (`src/App.tsx:491-494`). Link it from `PortalHome.tsx:171-178` and from a new tab in `ManageAccount.tsx:29-33`. When offline, hold it with `messageQueue.ts`. Add its `t()` keys to all five `src/i18n/locales/*.json` files.
5. Create `src/pages/admin/DataRequests.tsx` (new) behind `RequireRoles` (admin) in `src/App.tsx`. Add a matching `needsServer` entry to `src/features/admin/adminSections.ts`.
6. Create `supabase/migrations/20260926000700_erase_patient.sql` (new). Add an `erased_patients` tombstone table and `erase_patient(p_id text, p_mode text)`, which only `service_role` may run. In one transaction, the function:
   - expands the patient id to its merge family with `canonical_patient_id()`;
   - deletes `queue`, `vitals`, `consultations`, `dispenses`, `visits`, `patient_merges`, `tefca_access_logs`, `patient_data_sharing_preferences`, `queue_transitions` and the three conflict tables;
   - deletes `patients`, so the cascades run;
   - deletes `resource_versions` last, then writes the tombstone.

   In `anonymise` mode it clears identifiers instead of deleting rows.
7. In the same file, let `queue_transitions_reject_change()` pass when `mbhr.erasure` is on, as `tg_patients_guard_authoritative` does (`20260925100000_sync_authority_foundation.sql:360-385`). Also refuse inserts of tombstoned ids into `patients`.
8. Create `supabase/functions/erase-patient/index.ts` (new). Authorise the caller with `requireStaff(req, service, ['admin'])` (`_shared/security/staffAuth.ts:85`). Its error messages mention SMS, so make them general. The function reads `auth_uid` and the document paths first, then calls the RPC. It then empties `patient-documents/<pid>/` and `photos/patient-photos/<pid>-*`. Last, it calls `auth.admin.deleteUser`.
9. Create `src/services/patientErasure.ts` (new). It clears the patient from `mbhr_v5` (`src/db/index.ts:720-756`, including `queueTransitions` and `serverCommands`), `mbhr`, `mbhr_outbox` and `gamification_db`. It also clears the `mbhr_portal_users` and `patient_message_queue` keys.
10. Register a sync participant (`src/sync/adapter.ts:453`). Its `beforePush` step pulls tombstones and runs `patientErasure`.
11. Rewrite `handleDelete` (`PatientDetail.tsx:257-305`). It calls `erase-patient`, checks the result, then erases locally. When offline, it records a request instead of reporting a deletion. Update the dialog text at `:954-960`.
12. Add a pruning step to `.github/workflows/backup.yml`. Add a tombstone replay step and the PITR window to `docs/deployment/RESTORE_RUNBOOK.md`.
13. Write `docs/legal/DATA_DELETION_RUNBOOK.md` (new) and link it from `docs/legal/README.md`. It covers identity checks, deadlines, legal hold and backups. Staff accounts stay in `UserManagement`, which keeps the permanent-admin rule (`README.md:60-63`).
14. In the same commit, update `PrivacyPolicy.tsx:94-109` with the contact, the in-app path, the retention period and the request record. Update `docs/security/RLS_MATRIX.md` too.

**How to check it.**
- `src/services/patientErasure.test.ts` (new) reuses the in-memory table from `src/utils/import.test.ts`. It asserts that no table and no key still holds the patient id.
- Run SQL after `supabase db reset`:
  1. Seed a patient with a merged copy, a queue ticket, a transition and a document.
  2. Run `erase_patient`.
  3. Every table listed at `20260924110400_rls_verify_phi_lockdown.sql:21-44` should return zero rows for that patient.
  4. Re-inserting the patient id should fail.
- Add a Playwright spec next to `e2e/patient-registration.spec.ts`. It submits a portal request and finds it in the admin queue.

**Decision needed.** The Foundation must decide five things:
- a privacy contact;
- a response deadline;
- the medical-record retention period (`docs/legal/README.md:22-24`);
- whether records inside that period are deleted or anonymised;
- a backup retention window.

A lawyer should confirm who may request erasure for a child.

**Risk if left.** Without a request log or complete erasure, the Foundation could not show the NDPC that it honours the NDPA 2023 right to erasure, and children's health data would stay in history tables, storage, backups and other devices. Not legal advice.

## Before you start

### Decisions the Foundation must make

| Decision | Unblocks items |
|---|---|
| The Foundation's registered name, CAC number, registered address, and a privacy contact (email and phone) | 1, 2, 16, 20 |
| Retention periods for each kind of record | 1, 7, 20 |
| Whether patient field changes are really kept "for AI training" (`conflict_change_deltas`) | 1, 7 |
| How staff verify that someone is a child's parent or guardian | 6, 17 |
| Whether to get a two-way SMS number, so patients can reply STOP | 18 |

### Facts to check before acting

- Which of `VITE_SENTRY_DSN`, `VITE_TERMII_API_KEY`, `TWILIO_*` and `RESEND_API_KEY` are set in each deployment. Items 5 and 8 depend on the answer.

### Shared groundwork

- One constant for the current privacy and terms versions, used by items 1, 2 and 6, so the version a patient accepts always matches the text they saw.
- An accessibility step in CI (axe plus a contrast script), used by items 13, 14 and 15.
- A lawyer's review of the finished notice and terms.

### New migrations named in this checklist

The newest migration from `mainone` is `20260925100700_patient_document_ownership.sql`, so every name below sorts after it.

| Migration (new) | Items |
|---|---|
| `20260926000100_record_portal_consent.sql` | 2, 6 |
| `20260926000200_consent_defaults_off.sql` | 9 (**done**, first pass: the auto-enrolment setting and the sharing default) |
| `20260926000210_portal_link_adults_only.sql` | 17 (**done**, step 5) |
| `20260926000300_limit_conflict_deltas.sql` | 1, 7 |
| `20260926000400_add_patient_guardians.sql` | 17 |
| `20260926000500_message_categories_and_suppressions.sql` | 18 |
| `20260926000600_add_data_subject_requests.sql` | 20 |
| `20260926000700_erase_patient.sql` | 20 |
| `20260926000800_org_legal_identity.sql` | 16, only if needed |
