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
- [x] Row 18: Dispensing checks allergies across merged records.
      Decision received 2026-09-25: **approve**. The check follows the
      whole merge chain; the kept record stays the one shown to staff; an
      allergy recorded on more than one record is shown once (done: see
      section 4, "Clinician sign-off follow-up").
- [x] Row 19: A refused dispense never erases medicine already handed over.
      Decision received 2026-09-25: **approve with changes**. A handed-over
      dispense stays recorded (medicine, strength, quantity, directions,
      patient, dispenser, actual time, device and outreach site, sync status,
      refusal reason, later reconciliation outcome) and remains auditable
      after the discrepancy is resolved. A failed sync never reopens the
      prescription. Stock discrepancies go to the pharmacist-in-charge or
      outreach pharmacy lead; a refusal that may be clinical (wrong patient,
      invalid or void prescription, another medication-safety problem) is
      also escalated to the prescriber. Open: the refused dispense is kept
      only on the device today; recording it, its reconciliation outcome and
      the escalation on the server needs a database change.
- [x] Row 20: Dispensing needs an identified patient.
      Decision received 2026-09-25: **approve with changes**. Routine
      dispensing is blocked without the patient's record, and an empty
      allergy check never means "no allergies". Before handover the
      pharmacist confirms the name and a second identifier (date of birth or
      MBHR ID; the outreach ticket number when a date of birth can't
      reliably be given), said by the patient or caregiver, not read off the
      screen (done: see section 4). No ordinary senior-clinician override.
      Open: an emergency break-glass pathway (emergency reason, two
      identifiers checked by hand, manual allergy confirmation, authorising
      clinician, person dispensing, time, full audit, mandatory
      reconciliation afterwards) is not built; it must not become a
      workaround for sync problems.
- [x] Row 21: A merged-away patient record is screened and treated on the
      kept record.
      Decision received 2026-09-25: **approve with changes**. Merged-away
      records are not selectable for clinical actions; the kept record is
      the single active chart. The merged-away page is read-only, points to
      the kept record and shows the merge provenance: old MBHR ID, kept MBHR
      ID, when, by whom and, where recorded, why (done: see section 4).
      All clinically relevant history from the merged record must be
      reachable from the kept record: to be verified in the staging
      workflow test.
- [x] Row 22: Unreviewed critical lab results are shown without opening
      /labs.
      Decision received 2026-09-25: **approve with changes**. The alert
      goes to the ordering clinician, the clinician responsible for the
      patient, authorised nurses caring for the patient and a designated
      clinical escalation role, not to a generic administrator (the banner
      no longer shows for admins: see section 4). The alert should appear
      as soon as a result becomes critical, with the one-minute refresh as a
      fallback. A critical result stays outstanding until an authorised
      clinical user acknowledges it; viewing is not acknowledging; record
      who, when, which result and any initial action or escalation.
      Unacknowledged results escalate, by SMS where useful, with no result
      or patient details in the text. Clinical leadership sets the
      acknowledgement and escalation times per type of result. Notification,
      acknowledgement and escalation are audited. Open: acknowledgement,
      immediate alerts, per-patient audience, escalation and SMS need
      database and server work.

      These decisions approve the workflow and patient-safety changes only.
      They do not approve any allergy-matching rule, laboratory reference
      range, medication dose, treatment recommendation or triage threshold.
      Signed off: Emeke Okobah, Director (no professional registration
      given), 2026-09-25. Signature: KCO.
      Decision: row 18 accept; rows 19 to 22 change as described above.
      Rows 18 to 22 are ticked on this sign-off by the owner's decision
      (Emeke Okobah, 2026-09-25): the Director's sign-off is accepted for
      these rows without a clinician's professional registration. The open
      items listed under rows 19, 20 and 22 are still to be built.

