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
   skipped (the end is exclusive: a directive ending at 12:00 is expired
   at 12:00).
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
8. A matching **permit** counts only when the directive is verified and
   the permit names no specific recipient (`names_recipient` is false).
   mBHR cannot tell whether a requester is the one recipient a patient
   named, so such a permit never grants access; a deny that names a
   recipient still refuses (step 7). Then the answer is permit,
   `consent_permit_provision`, with the consent id and provision id.
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
evaluator, `authorize.test.ts` calls `consentStep()` directly, and
`consentDirectiveLoader.test.ts` tests the lookup below.

The three permissions in step 4 are the step's own list
(`CONSENT_READERS`). No staff account may read the Consent resource (owner
decision, "Only what the app shows"), but once a governed purpose is
served the step still loads directives for these staff inside the gateway,
to decide a request for another type. It never returns them to the caller.

How step 10 looks up directives once a governed purpose is served
(`loadConsentDirectives()` in `gateway/handler.ts`):

- A merge does not move consent records. When the request names one
  patient, the lookup asks for that patient's whole merge family (the
  kept record and the records merged into it that the caller can see) and
  reads every directive as the named patient's, so a refusal filed under
  a merged-away record still counts.
- It never decides on a partial set: it asks for up to 101 directives,
  and more than 100 is a 503, not a decision on the first hundred.

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
| `source_document_id`, `policy_uri` | where the signed form or the policy is; `policy_uri` is required (Phase 2 CHECK) |
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
- Every record cites a policy link (Phase 2 CHECK
  `consent_records_policy_required`): an absolute URI in ASCII, at most
  500 characters, whoever writes it, the service role included.
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
| `fhir_consent_directives()` | staff with `consult`, `portal_manage` or `audit_access` (any patient); a portal patient (own records, including records merged into theirs) | Directives and provisions for named patient ids or consent ids (one is required). Used by the gateway: a patient's own Consent reads and searches, and the consent step's directive lookup (staff included). No staff account gets the Consent resource (owner decision); a direct API call by such staff still returns the directives, and no app screen makes one. Never returns account ids, the withdrawal reason, who signed, the source document or a provision's actor reference (only `names_recipient`: whether a rule names one specific recipient). |
| `interop_record_consent()` | staff with `portal_manage` or `consult` | Records a directive with up to 20 provisions. Status draft, proposed or active. The patient must exist and must not be merged away. A policy link is required (22023 `a policy link is required` when missing or blank; `invalid consent` when it is not an absolute ASCII URI of at most 500 characters). |
| `interop_verify_consent()` | staff with `portal_manage` or `consult` | Marks a draft, proposed or active record verified. A withdrawn record cannot be verified. |
| `interop_withdraw_consent(p_consent_id, p_reason, p_patient_id)` | staff with `portal_manage` or `consult`; or the portal patient whose record it is (including records merged into theirs) | Withdraws a record, with an optional reason of at most 500 characters. Status becomes inactive (entered-in-error stays). A repeat returns false. A portal patient may withdraw only a permission to share: scope patient-privacy or research, and no deny provision (the database also accepts a record with no provisions, which the portal does not offer). A refusal, a treatment consent or an advance directive is changed with clinic staff: the patient gets 42501, whatever the record's status. `p_patient_id` is optional and names the page's patient. When given, the record must be that patient's or a record merged into it (42501 otherwise, for staff too), and a patient must name one of their own portal records (42501 otherwise). A malformed id is refused (22023). The portal always sends it, so a sign-in linked to two people (a shared phone) withdraws only for the person the page shows. Without it, a patient may still withdraw a permission of any person linked to the sign-in, and staff are not limited. |
| `interop_my_consents(p_patient_id)` | a portal patient, for one of their own portal records | The directives (at most 500) of that record and of the records merged into it, not of every record linked to the sign-in (a shared phone can link several people). NULL or a malformed id is refused (22023); a record that is not one of the caller's gives 42501. There is no form without an argument. |
| `interop_consent_summary(p_patient_id)` | staff with `consult`, `portal_manage` or `audit_access`; or the patient | For one patient over the whole merge family. `external_sharing`: `allowed`, `not_allowed` or `withdrawn`, by the evaluator's external-sharing rules (it cannot weigh purpose, action, resource type or data class), plus `pending_verification`, record counts and the last change time. For the staff chip, also `sharing_state` and `sharing_reason` ([below](#the-staff-chips-state-and-reason)). |
| `fhir_interop_admin_status()` | `audit_access` or `users` | Gateway request counts, recent requests and refusals, and consent record counts. No ids. |

