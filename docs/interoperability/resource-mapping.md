# mBHR → FHIR R4 resource mapping

The mapping specification for mBHR's actual tables. **Implemented** rows are
served by `/fhir/R4` today (when enabled) and are defined in code in
`src/interoperability/fhir/mappers/registry.ts`, which also generates the
CapabilityStatement. **Planned** rows are the design for the second delivery;
nothing serves them yet.

General rules, all resource types:

- The mBHR tables remain the system of record. Resources are generated on
  read; nothing is copied into a second clinical store.
- Ids are stable and derived, never generated per request (strategy per type
  below). `interop.resource_links` exists for sources whose id cannot serve
  as a FHIR id; nothing implemented needs it yet.
- `meta.versionId` = the source row's last change time in epoch
  milliseconds (`updated_at`, else `created_at`); `meta.lastUpdated` = that
  time. A row with no timestamp gets version `"0"` and no `lastUpdated`.
  Reads return `ETag: W/"<versionId>"` and `Last-Modified`.
- References are `Type/id` (`Patient/<fhir_id>`), never table names.
- Only listed columns are read (the query selects them by name) and only
  listed elements are published. Notes, photos, auth ids, portal and sync
  columns, flags and staff metadata never leave.
- Status and uncertainty are carried over exactly. An unrecognised local
  value becomes `unknown` or is left out; it is never mapped to a "good"
  value. Missing values are left out, never zero.
- International codes appear only where the FHIR R4 specification binds
  them for the concept, or from a **verified** row in
  `interop.terminology_map`. Otherwise mBHR's local code system is used:
  `https://mbhr.app/codes/<domain>`.
- Clinical representation choices awaiting clinician review are listed in
  `docs/clinical/CLINICAL_LOGIC_CHANGES.md` section 2.5.

## Implemented (first delivery)

### Patient ← `public.patients`

| | |
| --- | --- |
| FHIR id | `patients.fhir_id` (random uuid). `patients.id` (the device ULID) is never published. |
| identifier | `https://mbhr.app/identifiers/patient` \| `fhir_id`. mBHR records no MRN or national id; none is invented. |
| active | `false` when `merged_into` is set; otherwise **omitted** (mBHR has no active flag). |
| name | `official`: family = `family_name`, given = `given_name` split on spaces, text = both. |
| telecom | `phone` (mobile), `email`. |
| gender | `sex`: m/male → male, f/female → female, other → other, anything else → unknown, empty → omitted. |
| birthDate | `dob` (date). |
| address | `home`: text = `address`, district = `lga`, state = `state`. Country is not recorded, so not stated. |
| link | merged record → `replaced-by` the record it was merged into (when the caller can see it). |
| Not published | `photo_url` (a later authenticated Binary/DocumentReference route), `auth_uid`, `family_id`, portal and sync columns, merge metadata. |
| Searches | `_id`; `identifier`; `name` + `birthdate` together (starts-with on either name, exact date, merged records excluded). |
| Consent sensitivity | demographics |

### Encounter ← `public.visits`

| | |
| --- | --- |
| FHIR id | `visits.id` |
| status | `open`/`in_progress`/`active` → in-progress; `closed`/`completed`/`finished` → finished; `cancelled` → cancelled; else unknown. |
| class | v3 ActCode `AMB` (mBHR has no inpatient care). |
| subject | `Patient/<fhir_id>` of `patient_id`. |
| period.start | `started_at`. There is no end time column. |
| location | `site_name` as a display-only reference (no Location record exists yet). |
| Not modelled | Queue tickets are **not** encounters and are not published. Participants, service provider and reason are not recorded on visits. |
| Searches | `_id`, `patient`/`subject`, `date` (started_at, up to two bounds), `status`. |

### Observation ← `public.vitals` (vital signs)

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

- status `final`; category `vital-signs`; code = LOINC + local
  `https://mbhr.app/codes/vitals|<column>` (for blood pressure the panel
  code is LOINC only and each component carries its column code, since
  codings in one concept must mean the same thing); subject; encounter =
  `Encounter/<visit_id>`; effectiveDateTime = `taken_at`.
