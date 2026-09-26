# Terminology review

Every code system and code the FHIR gateway publishes, what it leaves
uncoded and why, and how a local code can gain a reviewed standard code.
This is a list for review. Nothing here is a clinical or terminology
sign-off.

The rule in the code (`src/interoperability/fhir/terminology/codeSystems.ts`):

- An international code is published only where the FHIR R4 specification
  itself binds it for the concept (the vital signs profile, the Condition
  code systems, the condition-severity value set, v3 ActCode, and so on).
- Everything else keeps mBHR's own code under
  `https://mbhr.app/codes/<name>`, or stays as text.
- A mapping from a local code to ICD-10, SNOMED CT or LOINC comes only from
  a **verified** row in `interop.terminology_map`. Nothing is guessed from a
  description.

The mapping per resource is in [resource-mapping.md](resource-mapping.md).
Clinical representation choices are listed for clinician review in
`docs/clinical/CLINICAL_LOGIC_CHANGES.md` (sections 2.5 and 2.7).

## (a) Standard FHIR and HL7 systems

### Coded elements (the system is published)

| Element | System | Codes used |
| --- | --- | --- |
| Observation.category (vital signs) | `http://terminology.hl7.org/CodeSystem/observation-category` | `vital-signs` |
| Observation.category (laboratory) | same | `laboratory` |
| Observation.code, component.code (vital signs) | `http://loinc.org` | see [(b)](#b-loinc-codes) |
| Observation.valueQuantity, component.valueQuantity | `http://unitsofmeasure.org` | see [(b)](#b-loinc-codes) and [(c)](#c-ucum-units-for-laboratory-values) |
| Observation.dataAbsentReason, component.dataAbsentReason | `http://terminology.hl7.org/CodeSystem/data-absent-reason` | `unknown` |
| Observation.interpretation (laboratory) | `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation` | `N` Normal, `A` Abnormal, `AA` Critical abnormal |
| Observation.meta.profile (vital signs) | FHIR R4 StructureDefinitions | `vitalsigns`, `bp`, `heartrate`, `bodytemp`, `bodyweight`, `bodyheight`, `bmi`, `oxygensat` |
| DiagnosticReport.category | `http://terminology.hl7.org/CodeSystem/v2-0074` | `LAB` |
| Encounter.class | `http://terminology.hl7.org/CodeSystem/v3-ActCode` | `AMB` ambulatory |
| Condition.clinicalStatus | `http://terminology.hl7.org/CodeSystem/condition-clinical` | the stored code, one of active, recurrence, relapse, inactive, remission, resolved |
| Condition.verificationStatus | `http://terminology.hl7.org/CodeSystem/condition-ver-status` | the stored code, one of unconfirmed, provisional, differential, confirmed, refuted, entered-in-error (left out when none was recorded) |
| Condition.category | `http://terminology.hl7.org/CodeSystem/condition-category` | `problem-list-item`, `encounter-diagnosis` |
| Condition.category | `http://hl7.org/fhir/us/core/CodeSystem/condition-category` | `health-concern` (defined by US Core, not by base R4) |
| Condition.severity | `http://snomed.info/sct` | `255604002` Mild, `6736007` Moderate (severity modifier), `24484000` Severe |
| Condition.code | a verified `terminology_map` row | only when a reviewer has verified one (none today); added next to the local code |
| AllergyIntolerance.clinicalStatus | `http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical` | from `is_active` |
| Consent.scope | `http://terminology.hl7.org/CodeSystem/consentscope` | adr, research, patient-privacy, treatment |
| Consent.provision.action | `http://terminology.hl7.org/CodeSystem/consentaction` | collect, access, use, disclose, correct |
| Consent.provision.purpose | `http://terminology.hl7.org/CodeSystem/v3-ActReason` | TREAT, ETREAT, HOPERAT, PATRQT, HRESCH, PUBHLTH (no display) |
| Consent.provision.class | `http://hl7.org/fhir/resource-types` | an R4 resource type name, when the stored name is one |
| Provenance.activity (uploads) | `http://terminology.hl7.org/CodeSystem/v3-DataOperation` | `CREATE` |
| Provenance.agent.type (lab review) | `http://terminology.hl7.org/CodeSystem/provenance-participant-type` | `verifier` |
| AuditEvent.type | `http://terminology.hl7.org/CodeSystem/audit-event-type` | `rest` |
| AuditEvent.subtype | `http://hl7.org/fhir/restful-interaction` | `read`, `search-type` |
| AuditEvent.purposeOfEvent | `http://terminology.hl7.org/CodeSystem/v3-ActReason` | the stated purpose, when it is a known code |
| AuditEvent.source.type | `http://terminology.hl7.org/CodeSystem/security-source-type` | `4` Application Server |
| AuditEvent.entity.type | `http://hl7.org/fhir/resource-types` | the resource type |
| AuditEvent.entity.role | `http://terminology.hl7.org/CodeSystem/object-role` | `1` Patient, `4` Domain Resource, `24` Query |
| DocumentReference.content.attachment.contentType, Binary.contentType | MIME types | an allowlist; anything else is `application/octet-stream` |

### Code elements (no system in the resource)

These are FHIR `code` elements. The resource carries the code only. Each
value comes from an explicit map in `src/interoperability/fhir/terminology/`
(listed in [resource-mapping.md](resource-mapping.md)). Where a search
takes a token, the gateway accepts the value set's code system in
`system|code`.

| Element | Value set |
| --- | --- |
| Patient.gender | administrative-gender (male, female, unknown; "other" is left out) |
| Patient.telecom.system | contact-point-system (phone, email) |
| Patient.identifier.use | identifier-use (`usual`) |
| Patient.link.type | link-type (`replaced-by`) |
| Encounter.status | encounter-status |
| Observation.status | observation-status |
| AllergyIntolerance.category | allergy-intolerance-category (food, environment; "medication" is the form's pre-selected type and is left out) |
| AllergyIntolerance.criticality | allergy-intolerance-criticality (high only) |
| AllergyIntolerance.reaction.severity | reaction-event-severity (moderate, severe) |
| Medication.status | medication-status |
| MedicationRequest.status, intent | medicationrequest-status; intent |
| MedicationDispense.status | medicationdispense-status |
| ServiceRequest.status, intent, priority | request-status; `order`; request-priority |
| DiagnosticReport.status | diagnostic-report-status |
| DocumentReference.status, docStatus | document-reference-status; composition-status |
| Consent.status | consent-state-codes |
| Location.status | location-status |
| AuditEvent.action, outcome | audit-event-action (R, E); audit-event-outcome (0, 4, 8) |

`AllergyIntolerance.verificationStatus`
(`allergyintolerance-verification`) is known to the validator but is never
published: mBHR does not record whether an allergy was confirmed.

## (b) LOINC codes

LOINC is used for **vital signs only**, as the FHIR R4 vital signs profile
binds it. The local column name is published next to each LOINC code as a
`https://mbhr.app/codes/vitals` coding, so the original concept is kept.

| Observation | LOINC | Local code | UCUM unit |
| --- | --- | --- | --- |
| Blood pressure panel | `85354-9` Blood pressure panel with all children optional | none (two columns) | |
| component: systolic | `8480-6` Systolic blood pressure | `systolic` | `mm[Hg]` |
| component: diastolic | `8462-4` Diastolic blood pressure | `diastolic` | `mm[Hg]` |
| Pulse | `8867-4` Heart rate | `pulse_bpm` | `/min` |
| Body temperature | `8310-5` Body temperature | `temp_c` | `Cel` |
| Body weight | `29463-7` Body weight | `weight_kg` | `kg` |
| Body height | `8302-2` Body height | `height_cm` | `cm` |
| Body mass index | `39156-5` Body mass index (BMI) [Ratio] | `bmi` | `kg/m2` |
| Oxygen saturation | `2708-6` Oxygen saturation in Arterial blood, and `59408-5` Oxygen saturation in Arterial blood by Pulse oximetry | `spo2` | `%` |

The oxygen saturation profile requires `2708-6`. `59408-5` is added
because outreach readings come from a pulse oximeter.

No LOINC code is published for laboratory tests, lab results, documents or
consent categories. See [(e)](#e-what-is-deliberately-not-coded) and
[(g)](#g-gaps-and-recommended-next-mappings).

## (c) UCUM units for laboratory values

A laboratory value gets a UCUM code only when its recorded unit is exactly
one of these 13 strings (case-sensitive). Each is itself a valid UCUM code
with the same meaning as typed, so the code equals the text.

| Unit | Meaning |
| --- | --- |
| `%` | percent |
| `g/dL` | grams per decilitre |
| `g/L` | grams per litre |
| `mg/dL` | milligrams per decilitre |
| `mg/L` | milligrams per litre |
| `mmol/L` | millimoles per litre |
| `umol/L` | micromoles per litre |
| `U/L` | enzyme units per litre |
| `fL` | femtolitres |
| `pg` | picograms |
| `mm/h` | millimetres per hour |
| `10*9/L` | ×10⁹ per litre |
| `10*12/L` | ×10¹² per litre |

Any other unit ("g/dl ", "x10^9/L", "mEq/L", "mIU/mL", "IU/L") is
published as unit text only, with no system. A value that is not a plain
decimal, or has no unit, is `valueString`. Nothing is parsed or converted.
The table is `UCUM_UNITS` in
`src/interoperability/fhir/mappers/laboratory.ts`.

Medicine quantities (tablets, bottles and so on) are never given a UCUM
code: those dispensing units are not UCUM.

## (d) mBHR local systems

All under `https://mbhr.app/codes/`. The gateway publishes no CodeSystem
resource for them. Whether the URLs resolve on the web is not verified
here: they are identifiers, not links.

| System | Codes (display) | Used in |
| --- | --- | --- |
| `vitals` | `systolic`, `diastolic`, `pulse_bpm`, `temp_c`, `weight_kg`, `height_cm`, `bmi`, `spo2` (no display) | vital-sign Observation.code and component.code, next to LOINC |
| `condition` | the stored `condition_code`, with `condition_name` as display | Condition.code |
| `lab-test` | CBC "Complete Blood Count (CBC)", BMP "Basic Metabolic Panel", CMP "Comprehensive Metabolic Panel", LIPID "Lipid Panel", HBA1C "Hemoglobin A1C", TSH "Thyroid Stimulating Hormone", UA "Urinalysis", GLUCOSE "Blood Glucose", LFT "Liver Function Tests", RFT "Kidney Function Tests", HIV "HIV Test", HBSAG "Hepatitis B Surface Antigen", MRDTrunc "Malaria Rapid Test", PREG "Pregnancy Test", STOOL "Stool Analysis" | laboratory Observation.code, DiagnosticReport.code, ServiceRequest.code; only when the order still carries an unchanged quick pick (code and name both match) |
| `lab-interpretation` | `normal` Normal, `abnormal` Abnormal, `critical` Critical | laboratory Observation.interpretation, next to the v3 code |
| `document-type` | `medical_record` Medical record, `lab_result` Test result, `imaging` Scan or X-ray, `prescription` Prescription, `insurance` Insurance document, `other` Other | DocumentReference.type; any other stored value is text only |
| `document-source` | `patient` "Uploaded through the patient portal", `staff` "Clinic record (or added before mBHR recorded who uploaded documents)" | DocumentReference.category |
| `staff-role` | `admin` Administrator, `doctor` Doctor, `nurse` Nurse, `pharmacist` Pharmacist, `volunteer` Volunteer, `auditor` Auditor, `lead_clinician` Lead clinician, `registration_lead` Registration lead | PractitionerRole.code (text "mBHR access role: …"), AuditEvent.agent.role |
| `provenance-activity` | `lab-review` "Laboratory result reviewed by a clinician", `lab-release` "Laboratory result released to the patient portal", `lab-withhold` "Laboratory result withheld from the patient portal", `patient-merge` "Duplicate patient record merged into the kept record" | Provenance.activity |
| `consent-category` | the stored category (free text in the register) | Consent.category |
| `consent-actor-type` | `organization` Organisation, `practitioner` Practitioner, `care_team` Care team, `patient_portal` Patient portal, `external_system` External system (`any` means no actor element) | Consent.provision.actor.role |
| `consent-data-class` | the stored `data_class` (free text). The gateway's own classes are demographics, clinical, medication, laboratory, document, consent, directory, audit | Consent.provision.class |
| `consent-resource-type` | a stored resource type name that is not an R4 type | Consent.provision.class |
| `consent-security-label` | the stored security label | Consent.provision.securityLabel |

Identifier systems, under `https://mbhr.app/identifiers/`:

| System | Value | Used in |
| --- | --- | --- |
| `patient` | the patient's `fhir_id` (use `usual`) | Patient.identifier; the only identifier mBHR records |
| `prescription` | the prescription id | MedicationRequest.groupIdentifier |

Policy URIs such as `https://mbhr.app/policies/data-sharing/v1` appear
only in synthetic examples. No real policy URI is defined.

Points for review in this table:

- `MRDTrunc` is kept exactly as the order form stores it. It probably means
  "MRDT". Renaming it would publish a code no order carries.
- The `staff-role` displays "Administrator" and "Lead clinician" differ from
  the app's own labels ("Admin", "Lead Clinician"). The wording needs
  confirming.
- `consent-category`, `consent-data-class` and `consent-security-label`
  have no fixed list. With the register empty, no value exists yet.

## (e) What is deliberately not coded

| What | How it is published | Why |
| --- | --- | --- |
| Laboratory tests and analytes | the test name as text, plus the local quick-pick code | No lab code is verified. The quick picks include panels, and results are free text against the order, not coded analytes. |
| Laboratory interpretation direction | N, A or AA only | mBHR records normal, abnormal or critical, not high or low. H, L, HH and LL would invent a direction. |
| Reference ranges | text only | Never parsed into low and high. |
| Medicines | name and strength as text | The catalogue has no code column and no verified RxNorm, SNOMED CT or ATC mapping. The RxNorm system that `dispenses` carries by column default, with no code, is never read. |
| Dose form | text | No verified SNOMED CT or EDQM mapping. |
| Dosage | `Dosage.text` only | Dose, frequency, duration and directions are free text. Nothing is parsed into a quantity, timing or route. |
| Dispensing units | text, no UCUM | Tablets and bottles are not UCUM units. |
| Allergens and reactions | text | mBHR has no allergen code list. A text such as "Penicillin, codeine" stays one record. |
| Allergy verification status and type | left out | Not recorded. |
| Allergy category for the type "medication" | left out | The allergy form pre-selects "medication", so a stored "medication" cannot be told apart from "not chosen". Only food and environmental, which someone chose, are sent. |
| Diagnosis clinical status, verification status and category not recorded | left out | The held-back `conditions` table has no default for them, so nothing is filled in; a missing one means none was recorded. |
| Diagnoses in consultations | not published | `consultations.provisional_dx` is a text array with no stable id per diagnosis. |
| Staff roles | local code only | An mBHR role is an access role an admin assigns, not a qualification. It is never mapped to SNOMED CT or HL7 v2 practitioner codes. |
| Organization and Location type | left out | Not recorded in a codable form. |
| Facility identifiers | none | mBHR records no facility registry id. |
| Provenance for release, withhold and merge | local codes | R4 has no activity code for these. Only an upload matches `v3-DataOperation CREATE` exactly, and only a review matches the `verifier` agent type. |
| Consent category | local code | No reviewed mapping says which LOINC document class a category is. |
| Document type | local code | No reviewed mapping to the LOINC Document Ontology. |
| Document source | local code | No standard code says who uploaded a document. |
| Patient gender "other" | left out | Registration also stores "other" when nothing was chosen. |
| Security labels on data | none | mBHR labels no data. A consent rule limited to a label covers nothing. |

## (f) Review process

The table for reviewed mappings is `interop.terminology_map` (Phase 1
migration). It holds one row per local code and target code:

- `domain`: condition, vitals, lab_test, medication, allergy, gender or
  other;
- `local_system`, `local_code`, `local_display`;
- `fhir_system`, `fhir_code`, `fhir_display`, `version`;
- `review_status`: unverified (the default), verified or rejected;
- `reviewed_by`, `reviewed_at`, `review_note`;
- `active`.

The database enforces:

- a verified row must name its reviewer and the review time;
- both systems must be URIs, and neither code may be blank;
- at most one active mapping per domain, local system, local code and
  target system.

How a mapping reaches a published resource today:

1. Someone with the service role inserts the row. RLS is on with no
   policies, and only `service_role` has SELECT, INSERT and UPDATE. There
   is **no screen** for this.
2. A reviewer checks it and the row is updated to `verified` with
   `reviewed_by` and `reviewed_at`.
3. The gateway calls `fhir_terminology_lookup(domain, codes)`. It answers
   staff only, returns only verified and active rows, and takes at most 200
   codes.
4. The verified coding is published next to the local coding, never
   instead of it.

Limits to know:

- **Only Condition uses it** (domain `condition`). No other resource looks
  up mappings, so a verified vitals, lab_test, medication, allergy or
  gender row changes nothing today.
- The lookup matches `domain` and `local_code` but **not**
  `local_system`. Two rows in the same domain with the same local code
  under different local systems would both be applied.
- A lookup failure is ignored: the local coding is still published.
- The table is empty after the migration. No mapping has been loaded or
  reviewed.

**Open question (owner):** who may verify a mapping. It needs a named
clinician or terminology reviewer, a record of which terminology version
was used, and a way to enter rows other than the service role. None of
this exists yet.

## (g) Gaps and recommended next mappings

Each item needs clinical or terminology review before any code is
published. None is implemented.

| Area | Gap | Recommended next step |
| --- | --- | --- |
| Laboratory tests | No LOINC. Panels (CBC, BMP, CMP, lipid, LFT, RFT, urinalysis, stool) are ordered as one test, but LOINC codes results per analyte. | Map single tests first (for example HbA1c, TSH, glucose, HIV, HBsAg, malaria RDT, pregnancy) through `terminology_map` domain `lab_test`, and extend the lookup to laboratory resources. Panels need per-analyte results before their results can be coded. |
| `MRDTrunc` | Probably a typo for MRDT | Decide with the lab lead whether to fix the order form. A fix changes published codes. |
| Laboratory units | Common units outside the 13 | Consider adding exact UCUM strings such as `[IU]/L` and `meq/L`, only where the typed text means exactly that. |
| Interpretation | No direction | Record high or low at result entry if clinicians want H and L. |
| Medicines | No code | Choose a system suitable for Nigeria (RxNorm, SNOMED CT, ATC, or a NAFDAC registration number as an identifier) and map the catalogue through domain `medication`. |
| Dose form | Text only | SNOMED CT or EDQM dose form codes. |
| Dispensing units | Not UCUM | Keep as text, or code as SNOMED CT unit of presentation after review. |
| Document type | Local only | Map the six types to the LOINC Document Ontology. |
| Document source | Local only | No standard equivalent is known. Keep local. |
| Staff roles | Local only (by design) | Keep. If receivers need a practitioner role, add a separate reviewed qualification, not the access role. |
| Organization and Location | No type, no facility identifier | Record a facility type and a national facility registry id, if one applies. |
| Provenance activities | No R4 code for release, withhold, merge | Keep local unless a later FHIR version or IG defines them. |
| Allergens | Text only | A substance list (SNOMED CT substances, or RxNorm for drug allergens) in domain `allergy`, and a lookup in the allergy module. |
| Consent category | Local, free text | Fix a short list of categories, then decide on LOINC consent document codes. |
| Condition | Local code only | Map local condition codes to ICD-10 or SNOMED CT through domain `condition`. The lookup is already wired. |
| Consultation diagnoses | Not published | Give each diagnosis a stable id first, then publish and code it. |
| SNOMED CT use | Three severity codes are already published | Check SNOMED CT licensing for the country of use before adding more SNOMED CT codes. |
