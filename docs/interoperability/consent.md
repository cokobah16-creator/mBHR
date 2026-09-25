# Consent and purpose of use

What the FHIR gateway enforces today, what the new consent tables hold, and
what is left for the release that serves anyone outside mBHR's own care
team. Decisions marked **(owner)** need confirming by DIOF.

## Principle

mBHR separates two things:

- **Internal care:** mBHR's own staff treating a patient who came to an
  outreach. The staff member already sees the same record in the app; the
  FHIR interface is another way for the same person to read the same rows,
  under the same permissions and row-level security.
- **Disclosure:** anything leaving mBHR's care team: another facility, a
  partner system, a SMART app, research, the patient's own apps. This needs
  a recorded basis (consent or policy) and is **default-deny**.

This release serves internal care only.

## Purpose of use (enforced)

The caller states a purpose in the `X-Purpose-Of-Use` header, as an HL7 v3
PurposeOfUse code (`http://terminology.hl7.org/CodeSystem/v3-ActReason`).

| Purpose | Meaning | Result |
| --- | --- | --- |
| absent, or `TREAT` | treatment by mBHR staff | permitted, subject to role, permission and RLS |
| `ETREAT` | emergency / break-glass | 403 `break_glass_not_enabled` |
| `HOPERAT` | operations | 403 `purpose_not_supported` |
| `PATRQT` | patient request | 403 `purpose_not_supported` |
| `HRESCH` | research | 403 `purpose_not_supported` |
| anything else | | 403 `purpose_invalid` |
| any purpose, non-staff caller | disclosure | 403 (`no_staff_role`; the consent decision would give `external_disclosure_not_enabled`) |

Every refusal is audited with its reason. The code is
`src/interoperability/fhir/consent/policy.ts`.

**(owner)** Treating TREAT by mBHR staff as not needing a separate
data-sharing consent matches how the app already works (the staff who
register a patient treat them). If DIOF's consent forms say otherwise, the
same function can require an active `treatment` consent before permitting.

## The consent tables (schema only)

The interop migration adds two tables that can hold a patient's directive in
FHIR Consent terms. **Nothing writes, displays or enforces them yet**, and no
API role can reach them (the `interop` schema is closed to the Data API).

`interop.consent_records`: one directive.

| Column | Values |
| --- | --- |
| `patient_id` | internal patient id (text) |
| `status` | FHIR consent-state-codes: draft, proposed, active, rejected, inactive, entered-in-error |
| `scope` | FHIR consent-scope: adr, research, patient-privacy, treatment |
| `category` | free text now; a verified code later |
| `source_type` | paper_form, portal, verbal_witnessed, imported, mbhr_consent_record |
| `source_document_id`, `policy_uri` | where the signed form or policy is |
| `granted_by`, `granted_by_relationship` | who consented (patient, guardian, …) |
| `recorded_by`, `verified`, `verified_by`, `verified_at` | a verified record must say who verified it and when |
| `effective_from`, `effective_until` | period; the end must be after the start |
| `withdrawn_at`, `withdrawn_by`, `withdrawal_reason` | a withdrawn consent must be `inactive` or `entered-in-error` |

`interop.consent_provisions`: permit or deny rules inside a directive:
`provision_type` (permit/deny), `actor_type` (organization, practitioner,
care_team, patient_portal, external_system, any) and `actor_reference`,
`action` (FHIR consentaction: collect, access, use, disclose, correct),
`purpose` (TREAT, ETREAT, HOPERAT, PATRQT, HRESCH, PUBHLTH), `data_class`,
`resource_type`, `security_label`, and a period.

History is kept: neither table allows DELETE or TRUNCATE. A consent is
withdrawn by recording the withdrawal, never by removing the row. The pgTAP
file `supabase/migrations-deferred/tests/interop_foundation.test.sql` checks these rules.

The existing `public.patient_consent_records` (yes/no per consent type,
used by the app) and `public.patient_data_sharing_preferences` (from the
TEFCA work) are unchanged. Importing them into the new tables is a
migration for the release that enforces consent, and needs a clinician and
DIOF to confirm what each existing yes/no actually covered.

## Planned enforcement (not built)

For any purpose other than internal TREAT, and for any caller other than
mBHR staff:

1. No active, verified consent covering the actor, action, purpose and data
   → deny.
2. A deny provision that matches → deny, even if a permit also matches.
3. Expired, withdrawn, draft or `entered-in-error` consents never permit.
4. Every decision audited with the consent id it relied on.
5. Break-glass (`ETREAT`): a separate permission, a mandatory reason, a short
   time limit, an audit row flagged `break_glass`, and review afterwards.
   Not enabled in any form until that review process exists **(owner)**.

`FHIR_CONSENT_ENFORCEMENT_ENABLED` is reserved for switching this on. In
this release no decision depends on it.
