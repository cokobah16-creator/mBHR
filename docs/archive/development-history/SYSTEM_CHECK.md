# mBHR System Check Report

**Date:** 2026-04-20  
**Branch:** `claude/system-check-improvements-UtN2T`  
**Scope:** Full codebase audit — security, code quality, architecture, feature completeness, infrastructure

---

## Executive Summary

mBHR is a mature, well-architected offline-first PWA for Nigerian medical outreach. The core clinical workflows, internationalization, and offline/online sync are production-quality. This audit identified **5 critical issues** (3 fixed in this PR), **10 high-priority issues**, **11 medium issues**, and **5 low-priority items**. It also identifies **10 areas that require specialist technical support** beyond developer effort alone.

**Fixed in this PR:**

- C1 — XSS pattern in `renderFatal` (`src/main.tsx`)
- C2 — Session token moved from `localStorage` → `sessionStorage`
- C3 — DOB-only auth replaced with mandatory 6-digit PIN for offline portal login

---

## Category 1: Security

### 🔴 C1 — XSS Pattern in `renderFatal` ✅ FIXED

**Location:** `src/main.tsx:53`  
**Finding:** `el.innerHTML` used with a template literal containing `${msg}`. Currently `msg` is only ever a hard-coded string, but the pattern is dangerous: any future refactor passing user-derived content creates XSS with no framework-level sanitisation.  
**Fix applied:** Replaced with `document.createElement` + `.textContent` assignments.

### 🔴 C2 — Session Token in `localStorage` ✅ FIXED

**Location:** 11 occurrences across 9 files  
**Finding:** `patient_session_token` was stored in `localStorage`, accessible to any JavaScript on the page. Any XSS exploit or malicious extension could silently exfiltrate it.  
**Fix applied:** All reads/writes/removes changed to `sessionStorage` (clears on tab close, not accessible cross-tab).  
**Note:** `mbhr_portal_users` and `patient_portal_user` (full user records) remain in `localStorage` — they are persistent profile data, not auth tokens. This trade-off is accepted for offline-first PWA behaviour and should be re-evaluated when a service-worker token store is implemented.

### 🔴 C3 — Date-of-Birth as Sole Offline Auth Credential ✅ FIXED

**Location:** `src/services/patientPortalAuth.ts`, `src/features/patient-portal/PatientLogin.tsx`, `src/features/patient-portal/PatientRegister.tsx`  
**Finding:** The offline patient portal login accepted only email + DOB. DOB is guessable PII and is stored in the patient record itself.  
**Fix applied:**

- Registration now requires a mandatory 6-digit PIN (validated with `/^\d{6}$/`, SHA-256 hashed before storage).
- Offline login schema changed to require 6-digit PIN.
- `loginPatientPortal` called with `"pin"` method instead of `"dob"`.
- Staff-registered patients who lack a PIN receive a clear message directing them to register.

### 🟠 C4 — SMS/Email Delivery is Stubbed in Production (NOT YET FIXED)

**Location:** `src/services/portalSyncWorker.ts:65`  
**Finding:** `// TODO: Implement actual SMS/Email delivery` — the production code path marks messages as "sent" without transmitting them. Patients never receive portal invitations, appointment reminders, or medication alerts.  
**Note:** `TermiiGateway` in `src/services/messaging.ts` is fully implemented and uses the Termii Nigeria SMS API. The disconnect is in `portalSyncWorker.ts` which never calls it.  
**Next step:** Wire `portalSyncWorker.ts` to call `MessageService` using `TermiiGateway` when `VITE_TERMII_API_KEY` is set. Requires **infrastructure decision** on SMS provider and key management. See Technical Support section T-1.

### 🟠 C5 — Audit Log Coverage is Incomplete

**Location:** `src/db/index.ts`, `auditLogs` Dexie table  
**Finding:** `db.auditLogs.add()` is called in only 3 places (patient merge, vitals entry, gamification approval). Patient registration, consultation creation, medication dispensing, portal authentication, user management, and RBAC changes are **not audited**.  
**Next step:** Requires a **compliance expert** to define the required event list (NDPR/HIPAA equivalent). See Technical Support section T-6.

---

## Category 2: Code Quality

### 🟠 H1 — Silent Error Swallowing in Critical Paths