- The vital signs profiles are claimed only when `taken_at` is present
  (they require a time; none is invented).
- A value that is missing, not a number, or 0 or below is not published.
- No interpretation and no reference range (mBHR's flags and ranges are
  local rules awaiting sign-off).
- Not yet: lab results as Observations (they belong with DiagnosticReport,
  second delivery); `sdoh_observations`.
- Searches: `_id`, `patient`/`subject`, `encounter`, `date` (taken_at),
  `category` (vital-signs), `code` (LOINC above or local column code),
  `status` (final).

### Condition ← `public.conditions`

| | |
| --- | --- |
| FHIR id | `conditions.id` (uuid) |
| clinicalStatus | `clinical_status` (already FHIR condition-clinical codes); omitted when verification is entered-in-error (invariant con-5). |
| verificationStatus | `verification_status` (already condition-ver-status codes): provisional stays provisional. |
| category | `problem-list-item` / `encounter-diagnosis` (R4); `health-concern` (US Core code system). |
| severity | mild/moderate/severe → SNOMED CT 255604002 / 6736007 / 24484000 (R4 condition-severity value set). |
| code | local `https://mbhr.app/codes/condition|<condition_code>` with `condition_name` as display and text; plus any **verified** mapping from `interop.terminology_map`. |
| onset / abatement | `onset_date`, `abatement_date`. |
| recordedDate | `created_at`. |
| Not published | `notes`, `recorded_by` (free text, not a staff reference). |
| Not yet | `consultations.provisional_dx` (text array, no stable per-diagnosis id; would need resource_links). `conditions` has no encounter column, so there is no `encounter` search. |
| Searches | `_id`, `patient`/`subject`, `clinical-status`, `code` (local system). |
| Consent sensitivity | clinical (diagnoses); readable only with `consult`. |

## Planned (second delivery)

| FHIR resource | mBHR source | Id strategy | Notes |
| --- | --- | --- | --- |
| AllergyIntolerance | `patient_allergies` | uuid | `is_active` → clinicalStatus active/inactive; no verification column, so verificationStatus omitted rather than asserted; allergen text as code.text unless verified; severity life-threatening → criticality high. "No allergies recorded" is **never** published as "no known allergies". |
| Practitioner | `app_users` | new resource_links row per staff account (never the auth uid) | name only; no qualifications or contact details are recorded. |
| PractitionerRole | `app_users.role`, `user_org_sites`, `event_staff_assignments` | resource_links | role as local code; not every permission. |
| Organization | `organizations` | uuid | DIOF and partner facilities as actually stored. |
| Location | `sites` (and outreach events as temporary sites) | uuid | lets Encounter.location become a real reference. |
| Medication | `pharmacy_items` | text id | local codes; RxNorm only if verified (the `dispenses.medication_code_system` default of RxNorm is not trusted without review). |
| MedicationRequest | `prescriptions` (+ `lines`) | `<id>-<line>` | status open → active, dispensed → completed, partial → active, void → cancelled (review); intent order. |
| MedicationDispense | `dispenses` | text id | `dispense_status` is already FHIR; authorizingPrescription from `authorizing_prescription_id` / `prescription_id`. |
| ServiceRequest | `lab_orders` (and `service_requests`) | uuid | ordered/collected/processing → active, completed → completed, cancelled → revoked (review). |
| DiagnosticReport + lab Observations | `lab_orders` + `lab_results` | uuid | only reviewed results are final; unreviewed → preliminary; withheld/superseded handled explicitly; value text kept as valueString unless numeric with a unit. |
| DocumentReference | `patient_documents`, `document_references` | uuid | attachment points at an authenticated gateway route, never a storage URL; soft-deleted rows excluded. |
| Consent | `interop.consent_records` + provisions | uuid | status and scope stored as FHIR codes already. |
| Provenance | `audit_logs` / domain logs | derived | for key clinical writes. |
| AuditEvent | `interop.access_audit` | uuid | rendering of the append-only trail. |

Not planned as FHIR (stays internal): queue tickets and analytics, wait
times, dashboards, device and sync state, duplicate-detection internals,
notification state, gamification.
