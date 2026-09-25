# Clinical logic changes: blocking clinical review

The UI redesign was not meant to change medicine. While doing it, a few
places were found where the code did not do what its own rules said. This
file lists every change that affects a clinical decision, so a clinician can
review, accept or revert each one independently.

> **Release-blocking.** Owner decision: this file is a blocking remediation
> checklist. Every row and every item under "Flagged, not changed" must be
> reviewed, and accepted or reverted, by a qualified clinician before
> production use. All clinical decision-support logic needs the same review.
> Production use is blocked while any box in section 2 is unticked.

Contents:

1. [How the gate works](#1-how-the-gate-works)
2. [Blocking remediation checklist](#2-blocking-remediation-checklist)
3. [Owner decisions (decided)](#3-owner-decisions-decided)
4. [Change log](#4-change-log)

## 1. How the gate works

Owner requirement: any pull request touching clinical thresholds,
interpretation, medication guidance, lab interpretation, triage, vitals
ranges, diagnosis support, contraindication logic, or patient-facing medical
advice must either update this file or explicitly say "No clinical logic
change."

The **Clinical logic gate** check (job `clinical-logic-gate` in
`.github/workflows/build.yml`) enforces this on every pull request. It runs
`scripts/check-clinical-logic-change.mjs`, which:

1. Lists the files the pull request changes (`git diff --name-only` between
   the base and head commits).
2. Picks out the files on the clinical-logic list, kept in the script:
   - **By path** (`CLINICAL_PATH_RULES`): triage and queue priority; vitals
     ranges, flags and categories (including input limits in
     `src/validation/schemas.ts`); lab interpretation, review, release and
     worklist order; prescribing, dispensing, allergy and interaction
     matching, expiry (FEFO) and medication reminders; clinical alerts and
     decision support; patient-facing medical advice in the patient portal;
     training games that teach clinical practice (for example the insulin
     question in Knowledge Blitz).
   - **By changed lines** (`CLINICAL_CONTENT_RULES`), for files that mix
     clinical rules with other things: database migrations whose changed
     lines mention interpretation, lab review or release, priority or
     triage, reference ranges or thresholds, allergies, interactions,
     dosing, lot expiry or vitals; translation keys for vitals status,
     triage, symptoms, dosing and emergency advice; role permissions that
     grant `consult`, `lab_review`, `lab_release` or `prescribe`; and
     patient-portal text about hospitals, emergencies, symptoms, doses or
     diagnoses.
   - Test files (`*.test.*`, `*.spec.*`, `src/test/`, `e2e/`) never count.
3. Passes when no listed file changed, when this file is changed in the
   same pull request, or when the pull request description contains the
   words **No clinical logic change**. Case does not matter. Text inside
   `<!-- -->` comments and unticked checkboxes (`- [ ]`) does not count, so
   the unedited pull request template never passes. Otherwise it fails and
   lists the matched files and why each one matched.

When the check fails, do one of these:

- **The change alters clinical behaviour:** add a row to the change log
  (section 4). For anything a clinician must decide or confirm, add an
  unticked item to section 2 and name it in the row.
- **It does not** (for example a rename, a layout or style change, or a
  refactor with the same results): write "No clinical logic change" in the
  pull request description (the template has a box for it), then re-run
  the check. The check reads the current description, so editing it and
  re-running the job is enough.

For the check to block merging, it must be set as a required status check
for the branches pull requests merge into (for example `main` and
`mainone`) in the repository's branch protection settings.

Passing the gate records a change; it does not approve it. Reviewers still
judge whether a "No clinical logic change" claim is true, and production
use still needs a qualified clinician's sign-off of every open item in
section 2.

Keeping the list current:

- When you add a file that holds clinical logic, add it to the list in the
  script in the same pull request.
- If a listed file is moved or renamed, the unit test
  (`scripts/check-clinical-logic-change.test.ts`) fails until the list is
  updated.
- Removing a file from the list weakens the gate: say why in the change
  log. The script itself is on the list, so any change to it is gated too.

Run it locally before opening a pull request:

```bash
# Lists the clinical files your branch changes; PR_BODY is the description.
PR_BODY="" node scripts/check-clinical-logic-change.mjs --base origin/main --head HEAD
# Or name the files to check.
node scripts/check-clinical-logic-change.mjs src/utils/vitals.ts
```

## 2. Blocking remediation checklist

Every item below starts unticked. Tick an item only when a named, qualified
clinician has reviewed it, and write the sign-off under it:

```text
Signed off: <full name>, <qualification and professional registration>, <YYYY-MM-DD>.
Decision: accept / revert / change (say how).
```

A decision to revert or change something needs its own pull request, which
the gate will ask to be recorded in section 4. Production use is blocked
while any item here is unticked.

### 2.1 Whole-system review

- [ ] **All clinical decision-support logic** has been reviewed with a
      qualified clinician before production use: every area on the gate's
      list (section 1), not only the items below.

### 2.2 Changes already made

In the UI redesign (rows 1 to 16), **no reference range, alert threshold,
dosage rule or decision-support rule was changed.** `flagVitals`
thresholds, `vitalsRanges` and the rules in
`services/clinicalDecisionSupport.ts` are untouched. Row 17 documents the
queue priority change that follows the owner decision in section 3.3.

- [ ] Row 1: BMI is calculated as weight ÷ height².
- [ ] Row 2: Fever, pulse and SpO₂ flags are raised.
- [ ] Row 3: Displayed BMI is recomputed from stored height and weight.
- [ ] Row 4: Display-only categories next to readings.
- [ ] Row 5: Medication–allergy matching includes drug classes.
- [ ] Row 6: Dispensing checks allergies.
- [ ] Row 7: FEFO never uses expired lots and can span lots.
- [ ] Row 8: Every prescription line is dispensed.
- [ ] Row 9: A visit closes when the patient finishes pharmacy.
- [ ] Row 10: A lab result's interpretation must be chosen.
- [ ] Row 11: The training game no longer completes real patients.
- [ ] Row 12: Patient emergency help dials 112.
- [ ] Row 13: Acknowledging a clinical alert needs the consult permission.
- [ ] Row 14: Marking a lab result reviewed needs the `lab_review` permission.
- [ ] Row 15: A lab result is never saved without a chosen interpretation.
- [ ] Row 16: Knowledge Blitz insulin storage question corrected.
- [ ] Row 17: Triage priority is carried to the next stage; only a
      clinician can lower it.
- [ ] Row 18: Dispensing checks allergies across merged records.
- [ ] Row 19: A refused dispense never erases medicine already handed over.
- [ ] Row 20: Dispensing needs an identified patient.
- [ ] Row 21: A merged-away patient record is screened and treated on the
      kept record.

| # | Change | Why | Where | Revert by |
| --- | --- | --- | --- | --- |
| 1 | BMI is calculated as weight ÷ height² | Both vitals forms called `calculateBMI(height, weight)` but the function is `calculateBMI(weight, height)`. 170 cm / 70 kg was stored as BMI ≈ 347 instead of 24.2. | `utils/vitals.ts` `assessVitals`; `components/VitalsForm.tsx`; `features/vitals/EnhancedVitalsForm.tsx` | Not recommended |
| 2 | Fever, pulse and SpO₂ flags are raised | The forms passed `tempC`/`pulseBpm` to `flagVitals`, which reads `temperature`/`pulse`/`spo2`, so those flags could never fire. Thresholds are unchanged (≥38.0 °C, <35.0 °C, ≥100 / <60 bpm, SpO₂ <95%). | same as above | Not recommended |
| 3 | Displayed BMI is recomputed from stored height and weight | Records saved before fix 1 hold a wrong BMI. Display (staff record, timelines, patient portal) recomputes; stored values and stored flags are **not** rewritten. A stored BMI outside 8–90 with no height/weight is hidden. | `utils/vitals.ts` `resolveBmi` | Decide whether to run a data migration that rewrites stored `bmi` and BMI flags |
| 4 | Display-only categories next to readings | Adds words beside numbers (e.g. "BMI 27.4 · Overweight", "BP 182/100 · Severely elevated"). WHO adult BMI bands; BP: ≥180/120 severely elevated, ≥140/90 high (same as the existing flag), 130–139/80–89 elevated, <90/60 low. Temperature ≥39.5 °C and pulse ≥130 or <40 shown as critical. These do **not** create flags, queue priority or alerts. | `utils/vitals.ts` `classify*` | Change the bands in one file |
| 5 | Medication–allergy matching includes drug classes | A recorded "Penicillin" allergy did not match "Amoxicillin". Matching now also checks a small list of common classes (penicillins, sulfonamides, NSAIDs incl. aspirin, cephalosporins, quinolones, macrolides, tetracyclines). Penicillin ↔ cephalosporin cross-reactivity is deliberately **not** included. A match asks the dispenser to confirm; it never blocks. | `utils/allergyMatch.ts`, `services/allergies.ts` | Delete the class table to return to name-only matching |
| 6 | Dispensing checks allergies | Visit dispensing had no allergy check. A possible match now requires an explicit acknowledgement, which is audit-logged as `dispense_allergy_override`. | `components/DispenseForm.tsx`, `features/pharmacy/Dispense.tsx` | — |
| 7 | FEFO never uses expired lots and can span lots | `/rx/dispense` always tried the earliest-expiring lot, so an expired lot blocked dispensing and in-date stock was never used; a quantity larger than one lot was refused. Expired lots are now shown to be set aside; a shortfall is reported, never partially dispensed. | `features/pharmacy/fefo.ts` | — |
| 8 | Every prescription line is dispensed | `/rx/dispense` dispensed only the first line but marked the whole prescription dispensed. | `features/pharmacy/Dispense.tsx` | — |
| 9 | A visit closes when the patient finishes pharmacy | Visits were never closed on staff devices, so a returning patient's new records could be filed under an old visit. Completing the pharmacy stage in the queue now sets the patient's open visits to `closed`; only a visit started today can be continued. | `services/queueManagement.ts` `moveToNextStage`, `pages/PatientDetail.tsx` | — |
| 10 | A lab result's interpretation must be chosen | The result-entry form defaulted Interpretation to "Normal", so a critical result saved in a hurry was filed as normal and sorted to the bottom of the review queue. It now starts empty and must be picked. The allowed values (normal / abnormal / critical) and their meaning are unchanged. | `features/labs/LabResultEntryDialog.tsx` | Set the default back to `normal` |
| 11 | The training game no longer completes real patients | Queue Maestro called `completeService` on a **real** queue row two seconds after "Process next patient", with a random 2–8 minute service time, marking the patient done at that stage without being seen and without moving them on. It now starts service like the queue board, and counts the patient only when their stage is really finished elsewhere. | `features/gamification/QueueMaestro.tsx` | Not recommended |
| 12 | Patient emergency help dials 112 | The portal's emergency sheet showed a placeholder number (`0800123HELP`) and an "Alert my health worker" button that only wrote to the phone's local storage, which nothing reads. It now offers Call 112 (Nigeria's national emergency number) and the patient ID, and says plainly that the portal cannot alert anyone. | `features/patient-portal/EmergencyHelp.tsx` | Confirm 112 for every deployment, or make the number configurable |
| 13 | Acknowledging a clinical alert needs the consult permission | Any signed-in user could acknowledge a clinical-insight alert. It now needs `consult` (doctor, lead clinician, admin) and is audit-logged. Nurses lose this ability; the screen is not routed today. | `features/clinical/ClinicalInsightsDashboard.tsx` | Add nurses to the check |
| 14 | Marking a lab result reviewed needs the `lab_review` permission | The old dashboard let any role on `/labs` (doctor, nurse, admin) mark critical results reviewed. Review now needs its own permission, `lab_review`, not `consult`, so it can be granted to other authorised professionals (for example lab scientists or senior nurses) without granting consultations. It is granted to doctor, lead clinician and admin for now; **the list must follow DIOF clinical policy** and must match `public.app_has_permission(..., 'lab_review')` in the database, which enforces the same rule on the server. The action is hidden without the permission and checked again before the write. Nurses can still collect specimens, start processing and enter results. | `auth/roles.ts` `lab_review`; `features/labs/LabResultsDashboard.tsx` `canReview`, `review()` | Grant `lab_review` to more roles in `auth/roles.ts` **and** the database function together |
| 15 | A lab result is never saved without a chosen interpretation | Follows row 10. The dashboard refuses to send a result whose interpretation is empty or unknown, because the `lab_results.interpretation` column defaulted to `normal` on the server (until `20260925100500` dropped the default), so an omitted value would be filed as normal. A stored result with a missing or unknown interpretation is shown as "Interpretation missing, check result" (warning), never as normal. Sorting keeps the worst interpretation; a later normal result never hides an abnormal or critical one. | `features/labs/LabResultsDashboard.tsx` `saveResult`, `ResultCell`; `features/labs/labWorklist.ts` `isInterpretation` | Not recommended. The column default was dropped in `20260925100500` (see "Lab result interpretation default in the database" in 2.3) |
| 16 | Knowledge Blitz insulin storage question corrected | Q2 taught that insulin (with paracetamol and cough syrup) is stored "in a cool, dry place". It now asks how **unopened** insulin is stored: refrigerated at 2–8 °C and never frozen; an in-use vial or pen may be kept at room temperature (below about 30 °C) for the limited period on the product label. No option teaches a generic "cool, dry place" rule. Q3 (handwashing) was reworded to ask for the minimum scrub time, since "30 seconds" also satisfied "at least 20 seconds". Training content only; nothing in patient care reads it. | `features/gamification/KnowledgeBlitz.tsx` | — |
| 17 | Triage priority is carried to the next stage; only a clinician can lower it | Owner decision 3.3. `moveToNextStage` re-queued every patient at the next stage as `normal`, so an urgent patient lost urgent status after vitals or consultation. The patient's priority is now carried to each next stage. Lowering it needs the `consult` permission (doctor, lead clinician, admin), the clinician signed in on the device and a reason (up to 500 characters); it is recorded as a `priority_downgrade` audit row (who, when, from, to, why), and the server applies it only through that audited transition. Raising to urgent is open to queue staff and is audited as `priority_escalate`. An urgent ticket joins its stage line ahead of every waiting non-urgent ticket, behind urgent ones already waiting; Moving a ticket forward (`skipQueue`) and the long-wait escalation (`checkStaleQueues`) move it only within its priority. Who is urgent is still decided by staff: no triage rule changed. | `services/queuePriority.ts` `insertionPosition`, `mayDowngradePriority`; `services/queueManagement.ts` `moveToNextStage`, `downgradePriority`, `escalatePriority`, `skipQueue`, `checkStaleQueues`; server: `tg_queue_transition_apply` in `20260925100200` | Not recommended (owner decision) |
| 18 | Dispensing checks allergies across merged records | A prescription can name a patient record that was later merged into another on the device. `/rx/dispense` looked up allergies only under the prescription's own record id, so after a merge (which moves allergies to the kept record) it found none and did not warn. It now follows the merge to the kept record and checks the allergies of every record in the chain. The matching rule (row 5) and the acknowledgement (row 6) are unchanged. | `features/pharmacy/dispensePatient.ts` `resolveDispensePatient`; `features/pharmacy/Dispense.tsx` | Not recommended |
| 19 | A refused dispense never erases medicine already handed over | When the server refused a dispense, the device deleted its dispense record and reopened the prescription, even when the screen had already said "saved on this device" (offline, or after the 8-second confirm wait) and the medicine may have been handed over. Now, when the medicine was reported handed over: a refusal for lack of server stock is sent again as handed over, so the server records it with a stock discrepancy; any other refusal keeps the dispense on the device, does not reopen the prescription, and lists it under "Dispensed on this device" as refused, for a stock count and reconciliation. A refusal the pharmacist saw before handing over still undoes the dispense. | `sync/pharmacySync.ts` `rx_dispense` `onRejected`; `sync/pharmacySyncModel.ts` `refusedDispenseAction`, `prescriptionFromServer`; `services/pharmacyCommands.ts` `confirmDispenseNow`; `features/pharmacy/Dispense.tsx` | Not recommended |
| 20 | Dispensing needs an identified patient | `/rx/dispense` showed only the patient's name, and a prescription whose patient record was not on the device read "Unknown patient" yet could be dispensed with an empty allergy check. Each prescription now shows the MBHR ID, sex and age; the dispense panel shows the patient header (ID, sex, age, ticket, recorded allergies) of the record the patient lives on after any merge. Dispensing is blocked, with a message, when the patient has no record on the device or was merged into a record that is not on the device. A second identifier is not yet confirmed by the pharmacist. | `features/pharmacy/Dispense.tsx`; `features/pharmacy/dispensePatient.ts` `resolveDispensePatient`, `dispensePatientBlock`, `identityLine` | Not recommended |
| 21 | A merged-away patient record is screened and treated on the kept record | After a merge, the merged-away record keeps its name, date of birth and phone, but its allergies and history move to the kept record, so an allergy check on the merged-away id found nothing. Patient search no longer offers merged-away records. Choosing one at `/pharmacy` or `/rx/new` continues on the kept record. `/rx/new` and `/rx/dispense` check allergies recorded on both the chosen id and the kept record. The patient header shows "Merged record: check allergies on the kept record" (linking to it) instead of "No known allergies recorded", and the merged-away record's page offers no actions, only a link to the kept record. No allergy matching rule changed. | `services/activePatient.ts`; `features/pharmacy/RxForm.tsx`; `features/pharmacy/Dispense.tsx`; `components/patient/PatientContextHeader.tsx`; `stores/patients.ts`; `pages/Pharmacy.tsx`; `pages/PatientDetail.tsx` | Not recommended |

### 2.3 Flagged, not changed

- [x] **SmartMedication interactions** showed generic "Potential interaction between X and Y" for any pair not in the built-in list. Resolved by removal: `src/services/smartMedication.ts` was unreachable (no static or dynamic import, test, route or training path used it) and was deleted so that nobody treats it as authoritative decision support. Any future interaction checking needs a new, clinician-reviewed design.
- [ ] **Queue wait estimates** (`services/predictiveQueue.ts`) use a fixed 5-minute default in places. They are labelled as estimates.
- [ ] **QuickTriage** suggested priority is rule-based (ABC + symptoms). It was labelled "AI"; the label changed, the rules did not.
- [ ] **Queue priority** (`services/queueManagement.ts`): `moveToNextStage` re-queues a patient at the next stage as `normal`, so an urgent patient loses urgent status after vitals or consultation. `calculatePosition` treats any waiting item at position ≤ 10 as urgent, so an urgent ticket is placed at `min(waiting, 10) + 1`, often last. `checkStaleQueues` moves any wait over 60 minutes to position 1. The ticket screen no longer promises that urgent patients go to the front.
      *Status: the three behaviours were changed after this was written (row 17; Wave B item "Urgent patients stay ahead in the queue"). Tick when a clinician has reviewed row 17.*
- [ ] **Ticket day boundary**: the daily ticket sequence keys on the UTC date, so tickets issued 00:00–01:00 WAT count under the previous day.
- [ ] **Training content** (needs clinical review): Knowledge Blitz Q2 is corrected (row 16). Knowledge Blitz Q4 expects "Urgent priority" for chest pain with difficulty breathing while its explanation calls it a potential cardiac emergency; confirm against the local triage protocol (it may warrant the highest, emergency category). Q6's 36.1–37.2 °C "normal temperature" band is a textbook range that differs from the fever flag (≥38.0 °C). Vitals Precision uses hard-coded per-case ranges that may disagree with `utils/vitals`. Triage Sprint's expected priorities are not tied to QuickTriage or local protocol. Queue Maestro rewards speed on live patients.
- [ ] **SMS medication reminders** (`services/sms.ts`, not wired up today): `parseFrequency` matches "daily" before "twice/three times", so BID/TID/QID become once a day, and any number in the directions ("for 5 days", "500 mg") is read as doses per day. Dispense-time reminders say "take your X now" and are always scheduled for 09:00 the next day.
- [ ] **Lab codes**: the quick-pick code for the malaria rapid test is `MRDTrunc` (likely meant `MRDT`), and the FHIR mapper labels these local codes as LOINC. No H/L direction is stored for results; only the chosen interpretation.
- [ ] **Sync conflicts on clinical records**: vital signs can be merged field by field, which can leave the stored BMI and flags out of step with the chosen measurements (they are not recomputed). Vitals are classed as low-sensitivity, so nurses and doctors resolve them without approval; consultation notes need Admin approval. These are policy choices to confirm.
- [ ] **Patient portal vitals badges** (`PatientDashboard` `bpStatus` / `tempStatus`, unchanged): blood pressure is judged on systolic alone (<120 Normal, 120–139 Monitor, ≥140 Attention; 80/50 shows Normal) and low temperatures are never escalated (34 °C shows Monitor). Both differ from `utils/vitals` used by staff. The weight badge that always said "Normal" was removed; the portal now notes the badges are a guide, not a diagnosis.
- [ ] **"Most recent" readings by primary key**: `predictiveQueue.calculatePriorityScore` and `clinicalDecisionSupport.assessPatientRisk` take the "latest" vitals/visits with `.reverse().limit()` on the primary key, not `takenAt`, so an older reading can drive queue priority or risk. Their thresholds also differ from `utils/vitals` (and `analyzeVitals` uses SpO₂ <94 and pulse >120).
- [ ] **QuickTriage**: the UI never sets temperature, so the fever rule and the "low" suggestion never fire; on `/triage/quick` the result is saved only as a training sample, not applied to the queue.
- [ ] **Removed unrouted screens**: `EnhancedPharmacy`, `FEFODispenser`, `EnhancedVitalsForm` and `SmartMedicationDashboard` were not reachable from any route and carried their own FEFO, interaction and vitals logic (one never checked expiry; one pre-filled normal-looking vitals). They were deleted; dispensing uses `Dispense` with `features/pharmacy/fefo.ts`, and vitals use `VitalsForm` with `utils/vitals`.
- [ ] `EnhancedVitalsInput` (still used) marks "critical" at 30 % outside range, which does not match `utils/vitals`.
- [ ] **Patient-editable clinical fields**: the portal's Update health record lets patients edit blood type and medical notes on the clinical patient row (these columns do not exist in the current schema, so saves fail and say so). Decide whether they should be staff-only.
- [ ] **Lab result interpretation default in the database**: the migrations before `20260925100500` made `lab_results.interpretation` `NOT NULL DEFAULT 'normal'`, so any writer that omitted the field filed the result as normal. `20260925100500_lab_results_release.sql` drops the default. It adds `NOT NULL` only when no stored row lacks an interpretation; if some do, it raises a warning ("NOT NULL not added. Review them.") and leaves the column nullable, so those rows stay empty (shown to staff as "Interpretation missing, check result") and cannot be released. The staff app always sends a chosen value (row 15). After deployment, check that the migration did not warn; confirm with the Wave B item on the database default in 2.4.

The "Urgent status after vitals" item that was listed here is decided: see
section 3.3.

### 2.4 Wave B: questions for clinical review

Wave B (September 2026) moved portal access, queue tickets and queue
status, patient merges, pharmacy stock and lab result release to the server
(`supabase/migrations/20260925100100` to `20260925100500`). The package
authors report that no reference range, alert threshold, dosing rule,
triage rule or interpretation rule was changed. The items below are
behaviours that need a clinician's decision or confirmation. Tick an item
only when a clinician has decided it, and write the decision next to it.

- [ ] **Who may lower a patient's queue priority.** The server applies a
      priority downgrade only when the role recorded on the device holds
      `consult` (doctor, lead clinician, admin), and the uploading account
      also holds `consult` or the recorded user is a clinician on the
      server. Raising priority is open to every queue role. Confirm that
      downgrading urgent status is clinician-only. (`services/queuePriority.ts`;
      server: `tg_queue_transition_apply` in `20260925100200`)
      *The owner has decided that only a clinician may lower it (section
      3.3); the clinician confirms that `consult` holders are the right
      people.*
- [ ] **Long-wait escalation clock.** `checkStaleQueues` measures the wait
      from `updatedAt` (the last change to the queue row), not from
      `queuedAt`. A patient who was called and re-queued, or whose priority
      changed, starts the 60-minute clock again. Decide whether escalation
      should count from `queuedAt`. (`services/queueManagement.ts`
      `checkStaleQueues`)
- [ ] **Urgent patients stay ahead in the queue.** "Move to front" and the
      long-wait escalation could place a normal or low priority ticket
      ahead of waiting urgent patients; they no longer do. Urgent tickets
      are still placed ahead of every waiting non-urgent ticket. Confirm.
      (`services/queueManagement.ts`)
- [ ] **Unknown lab interpretation in the review worklist.** A result with a
      missing or unknown interpretation is ranked with abnormal (above
      normal, below critical), and the worklist banner counts these results.
      Decide whether it should rank with critical.
      (`features/labs/labWorklist.ts`)
- [ ] **Portal wording for lab results.** Patients see "In the usual range"
      (normal), "Outside the usual range" (abnormal), "Needs prompt
      attention" (critical) and "Ask the clinic about this result" (missing
      or unknown). Display only: the interpretation is still chosen by the
      person who records the result. Approve or change the wording.
      (`features/patient-portal/portalStatus.ts` `portalLabInterpretationInfo`)
- [ ] **Advice shown with a lab result.** New patient-facing copy, for
      example for a critical result: "This result needs prompt attention.
      Contact the clinic or the outreach team as soon as you can. If you
      feel very unwell, go to the nearest hospital." Approve or replace the
      advice for each interpretation. (`features/patient-portal/portalStatus.ts`
      `portalLabAdvice`)
- [ ] **Old results with no recorded interpretation.** Split from "Results
      reviewed before release existed" (now decided, section 3.1). Old
      results with no recorded interpretation cannot be released at all
      until a new result is entered (the server refuses with
      `no_interpretation`). Decide how to handle them.
- [ ] **Releasing a withheld result.** A clinician with `lab_release` may
      release a result that was withheld earlier. The dashboard offers it
      only when nothing else on the order is waiting and warns first; the
      server allows it at any time. Confirm.
- [ ] **No database default of "normal".** `20260925100500` drops the
      `lab_results.interpretation` default, so a writer that leaves the
      interpretation out is refused instead of filing the result as normal
      (see "Lab result interpretation default in the database" above).
      Confirm.
- [ ] **Nurse prescribing.** The app lets nurses write prescriptions
      (`/rx/new`, `canPrescribe` in `services/pharmacyCommands.ts`), but the
      server accepts a new prescription only from `consult` holders. A
      nurse's prescription reaches the server only when a prescriber syncs
      on the same device, or with the dispense that carries it. Decide
      whether nurses may prescribe (then the server rule changes) or not
      (then the app should stop offering it).
- [ ] **Offline dispensing that stock does not cover.** When medicine was
      handed over offline and the server's in-date stock cannot cover it,
      the server records the full handover, takes what stock it can and
      files the rest in `stock_discrepancies`. It never refuses medicine
      already given. The pharmacist must count the lots and mark each
      discrepancy reconciled, which needs a connection. Confirm this
      process and who reconciles.
- [ ] **Offline handover the server refuses for another reason.** If the
      prescription was already dispensed or voided, or its lines differ,
      the device removes its dispense rows; the handover (possibly a
      duplicate) is kept only in Conflicts and a "Refused by the server"
      badge. The allergy-override audit entry is kept even when the server
      refuses. Decide whether the server should record an offline handover
      in these cases too.
- [ ] **Lot expiry near midnight.** The device treats a lot as expired from
      the start of its expiry day in the device's time zone; the server uses
      the Africa/Lagos date. They agree on devices set to Nigerian time.
      Confirm that devices must be set to West Africa Time (otherwise the
      server may refuse a lot the device showed as usable near midnight; the
      pharmacist sees the reason).
- [ ] **Allergies and preferences when records are merged.** Allergies from
      both records end up on the kept record. A patient's preferences (and
      data-sharing preferences) move only when the kept record has none;
      otherwise the merged-away record keeps its own and they are not
      combined field by field. Decide whether that is acceptable.

## 3. Owner decisions (decided)

These are decided by the owner and are not open questions. The code
described under each is still reviewed by a clinician through the linked
checklist items.

### 3.1 Reviewed lab results are released one by one, never in bulk

**Decision.** Results that were already reviewed when `20260925100500` is
applied stay unreleased. There is no bulk release: reviewed is not the same
as released. A clinician with `lab_release` releases each result
deliberately (one `lab_release_result` call per result, from the lab
dashboard). The migration has no backfill and releases nothing on its own.

Moved from 2.4 (was an open question):

> **Results reviewed before release existed.** Results already reviewed
> when `20260925100500` is applied are not released to the portal
> automatically. Releasing them in bulk is a clinical decision (one
> `lab_release_result` call per result). Old results with no recorded
> interpretation cannot be released at all until a new result is
> entered (the server refuses with `no_interpretation`). Decide how to
> handle both.

The part about old results with no recorded interpretation is still open:
see "Old results with no recorded interpretation" in 2.4.

### 3.2 Pharmacy opening stock is set once per site, on one designated device

**Decision.** A site's opening stock is established on one designated
device (one session) per site, as an auditable inventory event. Other
devices do not upload their own opening stock; they pull the server's stock.

How the code does this today (`20260925100400_pharmacy_stock_ledger.sql`):
the opening balance is uploaded through `rx_receive_stock` as an
`opening_balance` movement in the append-only `stock_movements` ledger. The
first device to upload an opening balance for a site claims it
(`pharmacy_site_onboarding`); a second device is refused
(`opening_stock_already_uploaded`) and must use the server's stock. The
operational steps (choosing the device, checking `stock_balance_drift`) are
in `docs/security/PRODUCTION_HARDENING_CHECKLIST.md` ("Pharmacy opening
stock").

### 3.3 Urgent triage status stays until a clinician deliberately lowers it

**Decision.** Once a patient is urgent, they stay urgent at every stage
until an authorised clinician deliberately lowers the priority, with the
reason, the time and the user recorded.

Implemented as row 17 (checklist item in 2.2). Moved from 2.3 (was listed
as open):

> **Urgent status after vitals** (see "Queue priority" above): owner
> decision is that triage escalation must persist until an authorised
> clinician deliberately downgrades it, with reason, time and user
> recorded. A separate change (`services/queuePriority.ts`,
> `services/queueManagement.ts`) carries priority between stages; it is
> not described in the table above yet. Keep this item open until that
> change is documented here and reviewed by a clinician.

That change is now documented as row 17. Clinician review: row 17 and the
Wave B item "Who may lower a patient's queue priority".

## 4. Change log

Add a row for every pull request that changes clinical logic, newest first.
Write in plain English what changes for patients or staff. A row records a
change; it does not approve it. Link the checklist item in section 2 that a
clinician must sign off, or write "None" and say why.

| Date | Pull request | What changed | Files | Checklist item (section 2) | Clinician sign-off |
| --- | --- | --- | --- | --- | --- |
| 2026-09-25 | Queue: urgent first in every waiting line | The staff queue screens (queue board "Call next", the Queue page and the ticket board) now order each waiting line urgent first, then by queue position, then by time queued. Positions are renumbered on each device and can arrive out of date from another station; an urgent patient could then sit behind non-urgent ones. This is the order row 17 already intends (`insertionPosition`), so nothing changes while positions agree. Who is urgent, and how priority is carried or lowered, are unchanged. | `src/services/queuePriority.ts` `compareWaiting`; `src/components/EnhancedQueueBoard.tsx`; `src/pages/Queue.tsx`; `src/features/tickets/queueBoardModel.ts` `splitStage` | 2.2 row 17 (same ordering rule) | Pending |
| 2026-09-25 | Dispense: patient identity | The dispense list shows MBHR ID, sex and age for each prescription, the dispense panel shows the patient header, and dispensing is blocked when the prescription's patient cannot be resolved to a record on the device (missing, or merged into a missing record). | `src/features/pharmacy/Dispense.tsx`, `src/features/pharmacy/dispensePatient.ts` | 2.2 row 20 | Pending |
| 2026-09-25 | Dispense: refusals after hand-over | A dispense the screen reported as saved (offline, or after the confirm wait) is no longer deleted or reopened when the server refuses it. A stock refusal is resent as handed over; other refusals keep the record on the device and list it for reconciliation. | `src/sync/pharmacySync.ts`, `src/sync/pharmacySyncModel.ts`, `src/services/pharmacyCommands.ts`, `src/features/pharmacy/Dispense.tsx`, `src/db/mbhr.ts` | 2.2 row 19 | Pending |
| 2026-09-25 | Dispense: allergies after a merge | The dispense screen follows a merged patient record to the record it was merged into and checks medication allergies recorded on every record in that chain, so a merge on the device no longer hides an allergy from the dispense check. | `src/features/pharmacy/Dispense.tsx`, `src/features/pharmacy/dispensePatient.ts` | 2.2 row 18 | Pending |
| 2026-09-25 | Queue: send-on status | Sending a patient to the next stage now records the finished ticket's own status (`done`) in the `send_on` transition, so the server closes that ticket. Before, it recorded the next stage's `waiting`, which the server applied to the finished ticket, leaving the patient listed at two stations. No priority, triage or ordering rule changed. | `src/services/queueManagement.ts` `moveToNextStage` | None: queue bookkeeping only, no clinical rule changed | Not needed |
| 2026-09-25 | Patient identity: merged records | Merged-away patient records are left out of patient search. Prescribing and pharmacy continue on the kept record, and allergy checks at `/rx/new` and `/rx/dispense` include allergies recorded on the kept record. The patient header warns that a merged record's allergies are on the kept record instead of showing "No known allergies recorded". No allergy matching rule, threshold or dosing rule changed. | `src/features/pharmacy/RxForm.tsx`, `src/features/pharmacy/Dispense.tsx`, `src/components/patient/PatientContextHeader.tsx`, `src/services/activePatient.ts`, `src/stores/patients.ts`, `src/pages/Pharmacy.tsx`, `src/pages/PatientDetail.tsx` | 2.2 row 21 | Pending |
| 2026-09-24 | Wave B: registration lead role | New staff role `registration_lead`: register, queue, portal_manage and portal_invite (sending portal invitations). It has **no clinical permission**: no `vitals` (owner decision: registration-focused, not clinical; vitals stay with staff explicitly assigned to that workflow), no `consult`, `lab_review`, `lab_release` or prescribing. No existing role gained a clinical permission. | `src/auth/roles.ts`, `src/utils/permissions.ts`, `supabase/migrations/20260925100600_registration_lead_portal_invite.sql` | None: no clinical permission is granted | Not needed |
| 2026-09-24 | Wave B: lab result release | Reviewed results are no longer shown to patients automatically. A result reaches the portal only after review **and** a deliberate release by a `lab_release` holder (doctor, lead clinician, admin), one result at a time; results already reviewed when the migration is applied stay unreleased. No reference range, threshold or interpretation rule changed: the interpretation is still chosen by the person who records the result. The dropped `'normal'` database default is covered by the 2.3 and 2.4 items. | `supabase/migrations/20260925100500_lab_results_release.sql` | 3.1 (decided); 2.4 "Releasing a withheld result", "Old results with no recorded interpretation", "No database default of 'normal'" | Pending |
| 2026-09-24 | Wave B: remove SmartMedication | `src/services/smartMedication.ts` was deleted. It was unreachable decision support (no import, route, test or training path used it) that reported a generic "potential interaction" for any pair not in its list. Nothing replaces it; no screen or patient sees a change. Any future interaction checking needs a new, clinician-reviewed design. | `src/services/smartMedication.ts` (deleted) | 2.3 "SmartMedication interactions" (resolved by removal) | Not needed (no behaviour change for users) |
| 2026-09-24 | Clinical logic gate | No clinical behaviour changed. This file became the blocking checklist, with the gate described in section 1. Row 17 documents the existing priority carry-over. The note on the lab interpretation database default was corrected (`20260925100500` dropped it). Three owner decisions recorded in section 3. | `docs/clinical/CLINICAL_LOGIC_CHANGES.md`, `scripts/check-clinical-logic-change.mjs`, `.github/workflows/build.yml`, `.github/pull_request_template.md` | 2.2 row 17 | Pending |
