# The /fhir/R4 API

FHIR R4 (4.0.1), JSON only, read-only. Every statement below is
**implemented** and covered by tests unless it is marked **planned**. The
server's own description of itself is `GET /fhir/R4/metadata`; it lists only
what is implemented.

Base URL: `https://mbhr.app/fhir/R4` (the value of `FHIR_BASE_URL`). The
interface is off unless `FHIR_ENABLED` is set; off, every request is a 404
([README](README.md#feature-flags)).

## Endpoints

| Request | Auth | Result |
| --- | --- | --- |
| `GET /metadata` | none | CapabilityStatement (status `draft`, kind `instance`) |
| `GET /Patient/{id}` | staff session | Patient |
| `GET /Patient?…` | staff session | searchset Bundle |
| `GET /Encounter/{id}`, `GET /Encounter?…` | staff session | Encounter / Bundle |
| `GET /Observation/{id}`, `GET /Observation?…` | staff session | Observation / Bundle |
| `GET /Condition/{id}`, `GET /Condition?…` | staff session | Condition / Bundle |

Anything else is refused with an OperationOutcome:

- `POST`, `PUT`, `PATCH`, `DELETE`: 405 with `Allow: GET`.
- `POST /{type}/_search`: 405 (search is GET only).
- History (`/{type}/{id}/_history`), `$operations`, compartments
  (`/Patient/{id}/Observation`), `GET /{type}/_search` and whole-system
  search: 400 `not-supported`.
- An id that is not a FHIR id (1 to 64 letters, digits, `-` or `.`): 400
  `invalid`, before anything is read.
- Any other resource type: 404 `not-supported`.

**Planned** (second delivery): AllergyIntolerance, MedicationRequest,
MedicationDispense, ServiceRequest, DiagnosticReport with lab Observations,
DocumentReference, Practitioner, PractitionerRole, Organization, Location,
Consent, Provenance and AuditEvent ([resource-mapping.md](resource-mapping.md#planned-second-delivery)).

## Request headers

| Header | Meaning |
| --- | --- |
| `Authorization: Bearer <token>` | Required except for `metadata`. The caller's Supabase access token from signing in to mBHR. |
| `X-Purpose-Of-Use` | Optional HL7 v3 PurposeOfUse code. Absent means `TREAT`, the only purpose served. `ETREAT`, `HOPERAT`, `PATRQT`, `HRESCH` get 403; any other value gets 403 ([consent.md](consent.md)). |
| `If-None-Match` | On a read, `W/"<versionId>"` returns 304 when unchanged. |
| `Accept` | Ignored; the answer is always `application/fhir+json`. `_format=json` (or `application/fhir+json`) is accepted; any other `_format` is 400. |

## Searches

All searches are **patient-scoped or record-scoped**. A search that does not
name one of its required parameter groups is refused (403) before the
database is queried, so the interface cannot be used to list patients or
browse records.

| Type | Must include one of | Also accepted |
| --- | --- | --- |
| Patient | `_id`; `identifier`; `name` **and** `birthdate` | |
| Encounter | `_id`; `patient`; `subject` | `date` (≤2), `status` |
| Observation | `_id`; `patient`; `subject`; `encounter` | `date` (≤2), `category`, `code`, `status` |
| Condition | `_id`; `patient`; `subject` | `clinical-status`, `code` |

Parameter details:

- `_id`: one id. Patient ids are uuids; Observation ids are
  `<vitals id>-<kind>`.
- `patient` / `subject`: `Patient/<id>` or a bare `<id>`. A reference to
  another type is 400. If both are given and name different patients, the
  result is empty.
- `identifier`: `https://mbhr.app/identifiers/patient|<id>` (or the bare id).
  mBHR records no MRN or national identifier.
- `name`: 2 to 64 letters, spaces, hyphens or apostrophes; starts-with match
  on given or family name, case-insensitive. Only with `birthdate`; merged
  records are excluded.
- `birthdate`: an exact date `YYYY-MM-DD` only.
- `date`: `[eq|ge|gt|le|lt]YYYY[-MM[-DD[Thh:mm[:ss]±zone]]]`. A time needs a
  zone. Up to two values, combined as AND (`date=ge2026-01-01&date=lt2026-02-01`).
  A partial date means the whole period (`eq2026-03` is all of March).
- `status` (Encounter): `in-progress`, `finished`, `cancelled`, `unknown`.
- `status` (Observation): `final` (the only status published).
- `category` (Observation): `vital-signs`, optionally with the HL7
  observation-category system.
- `code` (Observation): a vital-signs LOINC code
  (`http://loinc.org|8867-4`) or an mBHR vitals column code
  (`https://mbhr.app/codes/vitals|pulse_bpm`).
- `clinical-status` (Condition): a condition-clinical code. Records whose
  verification status is `entered-in-error` never match.
- `code` (Condition): an mBHR local condition code, with or without the
  system `https://mbhr.app/codes/condition`. Other systems are 400
  **(planned: verified standard codes once terminology mappings are reviewed)**.

Refused with 400 (no silent ignoring):

- unknown parameters, and every modifier (`:exact`, `:missing`, `:not`, …);
- comma-separated OR values (`status=a,b`) and repeated parameters, except
  `date` twice;
- `_include`, `_revinclude`, `_sort`, `_summary`, `_elements`, `_total`,
  `_contained`, chained parameters;
- values longer than 256 characters, and `_count=0`.

A search that names a patient the caller cannot see, or that cannot match
(an unknown status, a malformed Observation id), returns an **empty
Bundle**, not an error, so a search reveals nothing about records the
caller cannot read.

## Paging

- `_count`: default 20 (`FHIR_DEFAULT_PAGE_SIZE`), maximum 100
  (`FHIR_MAX_PAGE_SIZE`); larger values are lowered to the maximum.
- Results are ordered by the source row id, and pages use an opaque
  `_cursor`. Follow the Bundle's `next` link unchanged; it carries the
  original parameters, `_count` and `_cursor`. There is no `previous` or
  `last` link and no `total`.
- A cursor that does not decode is 400; start the search again.
- One vitals row becomes up to seven Observations, so a page can end part way
  through a row; the cursor resumes at the next Observation.

## Responses

Common headers on every answer:

```
Content-Type: application/fhir+json; charset=utf-8
Cache-Control: no-store          (metadata: no-cache)
Pragma: no-cache
X-Content-Type-Options: nosniff
X-Request-Id: <uuid>             (quote it when reporting a problem)
```

Reads also send `ETag: W/"<versionId>"` and, when the record has a
timestamp, `Last-Modified`.

### Versioning

`meta.versionId` is the source row's last change time in epoch milliseconds
(`updated_at`, else `created_at`) and `meta.lastUpdated` is that time. It
changes whenever the row changes. There is no version history (`vread` and
`_history` are not supported), and a row with no timestamp has version `"0"`
and no `lastUpdated`.

### Errors

Every error body is an OperationOutcome with one issue and a fixed message.
Messages never contain SQL, table or column names, keys, stack traces or
other patients' identifiers.

| Status | issue.code | When |
| --- | --- | --- |
| 400 | `invalid` | malformed parameter, bad cursor, request with a body |
| 400 | `not-supported` | unsupported parameter, modifier, interaction or format |
| 401 | `login` | no token, or an invalid or expired session (`WWW-Authenticate: Bearer`) |
| 403 | `forbidden` | not staff, missing permission, purpose refused, search not narrowed |
| 404 | `not-found` | no such record **or a record the caller may not see** (indistinguishable) |
| 404 | `not-supported` | unknown resource type; or the interface is disabled |
| 405 | `not-supported` | a method other than GET |
| 414 | `too-costly` | URL over 4096 characters |
| 429 | `throttled` | rate limit; `Retry-After` in seconds |
| 500 | `exception` | an internal error, including a resource that failed validation (never released) |
| 503 | `exception` | misconfiguration, database unavailable, or the audit record could not be written |

Example:

```json
{
  "resourceType": "OperationOutcome",
  "issue": [
    {
      "severity": "error",
      "code": "forbidden",
      "diagnostics": "A Observation search must name a specific record: give _id, or patient, or subject, or encounter."
    }
  ]
}
```

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
          "versionId": "1777624860000",
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

(Shortened: ids elided with `…`, one entry shown. `npx tsx
scripts/fhir-r4-examples.ts <dir>` writes the full set.)
