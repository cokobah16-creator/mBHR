# Consent and purpose of use

What the FHIR gateway decides about purpose of use and consent, what the
consent register holds, who can change it, where it shows in the app, and
what is still missing. Decisions marked **(owner)** need confirming by DIOF.

Everything here is Phase 2 code. None of it is switched on in production
(see [README.md](README.md)).

## Principle

mBHR separates two things:

- **Internal care:** mBHR's own staff treating a patient, and a patient
  reading their own record in the portal. The FHIR interface is another way
  for the same person to read the same rows, under the same permissions and
  row-level security. Stored data-sharing consent does not decide these.
- **Disclosure:** anything leaving mBHR's care team: another facility, a
  partner system, a SMART app, research or public health. This needs a
  recorded basis and is **default-deny**.

This release serves internal care only. No disclosure is served.

## Purpose of use

The caller may state a purpose in the `X-Purpose-Of-Use` header, as an HL7
v3 PurposeOfUse code (`http://terminology.hl7.org/CodeSystem/v3-ActReason`).
The value is trimmed and upper-cased. An absent or blank header means the
account's ordinary purpose.

| Purpose | Staff | Portal patient |
| --- | --- | --- |
| absent | treated as `TREAT`: allowed | treated as `PATRQT`: allowed |
| `TREAT` | allowed | 403 `purpose_not_supported` |
| `PATRQT` | 403 `purpose_not_supported` | allowed |
| `ETREAT` (break-glass) | 403 `break_glass_not_enabled` | 403 `break_glass_not_enabled` |
| `HOPERAT`, `HRESCH`, `PUBHLTH` | 403 `purpose_not_supported` | 403 `purpose_not_supported` |
| anything else | 403 `purpose_invalid` | 403 `purpose_invalid` |