**Locations:**

- `src/components/OfflineAnalytics.tsx:79` — `.catch(() => {})` on daily count write; analytics data silently lost
- `src/sync/adapter.ts:227` — `.catch(() => undefined as any)` on settings read; sync cursor may default incorrectly
- `src/sync/adapter.ts:338` — `.catch(() => [])` on dirty-record query; entire table silently skipped on sync error
- `src/services/patientPortalAuth.ts:43,103,137,286,310,402,509` — multiple empty catch blocks in portal auth flow  
  **Risk:** Data loss and auth failures become invisible to both users and operators.  
  **Next step:** Replace each site with `logger.error(...)` plus a meaningful fallback or re-throw.

### 🟠 H2 — 229 `eslint-disable no-explicit-any` Suppressions

**Location:** Across `src/` (confirmed via grep)  
**Finding:** TypeScript's `@typescript-eslint/no-explicit-any` rule is set to `warn` with `--max-warnings=0` in CI, so every suppression is load-bearing. Highest concentrations in `src/sync/adapter.ts`, `src/db/index.ts`, `src/services/conflictQueue.ts`.  
**Next step:** Tackle by module. Replace `any` with `unknown` + type guards; start with the sync/data path.

### 🟠 H3 — TypeScript Strict Mode Disabled

**Location:** `tsconfig.json:7` — `"strict": false`  
**Finding:** README and documentation describe the project as "TypeScript (strict)" but strict mode is explicitly off. Without `strictNullChecks`, `null`/`undefined` bugs are not caught at compile time.  
**Next step:** Enable `"strictNullChecks": true` incrementally, resolve errors, then move to full `"strict": true`.

### 🟠 H4 — Unguarded `console.log/error` in Production Paths

**Locations:** `src/db/outbox.ts:81,206`, `src/sync/mbhrAdapter.ts:27,31,186`, `src/utils/performance.ts:231-258`  
**Finding:** These files call `console.*` directly rather than through `src/lib/logger.ts`. The Vite build strips `console.log` but not `console.error`, so sync errors are logged to the browser console in production.  
**Note:** Vite's `drop_console` config strips bare `console.log` in production builds — the risk is lower than it appears, but bypassing the logger is inconsistent and hides context.  
**Next step:** Migrate to `logger.error/warn/info` throughout.

### 🟠 H5 — N+1 Query in Bulk Patient Enrollment

**Location:** `src/services/unifiedPortalEnrollment.ts:266-280`  
**Finding:** `bulkEnrollPatients(patientIds)` issues one Supabase `.single()` query per patient ID in a loop — O(n) round trips. For 100 patients this is 100 sequential network calls.  
**Next step:** Replace the loop with a single `.in("id", patientIds)` batch query, then iterate the results.  
**Test:** `src/services/unifiedPortalEnrollment.test.ts` contains an `it.skip` regression test that will confirm the fix — remove `.skip` after the fix.

### 🟠 H6 — O(n²) Lookup in Portal Sync Worker

**Location:** `src/services/portalSyncWorker.ts:164`  
**Finding:** `.find()` called inside a loop over `supabasePatients` — O(n²) for large patient sets.  
**Next step:** Build a `Map<string, Patient>` from the local array before the loop.

### 🟡 M1 — `startPortalSyncWorker()` Called Without Error Handling

**Location:** `src/App.tsx:367`  
**Finding:** `startPortalSyncWorker()` is called with no `.catch()`. A worker startup failure is silently swallowed (global unhandledrejection handler will log it, but no user feedback).  
**Next step:** Add `.catch(logger.error)` or wrap in try/catch.

### 🟡 M2 — `Math.random()` in Production Code Paths

**Locations:** `src/services/messaging.ts:80` (MockGateway delivery simulation), `src/features/triage/TriageSprint.tsx:147` (question shuffling)  
**Finding:** `MockGateway` is used as de-facto production fallback when no API key is configured. `Math.random()` is not cryptographically secure.  
**Next step:** Replace `MockGateway` production fallback with `NullGateway` that logs cleanly. Use `crypto.getRandomValues()` for shuffling.

---

## Category 3: Architecture

### 🟡 M3 — Monolithic Files (8 files > 700 lines, 7,526 lines combined)

