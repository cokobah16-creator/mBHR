# Clinical logic changes — for clinical review

The UI redesign was not meant to change medicine. While doing it, a few
places were found where the code did not do what its own rules said. This
file lists every change that affects a clinical decision, so a clinician can
review, accept or revert each one independently.

**No reference range, alert threshold, dosage rule or decision-support rule
was changed.** `flagVitals` thresholds, `vitalsRanges` and the rules in
`services/clinicalDecisionSupport.ts` are untouched.

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

## Flagged, not changed

- **SmartMedication interactions** show generic "Potential interaction between X and Y" for any pair not in the built-in list. This may be over-alerting; review the rule list with a pharmacist.
- **Queue wait estimates** (`services/predictiveQueue.ts`) use a fixed 5-minute default in places. They are labelled as estimates.
- **QuickTriage** suggested priority is rule-based (ABC + symptoms). It was labelled "AI"; the label changed, the rules did not.