**Nothing in the app calls `interop_record_consent()` or
`interop_verify_consent()` yet.** There is no screen to record or verify a
consent. So the register is empty after the migration, and stays empty
until a recording screen or an import exists **(owner)**.

### The staff chip's state and reason

`interop_consent_summary()` returns `sharing_state` and `sharing_reason`
for the staff chip. They read the register more strictly than
`external_sharing`: the chip says Allowed only for a full, verified
permission.

What counts: patient-privacy records that are draft, proposed or active,
not withdrawn and not ended, and their provisions for someone outside
mBHR (actor `external_system`, `organization`, `any` or unset) that have
not ended. A provision is **in force** when its record is active and has
started, and the provision itself has started. A provision is
**limited** when it names a purpose, action, resource type, data class,
security label or one specific recipient. For `external_sharing`, a
permit that names one specific recipient is not counted, as in the
evaluator.

`sharing_reason`, first match wins:

| `sharing_reason` | `sharing_state` | When |
| --- | --- | --- |
| `refused` | `restricted` | a refusal in force, with no limit (verified or not) |
| `refused_partly` | `restricted` | a refusal in force, with a limit. A verified full permission beside it does not make the chip Allowed |
| `permitted` | `allowed` | a verified permission in force, with no limit |
| `limited` | `restricted` | the only verified permissions in force are limited |
| `pending_verification` | `restricted` | a permission in force that staff have not verified |
| `withdrawn` | `withdrawn` | a withdrawn patient-privacy record had a permission for someone outside mBHR and no refusal |
| `not_started` | `restricted` | a permission that is not in force yet (draft, proposed, or a start in the future) |
| `no_permission` | `restricted` | anything else, including no record at all |

- A refusal counts only where the gateway's evaluator would apply it. A
  refusal on a draft or proposed record, or one that has not started, is
  not counted, so the chip can read Allowed beside it until it is active
  and started.
- A refusal with a security label counts as `refused_partly`, although
  the evaluator ignores labelled provisions (mBHR labels no data).
- A withdrawn refusal, a withdrawn record with no rules, or a withdrawn
  permission for the care team only does not make the chip say
  Withdrawn. The same rule applies to `withdrawn` in the older
  `external_sharing` key.
- A permission waiting for staff to check it ranks above an older
  withdrawal.

## Where consent shows in the app

All three are read-only apart from the patient's Withdraw button. None of
them can block care.