| File                                            | Lines | Issue                                                  |
| ----------------------------------------------- | ----- | ------------------------------------------------------ |
| `src/db/index.ts`                               | 1,275 | Schema, types, helpers, and business logic mixed       |
| `src/services/conflictQueue.ts`                 | 1,107 | Conflict detection, resolution, escalation in one file |
| `src/pages/admin/ConflictDashboard.tsx`         | 1,042 | UI + embedded logic                                    |
| `src/features/pharmacy/PharmacyStock.tsx`       | 906   |                                                        |
| `src/pages/PatientDetail.tsx`                   | 852   |                                                        |
| `src/services/volunteerEngagement.ts`           | 791   |                                                        |
| `src/features/doctor/PalaverRoom.tsx`           | 784   |                                                        |
| `src/features/analytics/AnalyticsDashboard.tsx` | 769   |                                                        |

**Next step:** Start with `src/db/index.ts` — split into `db/schema.ts`, `db/types.ts`, `db/helpers/`. Create an ADR before refactoring `conflictQueue.ts`.

### 🟡 M4 — Two Parallel Dexie Databases

**Location:** `src/db/index.ts` (`MBHRDatabase`) + `src/db/mbhr.ts` (`MbhrDatabase`)  
**Finding:** Two separate IndexedDB databases exist. Some features import from `@/db`, others from `@/db/mbhr`. There is no single view of all offline data and no cross-database transactions.  
**Next step:** Document whether the split is intentional (clinical vs. operational isolation). If not, create a consolidation plan before adding new features.

### 🟡 M5 — `CarePlanManager.tsx` Excluded from TypeScript

**Location:** `tsconfig.json` `exclude` array  
**Finding:** `src/components/CarePlanManager.tsx` is explicitly excluded from TypeScript compilation — unusual for production source.  
**Next step:** Either fix the file and remove the exclusion, or remove the file from the codebase.

### 🟡 M6 — FHIR Module Uses US-Core Profiles in a Nigerian Deployment

**Location:** `src/services/fhir/uscore-validator.ts`, `src/services/fhir/tefcaAuth.ts`  
**Finding:** FHIR R4 validation uses HL7 US Core Implementation Guide profiles. TEFCA/QHIN is a US-specific interoperability framework. mBHR is deployed in Nigeria where NHIA/FMOH standards apply.  
**Next step:** Requires **healthcare informatics expert** decision. See Technical Support T-3.

---

## Category 4: Feature Completeness

### 🟠 H7 — Zero Tests for Components, Pages, and Feature Modules

**Location:** `src/components/` (56 files), `src/pages/` (17 files), `src/features/` (61+ files)  
**Finding:** Not a single unit test exists for any component, page, or feature file. The 60% coverage threshold in `vitest.config.ts` is never enforced (no coverage step in CI).  
**Fixed in this PR (partial):** Added 23 tests covering `patientPortalAuth`, `PatientLogin`, `PatientRegister`, and `unifiedPortalEnrollment` — the highest-risk untested paths.  
**Next step:** Prioritise test coverage for: `patientDeduplication.ts`, `enhancedSync.ts`, `conflictResolver.ts`, key form components (VitalsInput, DispenseForm, PatientForm).

### 🟠 H8 — i18n Completeness Unknown

**Location:** `src/i18n/locales/` (5 language files)  
**Finding:** `scripts/i18n-verify.ts` auto-fills missing keys with `[EN]` prefix. The script exists but is never run in CI, so the extent of English-prefixed placeholders in production is unknown.  
**Next step:** Add `npm run i18n:check` to CI. Run it now to generate a baseline. Engage native-speaker translators for Hausa, Yoruba, Igbo, and Pidgin medical terminology. See Technical Support T-5.

### 🟡 M7 — Sentry `GlobalErrorBoundary` Not Wired to Sentry

**Location:** `src/components/GlobalErrorBoundary.tsx:158-168`  
**Finding:** `reportError` stub logs to console but does not call `Sentry.captureException`. Sentry is initialised conditionally at startup but never receives React component tree errors.  
**Next step:** Add `if (import.meta.env.VITE_SENTRY_DSN) { Sentry.captureException(error); }` inside `reportError`.

### 🟡 M8 — `recharts` in `devDependencies`

