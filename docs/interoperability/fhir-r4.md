# The /fhir/R4 API

FHIR R4 (4.0.1), JSON only, read-only. Every statement below describes
code in `src/interoperability/fhir/` that is covered by tests. The
server's own description of itself is `GET /fhir/R4/metadata`; it lists
only what is implemented.

Base URL: `https://mbhr.app/fhir/R4` (the value of `FHIR_BASE_URL`). The
interface is off unless `FHIR_ENABLED` is set; off, every request is a 404
([README](README.md#feature-flags)).

## Endpoints

Only `GET`. Three kinds of request:

| Request | Auth | Result |
| --- | --- | --- |
| `GET /metadata` | none | CapabilityStatement |
| `GET /{type}/{id}` | session | the resource (read) |
| `GET /{type}?…` | session | a searchset Bundle (search) |
| `GET /Binary/{id}` | session | **the file itself**, not FHIR JSON (see [Binary](#binary)) |

`{type}` is one of: Patient, Encounter, Observation, Condition,
AllergyIntolerance, Medication, MedicationRequest, MedicationDispense,
ServiceRequest, DiagnosticReport, DocumentReference, Binary, Consent,
Practitioner, PractitionerRole, Organization, Location, Provenance,
AuditEvent. Every type supports read. Every type except Binary supports
search.

"Session" means an mBHR Supabase access token: a staff member's, or (only
with `FHIR_PATIENT_ACCESS_ENABLED`) a portal patient's for the types in
[Patient self-access](#patient-self-access). DocumentReference, Binary and
Consent are for portal patients only: a staff token gets 403
`missing_permission` (owner decisions, until mBHR has a staff documents
screen and a staff consent screen).

### metadata

The CapabilityStatement: status `draft`, kind `instance`, software
"mBHR FHIR gateway" 0.2.0, format `application/fhir+json`,
`security.cors` false. For each type it lists the interactions, the search
parameters with their documentation, and the type's notes as
`documentation`. It names no database table, function or policy. Every
type is `readHistory: false` and `updateCreate: false`. Every type except
Binary is `versioning: versioned` and `conditionalRead: not-match`. Binary
is `versioning: no-version` and `conditionalRead: not-supported`: a
download carries no ETag. It claims no profile and no SMART or OAuth
service.

- What patients get is published only while `FHIR_PATIENT_ACCESS_ENABLED`
  is on. That covers each type's patient notes, the patient part of a
  search parameter's documentation (DiagnosticReport `status`,
  MedicationDispense `prescription`, DocumentReference `patient`, Consent
  `patient`), and the patient part of the implementation and security
  descriptions. With it off, nothing in the statement describes what a
  patient gets.
- DocumentReference, Binary and Consent are listed whether patient access
  is on or off. Their notes say that staff accounts are refused (403); what
  a patient gets is added only while patient access is on.
- It takes no parameters other than `_format` (anything else is 400).
- With `FHIR_READ_ENABLED=false` it is still served, but lists no resource
  types.
- It carries the header `X-MBHR-FHIR-Flags` with on/off states only.
- It needs no token, reads no database table and writes no audit row.

### Refused requests

Each refusal is an OperationOutcome, and each happens before any database
call:

- A URL over 4096 characters: 414.
- `POST`, `PUT`, `PATCH`, `DELETE` and any other method: 405 with
  `Allow: GET`. This includes `POST /{type}/_search`.
- A `GET` with a body: 400.
- History (`/{type}/{id}/_history`), `$operations`, `GET /{type}/_search`
  and anything else with an id starting `$` or `_`: 400 `not-supported`.
- More than two path segments (for example compartments such as
  `/Patient/{id}/Observation`): 400 `not-supported`.
- Whole-system search (`GET /fhir/R4`): 400 `not-supported`.
- `GET /Binary?…` (Binary search): 400 `not-supported`.
- An id that is not a FHIR id (1 to 64 letters, digits, `-` or `.`): 400.
- Search parameters on a read: 400.
- A type that is not published: 404 `not-supported`.
- `FHIR_READ_ENABLED=false`: every request except `/metadata` gets 404.

## Request headers

| Header | Meaning |
| --- | --- |
| `Authorization: Bearer <token>` | Required except for `metadata`. The caller's Supabase access token from signing in to mBHR. A token in the URL is never accepted. |
| `X-Purpose-Of-Use` | Optional HL7 v3 PurposeOfUse code. Absent means `TREAT` for staff and `PATRQT` for a patient, the only purpose each may state. `ETREAT` gets 403 `break_glass_not_enabled`; `HOPERAT`, `HRESCH`, `PUBHLTH`, or the other kind's purpose, get 403 `purpose_not_supported`; an unknown value gets 403 `purpose_invalid` ([consent.md](consent.md)). |
| `If-None-Match` | On a read, `W/"<versionId>"` (or `*`) returns 304 when unchanged. The request is still authenticated, decided and audited first, and the audit row records 304. Binary sends no ETag and ignores this header. |
| `Accept` | Must allow JSON: absent, `*/*`, `application/*`, `application/json` or `application/fhir+json`. Anything else: 406. For Binary, an `Accept` that lists only `application/fhir+json` or `application/json` is 406 (the file is not available as FHIR JSON). |
| `_format` (query) | `json`, `application/json` or `application/fhir+json`; anything else is 406; more than once is 400. On Binary any `_format` is 406. |

## Searches

### Rules for every search

- **Staff searches must name a record.** Each type has required groups
  (below). A staff search that includes none of them is refused with 403
  and audited as `search_not_narrowed`, before any clinical row is read.
- **A patient's search is always confined to their own records**, whether
  or not it names a patient. Naming another patient is 403
  (`patient_not_in_context`), audited.
- Only the parameters listed for a type are accepted. Everything else is
  400 `not-supported`, never ignored: unknown parameters, every modifier
  (`:exact`, `:missing`, `:not`, …), chained parameters, `_include`,
  `_revinclude`, `_sort`, `_summary`, `_elements`, `_total`, `_contained`.
- Comma-separated OR values (`status=a,b`) are 400 `not-supported`, except
  in a date value, where a comma is simply invalid.
- A parameter may appear once, except the date parameters, which may appear
  twice (a range). More is 400.
- A value longer than 256 characters, or empty, is 400.
- A search that cannot match (an unknown status, a malformed id, a foreign
  code system) returns a Bundle with no matches, not an error (except an
  AllergyIntolerance search by type, below). For staff, a `patient` that
  cannot be resolved does the same.
- **An AllergyIntolerance search by type is refused.** Any search by
  `category` or `type`, whatever its value, system, modifier or the other
  parameters (even without `patient` or `_id`, and also with
  `Prefer: handling=lenient`, which the gateway does not honour), is 400
  `not-supported` with a fixed message that says "Ask for all of the
  patient's allergies instead (search AllergyIntolerance by patient or
  _id, without category or type)". The allergy form starts on
  "medication", so the recorded type cannot find every allergy of a type,
  and an empty result would wrongly say that no allergy is recorded. Each
  allergy's published category is unchanged.
- A malformed search from a caller who may not read the type is refused
  as forbidden first, so it learns nothing about the type's parameters.

### Parameters per type

"Required" lists the groups a staff search must include (one of them).

| Type | Required (staff) | Parameters |
| --- | --- | --- |
| Patient | `_id`; `identifier`; `name` + `birthdate` | `_id`, `identifier`, `name`, `birthdate` |
| Encounter | `_id`; `patient`; `subject` | `_id`, `patient`, `subject`, `date` (≤2), `status` |
| Observation | `_id`; `patient`; `subject`; `encounter`; `based-on` | `_id`, `patient`, `subject`, `encounter`, `date` (≤2), `category`, `code`, `status`, `based-on` |
| Condition | `_id`; `patient`; `subject` | `_id`, `patient`, `subject`, `clinical-status`, `code` |
| AllergyIntolerance | `_id`; `patient` | `_id`, `patient`, `clinical-status`, `criticality` |
| Medication | `_id` | `_id` |
| MedicationRequest | `_id`; `patient`; `subject`; `encounter` | `_id`, `patient`, `subject`, `encounter`, `status`, `authoredon` (≤2) |
| MedicationDispense | `_id`; `patient`; `subject`; `prescription` | `_id`, `patient`, `subject`, `status`, `prescription` |
| ServiceRequest | `_id`; `patient`; `subject`; `encounter` | `_id`, `patient`, `subject`, `encounter`, `status`, `authored` (≤2), `code` |
| DiagnosticReport | `_id`; `patient`; `subject`; `encounter`; `based-on` | `_id`, `patient`, `subject`, `encounter`, `based-on`, `status`, `category`, `code`, `date` (≤2) |
| DocumentReference | not available to staff (403) | `_id`, `patient`, `subject`, `date` (≤2), `type`, `category`, `status` |
| Binary | (no search) | read by id only |
| Consent | not available to staff (403) | `_id`, `patient`, `status`, `scope` |
| Practitioner | `_id`; `name` | `_id`, `name`, `active` |
| PractitionerRole | `_id`; `practitioner`; `role` | `_id`, `practitioner`, `role` |
| Organization | `_id`; `name` | `_id`, `name` |
| Location | `_id`; `name` | `_id`, `name` |
| Provenance | `_id`; `target`; `patient`; `recorded` | `_id`, `target`, `patient`, `recorded` (≤2) |
| AuditEvent | `_id`; `patient`; `date` | `_id`, `patient`, `date` (≤2), `outcome`, `action`, `subtype` |

Extra conditions on top of the required groups:

- **Patient:** `name` and `birthdate` only together (either alone is 403).
- **Practitioner:** `active` only narrows further; it never counts as a
  required group.
- **Provenance:** `recorded` on its own needs `audit_access` and a closed
  range of at most 31 days (403 otherwise). A `lab_review` holder without
  `audit_access` must give `_id`, `target` or `patient`.
- **AuditEvent:** `date` on its own must be a closed range of at most 31
  days (403 otherwise).
- **MedicationDispense:** `prescription` is staff only; a patient using it
  gets 400.

### Parameter values

- `_id`: one id. Ids per type are in
  [resource-mapping.md](resource-mapping.md): Patient ids are uuids,
  vital-sign Observations `<vitals id>-<kind>`, laboratory Observations
  `lab-<uuid>`, MedicationRequests `<prescription id>-<line>`, Provenance
  `labrel-…` or `merge-…`.
- `patient`, `subject`: `Patient/<id>` or a bare `<id>`. A reference to
  another type, or an absolute URL, is 400. If both are given and name
  different patients the result is empty (staff) or 403 (patient).
- References to other types (`encounter`, `based-on`, `practitioner`,
  `prescription`, `target`) take `Type/<id>` or a bare id in the same way.
  Provenance `target` accepts `Observation/lab-<id>`,
  `DiagnosticReport/<id>` and `Patient/<id>`; any other record, a
  `DocumentReference` included, matches nothing (document uploads get no
  Provenance).
- `identifier` (Patient): `https://mbhr.app/identifiers/patient|<id>` or
  the bare id. mBHR records no MRN or national identifier.
- `name` (Patient): 2 to 64 letters (any script), spaces, hyphens or
  apostrophes; case-insensitive starts-with on any given or family name.
  Merged-away records are never returned.
- `name` (Practitioner, Organization, Location): 2 to 64 letters, digits,
  spaces and `. ' ’ - _ % & ( ) /`; case-insensitive start of the name or
  of any word in it. `%` and `_` match themselves.
- `birthdate`: an exact date `YYYY-MM-DD` only (other forms are 400). It
  matches the full stored date of birth. A birth date on the 1st of a month
  is sent as `YYYY` (1 January) or `YYYY-MM` (any other month), so a
  search for `2021-01-01` can return a Patient whose `birthDate` is
  `2021`.
- Dates (`date`, `authored`, `authoredon`, `recorded`):
  `[eq|ge|gt|le|lt]YYYY[-MM[-DD[Thh:mm[:ss]±zone]]]`.
  - A date without a time means the clinic day in Africa/Lagos (UTC+1),
    00:00 to 24:00 there, not a UTC day. `2026-03` is all of March in
    Lagos; `2026` the whole year.
  - A time must carry a zone (`Z` or `±hh:mm`); without one it is 400.
  - Two values are combined as AND
    (`date=ge2026-01-01&date=lt2026-02-01`).
  - Encounter `date` matches `Encounter.period.start`. A visit published
    without a period never matches a date search: a visit whose site is
    "Portal entry" (any case, spaces around it ignored), or one with no
    usable start time.
- Tokens: `code` or `system|code`. The system must be the one the element
  uses. Another system, or an empty one (`|code`), makes the search match
  nothing. This holds for every status parameter, Encounter `status` and
  Condition `clinical-status` included. Three kinds are refused with 400
  instead: Condition `code` with another system; AuditEvent `outcome`,
  `action` or `subtype` with another system; and Practitioner `active`
  with any system.

Token values per type:

| Type | Parameter | Values |
| --- | --- | --- |
| Encounter | `status` | `in-progress`, `finished`, `cancelled`, `unknown`. Only the values the app writes are recognised, in any case; anything else, including a value with spaces around it (" closed"), is `unknown` |
| Observation | `category` | `vital-signs`, `laboratory` (system optional: HL7 observation-category) |
| Observation | `code` | a code the Observation's own `code` carries: a vital-signs LOINC code (for example `http://loinc.org|8867-4`), an mBHR vitals column code (`https://mbhr.app/codes/vitals|pulse_bpm`), or an mBHR lab-test code (`https://mbhr.app/codes/lab-test|CBC`). A blood pressure matches on its panel code `85354-9` only: the systolic and diastolic codes (`8480-6`, `8462-4`, `systolic`, `diastolic`) are on its components and match nothing |
| Observation | `status` | `final`, `preliminary` |
| Condition | `clinical-status` | a condition-clinical code; records whose verification status is `entered-in-error` never match |
| Condition | `code` | an mBHR condition code, with or without `https://mbhr.app/codes/condition` |
| AllergyIntolerance | `clinical-status` | `active` (`inactive` and `resolved` match nothing: allergies marked inactive in mBHR are not published) |
| AllergyIntolerance | `criticality` | `high` (allergies rated severe or life-threatening; `low`, `unable-to-assess` match nothing) |
| MedicationRequest | `status` | `active`, `completed`, `cancelled`, `unknown` match; other codes match nothing |
| MedicationDispense | `status` | the published status; almost every record is `unknown`, and `completed` matches nothing |
| ServiceRequest | `status` | `active`, `completed`, `revoked`, `unknown` |
| ServiceRequest, DiagnosticReport | `code` | an mBHR lab-test code; matches only orders that still carry the unchanged quick pick |
| DiagnosticReport | `status` | `registered`, `partial`, `final`, `cancelled`, `unknown`; worked out after reading, so a page can be short; a patient's reports are never `final` |
| DiagnosticReport | `category` | `LAB` (system optional: HL7 v2 table 0074) |
| DocumentReference | `type` | `medical_record`, `lab_result`, `imaging`, `prescription`, `insurance`, `other` (system optional: `https://mbhr.app/codes/document-type`) |
| DocumentReference | `category` | `patient`, `staff` (system optional: `https://mbhr.app/codes/document-source`) |
| DocumentReference | `status` | `current` matches every published document; other codes match nothing |
| Consent | `status` | `draft`, `proposed`, `active`, `rejected`, `inactive`, `entered-in-error` (the published status: a withdrawn record, or an active one past its end date, is `inactive`) |
| Consent | `scope` | `adr`, `research`, `patient-privacy`, `treatment` |
| Practitioner | `active` | `true`, `false`; an account that records no flag matches neither |
| PractitionerRole | `role` | `admin`, `doctor`, `nurse`, `pharmacist`, `volunteer`, `auditor`, `lead_clinician`, `registration_lead` |
| AuditEvent | `outcome` | `0`, `4`, `8` (`12` matches nothing; anything else is 400) |
| AuditEvent | `action` | `R`, `E` (`C`, `U`, `D` match nothing) |
| AuditEvent | `subtype` | `read`, `search-type` |

Not offered (400 if used), among others: Patient `gender`, `address`,
`telecom`; Encounter `class`, `location`; AllergyIntolerance `category`
and `type` (answered with a message to ask for all allergies; see above);
MedicationDispense `whenhandedover`; DocumentReference `author`,
`period`, `contenttype`; Practitioner `identifier`, `telecom`, `email`;
Location `status`, `address`, `near`; Provenance `agent`, `entity`;
AuditEvent `agent`, `entity`, `type`, `source`. Medication has no search
other than `_id`.

### Notes in a searchset

Some searchsets carry one OperationOutcome entry (`search.mode: outcome`)
after the matches. A searchset with no match and no note has no `entry`
element at all (FHIR JSON allows no empty arrays).

- Observation, for staff without consult or lab_review: every search that
  could include laboratory results says, with issue code `suppressed`,
  that laboratory results are not included and that an empty or short
  result does not mean the patient has none. It depends only on the
  caller's permissions and the query, never on whether a result exists. A
  search that can match vital signs only (for example
  `category=vital-signs`) carries no such note.
- Condition: every searchset says that diagnoses in consultation notes are
  not published.
- AllergyIntolerance: every searchset says that mBHR does not record "no
  known allergies", and that an empty result means no active allergy
  matched the search.
- Consent: the patient's coverage note (staff cannot search Consent).
- A `patient` naming a merged-away record: an empty result and a note
  naming the kept record.
- Records left out: "N matching record(s) were left out because they
  could not be shown as valid FHIR" (warning), or a type's own note (for
  example allergies or consents that could not be shown).

## Paging

- `_count`: default 20 (`FHIR_DEFAULT_PAGE_SIZE`), maximum 100
  (`FHIR_MAX_PAGE_SIZE`). Larger values are lowered to the maximum.
  `_count=0` is 400 `not-supported`; a value that is not a whole number
  is 400.
- Pages use an opaque `_cursor` (keyset paging, never offsets). Follow the
  Bundle's `next` link unchanged; it carries the original parameters,
  `_count` and `_cursor`. There is no `previous` or `last` link.
- **A cursor is bound to the caller, the query and the type.** It carries
  a digest of the resource type, the search parameters, the account and
  its scope. A cursor used by another account, with other parameters or on
  another type, or one that does not decode, is 400 (audited); start the
  search again. A cursor never carries filters, so it cannot widen a
  search.
- **There is no `Bundle.total`.**
- A page can hold fewer entries than `_count` and still have a `next` link
  (some filters are applied after reading, and each page reads a bounded
  number of batches). Follow `next` until it is absent.
- One vitals row becomes up to seven Observations, and an Observation
  search runs vital signs first, then laboratory results; the cursor
  resumes in the right place.

## Responses

Headers on every answer, including `metadata` and errors:

```
Content-Type: application/fhir+json; charset=utf-8   (not on Binary)
Cache-Control: private, no-store
Pragma: no-cache
X-Content-Type-Options: nosniff
X-Request-Id: <uuid>             (quote it when reporting a problem)
```

A read (other than Binary) also sends `ETag: W/"<versionId>"` and, when
the resource has `meta.lastUpdated`, `Last-Modified`.

### Versioning

`meta.versionId` is a digest of the resource as served: the first 12 bytes
of a SHA-256 over the resource without its `versionId`, as 24 hex
characters. It changes whenever the served content changes. `ETag` uses
the same value. `meta.lastUpdated` is the source row's last change time
where the type publishes one; for a Consent that ended after its last
change, it is the end date, from which it is served as `inactive`. There
is no version history (`vread` and `_history` are not supported).

### Binary

`GET /Binary/{id}` returns the stored file of the DocumentReference with
the same id, never FHIR JSON. Portal patients only (with
`FHIR_PATIENT_ACCESS_ENABLED`), for files they uploaded to their own
record; a staff account gets 403. Headers:

```
Content-Type: <allowlisted type, else application/octet-stream>
Content-Disposition: attachment; filename="<safe ASCII name>"
Content-Security-Policy: default-src 'none'; sandbox
X-Security-Context: DocumentReference/<id>
Cache-Control: private, no-store
Pragma: no-cache
X-Content-Type-Options: nosniff
X-Request-Id: <uuid>
```

There is no ETag, so `If-None-Match` is ignored: a download that succeeds
is a 200 with the file (the CapabilityStatement says `conditionalRead:
not-supported`). A file over 25 MB is refused with 503. A removed
document, a missing file, a file Storage refuses and a stored path outside
the patient's folder all answer 404. See
[security.md](security.md#documents).

### Errors

Every error body is an OperationOutcome with one issue and a fixed
message. Messages never contain SQL, table or column names, keys, stack
traces or other patients' identifiers.

| Status | issue.code | When |
| --- | --- | --- |
| 400 | `invalid` | malformed value, bad or foreign cursor, a request with a body, parameters on a read, a repeated parameter |
| 400 | `not-supported` | unsupported parameter, modifier, OR list, interaction or path; `_count=0`; Binary search; an AllergyIntolerance search by type (`category` or `type`) |
| 400 | `too-costly` | a laboratory search that matches more results than one page can gather (narrow it, for example with `based-on` or `_id`) |
| 401 | `login` | no token, or an invalid, expired or wrong-audience session. Header `WWW-Authenticate: Bearer realm="mBHR FHIR"` |
| 403 | `forbidden` | no staff role or linked record, missing permission (including a read of a laboratory Observation, `Observation/lab-<id>`, without consult or lab_review, decided from the id before any lookup, and any DocumentReference, Binary or Consent request from a staff account), patient access off, type not available to patients, another patient named, purpose refused, search not narrowed |
| 404 | `not-found` | no such record **or a record the caller may not see** (indistinguishable); reads switched off; the interface disabled |
| 404 | `not-supported` | a type that is not published |
| 405 | `not-supported` | a method other than GET (`Allow: GET`) |
| 406 | `not-supported` | an `Accept` or `_format` that is not FHIR JSON; FHIR JSON asked of Binary |
| 414 | `too-costly` | URL over 4096 characters |
| 429 | `throttled` | rate limit; `Retry-After` in seconds |
| 500 | `exception` | an internal error: a resource that failed validation on a read, a row outside the caller's scope, a response that would name more than 100 patients |
| 503 | `exception` | misconfiguration, a missing database function or column, the database unavailable, the audit record could not be written, a file over 25 MB |

A database refusal (SQLSTATE `42501`, or HTTP 403 from PostgREST) becomes
403; a value the database cannot accept (`22P02`, `22023`, `22007`,
`22008`) becomes 400; anything else becomes 503 without detail.

Example:

```json
{
  "resourceType": "OperationOutcome",
  "issue": [
    {
      "severity": "error",
      "code": "forbidden",
      "diagnostics": "A Observation search must name a specific record: give _id, or patient, or subject, or encounter, or based-on."
    }
  ]
}
```

## Rate limits

Per signed-in account, per minute, counted in the database
(`public.rate_limits`):

- **General:** 60 (`FHIR_RATE_LIMIT_PER_MINUTE`, clamped to 1 to 600 by the
  database), bucket `fhir_gateway`, for every request.
- **Sensitive:** 20 (`FHIR_SENSITIVE_RATE_LIMIT_PER_MINUTE`, never above the
  general limit), bucket `fhir_gateway_sensitive`, counted on top of the
  general one for searches on Patient, Observation, ServiceRequest,
  DiagnosticReport, DocumentReference, Provenance and AuditEvent, and for
  every Binary read. It is consulted only when the general limit allowed
  the request.
- Over either limit: 429 with `Retry-After`, audited.
- The audit function has its own limit (bucket `fhir_audit`: 300 rows a
  minute for staff and patients, 30 for other accounts). When it refuses,
  the request fails with 503 (a permitted request) or is still refused
  (a refusal).

Requests without a valid token are not counted by the gateway; Supabase
Auth's and Vercel's own protections apply.

## Patient self-access

Only with `FHIR_PATIENT_ACCESS_ENABLED`. A portal patient's records are
the ones `app_portal_patient_ids()` returns for their account, in the
database; nothing in the request or the browser decides it. Merged-away
records are not among them.

| Type | What a patient sees |
| --- | --- |
| Patient | Their own record(s). |
| Encounter | Their own visits with status `closed` only (as the portal shows). |
| Observation | Vital signs whose `portal_visible` is not false; laboratory results only through `fhir_patient_lab_results()`: reviewed, released to them, not withheld, not superseded. |
| DiagnosticReport | Only for results released to them, listing only those results. Never `final` and never `issued`: at best `partial`, because their view cannot show whether the order has another result still pending review or release. |
| MedicationDispense | Their own rows with `portal_visible = true`: medicine, status, visit (closed visits only) and directions. No quantity, performer or `authorizingPrescription`; `prescription=` is 400. |
| DocumentReference | Their own documents that were not removed. The attachment URL (`Binary/<id>`) only for documents they uploaded; a clinic document's description is never published. |
| Binary | Only files they uploaded to their own record. |
| Consent | Their own directives. Directives still filed under a record that was merged into theirs are not shown yet (the searchset says so; the portal lists them). |

Every other type (Condition, AllergyIntolerance, Medication,
MedicationRequest, ServiceRequest, Practitioner, PractitionerRole,
Organization, Location, Provenance, AuditEvent) is 403
`not_available_to_patients`. A patient may not state a purpose other than
`PATRQT`. Every row returned is checked again against the patient's own
records before release ([security.md](security.md#owner-check-after-read)).

## Examples

Synthetic data from `src/interoperability/fhir/conformance/examples.ts`
(no real patient). CI runs the HL7 FHIR Validator over all of them.

```
GET /fhir/R4/Observation?patient=Patient/3f0c2a7e-…&category=vital-signs&_count=2
```

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "timestamp": "2026-09-25T12:00:00.000Z",
  "link": [
    { "relation": "self", "url": "https://mbhr.app/fhir/R4/Observation?_count=2&category=vital-signs&patient=Patient%2F3f0c2a7e-…" },
    { "relation": "next", "url": "https://mbhr.app/fhir/R4/Observation?_count=2&_cursor=eyJr…&category=vital-signs&patient=Patient%2F3f0c2a7e-…" }
  ],
  "entry": [
    {
      "fullUrl": "https://mbhr.app/fhir/R4/Observation/01J8…-bp",
      "resource": {
        "resourceType": "Observation",
        "id": "01J8…-bp",
        "meta": {
          "versionId": "5d41a0c2…",
          "source": "https://mbhr.app",
          "lastUpdated": "2026-05-01T08:41:00.000Z",
          "profile": ["http://hl7.org/fhir/StructureDefinition/vitalsigns", "http://hl7.org/fhir/StructureDefinition/bp"]
        },
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs", "display": "Vital Signs" }], "text": "Vital Signs" }],
        "code": {
          "coding": [{ "system": "http://loinc.org", "code": "85354-9", "display": "Blood pressure panel with all children optional" }],
          "text": "Blood pressure"
        },
        "subject": { "reference": "Patient/3f0c2a7e-…" },
        "encounter": { "reference": "Encounter/01J8…" },
        "effectiveDateTime": "2026-05-01T08:40:00.000Z",
        "component": [
          {
            "code": {
              "coding": [
                { "system": "http://loinc.org", "code": "8480-6", "display": "Systolic blood pressure" },
                { "system": "https://mbhr.app/codes/vitals", "code": "systolic" }
              ]
            },
            "valueQuantity": { "value": 128, "unit": "mmHg", "system": "http://unitsofmeasure.org", "code": "mm[Hg]" }
          },
          {
            "code": {
              "coding": [
                { "system": "http://loinc.org", "code": "8462-4", "display": "Diastolic blood pressure" },
                { "system": "https://mbhr.app/codes/vitals", "code": "diastolic" }
              ]
            },
            "valueQuantity": { "value": 84, "unit": "mmHg", "system": "http://unitsofmeasure.org", "code": "mm[Hg]" }
          }
        ]
      },
      "search": { "mode": "match" }
    }
  ]
}
```

(Shortened: ids and the version digest elided with `…`, one entry shown.
`npx tsx scripts/fhir-r4-examples.ts <dir>` writes the full set.)