- [ ] Row 23: Height and weight no longer compared with the heart-rate range.
- [ ] Row 24: Adult heart-rate, blood-pressure and BMI flags are no longer applied to children.
- [ ] Row 25: Patient header: paediatric prompt instead of adult blood-pressure category.
- [ ] Row 26: Vitals can be saved with only the measurements taken; systolic must be above diastolic.
- [ ] Row 27: Vitals save failures are shown, and unsaved vitals are not discarded without asking.
- [ ] Row 28: Abnormal-vitals counts ignore the paediatric-chart prompt on its own.
- [ ] Row 29: Patient header: a failed allergy read is not shown as 'no known allergies'.
- [ ] Row 30: Allergy check uses every allergy type.
- [ ] Row 31: Allergies the app cannot check are shown for a check by hand.
- [ ] Row 32: Allergies still loading or unreadable are never shown as none.
- [ ] Row 33: /pharmacy shows only today's consultation as the current plan.
- [ ] Row 34: Lab queue and result forms show MBHR ID, sex and age.
- [ ] Row 35: Specimen collection and result entry wait until the patient can be identified.
- [ ] Row 36: Lab queue no longer silently drops newer open orders.
- [ ] Row 37: Lab result value: spaces trimmed, blank refused.
- [ ] Row 38: Staff told that a saved lab result cannot yet be corrected.
- [ ] Row 39: Patient portal vital-sign badges match the staff screens.
- [ ] Row 40: Quick registration: babies and estimated dates of birth.
- [ ] Row 41: Duplicate check no longer calls siblings 'likely the same person'.
- [ ] Row 42: One visit per patient per day on a double tap.
- [ ] Row 43: Consultation notes are not lost or saved twice.
- [ ] Row 44: Portal access can be switched off at registration.

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
| 20 | Dispensing needs an identified patient | `/rx/dispense` showed only the patient's name, and a prescription whose patient record was not on the device read "Unknown patient" yet could be dispensed with an empty allergy check. Each prescription now shows the MBHR ID, sex and age; the dispense panel shows the patient header (ID, sex, age, ticket, recorded allergies) of the record the patient lives on after any merge. Dispensing is blocked, with a message, when the patient has no record on the device or was merged into a record that is not on the device. Before dispensing, the pharmacist confirms that the patient or caregiver gave the name and a second identifier (date of birth, MBHR ID, or the ticket number when a date of birth can't be given) matching the record; which identifier was used is audited, not its value. | `features/pharmacy/Dispense.tsx`; `features/pharmacy/dispensePatient.ts` `resolveDispensePatient`, `dispensePatientBlock`, `identityLine` | Not recommended |
| 21 | A merged-away patient record is screened and treated on the kept record | After a merge, the merged-away record keeps its name, date of birth and phone, but its allergies and history move to the kept record, so an allergy check on the merged-away id found nothing. Patient search no longer offers merged-away records. Choosing one at `/pharmacy` or `/rx/new` continues on the kept record. `/rx/new` and `/rx/dispense` check allergies recorded on both the chosen id and the kept record. The patient header shows "Merged record: check allergies on the kept record" (linking to it) instead of "No known allergies recorded", and the merged-away record's page offers no actions, only a link to the kept record and the merge details held on the device (old and kept MBHR ID, when, by whom, reason). No allergy matching rule changed. | `services/activePatient.ts`; `features/pharmacy/RxForm.tsx`; `features/pharmacy/Dispense.tsx`; `components/patient/PatientContextHeader.tsx`; `stores/patients.ts`; `pages/Pharmacy.tsx`; `pages/PatientDetail.tsx` | Not recommended |
| 22 | Unreviewed critical lab results are shown without opening /labs | A result saved as critical alerted no one until someone opened or refreshed `/labs`, and the consultation Labs tab showed the order as a green "Completed". The app shell now reads unreviewed critical results when it opens, every minute while online and when the tab becomes visible, and shows the count on the Labs menu item and as a banner on every other page, for doctors and nurses (not administrators, per the clinician's decision). The consultation Labs tab shows the most severe current result with its value and whether it awaits review (for example "Critical: 4.8 g/dL · not reviewed"). No interpretation, range or review rule changed; nothing is sent to anyone outside the app, and no acknowledgement is recorded. | `hooks/useCriticalLabCount.ts`; `components/Layout.tsx`; `features/labs/LabOrderForm.tsx`; `features/labs/labWorklist.ts` `orderOutcomeMeta`; `services/labs.ts` `getLabResultsForOrders` | Not recommended |
| 23 | Height and weight no longer compared with the heart-rate range | On the vitals form, the height and weight boxes were checked against the heart-rate range, so every adult height showed 'Critical value - immediate attention required'. These two boxes now show no normal or abnormal status. BMI and its category still show for adults as before. No threshold, range or dose changed. | `components/VitalsForm.tsx`; `components/EnhancedVitalsInput.tsx` | Not recommended |
| 24 | Adult heart-rate, blood-pressure and BMI flags are no longer applied to children | These adult flags and categories now apply only when the patient was 18 or older on the day of the reading: High/Low BP, High/Low HR, Underweight/Obese, and the BMI and BP categories. They are not raised for a patient under 18, or one with no readable date of birth. For these patients the vitals form also no longer shows the per-box 'normal range' messages from the device's age-banded table. A banner tells staff to check each reading against a paediatric chart and to tell the clinician about any concern before the consultation. Low O2 (SpO2 below 95%), Fever (38.0 C or more) and Hypothermia (below 35.0 C) are still raised and shown on the form at every age, with the same thresholds as before. For example, a child with SpO2 82% is still flagged Low O2. A child's saved reading also carries an amber 'Check paediatric chart' flag, which shows wherever flags are shown (patient timeline, patient record, dashboard list). Adults are unchanged. Readings saved before this change keep their old flags. No threshold, range or dose changed. Paediatric heart-rate, blood-pressure and BMI ranges are an open clinical question. | `utils/vitals.ts`; `components/VitalsForm.tsx`; `components/EnhancedVitalsInput.tsx` | Not recommended |
| 25 | Patient header: paediatric prompt instead of adult blood-pressure category | When the latest reading was taken under 18 or at an unknown age, the patient header no longer shows an adult blood-pressure category. It shows 'Vitals: check paediatric chart' instead. Temperature and SpO2 alerts, for example 'SpO2 82% - Critically low' or 'Temp 40 C - High fever', still show at every age with the same bands as before. Adults are unchanged. No threshold, range or dose changed. | `components/patient/PatientContextHeader.tsx`; `utils/vitals.ts` | Not recommended |
| 26 | Vitals can be saved with only the measurements taken; systolic must be above diastolic | Before, all seven boxes had to be filled before vitals could be saved. Now staff can save only the measurements they took. An empty box is saved as 'not recorded', never as 0, and at least one measurement is needed. The form also now refuses a blood pressure where the systolic is not higher than the diastolic. This rule already existed in the app's shared validation, but the form did not use it. The allowed input limits for each box are the same as before. No threshold, range or dose changed. | `components/VitalsForm.tsx`; `components/EnhancedVitalsInput.tsx`; `utils/vitals.ts` | Not recommended |
| 27 | Vitals save failures are shown, and unsaved vitals are not discarded without asking | If the device cannot save a reading, the form now says 'The vitals were not saved. Your entries are still here — try again.' Before, nothing was shown and the nurse could believe the reading was saved. The reading and its audit entry are now saved together, so trying again cannot create a duplicate. Pressing Cancel after typing values asks before throwing them away, and closing the tab warns. No threshold, range or dose changed. | `components/VitalsForm.tsx` | Not recommended |
| 28 | Abnormal-vitals counts ignore the paediatric-chart prompt on its own | Three counts now leave out a reading whose only flag is 'Check paediatric chart': the outreach report's 'Patients with flagged vitals' figure, the dashboard's 'Abnormal vitals today' list and the doctor station's 'Waiting with abnormal vitals' count. Before this, every child who had vitals taken would have been counted, whatever the values. A child with Low O2, Fever or Hypothermia is still counted and listed, and the dashboard still shows that child's paediatric prompt next to the abnormal flag. A child's heart rate or blood pressure is not counted as abnormal, because adult flags no longer apply to children (see the paediatric row). Adults are unchanged. No threshold, range or dose changed. | `utils/vitals.ts`; `services/outreachReports.ts`; `pages/Dashboard.tsx`; `pages/DoctorDashboard.tsx` | Not recommended |
| 29 | Patient header: a failed allergy read is not shown as 'no known allergies' | If the device cannot read a patient's allergy list, the patient header now shows 'Allergies could not be read: check by hand' in red. Before, it showed 'No known allergies recorded'. When the read works, nothing changes. No allergy matching rule changed. | `components/patient/PatientContextHeader.tsx` | Not recommended |
| 30 | Allergy check uses every allergy type | At /rx/dispense, /rx/new and the /pharmacy dispense form, the allergy check now looks at every active allergy on the patient's record, whatever type it was recorded as (medication, food, environmental or other). Before, only allergies recorded as type 'medication' were checked, so a drug allergy recorded as 'other' (for example one a patient entered through the portal) gave no warning. The existing matching rules (medicine name or listed drug class) still decide whether an allergen matches a medicine. No matching rule, drug class, threshold, range or dose changed. | `features/pharmacy/Dispense.tsx`; `features/pharmacy/RxForm.tsx`; `components/DispenseForm.tsx`; `services/allergies.ts` | Not recommended |
| 31 | Allergies the app cannot check are shown for a check by hand | Some recorded allergens cannot be screened by the app. Examples: a food such as 'Peanuts'; a medicine outside the class list such as 'Chloroquine'; a different spelling such as 'Penicilin'; a salt name such as 'Quinine sulphate'; or a free-text list that includes an allergen the app does not know, such as 'Penicillin, codeine'. The app treats an allergen as screened only when every part of it is a medicine or drug class on its list. Words such as 'drugs', 'allergy', 'class', 'group' or 'antibiotics' are ignored. When an unscreened allergen does not match the medicine by name, staff now see 'Check this allergy by hand'. At /rx/dispense and in the /pharmacy dispense form, dispensing stays blocked until the pharmacist ticks 'I have checked this allergy by hand and will dispense'. This is the same acknowledgement a possible match needs. It is recorded in the device audit log as dispense_allergy_checked_by_hand. At /rx/new it is a warning, as a possible match is there. Before, such allergens gave no warning at all. No fuzzy or misspelling matching was added. The rule that decides whether an allergen matches a medicine is unchanged. No drug class, threshold, range or dose changed. | `utils/allergyMatch.ts`; `features/pharmacy/Dispense.tsx`; `features/pharmacy/RxForm.tsx`; `components/DispenseForm.tsx` | Not recommended |
| 32 | Allergies still loading or unreadable are never shown as none | While the patient's allergies are being read, the /pharmacy dispense form now shows 'Checking recorded allergies…' and keeps dispensing blocked. If they cannot be read, it says so, blocks dispensing and offers Try again. Before, it showed no warning and allowed dispensing in both cases. /rx/new now shows the same loading message, or 'could not be read, ask the patient about allergies', instead of no warning. A dispense saved on the device is no longer reported as 'Nothing was dispensed' when only the audit entry failed, which could have led to a second dispense. No threshold, range, dose or matching rule changed. | `components/DispenseForm.tsx`; `features/pharmacy/RxForm.tsx` | Not recommended |
| 33 | /pharmacy shows only today's consultation as the current plan | /pharmacy showed the patient's most recent consultation, possibly from an old visit, with no date, under 'From the consultation'. It now shows 'From today's consultation' only for a consultation on the visit being dispensed that was recorded today. Otherwise it shows the most recent earlier consultation as 'Earlier consultation', with its date and time and the warning 'Not from today's visit: this plan is from an earlier consultation. Confirm the prescription with a clinician before dispensing.' Every consultation shown there now has its recorded date. No clinical rule, threshold, range or dose changed. | `pages/Pharmacy.tsx`; `features/pharmacy/visitConsultation.ts` | Not recommended |
| 34 | Lab queue and result forms show MBHR ID, sex and age | Each order on /labs, the Enter result form and the Release/Withhold form now show the patient's MBHR ID, sex and age next to the name, so two patients with the same name can be told apart. If the patient's record is not on the device, the MBHR ID still shows, marked 'name, sex and age unknown'. The Enter result form asks staff to check the specimen belongs to this patient before saving. Staff can search the list by MBHR ID. No threshold, range, dose or interpretation rule changed. | `features/labs/LabResultsDashboard.tsx`; `features/labs/LabResultEntryDialog.tsx`; `features/labs/labWorklist.ts` | Not recommended |
| 35 | Specimen collection and result entry wait until the patient can be identified | If an order's patient record is not on the device, 'Mark collected' and 'Enter result' are replaced by a message: the patient cannot be identified, so sync the device and try again. This matches how dispensing already works. 'Start processing', review, release and withhold are unchanged. No threshold, range, dose or interpretation rule changed. | `features/labs/LabResultsDashboard.tsx`; `features/labs/labWorklist.ts` | Not recommended |
| 36 | Lab queue no longer silently drops newer open orders | Before, /labs loaded only the 500 oldest open orders and the 500 oldest results waiting for review. Newer orders, including STAT ones, could disappear from the list with no warning. Now all open orders and all results waiting for review are loaded, up to 5,000 of each. If there are more, a warning says what is missing, and unreviewed critical results are loaded separately so every one is still shown. Sorting on screen is unchanged. No threshold, range, dose or interpretation rule changed. | `services/labs.ts`; `features/labs/LabResultsDashboard.tsx`; `features/labs/labWorklist.ts` | Not recommended |
| 37 | Lab result value: spaces trimmed, blank refused | A result value is saved without spaces at the start or end, and a blank value is refused before anything is saved, even if the form check is bypassed. A unit, range or note that holds only spaces is saved as empty. The value is still free text, and the person recording it still chooses Normal, Abnormal or Critical (rows 10 and 15 unchanged). The form now says the app does not work out the interpretation from the value or range. No threshold, range, dose or interpretation rule changed. | `services/labs.ts`; `features/labs/LabResultEntryDialog.tsx`; `features/labs/labWorklist.ts` | Not recommended |
| 38 | Staff told that a saved lab result cannot yet be corrected | /labs now says a saved result cannot be corrected or withdrawn in the app yet. If a result was entered wrongly, staff should tell a clinician who reviews lab results straight away. A doctor, lead clinician or admin can withhold the result from the patient portal (this already existed). This is information only; a proper correction or entered-in-error step needs a server change. No threshold, range, dose or interpretation rule changed. | `features/labs/LabResultsDashboard.tsx` | Not recommended |
| 39 | Patient portal vital-sign badges match the staff screens | The portal's own badge rules are removed. Blood pressure was judged on the top number only and temperature on its own bands, so 80/50 showed "Normal" and 34 °C showed "Monitor". Portal blood-pressure and temperature badges now use exactly the staff categories (`utils/vitals` `classifyBloodPressure`, `classifyTemperature`), so some adult labels change (for example a bottom number of 90 or more, a top number under 90 or a bottom number under 60 now show "Attention"; 35.0–36.0 °C and 37.3–37.9 °C now show "Normal"; 38.0 °C and below 35.0 °C show "Attention"). Temperature is rated at every age, as the staff fever and low-temperature flags are. Blood pressure for patients under 18 on the day of the reading, or with no date of birth, shows no badge and a note that blood pressure is not rated for children or without a date of birth, and to ask their clinician (interim until paediatric ranges are decided). The "guide, not a diagnosis" note is unchanged. No new threshold or range was created; the only new cut-off is age 18 for rating blood pressure, which needs clinician review. | `features/patient-portal/PatientDashboard.tsx`; `features/patient-portal/portalStatus.ts`; `i18n/locales/*.json (portal.vital.notRated)` | Not recommended |
| 40 | Quick registration: babies and estimated dates of birth | Staff can now give a child's age in months (0 to 23 months). Before, children under 1 could not be registered at all. A date of birth worked out from an age is marked 'estimated'. The mark shows on the patient record, in the edit form and in the duplicate check, and it clears when staff enter a real date. Ages in years still become 1 January of the birth year, as before. Ages in months become the 1st of the birth month. The accepted range (1 to 120 years, or 0 to 23 months) is shown under the age box. If staff type an age outside that range (for example 0 years for a newborn, or 30 months for a 2-year-old), or clear the box, the step cannot be completed: Next stays disabled and the range is shown as an error. Before, the form ignored such an entry and kept the previous number (for example the default 25 years) while the box showed what was typed, so a baby could be saved as an adult. For now the 'estimated' mark stays on the device that registered the patient; other devices show the date without it until the server is updated. No threshold, range or dose changed. | `components/SimplePatientForm.tsx`; `components/VisualNumberInput.tsx`; `utils/ageEstimate.ts`; `db/index.ts (Patient.dobEstimated)`; `stores/patients.ts`; `pages/PatientDetail.tsx`; `components/PatientDedupeModal.tsx`; `i18n/locales/*.json (simple.ageHint`; `simple.ageRangeYears`; `simple.ageRangeMonths)` | Not recommended |
| 41 | Duplicate check no longer calls siblings 'likely the same person' | The duplicate check only says 'Likely the same person' when the first name also matches. Before, two children sharing a family phone and a birth date (twins, or ages entered on quick registration) were called likely the same person even with different first names. Such a record now shows as 'Possible match', with a note that it may be a family member sharing the phone. Staff still choose. No fuzzy or misspelling name matching was added, and the way candidates are found is unchanged. No threshold, range or dose changed. | `utils/dedupeMatch.ts`; `components/PatientDedupeModal.tsx` | Not recommended |
| 42 | One visit per patient per day on a double tap | Tapping 'Start visit' twice, or opening the same patient from two screens at once, no longer opens two visits: the second continues the first. On the patient record, 'Start visit' continues today's open visit that still has a stage to do. If today's visit already has every stage recorded, a new visit is opened, as before. Quick and full registration can no longer register the same patient twice (with two tickets) from a double tap. No threshold, range or dose changed. | `services/visits.ts (ensureTodaysVisit)`; `pages/PatientDetail.tsx`; `components/SimplePatientForm.tsx`; `components/StepperForm.tsx`; `components/PatientForm.tsx` | Not recommended |
| 43 | Consultation notes are not lost or saved twice | Pressing Cancel on the consultation form now asks before discarding notes, diagnoses or a referral that have not been saved. Before, they were dropped without warning. A double tap on 'Complete consultation' can no longer save two consultations and move the patient on two queue stages. No threshold, range or dose changed. | `components/SoapForm.tsx` | Not recommended |
| 44 | Portal access can be switched off at registration | On the full registration form, unticking 'Enable patient portal access' now works. Before, the box could not really be unticked, so the patient was enrolled anyway. Before, typing a phone number or email ticked it automatically; now the box starts unticked and typing never ticks it. For a patient under 18 it is unticked and cannot be ticked, and the patient is not enrolled. Portal enrolment happens only when the box is ticked, and the 'terms explained and agreed' tick is still required then. No threshold, range or dose changed. | `components/PatientForm.tsx` | Not recommended |

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
- [x] **Patient portal vitals badges** (resolved by 2.2 row 39; was `PatientDashboard` `bpStatus` / `tempStatus`): blood pressure is judged on systolic alone (<120 Normal, 120–139 Monitor, ≥140 Attention; 80/50 shows Normal) and low temperatures are never escalated (34 °C shows Monitor). Both differ from `utils/vitals` used by staff. The weight badge that always said "Normal" was removed; the portal now notes the badges are a guide, not a diagnosis.
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

### 2.5 FHIR R4 export: questions for clinical review

The FHIR R4 gateway (`src/interoperability/fhir`, off by default behind
`FHIR_ENABLED`) publishes existing records in a standard format. It changes
nothing staff or patients see in mBHR, and no threshold, range or
decision-support rule. These representation rules decide what another
system would read, so each needs a clinician's decision before the gateway
is switched on anywhere real data exists. Full rules:
`docs/interoperability/resource-mapping.md`.

- [ ] **A stored vital sign of 0 is not published.** A pulse, blood
      pressure, temperature, SpO₂, weight, height or BMI of 0 (or below)
      is left out of the export rather than sent as a reading, because
      "pulse 0" would tell another system the patient had no pulse. Missing
      values are never sent as 0. Confirm, or say whether such rows should
      be sent with a "data absent" marker instead. (Phase 2 changes this
      for blood pressure only, pending sign-off: see 2.7.)
- [ ] **mBHR's vitals flags and ranges are not exported.** No
      interpretation (high/low) and no reference range is attached to a
      reading, because those are local rules still awaiting sign-off in
      2.2. Confirm.
- [ ] **Every saved vitals reading is "final".** mBHR has no preliminary
      or entered-in-error state for vitals. Confirm that a saved reading is
      a completed measurement.
- [ ] **Pulse is published as LOINC "Heart rate" (8867-4) and SpO₂ as
      LOINC "Oxygen saturation in Arterial blood" (2708-6) plus "Oxygen
      saturation in Arterial blood by Pulse oximetry" (59408-5)**. The FHIR
      vital signs profile requires 8867-4 and 2708-6; 59408-5 is mBHR's
      addition, because SpO₂ is read with a pulse oximeter. mBHR's own column name is kept alongside. mBHR does not
      record how a reading was taken. Confirm these match how outreach
      readings are taken.
- [ ] **Diagnosis status is carried over exactly.** A provisional or
      differential diagnosis stays provisional or differential; only
      diagnoses in the `conditions` table are exported. Provisional
      diagnoses typed on the consultation (`provisional_dx`) are not
      exported yet. Confirm that leaving them out is safer than exporting
      them without a stable identity. (Phase 2 changes this for a stored
      "confirmed", which is now sent with no verification status, pending
      sign-off: see 2.7.)
- [ ] **Diagnosis codes stay local unless a person has verified a
      mapping.** An ICD-10 or SNOMED CT code is added only from a reviewed
      entry in `interop.terminology_map`. Decide who may verify a mapping.

### 2.6 Audit follow-up (September 2026): questions for clinical review

Rows 23 to 44 in 2.2 come from the audit follow-up (batches 1 and 2). They
make no new threshold, range, dose or allergy-matching rule; where a
finding needed one, the app now asks staff to check by hand and the
question is listed here. Tick an item only when a clinician has decided it,
and write the decision next to it.

- [ ] Which paediatric vital-sign ranges should the app use to flag children, by age band (newborn, infant, toddler, child, adolescent), for heart rate, blood pressure, temperature, SpO2 and respiratory rate? The device already holds an age-banded reference table labelled WHO/AAP (src/db/seedVitalsRanges.ts). Is that table approved for flagging children? If so, which band applies at the boundary ages (exactly 1, 2, 5, 12 and 18)? The table's bands overlap at those ages. Until now the form used whole-year age, so every infant under 1 year was matched to the newborn (0-4 weeks) band. Should infants be matched by age in months?
- [ ] Should BMI for under-18s be judged with a BMI-for-age chart (for example the WHO growth references), and if so which chart and which cut-offs?
- [ ] Is 18 the right age at which to start applying the adult vital-sign flags, or should some signs (for example SpO2 or temperature) use the adult cut-offs from a younger age?
- [ ] When a patient has no readable date of birth, should their vitals keep the 'check by hand' prompt (the current interim), or should the adult flags be applied?
- [ ] The per-box status on the vitals form calls a value 'Critical value - immediate attention required' when it is more than 30% outside the reference range. This is an existing rule that nobody has signed off. Is it clinically acceptable? The per-box adult ranges (for example systolic 90-120, diastolic 60-80) also differ from the flag thresholds (140/90 for High BP). Which should the form show?
- [ ] Should a child's reading count toward the 'high-risk cases' figure in outreach reports and the doctor station's 'abnormal vitals' count? Every child's reading now carries the 'Check paediatric chart' flag, so all of them are counted.
- [ ] Misspelt allergens: should the allergy check tolerate misspellings (e.g. 'Penicilin', 'amoxcillin', 'sulpha' vs 'sulfa')? If so, by what rule (edit distance, sound-alike, a curated list of known variants), and which false alarms are acceptable? For now, any allergen the matcher does not recognise must be checked by hand before dispensing.
- [ ] Non-medicine allergies: should food, environmental and other allergies (e.g. peanuts, egg, latex, dust) always ask for a check by hand at dispensing? Or only for substances that can be ingredients of medicines (e.g. egg, gelatin, peanut or soya oil)? The interim asks for every allergen the app does not recognise, which may cause alert fatigue.
- [ ] Drug list coverage: should the recognised drug and class list be extended, e.g. antimalarials (chloroquine, artemether/lumefantrine), metronidazole, and brand names such as Amoxil or Tazocin? Correctly spelt allergens outside today's list would then be cleared automatically instead of needing a hand check. Each addition is a matching rule that needs sign-off.
- [ ] Prescribing (/rx/new): should an unrecognised allergen, or allergies that could not be read, block sending the prescription until acknowledged, as at dispensing? Or should it stay a warning, as a possible match is there today?
- [ ] Who confirms a hand check: may the pharmacist confirm an unrecognised allergen alone (current wording: 'I have checked this allergy by hand'), or must they check with the prescriber, as for a possible match?
- [ ] Interim wording: /labs now says 'A saved result cannot be corrected or withdrawn in the app yet. If a result was entered wrongly, tell a clinician who reviews lab results straight away. A doctor, lead clinician or admin can withhold it from the patient portal.' Is this the right interim procedure until correction exists?
- [ ] When correction exists: who may correct a result, or mark it entered in error (the recorder, any lab_review holder, only doctors)? Is a reason mandatory? What must happen to a wrong result that was already released or was critical? For example, must the clinician be told again?
- [ ] Result entry is still free text, with the interpretation chosen by the recorder (rows 10 and 15). Should some tests get a numeric-only check, per-test reference ranges or a fixed qualitative vocabulary (e.g. Positive/Negative/Reactive/Non-reactive)? If so, which tests and which values? No ranges were added.
- [ ] Specimen collection and result entry are now refused when the patient's record is not on the device, as dispensing already is. Is that right for a central lab or hub station entering results for several sites? Or should entry by MBHR ID alone be allowed after an explicit confirmation?
- [ ] The lab queue reads up to 5,000 open orders; if there are more, the oldest are left off, with a warning. The app has no action to cancel a stale order. Should staff be able to cancel open orders, and who?
- [ ] Patient portal: from what age may BP and temperature readings be rated with the adult (staff) categories? Interim: 18, taken from the adult band in the existing reference-range table. Blood pressure for under-18s and for patients of unknown age gets no badge and a note to ask the clinician. Temperature is now rated at every age (as the staff fever and low-temperature flags are); which paediatric BP ranges should apply?
- [ ] Patient portal now uses exactly the staff bands. For example 37.5 °C shows 'Normal' (the portal used to say 'Monitor' above 37.2 °C), and 130-139/80-89 shows 'Monitor' (staff 'Elevated'). Please confirm the portal should follow the staff bands.
- [ ] Quick registration: an age in months becomes the 1st of the birth month (new); an age in years stays 1 January of the birth year. Months are accepted from 0 to 23 (under 2). Please confirm the convention, and whether ages 2-4 should also be entered in months.
- [ ] Duplicate check: 'Likely the same person' now needs the same first name (exact, ignoring case and spaces). Should any other identifier (for example the family name alone, or the MBHR ID) be enough, and is misspelling-tolerant name matching wanted? It is not implemented.
- [ ] An estimated date of birth is weaker as an identifier. Should dispensing (which accepts date of birth as the second identifier) and the patient header show or treat an estimated date differently? Those screens belong to other groups and were not changed.
- [ ] Patient record 'Start visit': if today's open visit already has vitals, consultation and pharmacy recorded, a new visit is opened; otherwise today's visit is continued. The Vitals/Consult/Pharmacy search screens still continue any open visit from today. Should a same-day return always be a separate visit?
- [ ] Which staff roles should open the patient list, individual patient records, the queue and inventory? The interim follows the permission matrix. Registration, vitals, consultation and dispensing staff, plus anyone with the queue or inventory permission, keep access. The auditor role loses these pages in the app, although the dashboard still shows it the live queue summary. Should auditors have read-only record access for audits?
- [ ] Please confirm 10 minutes as the idle lock time for clinical areas, or name a different value per area (for example shorter at registration, longer in consultation). It is a single named constant (STAFF_IDLE_LOCK_MS).

### 2.7 FHIR R4 Phase 2: questions for clinical review

Phase 2 adds allergies, medicines, laboratory orders, results and reports,
documents, consents, staff, sites, provenance and access history to the
FHIR gateway. The gateway is still off (`FHIR_ENABLED` unset), and nothing
changes for staff or patients in mBHR. These rules decide what another
system would read once it is switched on, so each needs a clinician's
decision first. The status maps are in
`src/interoperability/fhir/terminology/status/`, and the full rules in
`docs/interoperability/resource-mapping.md`. Nothing unknown is published
as a definite status, and no code is invented (a test enforces both).

Changes to what Phase 1 published (2.5)

- [ ] **A blood pressure with only one half measured is now published.**
      The measured half is sent; the other (missing, or stored as 0) is
      marked "unknown" (data absent), never sent as 0. Phase 1 left the
      whole reading out, which hid a real measurement. This answers the
      2.5 question on stored 0 for blood pressure only. Confirm that a 0
      half means "not measured", or say to leave such readings out again
      (a one-line change).
- [ ] **Sex "other" is not published.** Registration also stores "other"
      when nothing was chosen, so a real "other" cannot be told apart from
      an unset value; the patient's sex is left out rather than guessed.
      Confirm.
- [ ] **Name, phone and address are sent without a "use".** mBHR does not
      record whether a name is the official one or a phone is a mobile, so
      none is claimed. Confirm.
- [ ] **Visits a staff member adds afterwards on the online staff
      dashboard ("Portal entry") have no start time,** because that time is
      when the visit was typed in, not when care happened. A date search
      never finds them. The site name is matched in any case, and spaces
      around it are ignored. "Portal entry" and "Mobile clinic" are not
      published as a place. Confirm.
- [ ] **A visit status stored with spaces around it is now "unknown".**
      Only the exact values the app writes (such as "open", "closed" and
      "cancelled") are translated, in any case. Phase 1 trimmed the value
      first, so a stored " closed" went out as finished; it is now unknown,
      and a status search does not find it as finished. The app always
      writes the exact value. Confirm that such a visit should not be shown
      as finished.
- [ ] **A diagnosis stored as "confirmed" is sent without a verification
      status.** The `conditions` table fills in "confirmed" when nothing is
      given, so a stored "confirmed" cannot be told apart from an unset
      value. Other values (provisional, differential, unconfirmed, refuted,
      entered in error) are sent as stored. The same table fills in
      "active" as the clinical status when nothing is given, and that is
      still sent as active. Nothing in mBHR writes this table yet. Confirm
      both, before anything starts writing diagnoses there.
- [ ] **A diagnosis end date is sent only beside an ended status**
      (inactive, remission or resolved), as FHIR requires. Phase 1 sent a
      stored end date beside any status. It is now left out beside active,
      recurrence or relapse, and when no status is sent (entered in error,
      or a status that is missing or not recognised). An ended status is
      never guessed from the date. Confirm.
- [ ] **An estimated date of birth is sent as an exact date** (unchanged
      from Phase 1). Quick registration turns an age into 1 January of the
      birth year, or the 1st of the birth month, and the "estimated" mark
      stays on the tablet that registered the patient, so the server cannot
      tell an estimate from a real birthday. Another system could then work
      out an exact age in days or months (for example for a child's dose)
      from it. Options: send it as is (today); or have the app upload the
      mark so the gateway sends only the year (or year and month) for an
      estimate, which needs an app and database change. Which?

Allergies

- [ ] **An empty allergy list never means "no known allergies".** mBHR
      cannot record NKA, so every allergy search says so. Text such as
      "None" or "NKDA" typed as an allergen is published as written, as an
      allergy. Should such rows be cleaned first?
- [ ] **"Mark inactive" is published as `inactive`** ("no longer at
      risk"), although mBHR stores no reason and the same action is used for
      wrong-patient or duplicate entries. The app hides inactive allergies.
      Publish them as inactive, or leave them out?
- [ ] **Severity.** Life-threatening becomes criticality `high` and,
      when a reaction was typed, reaction severity `severe` (the top of the
      FHIR scale). Severe and moderate are sent as reaction severity
      `severe` and `moderate`, but only when a reaction was typed, so a
      severe allergy with no reaction typed carries no rating. `mild` is
      left out because the form pre-selects it. Should `severe` also be
      criticality `high`?
- [ ] **No verification status is published.** mBHR does not record
      whether an allergy was confirmed (the old export said "confirmed").
- [ ] **An allergy's type "medication" is not published as a category.**
      The form pre-selects it, so a stored "medication" cannot be told apart
      from a type nobody chose. Only food and environmental, which someone
      chose, are sent as a category; "other" gets none. A search for
      medication allergies finds nothing. The app itself still checks every
      active allergy against medicines, whatever its type. Confirm, or say
      whether the form should start with no type chosen, so that a chosen
      "medication" can be published.

Medicines

- [ ] **A dispense is never published as `completed` and carries no
      hand-over time.** mBHR has no separate hand-over record. The
      prescription dispensing screen (Pharmacy > Dispense, `/rx/dispense`)
      asks staff to confirm who they hand the medicine to before
      dispensing; the visit dispensing form (`/pharmacy`) does not, and its
      dispenses have no prescription. The held-back migration
      `20260503010200` would mark every dispense that exists when it is
      applied as `completed` and copy its dispense time into
      `when_handed_over`; the gateway ignores both. Should a
      recorded dispense count as a hand-over (then `completed`, with the
      dispense time)?
- [ ] **Prescription status.** Open is `active` (mBHR sets no expiry, so an
      old open prescription stays active), dispensed is `completed` (every
      line given, not the course finished), partial is `unknown`, void is
      `cancelled`. Confirm.
- [ ] **Medicines are text only.** No medicine code is published, doses are
      free text, and a quantity's unit is today's catalogue unit (past
      quantities follow a later change of unit).

Laboratory

- [ ] **A result is `preliminary` until someone with the review
      permission reviews it** (a doctor, lead clinician or admin; an admin
      need not be a clinician), then `final`. A result with no value is never final. Normal, abnormal and
      critical become N, A and AA; H and L are never inferred, and an
      unreviewed "normal" is left out (older rows may carry the form's old
      default). Confirm.
- [ ] **A report is `final` only when every current result is reviewed.** A
      patient's own report is at most `partial`, because the patient's view
      cannot prove that no other result on the order is still unreviewed or
      withheld. Confirm, or decide that patients may see `final` (this would
      tell them a hidden result exists).
- [ ] **Values are published as recorded.** A number becomes a quantity only
      when it is a plain decimal with a unit; UCUM codes are used for 13
      exact unit strings. Reference ranges stay text. Confirm the unit list.

Documents

- [ ] **Patients may download only files they uploaded.** Clinic documents
      have no release step, so patients see that they exist but not their
      content. The clinic description (a staff note) is never published.
- [ ] **Document type is the uploader's own label.** A file labelled "Test
      result" or "Prescription" never becomes a lab result or medicine
      record. Documents from before the uploader was recorded are labelled
      as clinic documents, which includes early patient uploads. Is that
      wording acceptable, and should insurance documents be included?
- [ ] **Doctors, lead clinicians and admins could read every patient's
      document list and files over FHIR,** although the staff app has no
      documents screen today and the owner's rule is that FHIR never goes
      beyond what staff can see in mBHR. Decide whether staff get
      documents over FHIR before a staff documents screen exists (the
      alternative is patients only, for their own files).

Consents, staff and sites

- [ ] **Consents are published exactly as recorded.** A withdrawn consent is
      `inactive` and kept. An unverified one is marked unverified. One with
      no policy, or with a rule the shared format cannot show exactly
      (including a rule that names one specific recipient), is not
      published at all rather than shown broader than the patient agreed;
      a search says how many were left out.
- [ ] **Staff are published by name and mBHR access role only** (the role is
      not a qualification). Confirm "Administrator" and "Lead clinician" as
      the role names.

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
| 2026-09-26 | FHIR sign-off follow-up: consent for one named recipient | None for staff or patients: the `/fhir/R4` gateway stays off and the consent register is not on production yet. A consent with a rule for one specific recipient (for example one hospital) is no longer published as a rule for every recipient of that kind: the whole consent is withheld, and a search says how many were left out. Such a permit never grants access in the consent check, and the staff "External sharing" badge shows it as limited, not allowed; a refusal that names one recipient still refuses, and the badge gives it as "refused in part" rather than "refused". In the patient portal's Privacy section, such a permission reads "A choice about how your records are shared" with "Ask clinic staff about it", instead of a general permission to share outside mBHR. Six items in 2.5 and 2.7 were reworded to match the code (oxygen codes, diagnosis end date history, allergy reaction severity, dispense hand-over, who reviews a lab result, consents). No threshold, range, dose or matching rule changed. | `src/interoperability/fhir/mappers/consent.ts`, `src/interoperability/fhir/resources/consent.ts`, `src/interoperability/fhir/consent/evaluateConsent.ts`, `supabase/migrations-deferred/20260926130000_interop_phase2.sql`, `src/services/interopConsent.ts`, `src/features/patient-portal/privacyCopy.ts`, this file | 2.5 "Pulse is published as LOINC…"; 2.7 "A diagnosis end date is sent only beside an ended status", "Severity", "A dispense is never published as `completed`…", "A result is `preliminary` until…", "Consents are published exactly as recorded" | Pending |
| 2026-09-25 | FHIR R4 interoperability Phase 2 | None for staff or patients: the `/fhir/R4` gateway stays off (`FHIR_ENABLED` unset). When switched on it would also publish allergies, medicines, laboratory orders, results and reports, documents, consents, staff, sites, provenance and access history. How each status, value and code is represented (an empty allergy list is not NKA, an allergy's pre-selected type "medication" is not sent as a category, a dispense is never shown as handed over, a result is preliminary until reviewed, a patient's report is never final, no invented codes) is listed for review in 2.7, together with changes to what Phase 1 published (a blood pressure with one half measured is now sent, sex "other" and name or phone "use" are left out, visits added afterwards on the staff dashboard ("Portal entry") have no start time, a visit status stored with spaces around it is unknown, a stored "confirmed" diagnosis carries no verification status). No threshold, range, dose or matching rule is created. | `src/interoperability/fhir/mappers/*`, `src/interoperability/fhir/terminology/**`, `src/interoperability/fhir/resources/*` | 2.7 (all items) | Pending |
| 2026-09-25 | Audit follow-up: portal note and registration wording | The patient portal note shown beside an unrated blood pressure said none of the readings were rated, although temperature is rated at every age; it now says only blood pressure is not rated for children or without a date of birth. Row 44 now describes the registration form as shipped (the box starts unticked, typing never ticks it, locked off for under-18s). No threshold, range, dose or rule changed. | `i18n/locales/*.json (portal.vital.notRated)`, this file | 2.2 rows 39 and 44 | Pending |
| 2026-09-25 | Audit follow-up: clinical safety and shared-tablet privacy | Vitals: optional measurements, visible save failures, confirm before discarding; height and weight no longer rated against the heart-rate range; adult heart-rate, blood-pressure and BMI flags not applied to under-18s (fever, low temperature and low SpO2 still flagged at every age); a failed allergy read is never shown as none. Pharmacy: every allergy type screened; allergens the app cannot screen need a check by hand; an older consultation is dated and marked as not today's. Labs: patients identified by MBHR ID, sex and age; no collection or result entry for patients not on the device; every open order loaded; blank values refused. Registration and portal: infants and estimated birth dates; siblings not called the same person; no duplicate visits or consultations from a double tap; portal consent can be unticked; portal badges use the staff categories. Also (no clinical rule): idle screen lock, route guards by permission, no automatic erasing of device records, server answers kept out of browser caches, prompt-style app updates, sync conflicts decided on server timestamps. No threshold, range, dose or matching rule was created. | `src/utils/vitals.ts`, `src/components/VitalsForm.tsx`, `src/components/EnhancedVitalsInput.tsx`, `src/components/patient/PatientContextHeader.tsx`, `src/utils/allergyMatch.ts`, `src/features/pharmacy/*`, `src/components/DispenseForm.tsx`, `src/pages/Pharmacy.tsx`, `src/features/labs/*`, `src/services/labs.ts`, `src/features/patient-portal/*`, `src/components/SimplePatientForm.tsx`, `src/components/PatientForm.tsx`, `src/components/SoapForm.tsx`, `src/utils/dedupeMatch.ts`, `src/services/visits.ts`, `scripts/check-clinical-logic-change.mjs` | 2.2 rows 23 to 44; 2.6 | Pending |
| 2026-09-25 | FHIR R4 interoperability foundation | None for staff or patients: the new `/fhir/R4` gateway is off (`FHIR_ENABLED` unset) and only publishes existing records in FHIR format when switched on. How readings, statuses and codes are represented (a 0 reading is not published, no interpretation or range is attached, diagnosis status is kept exactly, codes stay local unless verified) is listed for review in 2.5. The mappers and terminology files are added to the clinical logic gate, so later changes to them must be recorded here. | `src/interoperability/fhir/mappers/*`, `src/interoperability/fhir/terminology/codeSystems.ts`, `scripts/check-clinical-logic-change.mjs` | 2.5 (all items) | Pending |
| 2026-09-25 | Clinician sign-off follow-up (rows 18 to 22) | Records the clinician's decisions on rows 18 to 22 and makes the app-only changes they asked for. Dispensing now needs the pharmacist to confirm that the patient or caregiver gave the patient's name and a second identifier (date of birth, MBHR ID, or the ticket number when a date of birth can't be given) matching the record. The same allergy recorded on several records of a merge chain, or with different case or spacing, shows as one warning. A merged-away record's page shows its old and kept MBHR ID, when and by whom it was merged, and why. The critical lab banner is shown to doctors and nurses, no longer to administrators. No allergy matching rule, range, dose or threshold changed. | `src/features/pharmacy/Dispense.tsx`, `src/features/pharmacy/dispensePatient.ts`, `src/components/patient/MergeProvenance.tsx`, `src/pages/PatientDetail.tsx`, `src/components/Layout.tsx` | 2.2 rows 18, 20, 21, 22 | Emeke Okobah, Director, 2026-09-25 (no professional registration; accepted by owner decision) |
| 2026-09-25 | Critical lab result alert (in app) | Doctors, nurses and admins see the number of unreviewed critical lab results on the Labs menu item and in a banner on every other page, refreshed every minute while online, without opening `/labs`. The consultation Labs tab shows each order's most severe result with its value and review state instead of a plain "Completed". No interpretation, range or review rule changed. | `src/hooks/useCriticalLabCount.ts`, `src/components/Layout.tsx`, `src/features/labs/LabOrderForm.tsx`, `src/features/labs/labWorklist.ts`, `src/services/labs.ts` | 2.2 row 22 | Pending |
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
