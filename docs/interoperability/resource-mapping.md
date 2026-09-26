# mBHR → FHIR R4 resource mapping

The mapping specification for mBHR's actual tables. Every section below is
served by `/fhir/R4` when the gateway is enabled. The definitions live in
code: one module per type in `src/interoperability/fhir/resources/`
(listed in `resources/registry.ts`, which also generates the
CapabilityStatement), one pure mapper per type in `mappers/`, and the
status maps in `terminology/statusMaps.ts` and `terminology/status/`.
Where this document and the code disagree, the code is right and this
document is out of date.

General rules, all resource types:

- The mBHR tables remain the system of record. Resources are generated on
  read; nothing is copied into a second clinical store.
- Ids are stable and derived, never generated per request (strategy per
  type below). Where a source id cannot be published (staff account ids,
  pharmacy catalogue ids), a random uuid is minted once and kept in
  `interop.resource_links`.
- `meta.versionId` is a digest of the resource as served (24 hex
  characters of SHA-256), set by the gateway after mapping; it changes
  whenever the served content changes. `meta.lastUpdated` is the source
  row's last change time (`updated_at`, else `created_at`) where the type
  publishes one. `meta.source` is `https://mbhr.app`.
- References are `Type/id` (`Patient/<fhir_id>`), never table names or
  internal ids. A patient reference is always the **canonical** record: a
  row still filed under a merged-away record names the kept record. A row
  whose patient cannot be resolved (a merge chain that does not end) is
  not published.
- Only listed columns are read (queries select them by name) and only
  listed elements are published. Free-text staff notes, photos, account
  ids, device ids, portal and sync columns, storage paths and internal
  flags never leave.
- **Unknown stays unknown.** Status and uncertainty are carried over
  exactly. A missing or unrecognised local value becomes `unknown` where
  the FHIR value set has it, or the element is left out, or (where the
  element is required and has no `unknown`) the record is withheld. It is
  never mapped to a "good" value. Missing values are left out, never zero.
  `statusMaps.test.ts` checks every status map for this.
- International codes appear only where the FHIR R4 specification binds
  them for the concept, or from a **verified** row in
  `interop.terminology_map`. Otherwise mBHR's own code system is used:
  `https://mbhr.app/codes/<domain>`. Every code is listed in
  [terminology-review.md](terminology-review.md).