**Location:** `package.json`  
**Finding:** `recharts` is used in the production `AnalyticsDashboard` component but listed under `devDependencies`. While Vite bundles it correctly, this is a semantic error that could cause issues in some CI environments.  
**Next step:** Move to `dependencies`.

---

## Category 5: Infrastructure & CI/CD

### 🔴 H9 — CI Pipeline Does Not Run Tests or Lint (PARTIALLY FIXED IN THIS PR)

**Location:** `.github/workflows/build.yml`  
**Finding:** CI runs only `typecheck` and `build`. No lint (`npm run lint`), no unit tests (`npm run test:run`), no i18n verification. The 60% coverage threshold and 229 `no-explicit-any` suppressions are never validated in CI.  
**Fix applied in this PR:** Added `lint` and `test:run` steps to `build.yml`.

### 🟠 H10 — No Security Scanning in CI

**Location:** `.github/workflows/build.yml`  
**Finding:** No dependency audit, no SAST tool, no secret scanning.  
**Next step:** Add `npm audit --audit-level=high`. Configure GitHub CodeQL Action for the repository.

### 🟡 M9 — `staff_roles` Role Check Missing `auditor` and `lead_clinician`

**Location:** `supabase/migrations/20260417000000_add_staff_roles_and_rbac.sql`  
**Finding:** The `staff_roles_role_check` constraint lists `'staff', 'admin', 'doctor', 'nurse', 'pharmacist', 'volunteer'` but omits `'auditor'` and `'lead_clinician'` which are defined in `src/auth/roles.ts`. Inserting these roles will fail at the DB level.  
**Next step:** Create a new migration adding both roles to the constraint.

### 🟡 M10 — Migration History Has Duplicate/Malformed Timestamps

**Location:** `supabase/migrations/` (42 files)  
**Finding:** Multiple duplicate timestamps and one file with a prefixed old timestamp in its name (`20251024121716_20251023220000_add_photo_storage.sql`), suggesting re-runs of previously failed migrations.  
**Next step:** Run `supabase db diff` to verify migration history integrity.

### 🔵 L1 — Migration Runner Disabled

**Location:** `src/main.tsx:71-73`  
**Finding:** The Dexie migration runner is commented out pending a `meta` table. The schema is at version 12 but migrations are not auto-applied.  
**Next step:** Implement the `meta` table and re-enable the runner, or document why version bumps are sufficient.

---

## Category 6: Areas Requiring Technical Support

The following issues cannot be resolved by engineering effort alone and require external expertise.

| #    | Area                                                | Expertise Needed                                  | Key Questions                                                                                                                                                                            |
| ---- | --------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1  | **SMS/Email Delivery**                              | Infrastructure / Backend                          | Which provider (Termii, Twilio)? How is the API key managed in production? What retry policy for failed deliveries?                                                                      |
| T-2  | **Patient Portal Auth Hardening**                   | Security Architect                                | Should PIN reset require staff involvement? Is rate-limiting DOB attempts sufficient as a secondary credential for staff-registered patients?                                            |
| T-3  | **FHIR / TEFCA Scope**                              | Healthcare Informatics                            | Should US-Core profiles be replaced with Nigerian standards (NHIA/FMOH)? Is TEFCA retained for future international expansion?                                                           |
| T-4  | **Clinical Decision Support**                       | Clinician (GP / Family Medicine)                  | Are the hard-coded vital thresholds in `clinicalDecisionSupport.ts` validated for Nigerian demographics? Are the SOAP suggestion strings safe to show to volunteers without disclaimers? |
| T-5  | **Predictive Queue ML**                             | Data Scientist / ML Engineer                      | What is the minimum historical data for reliable predictions? Should the `confidence` score gate UI recommendations?                                                                     |
| T-6  | **Audit Log Coverage**                              | Compliance / Medical Informatics                  | What events must be audited under NDPR and applicable Nigerian health data regulations?                                                                                                  |
| T-7  | **i18n Translation Quality**                        | Medical Translators (Hausa, Yoruba, Igbo, Pidgin) | Are clinical terms accurately translated? Which keys have medically ambiguous colloquial translations?                                                                                   |
| T-8  | **Offline Sync Reliability Under Field Conditions** | Network / Infrastructure Engineer                 | Has sync been tested under 2G/3G? What is the maximum payload size per sync cycle? Is the Workbox service-worker cache-first strategy appropriate for clinical data?                     |
| T-9  | **Conflict Resolution Policy**                      | Clinical Governance                               | Who sets per-site merge thresholds? What is the dual-approval workflow for `lead_clinician`-level merges? Has any patient merge been tested in a real deployment?                        |
| T-10 | **RLS Policy Correctness**                          | Database Administrator                            | Are Supabase Row-Level Security policies correctly scoped to prevent cross-patient data access? Has any RLS policy been penetration-tested?                                              |

