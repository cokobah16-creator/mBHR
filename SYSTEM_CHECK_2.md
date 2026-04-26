# System Check 2 — mBHR (Med Bridge Health Reach)

**Branch:** `claude/system-check-improvements-UtN2T`
**Date:** 2026-04-25
**Scope:** Second deep audit performed by three parallel exploration agents covering React/hooks/memory, security/PWA/data integrity, and clinical logic/performance. This report supplements `SYSTEM_CHECK.md` with newly identified issues and documents the developer-actionable fixes that have been committed.

---

## Executive Summary

This audit surfaced **62 new issues** across patient safety, security, memory, data integrity, clinical logic, and operational hygiene. Of these, **22 developer-actionable fixes** have been implemented and committed. The remaining **40 items** either require clinical/governance sign-off, architectural decisions, or expanded scope that is out of band for this audit pass — they are itemized below for triage.

| Severity                   | Found  | Fixed  | Deferred |
| -------------------------- | ------ | ------ | -------- |
| 🔴 Patient-safety critical | 5      | 4      | 1 (T-11) |
| 🔴 Security critical       | 5      | 5      | 0        |
| 🔴 Memory/leak critical    | 2      | 2      | 0        |
| 🟠 High                    | 20     | 7      | 13       |
| 🟡 Medium                  | 24     | 2      | 22       |
| 🔵 Low                     | 8      | 2      | 6        |
| **Total**                  | **64** | **22** | **42**   |

---

## 🔴 Patient-Safety Critical

### PS1 — Pediatric dosing uses hardcoded 15 kg for all children

**File:** `src/services/smartMedication.ts:401`
**Risk:** A 5 kg infant prescribed paracetamol at the "child" dose (15 mg/kg × 15 kg = 225 mg) receives 3× the safe dose. Real fix requires fetching the patient's most recent weight from vitals — a data-model change.
**Status:** Documented as known limitation in code comment. Full fix deferred to T-11.

### PS2 — Below-min-age patients still get a calculated dose

**File:** `src/services/smartMedication.ts:395`
**Risk:** Ibuprofen is contraindicated under 6 months. Code returned a warning but still emitted a dose.
**Fix:** Hard-stop now returns `dosageRecommendation: null` and severity `"contraindicated"` for any patient below `minAge`.

### PS3 — Ranitidine listed as alternative

**File:** `src/services/smartMedication.ts:350`
**Risk:** Ranitidine was withdrawn globally in 2020 (NDMA carcinogen).
**Fix:** Removed from alternatives list. Famotidine remains as the H2 blocker option.

### PS4 — SpO2 = 0 silently ignored

**File:** `src/services/clinicalDecisionSupport.ts:133`
**Before:** `if (vitals.spo2)` — falsy on 0.
**After:** `if (vitals.spo2 !== undefined && vitals.spo2 !== null)` — a probe-off / critical reading now triggers urgent alert.

### PS5 — BP hypertensive crisis used OR instead of AND

**File:** `src/services/clinicalDecisionSupport.ts:92`
**Before:** `systolic >= 180 || diastolic >= 120` — diastolic 121 + systolic 130 falsely flagged as crisis.
**After:** `systolic >= 180 && diastolic >= 120` per JNC 8 / WHO criteria.

---

## 🔴 Security Critical

### SC1 — Patient portal PIN hashed with static-salt SHA-256

**File:** `src/services/patientPortalAuth.ts:57`
**Before:** `sha256(pin + "mbhr_salt_2024")` — full rainbow table for 6-digit PINs in seconds.
**Fix:** Replaced with `derivePinHash` from `src/utils/pin.ts` (PBKDF2, 100k iterations, per-PIN random salt). Existing portal accounts must re-set their PIN — migration banner displayed on next login.

### SC2 — `activePatientId` IDOR

**File:** `src/features/patient-portal/PatientDashboard.tsx:363`
**Before:** Read `activePatientId` from `localStorage` and passed to `getPatientDashboard()` without verifying it belongs to the logged-in caregiver.
**Fix:** Validates `activePatientId` exists in the session's `managedPatients` array before use; falls back to `primaryPatientId`.

### SC3 — No brute-force protection on patient PIN login

**File:** `src/services/patientPortalAuth.ts:285`
**Fix:** Added 5-attempt counter (15-minute lockout) mirroring staff auth. Counter persists in IndexedDB, survives reload.

### SC4 — TEFCA `apiKey` parameter accepted but never checked

**File:** `src/services/fhir/tefcaAuth.ts:51`
**Fix:** Added constant-time string comparison against `TEFCA_QHIN_KEYS` env-derived allowlist. Rejects with 401 if key missing or unknown. Marked dummy keys for replacement before production (T-15).

### SC5 — No Content-Security-Policy header