- Every resource passes the structural validator
  (`validation/validate.ts` plus the type's own `validate`) before release.
  A read of a resource that fails is 500; a search leaves it out with a
  warning.
- Clinical representation choices awaiting clinician review are listed in
  `docs/clinical/CLINICAL_LOGIC_CHANGES.md`, sections 2.5 (Phase 1) and 2.7
  (Phase 2).

Contents: [Patient](#patient--publicpatients) ·
[Encounter](#encounter--publicvisits) ·
[Observation, vital signs](#observation--publicvitals-vital-signs) ·
[Observation, laboratory](#observation--publiclab_results-laboratory) ·
[Condition](#condition--publicconditions) ·
[AllergyIntolerance](#allergyintolerance--publicpatient_allergies) ·
[Medication](#medication--publicpharmacy_items) ·
[MedicationRequest](#medicationrequest--publicprescriptions--lines) ·
[MedicationDispense](#medicationdispense--publicdispenses) ·
[ServiceRequest](#servicerequest--publiclab_orders) ·
[DiagnosticReport](#diagnosticreport--publiclab_orders--current-publiclab_results) ·
[DocumentReference](#documentreference--publicpatient_documents) ·
[Binary](#binary--the-stored-file-of-a-document) ·
[Consent](#consent--the-consent-register) ·
[Practitioner](#practitioner--publicapp_users-staff) ·
[PractitionerRole](#practitionerrole--publicapp_usersrole) ·
[Organization](#organization--publicorganizations) ·
[Location](#location--publicsites) ·
[Provenance](#provenance--server-recorded-events) ·
[AuditEvent](#auditevent--interopaccess_audit) ·
[Not implemented](#not-implemented)

## Patient ← `public.patients`

| | |
| --- | --- |
| FHIR id | `patients.fhir_id` (random uuid). `patients.id` (the device ULID) is never published. A trigger (Phase 2) keeps `fhir_id` from changing once set. |
| identifier | `use: usual`, system `https://mbhr.app/identifiers/patient`, value `fhir_id`. mBHR records no MRN or national id; none is invented. |
| active | `false` for a merged-away record; otherwise **left out** (mBHR has no active flag). |
| name | family = `family_name`, given = `given_name` split on spaces, text = both. **No `use`**: mBHR does not record whether a name is official. |
| telecom | `phone` (system phone), `email` (system email). **No `use`**. |
| gender | `sex`: m/male → male; f/female → female; unknown → unknown; any other value → unknown; **`other` → left out** (registration also stores `other` when nothing was chosen, so it is not an assertion); empty → left out. |
| birthDate | `dob`, with less precision on the 1st of a month: 1 January gives the year only (`2021`), the 1st of any other month gives year and month (`2024-06`), any other date is sent in full. Quick registration saves an age as such a date and whether it was estimated is kept only on the tablet, so every date on the 1st is treated alike (a real birthday on the 1st loses its day too; an estimated year can still be a year out). The stored date is not changed and no "estimated" mark is sent. Owner decision, CLINICAL_LOGIC_CHANGES.md 2.7. |
| address | text = `address`, district = `lga`, state = `state`. **No `use`**, and no country (not recorded). |
| link | merged-away record → `replaced-by` the kept record (when the caller can see it). |
| Merged-away record | Served as a **tombstone**: id, identifier, name, `active: false` and the `replaced-by` link only. Contact details, gender, birth date and address are not repeated on it. |
| Never published | `photo_url`, `auth_uid`, `family_id`, portal and sync columns, merge metadata. |
| Searches | `_id`; `identifier`; `name` + `birthdate` together (starts-with on either name, exact date, merged-away records excluded). `birthdate` matches the full stored date, also when `birthDate` is sent shortened: `birthdate=2021-01-01` finds a record whose `birthDate` is `2021`. |
| Who reads | Staff with register, vitals, consult, dispense or lab_review; a patient reads their own record. |

## Encounter ← `public.visits`

| | |
| --- | --- |
| FHIR id | `visits.id` |
| status | See the table. |
| class | v3 ActCode `AMB` ("ambulatory"): mBHR has no inpatient care. |
| subject | the canonical Patient of `patient_id`. |
| period.start | `started_at`. There is no end time column. **No period** for a visit whose site is "Portal entry" (its start is when it was typed in, not when care happened). |
| location | `site_name` as a display-only reference. **Left out** for "Mobile Clinic" (the tablet's default) and "Portal entry", which are not places. No Location resource is referenced (visits record a typed name, not a registered site). |
| Not modelled | Queue tickets are **not** encounters and are not published. Participants, service provider and reason are not recorded on visits. |
| Searches | `_id`, `patient`/`subject`, `date` (started_at, up to two bounds; a visit published without a period, such as a "Portal entry" visit, never matches), `status`. |
| Who reads | Staff with vitals, consult or lab_review; a patient sees their own visits with status `closed` only. |

`ENCOUNTER_STATUS` (`visits.status`, matched case-insensitively but not
trimmed: a value with spaces around it, such as " closed", is `unknown`
in the resource and in a status search alike):

| visits.status | Encounter.status |
| --- | --- |
| open, in_progress, in-progress, active | in-progress (no end time is recorded) |
| closed, completed, finished | finished |
| cancelled | cancelled |
| missing | unknown |
| anything else | unknown |

## Observation ← `public.vitals` (vital signs)

One vitals row becomes up to seven Observations, id `<vitals.id>-<kind>`:

| kind | Column(s) | LOINC (R4 vital signs profile) | UCUM |
| --- | --- | --- | --- |
| bp | systolic, diastolic | 85354-9 panel; components 8480-6, 8462-4 | mm[Hg] |
| heart-rate | pulse_bpm | 8867-4 | /min |
| temperature | temp_c | 8310-5 | Cel |
| weight | weight_kg | 29463-7 | kg |
| height | height_cm | 8302-2 | cm |
| bmi | bmi | 39156-5 | kg/m2 |
| spo2 | spo2 | 2708-6 and 59408-5 | % |

- status `final` (a saved vitals row is a completed measurement; mBHR has
  no preliminary or entered-in-error state for vitals); category
  `vital-signs`; code = LOINC + local `https://mbhr.app/codes/vitals|<column>`
  (for blood pressure the panel code is LOINC only and each component
  carries its column code); subject; encounter = `Encounter/<visit_id>`;
  effectiveDateTime = `taken_at`.
- The vital signs profiles are claimed in `meta.profile` only when
  `taken_at` is present (they require a time; none is invented).
- A value that is missing, not a number, or 0 or below is not published.
- A blood pressure with only one half recorded is still published: the
  missing component carries `dataAbsentReason` `unknown`.
- No interpretation and no reference range (mBHR's flags and ranges are
  local rules awaiting sign-off).
- Not published: `sdoh_observations` (no writer in the app).
- Searches: `_id`, `patient`/`subject`, `encounter`, `date` (taken_at),
  `category` (vital-signs), `code` (a coding the Observation's own code
  carries: the LOINC code above, or the local column code of a
  single-column kind; a blood pressure matches on `85354-9` only, never on
  its components' codes), `status` (final).
- Who reads: staff with vitals, consult or lab_review; a patient sees
  their own rows whose `portal_visible` is not false.

## Observation ← `public.lab_results` (laboratory)

Served by the same Observation module, after vital signs.

| | |
| --- | --- |
| Source | One **current** `lab_results` row (`superseded_by` is null) and its `lab_orders` row. |
| FHIR id | `lab-<lab_results.id>` |
| status | Review state (table below): `preliminary` until reviewed, then `final`. The order status never makes a result final. |
| category | observation-category `laboratory` |
| code | text = `test_name` as recorded. A local `https://mbhr.app/codes/lab-test` coding only when `test_code` **and** `test_name` both still equal one of the 15 quick picks of the order form. No LOINC. |
| subject, encounter | the order's canonical Patient; `Encounter/<visit_id>` |
| basedOn | `ServiceRequest/<order id>` |
| effectiveDateTime | the order's `collected_at` (specimen time); left out when not recorded. Never the order or entry time. |
| issued | `reviewed_at` when final, otherwise `result_date` |
| value | `valueQuantity` only when the value is a plain decimal that JSON keeps with exactly the same digits **and** a unit is recorded; UCUM system and code only for 13 exact unit strings (see [terminology-review.md](terminology-review.md#c-ucum-units-for-laboratory-values)), otherwise `unit` text only. Everything else is `valueString`: the value and unit exactly as the portal shows them ("<0.5 mg/dL", "Positive", "12.50 g/dL"). Nothing is parsed. |
| dataAbsentReason | `unknown` when no value is recorded; such a result is never final. |
| interpretation | normal → N (only once reviewed), abnormal → A, critical → AA. Both the v3 ObservationInterpretation code and the local `https://mbhr.app/codes/lab-interpretation` code are sent. Missing → left out, never "normal". H, L, HH and LL are never produced (no direction is recorded). |
| referenceRange | `[{ text }]` only; never parsed into low and high. |
| Never published | notes (staff and patient notes), performer (reviewer and enterer are accounts), specimen, method, device, bodySite, `hasMember`, `derivedFrom`, the withhold reason, the release time, `amended_at`. The validator refuses them. |
| Searches | `_id` (`lab-<uuid>`), `patient`/`subject`, `encounter`, `based-on`, `date` (collected_at), `category` (laboratory), `code` (quick pick), `status` (final, preliminary). |
| Who reads | Staff with consult or lab_review. Other staff get vital signs only: each of their Observation searches that could include laboratory results carries a note saying they were left out, and a read of `Observation/lab-<id>` answers 403 (audited as `missing_permission`), decided from the id before any lookup. A patient only through `fhir_patient_lab_results()`: reviewed, released to the patient, not withheld, not superseded. |

`LAB_OBSERVATION_STATUS` (review state):

| Review state | Condition | Observation.status |
| --- | --- | --- |
| reviewed | `reviewed_at` set, a known interpretation and a value | final |
| review_incomplete | `reviewed_at` set, interpretation or value missing | preliminary |
| unreviewed | `reviewed_at` null | preliminary |
| missing or anything else | | unknown |

## Condition ← `public.conditions`

| | |
| --- | --- |
| FHIR id | `conditions.id` (uuid) |
| clinicalStatus | `clinical_status` as recorded (already condition-clinical codes); left out when none was recorded or not a code, and on an `entered-in-error` record (invariant con-5). Never filled in: the table has no default, so a diagnosis nobody marked is not sent as active. A problem-list-item with no clinical status is sent without one (R4 con-3 is a warning; none is invented). |
| verificationStatus | `verification_status` as recorded (already condition-ver-status codes): provisional stays provisional, differential stays differential, confirmed stays confirmed. Left out when none was recorded or not a code; never assumed confirmed. The table has no default (owner decision, CLINICAL_LOGIC_CHANGES.md 2.7), so a stored value is one someone chose. |
| category | `problem-list-item`, `encounter-diagnosis` (R4 condition-category); `health-concern` (US Core code system). Left out when none was recorded: the table has no default. |
| severity | mild/moderate/severe → SNOMED CT 255604002 / 6736007 / 24484000 (R4 condition-severity value set). |
| code | local `https://mbhr.app/codes/condition|<condition_code>` with `condition_name` as display and text; plus any **verified** mapping from `interop.terminology_map` (domain `condition`). |
| onset / abatement | `onset_date`; `abatement_date` only beside a published clinical status of inactive, remission or resolved (invariant con-4). It is **left out** beside active, recurrence or relapse, and when no clinical status is published (entered in error, or a missing or unknown stored value): an ended status is never inferred from the date. |
| recordedDate | `created_at` |
| Never published | `notes`, `recorded_by` (free text, not a staff reference). |
| Not yet | `consultations.provisional_dx` (a text array on the consultation, with no stable per-diagnosis id). No app code writes `public.conditions` (repository check), so most diagnoses mBHR records are not in this table. Every searchset carries a note saying so. `conditions` has no encounter column, so there is no `encounter` search. |
| Searches | `_id`, `patient`/`subject`, `clinical-status`, `code` (local system only; another system is 400). |
| Who reads | Staff with consult only. Not available to patients. |

## AllergyIntolerance ← `public.patient_allergies`

| | |
| --- | --- |
| FHIR id | `patient_allergies.id` as stored (opaque: a uuid, or a device ULID where the column holds text). Whether production stores uuid or text is not verified. |
| clinicalStatus | `is_active` (table below). Only `active` is ever published: an allergy marked inactive is left out entirely (see the table). A row with no usable value gets no clinical status, fails invariant ait-1 and is **withheld** (a searchset says how many; a read is 500), never shown as active. |
| verificationStatus, type | **Never filled**: mBHR records neither. Nothing is "confirmed" by default. |
| category | `allergy_type`: food → food, environmental → environment. "medication" is left out: the form pre-selects it, so it cannot be told apart from "not chosen". Anything else (including "other") → left out. |
| criticality | `high` for severity "severe" or "life-threatening", whether or not a reaction was written; otherwise left out (never `low`). |
| code | `code.text` = the allergen exactly as recorded (outer spaces trimmed). No substance coding; "Penicillin, codeine" stays one record. Blank → no code (the record is still published). |
| patient | the canonical Patient. |
| onsetDateTime | `onset_date` (date only). |
| recordedDate | `created_at` (the tablet's clock). |
| recorder | `Practitioner/<id>` only when `created_by` resolves in the staff directory; otherwise left out. |
| reaction | Only when a reaction was written: `manifestation.text` = the reaction as recorded, and `severity` from the severity rating (table below). The severity is not published without a reaction. |
| Never published | `notes`, `created_by` (an account id), device sync columns, the internal patient id. |
| Searches | `_id`, `patient`, `clinical-status`, `criticality`. No `subject`. `clinical-status=inactive` and `resolved` match nothing. `criticality=high` matches severe and life-threatening. A search by type (`category` or `type`, any value or modifier) is refused with 400 `not-supported` and a message to ask for all allergies instead: the form starts on "medication", so the recorded type cannot find every allergy of a type. Each allergy's own category (above) is unchanged. |
| Who reads | Staff with register, vitals, consult or dispense. Not available to patients. |

Every searchset carries a note: mBHR does not record "no known allergies";
an empty result means no active allergy is recorded, not that the patient
has none. Text such as "None" or "NKDA" typed as an allergen is published
as written, as an allergy.

| Source | FHIR | |
| --- | --- | --- |
| `is_active` true | clinicalStatus active | |
| `is_active` false | not published | "Mark inactive" in the app; no reason is recorded (resolved, error or duplicate). The app hides inactive allergies, and so does the gateway (owner decision, CLINICAL_LOGIC_CHANGES.md 2.7): a read is 404 as for an unknown id, no search returns or counts it, and a system that copied it earlier is not told. |
| `is_active` missing or not a boolean | none: record withheld | |
| severity moderate | reaction.severity moderate | |
| severity severe | reaction.severity severe, criticality high | criticality high even with no reaction written (owner sign-off, CLINICAL_LOGIC_CHANGES.md 2.7 "Severity"): the staff patient header gives severe the same top alert as life-threatening |
| severity life-threatening | reaction.severity severe, criticality high | |
| severity mild | left out | the form pre-selects mild |
| allergy_type medication | no category | the form pre-selects medication |

## Medication ← `public.pharmacy_items`

| | |
| --- | --- |
| Source | The pharmacy catalogue: one entry per medicine, form and strength at a site. Columns read: `id, med_name, strength, form, is_active, updated_at`. |
| FHIR id | A random uuid minted once per catalogue entry by `fhir_link_ids()` and kept in `interop.resource_links`. `fhir_link_ids()` and `fhir_link_sources()` answer only staff holding consult, dispense or inventory (the same set as the catalogue's row-level security); others get 42501. `pharmacy_items.id` is never published (seeded ids exceed the 64-character FHIR limit). |
| code | `code.text` = `med_name` + `strength` as typed ("Paracetamol 500mg"). **No coding.** The strength is never parsed into ingredient or amount. |
| form | `form.text` as recorded; no code. |
| status | `is_active`: true → active, false → inactive, missing or not a boolean → left out. |
| Never published | stock and reorder levels, `is_controlled`, lots, site, ingredient, amount, batch, manufacturer. The validator refuses `code.coding`, `ingredient`, `amount`, `batch` and `manufacturer`. |
| Searches | `_id` only (a keyset over catalogue rows would put `pharmacy_items.id` in the cursor). Clients reach a Medication through `MedicationRequest.medicationReference`. |
| Who reads | Staff with consult, dispense or inventory. Not available to patients. |

The same medicine stocked at two sites is two Medication resources.

## MedicationRequest ← `public.prescriptions` × `lines`

| | |
| --- | --- |
| Source | One resource per entry of `prescriptions.lines`. Columns read: `id, patient_id, visit_id, prescriber_id, lines, created_at, status, updated_at`. Void reason and void metadata are never read. |
| FHIR id | `<prescriptions.id>-<n>`, `n` the 1-based line position (at most 64). Lines never change after upload, so ids are stable. |
| status | See the table. |
| intent | `order` |
| medication | `medicationReference` = `Medication/<uuid>` with display = name and strength from the **current** catalogue entry. When the entry is readable but no id could be obtained: `medicationCodeableConcept.text`. When the entry is missing or unreadable, the line is **withheld** and the searchset says so. |
| subject | the canonical Patient. |
| encounter | `Encounter/<visit_id>` only when the visit exists, the caller can read it, and it belongs to the same canonical patient. |
| authoredOn | `created_at` (the prescribing tablet's clock). |
| requester | `Practitioner/<id>` only when `prescriber_id` resolves in the staff directory; never the raw id. |
| groupIdentifier | system `https://mbhr.app/identifiers/prescription`, value the prescription id: groups the lines of one prescription. |
| dosageInstruction | `text` = "dose · frequency · N days" as written; `patientInstruction` = the line's notes ("Instructions for the patient"). Not parsed: no doseAndRate, timing, route or boundsDuration. |
| dispenseRequest.quantity | `{value, unit}` only when the quantity is a positive whole number and the catalogue records a unit. No UCUM system or code. |
| Never published | `reasonCode`, `note`, `statusReason` (void reasons are free text), the prescriber's account id. |
| Searches | `_id`, `patient`, `subject`, `encounter`, `status`, `authoredon` (created_at, up to two bounds). |
| Who reads | Staff with consult or dispense. Not available to patients (the portal shows no prescriptions). |

`MEDICATION_REQUEST_STATUS`:

| prescriptions.status | MedicationRequest.status | |
| --- | --- | --- |
| open | active | mBHR sets no expiry: check authoredOn |
| dispensed | completed | every line was dispensed; not "the course has ended" |
| partial | unknown | no app code writes it |
| void | cancelled | |
| missing or anything else | unknown | |

## MedicationDispense ← `public.dispenses`

| | |
| --- | --- |
| Source | Prescription dispensing, imported tablet history and visit dispensing. Rows from the staff dashboard's "Add medicine" form (no prescription, no visit, `dispensed_by = 'staff'`, an invented quantity of 1) are **never** published. |
| FHIR id | `dispenses.id`, with `:` written as `.` (ids from the dispensing fallback contain `:`). A row whose id already has `.` or other characters outside `[A-Za-z0-9:-]` is not published. |
| status | `dispense_status` (table below). |
| medicationCodeableConcept | `text` = `item_name` as recorded when given. No coding; `medication_code_system` is never read. |
| subject | the canonical Patient. |
| context | `Encounter/<visit_id>` only for a readable visit of the same patient (for a patient: their closed visits). |
| authorizingPrescription | `MedicationRequest/<rx>-<n>` only when **exactly one** line of the prescription names this item and the prescription is the same patient's. Staff only. |
| quantity | `{value, unit}` only when the quantity is above 0 and the catalogue records a unit for the item. Staff only. |
| performer | `Practitioner/<id>` only when `dispensed_by` resolves in the staff directory. Staff only. |
| dosageInstruction | `text` = dosage and directions, joined with " · ". |
| whenHandedOver, whenPrepared | **Never published.** mBHR records when a medicine was recorded as given (the tablet's clock), not a handover. The validator refuses both. |
| Never published | lots, allergy-override flags, visibility notes, the dispenser's account id or typed name, `days_supply`, `dispensed_at`, `when_handed_over`. |
| Searches | `_id`, `patient`, `subject`, `status`, `prescription` (staff only). No `whenhandedover`. |
| Who reads | Staff with consult or dispense; a patient sees their own rows with `portal_visible = true` (medicine, status, visit, directions). |

`MEDICATION_DISPENSE_STATUS`:

| dispenses.dispense_status | MedicationDispense.status | |
| --- | --- | --- |
| completed | **unknown** | Its only writer is a migration that stamps every row without a status; it is not a recorded handover |
| preparation, in-progress, on-hold, cancelled, declined, stopped, entered-in-error, unknown | the same code | nothing in the app writes these, so a value there was set on purpose |
| missing | unknown | |
| anything else | unknown | |

Almost every published dispense is therefore `unknown`, and a
`status=completed` search matches nothing. `unknown` does not mean the
medicine was not given. One prescription line can have several dispenses
(one per stock lot, plus units given offline beyond stock).

## ServiceRequest ← `public.lab_orders`

| | |
| --- | --- |
| Source | Laboratory orders. Columns read: `id, patient_id, visit_id, test_name, test_code, priority, status, ordered_at, collected_at, created_at, updated_at`, and `ordered_by` only to look it up in the staff directory. |
| FHIR id | `lab_orders.id` (uuid); the same id as the order's DiagnosticReport. Only lower-case uuids; anything else is 404 without a query. |
| status | See the table. |
| intent | `order` |
| priority | `routine`, `urgent` or `stat` when recorded exactly; otherwise left out (never assumed routine). |
| code | as for the laboratory Observation: text, plus the local lab-test coding only for an unchanged quick pick. |
| subject, encounter | the canonical Patient; `Encounter/<visit_id>` |
| authoredOn | `ordered_at` (server time) |
| requester | `Practitioner/<id>` only when `ordered_by` resolves in the staff directory; otherwise left out. |
| Never published | `note` (clinical notes), `specimen` (never written), `performer`, `reasonCode`, `occurrence[x]`, `category`, the ordering account id. The validator refuses them. |
| Searches | `_id`, `patient`, `subject`, `encounter`, `status`, `authored` (ordered_at, up to two bounds), `code`. |
| Who reads | Staff with consult or lab_review. Not available to patients. |

`SERVICE_REQUEST_STATUS`:

| lab_orders.status | ServiceRequest.status | |
| --- | --- | --- |
| ordered, collected, processing | active | |
| completed | completed | a result was entered; says nothing about review |
| cancelled | revoked | |
| missing or anything else | unknown | |

## DiagnosticReport ← `public.lab_orders` + current `public.lab_results`

| | |
| --- | --- |
| FHIR id | `lab_orders.id`, the same as the ServiceRequest. |
| status | From the review state of the order's current results (table below). Never from the order status alone. **Never `final` for a patient.** |
| category | HL7 v2 table 0074 `LAB` (`http://terminology.hl7.org/CodeSystem/v2-0074`). |
| code | as for ServiceRequest. |
| subject, encounter | the canonical Patient; `Encounter/<visit_id>` |
| basedOn | `ServiceRequest/<id>` |
| effectiveDateTime | `collected_at`, when recorded. |
| issued | the latest `reviewed_at` of the current results, **final reports only** (so never on a patient's report). Never the entry time. |
| result | `Observation/lab-<id>` for each current result, sorted. No values, units or interpretations are copied into the report. |
| Never published | `conclusion`, `conclusionCode`, `presentedForm` (mBHR records none), `performer`, `resultsInterpreter` (only account ids exist), `specimen`, `media`. |
| Searches | `_id`, `patient`, `subject`, `encounter`, `based-on`, `status`, `category`, `code`, `date` (collected_at). |
| Who reads | Staff with consult or lab_review. A patient sees a report only for results released to them, listing only those results. |

Report state and `DIAGNOSTIC_REPORT_STATUS`:

| Order status | Current results | Report state | DiagnosticReport.status |
| --- | --- | --- | --- |
| ordered, collected, processing | none | awaiting_result | registered |
| cancelled | none | cancelled | cancelled |
| cancelled | some | results_on_cancelled_order | unknown |
| completed | none | completed_without_result | unknown |
| any known | some not reviewed | unreviewed | partial |
| any known | all reviewed (staff view: every current result) | reviewed | final |
| any known | all released ones reviewed (patient view) | released_results_reviewed | partial |
| missing or unrecognised | | | unknown |

A patient's view cannot show whether the order has another current result
that is unreviewed, unreleased or withheld (possibly critical), so a
patient's report is at best `partial`, even when every result was in fact
released. `amended`, `corrected` and `appended` are never produced. This
interface is not a critical-result alert channel: no acknowledgement is
recorded or published.

## DocumentReference ← `public.patient_documents`

| | |
| --- | --- |
| Source | Documents that were not removed (`deleted_at is null`, in every query). A removed document is never published and never shown as `entered-in-error` or `superseded`. `document_references` (TEFCA era) is not published. |
| FHIR id | `patient_documents.id` (uuid). The same id names the file as `Binary/<id>`. |
| status | `current` for every published document (table below). |
| docStatus | Never published: nothing records it, so a document is never presented as final. |
| type | `document_type`: a local `https://mbhr.app/codes/document-type` code with the portal's label, for the six portal values; any other value is `type.text` only (never `other`); blank → left out. No LOINC. |
| category | `upload_source`: local `https://mbhr.app/codes/document-source` `patient` ("Uploaded through the patient portal") or `staff` ("Clinic record (or added before mBHR recorded who uploaded documents)"). Any other value → left out. |
| subject | the canonical Patient; unresolved → withheld. |
| date | `created_at`: when the document was added to mBHR, not when it was written. |
| description | **Only for documents the patient uploaded.** A clinic record's description is a staff note and is never published, to staff or patients. |
| content.attachment | `contentType`: the declared type, lower-cased without parameters, when on the allowlist (PDF, JPEG, PNG, WebP, HEIC, HEIF, Word .doc and .docx), else `application/octet-stream`. `url`: `Binary/<id>`, relative; staff always get it, a patient only for documents they uploaded. `size`: the size the uploader's browser reported (0 to 2147483647), not checked. `title`: the last segment of the file name, with invisible and control characters removed; left out if blank, containing `://`, or over 255 characters. |
| Never published | `file_path`, the bucket, any Storage, signed or public URL; `uploaded_by_user_id`, `deleted_by`; the legacy `uploaded_by_patient` flag; `metadata`; `author`; `attachment.creation`, `hash`, `data`; `context`, `custodian`, `securityLabel`, `identifier`; `meta.lastUpdated`. |
| Searches | `_id`, `patient`, `subject`, `date` (created_at), `type`, `category`, `status`. |
| Who reads | Staff with consult. A patient sees their own documents that were not removed (as the portal lists them). |

- **`author` is left out** on purpose: mBHR records who uploaded a file,
  not who wrote it. A portal upload may come from a caregiver's account,
  and a clinic upload may be another hospital's letter.
- **`meta.lastUpdated` is left out**: `updated_at` is not read, because
  an older layout of the table has no such column.
- Documents added before mBHR recorded who uploaded them are categorised
  `staff`, including earlier portal uploads.
- A document typed "Test result" or "Prescription" is only a label on a
  file; it never becomes a laboratory or medication resource.

`DOCUMENT_REFERENCE_STATUS` (from `deleted_at`):

| Source state | DocumentReference.status |
| --- | --- |
| live (`deleted_at` null) | current |
| removed (`deleted_at` set) | none: never published |
| column not read | none: withheld |

## Binary ← the stored file of a document

| | |
| --- | --- |
| Source | The file of a `patient_documents` row in the private Storage bucket `patient-documents`, downloaded **as the caller** (the bucket's own policies apply a second time). The bucket is a constant; the path comes from the row, never from the request. |
| FHIR id | The same `patient_documents.id` as the DocumentReference. |
| Response | The file itself, as an attachment download (see [fhir-r4.md](fhir-r4.md#binary)). Never FHIR JSON, never base64 `data`. No ETag or version: `If-None-Match` is ignored. |
| contentType | As for the DocumentReference: allowlisted type, else `application/octet-stream`, with a `.bin` file name. |
| securityContext | `DocumentReference/<id>`, sent as `X-Security-Context`. |
| Search | None (400). |
| Who reads | Staff with consult. A patient only for files they uploaded to their own record. |

Path checks, security and limits are in [security.md](security.md#documents).
A removed document, a file missing from Storage, a file Storage refuses,
an empty file and a stored path outside the patient's folder all answer
404.

## Consent ← the consent register

| | |
| --- | --- |
| Source | `interop.consent_records` with `interop.consent_provisions`, read through `fhir_consent_directives()`, which never returns account ids (recorded, verified or withdrawn by), the withdrawal reason, who signed (`granted_by` and relationship), the source document or a provision's actor reference (only `names_recipient`: whether a rule names one specific recipient). |
| FHIR id | `consent_records.id` (uuid). |
| status | The stored consent-state code (table below); a withdrawn record is `inactive` (or stays `entered-in-error`). Missing or not a code → **withheld** (Consent.status is required and has no `unknown`). |
| scope | The stored consentscope code (adr, research, patient-privacy, treatment) with its R4 display. |
| category | The stored category as a local `https://mbhr.app/codes/consent-category` code (text only if it is not code-like). Never LOINC. Blank → withheld. |
| patient | The canonical Patient; unresolved → withheld. |
| dateTime | `recorded_at`: when the record was entered in the register. |
| policy | `policy.uri` = the recorded policy. R4 requires a policy or a policy rule (invariant ppc-1) and mBHR records no rule, so a record that cites no policy is **withheld**. |
| verification | Only from the recorded flag: verified true (with its date when recorded), or verified false. Who verified is never published. |
| provision | Root: the record's effective period, no type. One nested provision per stored rule, in stored order, with only what was recorded: `type` (permit or deny), `period`, `actor` (the kind of recipient as a local `consent-actor-type` code, with a display-only reference; `any` means no actor element; a rule that names one specific recipient withholds the record, below), `action` (consentaction), `purpose` (v3 ActReason, no display), `class` (an R4 resource type, or a local `consent-resource-type` or `consent-data-class` code) and `securityLabel` (local `consent-security-label`). |
| Never published | `performer`, `organization`, `source[x]`, `policyRule`, and every column listed under Source as not returned. |
| Searches | `_id`, `patient`, `status`, `scope`. |
| Who reads | Staff with consult, portal_manage or audit_access; a patient sees their own. |

A directive is published whole or not at all. When a stored rule cannot
be shown in R4 without changing its meaning (a code outside the register's
own lists; an unreadable or reversed period; a resource type **and** a
data class on one rule, which FHIR would read as either one; a rule for
one named recipient, such as one hospital in `actor_reference`, which is
never published and without which the rule would read as a rule for every
recipient of that kind), the record is withheld: leaving out a condition
would make a permit look broader than the patient agreed. Only
`names_recipient` false shows that a rule names no one: true, missing or
not a boolean withholds the record. A searchset says how many were left
out.

`CONSENT_STATUS` maps each stored code to itself (draft, proposed, active,
rejected, inactive, entered-in-error). An active record whose period has
ended stays `active` as recorded; its period is in `provision.period`.
`CONSENT_STATUS_WITHDRAWN`, used when `withdrawn_at` is set:

| Stored status of a withdrawn record | Consent.status |
| --- | --- |
| inactive, active, draft, proposed, rejected | inactive |
| entered-in-error | entered-in-error |
| missing or anything else | none: withheld |

Two partial points (see [consent.md](consent.md#the-consent-resource)):
the register is empty (nothing in the app records a consent yet), and a
patient does not see directives still filed under a record that was
merged into theirs.

## Practitioner ← `public.app_users` (staff)

| | |
| --- | --- |
| Source | Staff accounts whose role is one of the 8 staff roles (admin, doctor, nurse, pharmacist, volunteer, auditor, lead_clinician, registration_lead), read only through `fhir_staff_directory()`, which returns name, role, active and row times, never email, phone or credentials. Guest, legacy (chw) and unknown roles are never published. |
| FHIR id | A random uuid minted once per account by the directory function and kept in `interop.resource_links`. The account id (an auth uid, or a device ULID for staff added offline) is never published, not even as an identifier. |
| name | `[{ text: full_name }]` only: never split into given and family names (names may carry titles). A blank name → withheld. |
| active | Only when the account records a flag: true, or false when switched off. No flag → left out (the repository schema has no flag column, so it is usually absent). |
| Never published | identifier, telecom, address, gender, birthDate, photo, qualification, communication. The validator refuses them. |
| Searches | `_id`, `name`, `active` (only with `_id` or `name`). |
| Who reads | Any staff member. Not available to patients. |

A name or role search can mint `resource_links` rows for accounts that
have none yet: a GET with a write side effect in the `interop` schema, by
design (it is how ids become stable). An account that exists both as an
offline device row and an online row appears as two Practitioners.

## PractitionerRole ← `public.app_users.role`

| | |
| --- | --- |
| FHIR id | The same id as the account's Practitioner (one role per account). |
| practitioner | `Practitioner/<id>` with the full name as display. |
| code | The access role as a local `https://mbhr.app/codes/staff-role` code with display, and text "mBHR access role: <display>". Not a qualification; no SNOMED CT or HL7 v2 codes. |
| active | As Practitioner. |
| Never published | organization, location, specialty, period, availableTime, telecom, identifier (roles are global in mBHR). |
| Searches | `_id`, `practitioner`, `role`. |
| Who reads | Any staff member. Not available to patients. |

| app_users.role | code | display |
| --- | --- | --- |
| admin | admin | Administrator |
| doctor | doctor | Doctor |
| nurse | nurse | Nurse |
| pharmacist | pharmacist | Pharmacist |
| volunteer | volunteer | Volunteer |
| auditor | auditor | Auditor |
| lead_clinician | lead_clinician | Lead clinician |
| registration_lead | registration_lead | Registration lead |
| guest, chw, any other value, missing | none: withheld | |

## Organization ← `public.organizations`

| | |
| --- | --- |
| Source | The organisations registered on the server, read as the caller: row-level security returns only organisations the caller is a member of. No app code creates memberships, so many staff may get an empty result. |
| FHIR id | `organizations.id` (uuid) |
| name | `name` (required; blank → withheld) |
| active | `is_active`: true or false; missing → left out. |
| Never published | `slug` (editable, not an identifier), `logo_url`, `settings`, `subscription_tier`; no type, telecom, address, partOf or contact (not recorded). |
| Searches | `_id`, `name`. |
| Who reads | Any staff member. Not available to patients. |

Clinical records do not name the organisation that provided care, so
`Encounter.serviceProvider` is never set.

## Location ← `public.sites`

| | |
| --- | --- |
| Source | The server's site registry. Never built from the site names typed on tablets (`visits.site_name`). |
| FHIR id | `sites.id` (uuid) |
| status | `is_active`: true → active, false → inactive (never suspended), missing → left out (R4 location-status has no unknown). |
| name | `name`. Withheld when blank, or when it is "Mobile Clinic" or "Portal entry" (any case or padding). |
| mode | `instance` |
| address | text = `address`, district = `lga`, state = `state`; no country. |
| managingOrganization | `Organization/<org_id>`, no display. |
| Never published | `site_code` (unique only within an organisation), `coordinates` (never written, no datum), capacity and volume figures; no type, physicalType, operationalStatus, hours, telecom, identifier or partOf. |
| Searches | `_id`, `name`. |
| Who reads | Any staff member (RLS shows active sites to every signed-in user, inactive ones to members of the owning organisation). Not available to patients. |

## Provenance ← server-recorded events

Only events the database records itself, with the actor stamped from the
session and the time from its own clock. Nothing a tablet uploads is used.

| | Laboratory event | Merge | Upload |
| --- | --- | --- | --- |
| Source | `public.lab_result_release_log` | `public.patient_merges` rows with a server-stamped `actor_id` (written by `merge_patients()`) | `public.patient_documents` |
| FHIR id | `labrel-<log id>` | `merge-<merge id>` | `docup-<document id>` |
| target | `Observation/lab-<result id>` and `DiagnosticReport/<order id>` | the kept Patient and the merged-away Patient (each by its own id) | `DocumentReference/<id>` |
| recorded | `created_at` (server clock) | `created_at` (server clock) | `created_at` (database default, which a client could still set) |
| activity | local `lab-review`, `lab-release` or `lab-withhold` | local `patient-merge` | v3-DataOperation `CREATE` |
| agent.who | `Practitioner/<id>` when the directory resolves the account, else display "mBHR staff member" | same | display only: "Patient portal account" for a portal upload, else "mBHR account" |
| agent.type | provenance-participant-type `verifier`, for a review only | none | none |
| entity | none | the merged-away Patient, role `source` | none |

`meta.lastUpdated` is the recorded time. `occurred[x]` is never published.

Activity maps:

| Source | Provenance.activity |
| --- | --- |
| release log `reviewed` | `https://mbhr.app/codes/provenance-activity#lab-review` |
| release log `released` | `…#lab-release` (a release is not a review) |
| release log `withheld` | `…#lab-withhold` (the reason is never published) |
| merge `merge` | `…#patient-merge` |
| missing, `unmerge` or anything else | none: record withheld |

A row is withheld, never guessed, when:

- **Laboratory event:** the action is not one of the three; there is no
  time; the result has been superseded; it is a review or release that no
  longer stands (the result carries no review, or the event was recorded
  at or before the result's latest amendment; a withhold is kept); the
  result or order link is missing; or the patient is out of scope or does
  not resolve.
- **Merge:** no `actor_id` (a legacy tablet-uploaded row); `kind` is not
  `merge`; no time; or the kept record does not resolve.
- **Upload:** the document was removed; no time; or the patient does not
  resolve.

Never published: withhold reasons, merge snapshots and field choices, who
asked for a merge on the tablet, account ids, device ids, storage paths,
file names.

Searches: `_id`, `target`, `patient` (events about the patient's records,
including records merged into it; wider than R4, which matches Patient
targets only), `recorded`. Who reads: staff with audit_access or
lab_review; a lab_review holder without audit_access sees laboratory
events only. Not available to patients.

Visits, vital signs, consultations, prescriptions, dispenses, allergies
and conditions have no server-verified author and get no Provenance: an
empty result does not mean nothing changed.

## AuditEvent ← `interop.access_audit`

| | |
| --- | --- |
| Source | The gateway's own append-only access trail, read through `fhir_access_audit_events()` (audit_access only; FHIR gateway read and search rows only; a narrowing selector is required). |
| FHIR id | `access_audit.id` (uuid). |
| type | audit-event-type `rest` |
| subtype | restful-interaction `read` or `search-type` |
| action | `R` (read) or `E` (search) |
| recorded | `occurred_at` (server time) |
| outcome | `0` permit, `4` deny, `8` when the stored HTTP status is 500 or above (either decision). `12` is never produced. A permit with a 404 stays `0`. |
| outcomeDesc | The refusal reason code only, when the outcome is not 0. Never free text. |
| purposeOfEvent | v3 ActReason, for TREAT, HOPERAT, PATRQT, HRESCH, ETREAT or PUBHLTH only. |
| agent | `requestor: true`. who: `Practitioner/<id>` when the directory resolves a staff account, else display "mBHR staff member"; "Patient portal account" for a patient; "mBHR account" otherwise. role: the staff role as a local staff-role code. |
| source | Display-only observer "mBHR FHIR gateway", type security-source-type `4`. |
| entity | The patients whose records were returned or named, each as the canonical Patient (object-role `1`), deduplicated; a patient that does not resolve is left out, never named by an internal id. The resource: for a read `<Type>/<id>` (object-role `4`), for a search the type only (object-role `24`); for a permit a `result-count` detail. |
| Never published | account ids, IP hashes, user agents, request ids, search values and search parameter names, consent decision detail. |
| Searches | `_id`, `patient`, `date`, `outcome`, `action`, `subtype`. No `agent`, `entity`, `type`, `source` or `address` search. |
| Who reads | Staff with audit_access only. |

Status maps (`AUDIT_EVENT_STATUS_MAPS`): action read → R, search → E;
subtype read → `read`, search → `search-type`; outcome permit → 0,
deny → 4. A missing or unrecognised value withholds the record. A permit
row whose account kind is neither staff nor patient is also withheld (it
could only come from a direct call of the Phase 1 recording function).

Reading AuditEvents is itself audited against every patient the served
events name, at most 100 per response; a page may end early, with a
`next` link, to stay within that.

## Not implemented

| FHIR resource | Why |
| --- | --- |
| Procedure | The app records no performed procedure. `public.procedures` (TEFCA era) has no writer in the repository; appointments, dispenses and consultation text are not procedures. |
| CarePlan | There is no structured care plan: the consultation plan is one free-text column, `public.care_plans` has no writer, and the only care-task screen is not mounted. |
| Communication | Deferred. `patient_secure_messages` holds real portal messages, but the owner has not decided that messages are shareable record; clinicians can edit and delete them; they carry no category; and staff identity would need the directory. |
| Immunization, Goal, SDOH Observation | Their tables have no writer in the app. |
| Appointment, consultation notes, referrals | Out of Phase 2 scope. Referral details are stored only on the tablet. |

These reasons come from a review of the repository (no writer in `src/`
or the edge functions); the content of the production tables is not
known.

Not planned as FHIR (stays internal): queue tickets and analytics, wait
times, dashboards, device and sync state, duplicate-detection internals,
notification state, gamification, staff chat.