- **Patient portal, "Privacy and data sharing".** A section inside the
  portal's "Sharing your health records" page
  (`src/features/patient-portal/PrivacyConsentSection.tsx`, wording in
  `privacyCopy.ts`).
  - The intro says that the care team uses the records to care for the
    patient, that the list shows the choices about sharing that mBHR has
    recorded, that it is separate from the sharing choices further down
    the page, that mBHR does not apply these choices automatically yet,
    that a permission can be withdrawn here and a refusal changed only
    with clinic staff, and that withdrawing deletes neither the records
    nor the history of who looked at them. It makes no claim that mBHR
    shares nothing.
  - The list, "Your recorded choices", shows only patient-privacy and
    research records of the page's patient and of the records merged
    into it (`interop_my_consents(p_patient_id)`). Treatment consents and
    advance directives are not listed. Empty: "No choices are recorded
    here."
  - A permission (it allows something and refuses nothing) reads "Sharing
    your records outside mBHR" or "Using your records for research",
    with the purposes it names in brackets ("for your care", and so on).
    While it is in place or not started yet it has a Withdraw button. The
    dialog says: "mBHR will record that you withdrew this permission. It
    will no longer count as your permission. You cannot undo this here.
    To give permission again, ask clinic staff." Withdrawing sends the
    page's patient id (`interop_withdraw_consent()`). A permission with a
    rule for one specific recipient (`names_recipient` true) reads "A
    choice about how your records are shared" (research: "A choice about
    how your records are used for research") with "Ask clinic staff about
    it.", because the portal cannot say who the recipient is; it keeps
    its Withdraw button.
  - A record with any "do not" rule is a refusal and has no Withdraw
    button. It reads "You asked us not to share your records outside
    mBHR" (research: "You asked us not to use your records for research")
    only when one of its "do not" rules is for someone outside mBHR
    (`external_system`, `organization`, `any` or unset). When those rules
    name purposes, the purposes follow in brackets, and if one of them is
    the patient's own requests (`PATRQT`) the neutral title below is used
    instead. A named refusal carries "Ask clinic staff if you want to
    change this."
  - Any other refusal (a rule only for the care team, a practitioner or
    the portal, or one about the patient's own requests) reads "A choice
    about how your records are shared" (research: "A choice about how
    your records are used for research"), with "Ask clinic staff about
    it."
  - A refusal that also allows something adds "This choice also allows
    some sharing."
  - A record with no rules reads "A choice about sharing your records
    outside mBHR" (or the research form) with "It does not say what is
    allowed. Ask clinic staff about it.", and has no button.
  - A purpose that repeats the topic ("for research" under research) is
    not shown.
  - When the functions are not deployed it says "This list is not
    available yet." Offline, it asks the patient to connect. Signed out,
    refused, or without a valid patient id, it says "Sign in online to
    see this list."
- **Staff chip on the patient page.** `ExternalSharingChip` on
  `PatientDetail` shows "External sharing: Allowed", "Restricted" or
  "Withdrawn" from `sharing_state` ([above](#the-staff-chips-state-and-reason)).
  The hover text, also read out by screen readers, gives the reason in
  plain words, then says: "External access is off in this release, so
  this is not used to share records yet. It does not affect care." The
  reasons read:
  - `refused`: "The patient asked us not to share their records outside
    mBHR."
  - `refused_partly`: "The patient refused some sharing outside mBHR."
  - `permitted`: "The patient allowed sharing outside mBHR, with no
    limits."
  - `limited`: "The patient's permission covers only some recipients,
    records or uses."
  - `pending_verification`: "A permission is recorded, but staff have not
    checked it yet."
  - `withdrawn`: "A permission to share outside mBHR was withdrawn." (It
    does not say who withdrew it.)
  - `not_started`: "A permission is recorded, but it has not started
    yet."
  - `no_permission`: "No permission to share outside mBHR is in force."
  - an unknown reason: "The reason is not known."

  It shows only to roles with `consult`, `portal_manage` or
  `audit_access`, only when online and signed in online. It renders
  nothing when the summary cannot be read, or when the answer has no
  `sharing_state`.
- **Admin settings, Interoperability panel.**
  `src/pages/admin/InteroperabilitySettings.tsx` in `/admin/settings`, for
  roles with `audit_access` or `users`. It shows the gateway flags (read
  from the `/metadata` flags header), request and refusal activity, and
  consent record counts (`fhir_interop_admin_status()`). It changes
  nothing. Its description says that the FHIR interface lets signed-in
  mBHR staff (and patients, when patient access is on) read records in
  the FHIR R4 format, and that other systems and apps cannot connect in
  this release.

With the register empty, the portal list is empty and the chip reads
"External sharing: Restricted" (hover: "No permission to share outside
mBHR is in force."). That matches the default-deny rule.

## The Consent resource

The gateway publishes register records as FHIR R4 Consent, read-only. The
mapping is in [resource-mapping.md](resource-mapping.md#consent--the-consent-register).

- Searches: `_id`, `patient`, `status`, `scope`.
- No staff account may read or search it (owner decision, "Only what the
  app shows"): in mBHR staff see only the External sharing chip, and FHIR
  never shows staff more. Every staff request is 403 `missing_permission`
  at the permission step, audited, before the register is read, until
  mBHR has a staff consent screen. A patient (with
  `FHIR_PATIENT_ACCESS_ENABLED`) sees only their own (restriction
  `own_consents_only`).
- A withdrawn record is published as `inactive`, never `active`.
- A consent past its end date is published as `inactive` (no longer in
  force) with its end date in `provision.period`, as the consent check
  (`consent_expired`) and the portal (ended) treat it; `status=active`
  never matches it. The time is the gateway's request time, the one the
  access decision used.
- A record is published whole or not at all. Recording a consent needs a
  policy link, so every record has one; a record that still cites no
  usable `policy_uri` is not published (R4 needs a policy or a policy
  rule), as defence in depth. Neither is a record whose rules cannot be
  shown without changing their meaning. That includes a rule for one named recipient (for example one
  hospital): the recipient is never published, and without it the rule
  would read as a rule for every recipient of that kind. A searchset says
  how many were left out.
- Every searchset carries a note that an empty or short result is not
  evidence that the patient agreed to or refused anything.

Consent is **Partial** for two reasons:

1. **The register is empty.** Nothing in the app records a consent yet
   (see above), so every search returns an empty searchset.
2. **Patients do not see merged-away directives.** A patient's search
   sends only the patient's current record ids. A directive still filed
   under a record that was merged into theirs is not returned to the
   patient through FHIR. The patient's searchset says so, and points to
   the portal's privacy section, which does list them. Closing the gap
   needs a database helper that resolves a patient's merged records.

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
- The policy URIs to cite (none is defined; examples only). A consent
  cannot be recorded or imported without one, so this must be decided
  first.
- Break-glass: whether it is wanted, and the review process.
- When mBHR has a staff consent screen, whether staff read Consent over
  FHIR again (refused until then, by owner decision).