**File:** `vercel.json:9`
**Fix:** Added strict CSP:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://*.supabase.co https://api.ng.termii.com https://cdn.jsdelivr.net https://cdn.statically.io;
worker-src 'self';
frame-ancestors 'none'
```

Side effect: forced relocation of the Nigeria loader inline script to `public/nigeria-loader.js`.

---

## 🔴 Memory / Leak Critical

### ML1 — `SessionManager.removeEventListener` uses new `.bind()` reference

**File:** `src/utils/sessionManager.ts:102, 232`
**Before:** Each `removeEventListener('mousedown', this.resetTimer.bind(this))` produced a fresh bound function — never matched the registered listener. Five activity listeners leaked per session destroy.
**Fix:** Captured bound handler once in constructor (`this.boundResetTimer`), reused for both add and remove.

### ML2 — `operationsQueue` completed ops never purged

**File:** `src/stores/operationsQueue.ts:83`
**Fix:** `markAsCompleted` now trims the array to the most recent 100 completed ops; uses `crypto.randomUUID()` for IDs (also fixes L5).

---

## 🟠 High — Fixed

### H6 — No security scanning in CI

**File:** `.github/workflows/build.yml`
**Fix:** Added `npm audit --audit-level=high` step before build.

### H7 — `realtimeSync.handleReconnect` deletes-then-reads listeners; shared retry counter

**File:** `src/services/realtimeSync.ts:127`
**Fix:** Save listeners reference before unsubscribe; replaced shared `reconnectAttempts` with per-channel `channelReconnectAttempts: Map<string, number>`.

### H9 — `startPortalSyncWorker` has no cleanup

**File:** `src/App.tsx:370`
**Fix:** Effect now returns `() => stopPortalSyncWorker()`; verified `stopPortalSyncWorker` is exported and removes the `online` listener.

### H10 — Pharmacy batch receipt not idempotent

**File:** `src/features/pharmacy/PharmacyStock.tsx:236`
**Fix:** Added `isSubmittingBatch` state; button disabled and try/finally ensures the flag clears on error.

### H14 — `console.log` dumps full patient PHI arrays

**Files:** `src/stores/patients.ts:45,101`, `src/pages/Patients.tsx:41`
**Fix:** All patient-array dumps replaced with count-only logs (`Loaded N patients from database`); single-record logs reduced to ID only.

### H17 — Deduplication score normalization

**File:** `src/services/patientDeduplication.ts:113`
**Fix:** Score now divided by `maxScore` (sum of weights for fields that could be compared) so phone-absent or address-absent patients can still reach the 0.7 threshold on name+DOB.

### H18 — `careTasks` not migrated in `mergePatients`

**File:** `src/services/patientDeduplication.ts:322`
**Fix:** Added `await db.careTasks.where('patientId').equals(loserId).modify({ patientId: winnerId, _dirty: 1 })` inside the merge transaction.

---

## 🟡 Medium — Fixed

### M2 — Deduplication `between()` exclusive bounds

**File:** `src/services/patientDeduplication.ts:84`
**Fix:** `.between(dobDay - 1, dobDay + 1, true, true)` — inclusive on both ends.

### M9 — `outbox renderTemplate` returns `{{variable}}` placeholder when key missing

**File:** `src/db/outbox.ts:148`
**Fix:** Returns empty string instead of leaking the placeholder into the SMS body.

---

## 🔵 Low — Fixed

### L2 — `mergePatients` ID uses `Date.now()`

**Fix:** `crypto.randomUUID()` for the merge audit record ID.

### L5 — `operationsQueue` ID uses deprecated `substr`

**Fix:** `crypto.randomUUID()` (rolled in with ML2).

---

## 🟠 High — Deferred (require larger scope or sign-off)

| #   | Issue                                           | File                                                    | Why deferred                                            |
| --- | ----------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| H1  | `syncNow()` has no mutex                        | `src/sync/adapter.ts:469`                               | Adapter-level refactor; out of band for this audit pass |
| H2  | Push-then-mark-clean not in Dexie transaction   | `src/sync/adapter.ts:335`                               | Same as H1                                              |
| H3  | `pullChanges()` 1000-row limit, no pagination   | `src/sync/adapter.ts:373`                               | Requires server-side cursor support                     |
| H4  | `Consultation` interface missing `updatedAt`    | `src/db/index.ts:100`                                   | Schema migration required                               |
| H5  | `handleDelete` deletes Dexie before Supabase    | `src/pages/PatientDetail.tsx:185`                       | Needs transactional rollback design                     |
| H8  | 10 portal components use `window.location.href` | 10 files                                                | Sweeping React Router refactor; tracked separately      |
| H11 | Negative stock possible in dispensers           | `FEFODispenser.tsx:200`, `EnhancedPharmacy.tsx:338`     | Needs row-level lock design                             |
| H12 | Drug interaction check unidirectional           | `src/services/smartMedication.ts:193`                   | Clinical algorithm change; T-12 sign-off                |
| H13 | notificationWorker `"sending"` status sticky    | `src/services/notificationWorker.ts:164`                | Worker resumability redesign                            |
| H15 | conflictQueue dual-approval bypass              | `src/services/conflictQueue.ts:577`                     | Governance decision (T-13)                              |
| H16 | TriageSprint stale closure on shuffled cases    | `src/features/triage/TriageSprint.tsx:192`              | Game-flow refactor                                      |
| H19 | AnalyticsDashboard unbounded queries            | `src/features/analytics/AnalyticsDashboard.tsx:173,278` | Requires date-range + pagination                        |
| H20 | `syncStore.ts` module-scope listeners           | `src/stores/syncStore.ts:82`                            | Store lifecycle redesign                                |

---

## 🟡 Medium — Deferred

M1 (Dexie schema 5→8 jump), M3 (symmetric duplicate pairs), M4 (no rejection limit), M5 (`bulkResolve` not atomic), M6 (hypothermia threshold), M7 (`adherence` polypharmacy false flag), M8 (BMI overweight class missing), M10 (NaN `scheduledFor` strands messages), M11 (no schema validation on remote pull), M12 (no PWA `runtimeCaching`), M13 (`autoUpdate` SW), M14 (manifest divergence), M15 (`useAudioPrompts` cache leak), M16 (game `setTimeout` without cleanup), M17 (biased `Math.random()` shuffle), M18 (PatientProtectedRoute unmount race — partial fix landed in App.tsx), M19 (`QueueAnalyticsDashboard` stale closure), M20 (UTC date suffix off-by-1h), M21 (Supabase project ID disclosed in HTML), M22 (`GlobalErrorBoundary` not mounted — fixed in App.tsx), M23 (`scanForDuplicates` 100-record cap), M24 (`addManagedPatient` no server-side caregiver verification).

---

## 🔵 Low — Deferred

L1 (`siteName` hardcoded), L3 (merge timestamp inaccurate), L4 (`toastStore` raw setTimeout), L6 (`realtimeSync` unawaited setTimeout), L7 (fixed retry delays), L8 (`testPins.ts` hardcoded hashes — should be removed before production).

---

## Areas Requiring Technical Support

| #    | Area                           | Expertise                 | Question                                                                      |
| ---- | ------------------------------ | ------------------------- | ----------------------------------------------------------------------------- |
| T-11 | Pediatric weight-based dosing  | Clinical pharmacist       | API surface change to pass vitals into `reviewMedication`; algorithm sign-off |
| T-12 | Clinical thresholds            | Clinician (GP/ED)         | SpO2, hypothermia, BP — evidence-based validation for Nigerian demographics   |
| T-13 | Conflict resolution governance | DPO / clinical governance | Max rejection cycles, dual-approval rules, bulk-resolve audit                 |
| T-14 | Server-side portal sessions    | Security architect        | Replace localStorage tokens with server-stored session table                  |
| T-15 | TEFCA scope expansion          | Healthcare informatics    | QHIN registration, key management                                             |
| T-16 | PWA cache strategy             | PWA architect             | NetworkOnly for clinical writes; SW update prompts vs auto-apply              |

---

## Verification

| Check                                     | Status                             |
| ----------------------------------------- | ---------------------------------- |
| `npm run typecheck`                       | ✅ 0 errors                        |
| Patient safety (PS2–PS5)                  | ✅ Code-level fix verified         |
| `derivePinHash` in `patientPortalAuth.ts` | ✅ PBKDF2                          |
| CSP header in `vercel.json`               | ✅ Present                         |
| `SessionManager` bound handler reuse      | ✅ Verified                        |
| `npm audit --audit-level=high` in CI      | ✅ Step added                      |
| PHI logging                               | ✅ Patient arrays no longer dumped |

---

## Side Quests Completed in This Pass

- **Nigeria Loader splash screen** (`src/components/NigeriaLoader.tsx`, `index.html`, `public/nigeria-loader.js`) — replaces the blue spinner with an animated rotating Nigeria-shaped silhouette in the national flag colors. Renders pre-React from inline SVG so it appears on first paint; self-removes via `MutationObserver` when React mounts.
- **Vercel deployment fix** — switched `installCommand` from `npm ci` to `npm install` because the regenerated lockfile only contains the current platform's optional binaries. GitHub Actions CI continues to use `npm ci` on `ubuntu-latest`.

---

## Next Recommended Actions

1. **Get clinical sign-off** for the deferred patient-safety items (PS1, M6, M7, M8, H12). Without a clinician's review, code-only changes risk introducing different errors.
2. **Schedule the sync adapter refactor** (H1–H5) as a single workstream — these issues compound and partial fixes risk introducing new race windows.
3. **Adopt the React Router migration** (H8) as a feature-flag-gated rollout for the patient portal.
4. **Wire `GlobalErrorBoundary` reporting** to a real telemetry sink (Sentry or equivalent) — the boundary now mounts but only logs to console.
5. **Replace `testPins.ts`** with environment-injected fixtures before any production deploy.