"Allowed" means the request goes on to the other checks (role, permission,
patient scope, row-level security). Every refusal is audited with its
reason. The purpose check is step 4 of the access decision
([security.md](security.md#the-access-decision)). The code is
`src/interoperability/fhir/consent/policy.ts` and
`src/interoperability/fhir/authorization/authorize.ts`.

**(owner)** Treating TREAT by mBHR staff as not needing a separate
data-sharing consent matches how the app already works (the staff who
register a patient treat them). If DIOF's consent forms say otherwise, the
evaluator can be changed to require a consent for internal treatment too.

## Access classes

`evaluateConsent()` (`src/interoperability/fhir/consent/evaluateConsent.ts`)
first puts the request in an access class:

| Access class | When | Consent decision |
| --- | --- | --- |
| internal-treatment | staff, `TREAT` | not-applicable |
| internal-operations | staff, `HOPERAT` | not-applicable |
| self-access | patient, `PATRQT` | not-applicable |
| emergency | `ETREAT`, anyone | deny, `break_glass_not_enabled` |
| external-sharing | an external system; or a patient or staff member with a purpose other than the above | consent required |
| third-party-app | a client registered as a third-party app | consent required |
| research | `HRESCH` | consent required |
| public-health | `PUBHLTH` | consent required |

"Not-applicable" means stored consent neither permits nor blocks the access.
Other rules decide it. Ordinary care is never blocked by a missing form.

No external client or third-party app can reach the gateway in this
release. The gateway always passes "no client".

## The evaluator rules

For an access class that needs consent:

1. If `FHIR_CONSENT_ENFORCEMENT_ENABLED` is off, the answer is deny,
   `consent_enforcement_disabled`. No directive is read.
2. Only the patient's directives in the matching scope count:
   `patient-privacy` for external-sharing, third-party-app and
   public-health; `research` for research.
3. A withdrawn directive is skipped. A directive whose status is not
   `active` is skipped. A directive outside its effective period is
   skipped.
4. A provision matches when each of its fields is empty or equal to the
   request: actor type, action, purpose, resource type and data class. An
   empty field matches anything. The actor types that can match are:
   - external-sharing: `external_system`, `organization`, `any`;
   - third-party-app: `external_system`, `any`;
   - public-health and research: `organization`, `external_system`, `any`.
5. A provision with a security label never matches. mBHR records no
   security labels on data, so such a rule covers nothing.
6. A provision must also be inside its own effective period.
7. A matching **deny** wins at once, `consent_deny_provision`. It counts
   even when the directive is not verified yet: a patient's refusal is
   honoured before staff check the form.
8. A matching **permit** counts only when the directive is verified. Then
   the answer is permit, `consent_permit_provision`, with the consent id
   and provision id.
9. Otherwise the answer is deny: `consent_withdrawn` if a withdrawn
   directive in that scope was seen, else `consent_expired` if an expired
   one was seen, else `no_consent_permit`.

The action is always `access` for a gateway read or search.

Withdrawal stops future disclosure only. Nothing deletes a record or an
audit entry.

## The consent step in the gateway

Step 10 of `authorizeFhirRequest()` calls `consentStep()`:

1. It asks the evaluator for the access class first, with no directives.
   If the answer is not-applicable, the step ends there.
2. If the answer is `consent_enforcement_disabled` or
   `break_glass_not_enabled`, the refusal is final. **No directives are
   loaded.** No directive could change these answers.
3. If the request names no patient, it is refused with
   `consent_requires_patient_context`.
4. If the caller is staff without `consult`, `portal_manage` or
   `audit_access`, it is refused with `consent_not_readable`. **No
   directives are loaded.** `fhir_consent_directives()` would refuse that
   caller anyway.
5. Otherwise it loads the directives for the named patients through
   `fhir_consent_directives()` and evaluates each named patient. The first
   result that is not permit refuses the request.

Every decision (permit, deny or not-applicable) is written to the audit
row, with the consent id and provision id when one decided it.

**What happens today.** Staff can state only `TREAT` and patients only
`PATRQT`. Both are not-applicable. So step 10 never loads directives in
this release, and every audit row records `not-applicable`. The governed
path is covered by unit tests only: `consentPolicy.test.ts` tests the
evaluator, and `authorize.test.ts` calls `consentStep()` directly.

Two limits of the lookup matter only once a governed purpose is served:

- It sends the named patient's current record ids only.
  `fhir_consent_directives()` matches `patient_id` exactly, so a directive
  still filed under a record that was merged away would not be found.
- It asks for at most 100 directives and does not page.

## The consent register

Two tables in the `interop` schema, added by the Phase 1 migration
(`20260926110000_interop_foundation.sql`). `anon` and `authenticated`
cannot read or write them directly; only the service role (support
tooling) can. The app and the gateway reach them only through the
functions below.

`interop.consent_records`: one directive.

| Column | Values |
| --- | --- |
| `patient_id` | internal patient id (text) |
| `status` | FHIR consent-state-codes: draft, proposed, active, rejected, inactive, entered-in-error |
| `scope` | FHIR consentscope: adr, research, patient-privacy, treatment |
| `category` | free text today; see [terminology-review.md](terminology-review.md) |
| `source_type` | paper_form, portal, verbal_witnessed, imported, mbhr_consent_record |
| `source_document_id`, `policy_uri` | where the signed form or the policy is |
| `granted_by`, `granted_by_relationship` | who consented (patient, guardian, …) |
| `recorded_by`, `recorded_at` | who entered it and when |
| `verified`, `verified_by`, `verified_at` | a verified record must say who verified it and when |
| `effective_from`, `effective_until` | period; the end must be after the start |
| `withdrawn_at`, `withdrawn_by`, `withdrawal_reason` | a withdrawn record must be `inactive` or `entered-in-error` |

`interop.consent_provisions`: the permit or deny rules inside a directive.
`provision_type` (permit or deny), `actor_type` (organization,
practitioner, care_team, patient_portal, external_system, any) and
`actor_reference`, `action` (FHIR consentaction: collect, access, use,
disclose, correct), `purpose` (TREAT, ETREAT, HOPERAT, PATRQT, HRESCH,
PUBHLTH), `data_class`, `resource_type`, `security_label`, and a period.

Rules the database enforces:

- Neither table allows DELETE or TRUNCATE (Phase 1). A consent ends by
  withdrawal, never by removing the row.
- Who, whose and what a record is about never changes: `patient_id`,
  `scope`, `category`, `recorded_at`, `recorded_by` and `created_at` are
  fixed. A change means a new record (Phase 2 trigger
  `consent_records_guard`).
- A withdrawal is final. It cannot be undone or rewritten.
- A rejected, inactive or entered-in-error record never comes back into
  force.
- Provisions never change. They can be added only in the transaction that
  created their record, and never to a verified or withdrawn record
  (Phase 2 triggers `consent_provisions_no_update` and
  `consent_provisions_insert_guard`).
- Every change to a record writes one row to
  `interop.consent_record_history` (created, modified, withdrawn or
  verified; the status before and after; who, as staff, patient or system)
  and one row to `interop.access_audit` with the event name only. The
  history table refuses UPDATE, DELETE and TRUNCATE. Only the trigger
  writes it; the service role may read it.

## Consent functions (Phase 2)

All are in `20260926130000_interop_phase2.sql`. `anon` cannot call any of
them. Each checks the caller itself.

| Function | Who may call it | What it does |
| --- | --- | --- |
| `fhir_consent_directives()` | staff with `consult`, `portal_manage` or `audit_access` (any patient); a portal patient (own records, including records merged into theirs) | Directives and provisions for named patient ids or consent ids (one is required). Used by the gateway. Never returns account ids, the withdrawal reason, who signed, the source document or a provision's actor reference. |
| `interop_record_consent()` | staff with `portal_manage` or `consult` | Records a directive with up to 20 provisions. Status draft, proposed or active. The patient must exist and must not be merged away. `policy_uri` may be empty. |
| `interop_verify_consent()` | staff with `portal_manage` or `consult` | Marks a draft, proposed or active record verified. A withdrawn record cannot be verified. |
| `interop_withdraw_consent()` | staff with `portal_manage` or `consult`; or the portal patient whose record it is (including records merged into theirs) | Withdraws a record, with an optional reason of at most 500 characters. Status becomes inactive (entered-in-error stays). A repeat returns false. |
| `interop_my_consents()` | portal patients only | The patient's own directives (at most 500), including records merged into theirs. |
| `interop_consent_summary()` | staff with `consult`, `portal_manage` or `audit_access`; or the patient | External sharing for one patient over the whole merge family: `allowed`, `not_allowed` or `withdrawn`, plus `pending_verification`, counts and the last change time. It follows the evaluator's external-sharing rules, but cannot weigh purpose, action, resource type or data class. |
| `fhir_interop_admin_status()` | `audit_access` or `users` | Gateway request counts, recent requests and refusals, and consent record counts. No ids. |

**Nothing in the app calls `interop_record_consent()` or
`interop_verify_consent()` yet.** There is no screen to record or verify a
consent. So the register is empty after the migration, and stays empty
until a recording screen or an import exists **(owner)**.

## Where consent shows in the app

All three are read-only apart from the patient's Withdraw button. None of
them can block care.

- **Patient portal, "Privacy and data sharing".** A section inside the
  portal's "Sharing your health records" page
  (`src/features/patient-portal/PrivacyConsentSection.tsx`). It explains in
  plain words that mBHR does not share records outside the care team,
  lists the permissions the patient has given (`interop_my_consents()`),
  and lets the patient withdraw one that is in place or not started yet
  (`interop_withdraw_consent()`). When the functions are not deployed it
  says "This list is not available yet." Offline, it asks the patient to
  connect.
- **Staff chip on the patient page.** `ExternalSharingChip` on
  `PatientDetail` shows "External sharing: Allowed", "Not allowed" or
  "Withdrawn" from `interop_consent_summary()`. The hover text says it
  does not affect care. It shows only to roles with `consult`,
  `portal_manage` or `audit_access`, only when online and signed in
  online. It renders nothing when the summary cannot be read.
- **Admin settings, Interoperability panel.**
  `src/pages/admin/InteroperabilitySettings.tsx` in `/admin/settings`, for
  roles with `audit_access` or `users`. It shows the gateway flags (read
  from the `/metadata` flags header), request and refusal activity, and
  consent record counts (`fhir_interop_admin_status()`). It changes
  nothing.

With the register empty, the portal list is empty and the chip reads
"External sharing: Not allowed". That matches the default-deny rule.

## The Consent resource

The gateway publishes register records as FHIR R4 Consent, read-only. The
mapping is in [resource-mapping.md](resource-mapping.md#consent--the-consent-register).

- Searches: `_id`, `patient`, `status`, `scope`. Staff must give `_id` or
  `patient`.
- Staff with `consult`, `portal_manage` or `audit_access` may read any
  patient's consents. A patient sees only their own (restriction
  `own_consents_only`).
- A staff search by patient includes directives still filed under records
  merged into that patient, shown with the kept record as the patient.
- A withdrawn record is published as `inactive`, never `active`.
- A record is published whole or not at all. A record with no
  `policy_uri` is not published (R4 needs a policy or a policy rule), and
  neither is a record whose rules cannot be shown without changing their
  meaning. A searchset says how many were left out.
- Every searchset carries a note that an empty or short result is not
  evidence that the patient agreed to or refused anything.

Consent is **Partial** for two reasons:

1. **The register is empty.** Nothing in the app records a consent yet
   (see above), so every search returns an empty searchset. Note also
   that `interop_record_consent()` accepts a record with no `policy_uri`,
   and such a record would not be published.
2. **Patients do not see merged-away directives.** A patient's search
   sends only the patient's current record ids. A directive still filed
   under a record that was merged into theirs is not returned to the
   patient through FHIR. The patient's searchset says so, and points to
   the portal's privacy section, which does list them. Staff see these
   directives. Closing the gap needs a database helper that resolves a
   patient's merged records.

## Existing consent data (unchanged)

`public.patient_consent_records` (yes or no per consent type, used by the
app) and `public.patient_data_sharing_preferences` (the portal's sharing
choices, from the TEFCA work) are unchanged. The gateway does not read
them and does not publish them. The portal page keeps them separate from
the "Privacy and data sharing" list: the preferences are a record of
wishes, not consent records.

Importing them into the register needs a clinician and DIOF to confirm
what each existing yes or no actually covered **(owner)**.

## Break-glass

`ETREAT` is refused at the purpose check and again by the evaluator.
Enabling it needs a separate permission, a mandatory reason, a short time
limit, an audit row flagged as break-glass, and a review afterwards. It is
not enabled in any form until that review process exists **(owner)**.

## Open decisions (owner)

- Whether internal treatment by mBHR staff needs a stored consent.
- Who records and verifies consents, and on which screen.
- Whether and how to import `patient_consent_records`.
- The consent category codes (free text today).
- The policy URIs to cite (none is defined; examples only).
- Break-glass: whether it is wanted, and the review process.