---

## Prioritised Remediation Roadmap

| Priority    | ID  | Issue                           | Effort    | Owner             | Requires                |
| ----------- | --- | ------------------------------- | --------- | ----------------- | ----------------------- |
| ✅ Done     | C1  | XSS in `renderFatal`            | Low       | Dev               | —                       |
| ✅ Done     | C2  | Session token in `localStorage` | Low       | Dev               | —                       |
| ✅ Done     | C3  | DOB-only auth                   | Medium    | Dev               | —                       |
| ✅ Done     | H9  | CI missing tests/lint           | Low       | Dev               | —                       |
| 🔴 Critical | C4  | SMS delivery stub               | Medium    | Dev + Infra       | Provider decision (T-1) |
| 🔴 Critical | C5  | Audit log coverage              | High      | Dev + Compliance  | Event list (T-6)        |
| 🟠 High     | H3  | TypeScript strict mode off      | High      | Dev               | —                       |
| 🟠 High     | H1  | Silent error swallowing         | Medium    | Dev               | —                       |
| 🟠 High     | H5  | N+1 bulk enrollment query       | Low       | Dev               | —                       |
| 🟠 High     | H7  | Zero component/feature tests    | Very High | Dev               | —                       |
| 🟠 High     | H8  | i18n completeness unknown       | Medium    | Dev + Translators | T-7                     |
| 🟠 High     | H10 | No security scanning in CI      | Low       | Dev               | —                       |
| 🟡 Medium   | M3  | Monolithic files                | High      | Dev               | ADR first               |
| 🟡 Medium   | M6  | FHIR/US-Core in Nigeria         | N/A       | Decision          | T-3                     |
| 🟡 Medium   | M9  | Role constraint mismatch        | Low       | Dev               | —                       |
| 🔵 Low      | M7  | Sentry not wired                | Low       | Dev               | —                       |
| 🔵 Low      | M8  | `recharts` in devDeps           | Low       | Dev               | —                       |

---

## Files Modified in This PR

| File                                                   | Change                                           |
| ------------------------------------------------------ | ------------------------------------------------ |
| `src/main.tsx`                                         | Fix C1 — replace `innerHTML` with DOM API        |
| `src/App.tsx`                                          | Fix C2 — `sessionStorage` for session token      |
| `src/hooks/useAuth.ts`                                 | Fix C2                                           |
| `src/services/patientPortalAuth.ts`                    | Fix C2 (logout) + C3 (PIN required)              |
| `src/features/patient-portal/PatientLogin.tsx`         | Fix C2 + C3 (PIN login schema)                   |
| `src/features/patient-portal/PatientRegister.tsx`      | Fix C2 + C3 (PIN registration)                   |
| `src/features/patient-portal/PatientDashboard.tsx`     | Fix C2                                           |
| `src/features/patient-portal/PatientPortalLayout.tsx`  | Fix C2                                           |
| `src/features/patient-portal/VisitDetail.tsx`          | Fix C2                                           |
| `src/features/patient-portal/AppointmentRequest.tsx`   | Fix C2                                           |
| `src/services/patientPortalAuth.test.ts`               | New — 11 auth service tests                      |
| `src/features/patient-portal/PatientLogin.test.tsx`    | New — 5 login form tests                         |
| `src/features/patient-portal/PatientRegister.test.tsx` | New — 5 registration form tests                  |
| `src/services/unifiedPortalEnrollment.test.ts`         | New — N+1 regression test (1 active + 1 skipped) |
| `.github/workflows/build.yml`                          | Add lint + unit-test CI steps                    |
| `SYSTEM_CHECK.md`                                      | This document                                    |
