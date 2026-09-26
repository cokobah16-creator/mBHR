-- ============================================================================
-- Interoperability, second delivery: FHIR R4 Phase 2 database functions
-- ============================================================================
-- Additive and idempotent: every statement can run again. No existing table
-- or column is dropped or changed in type, no existing row is changed, and
-- no existing migration file is edited. Everything the /fhir/R4 gateway
-- calls is a public.fhir_* function (the gateway's PostgREST allowlist);
-- the consent management functions the app calls are public.interop_*.
--
-- Depends on (resolved when the functions run, not when they are created):
--   20260926110000  schema interop: resource_links, consent_records,
--                   consent_provisions, access_audit, refuse_change(),
--                   touch_updated_at(), and the three Phase 1 functions
--   20260517153407  public.check_and_increment_rate_limit() (the file was
--                   20260520000004 before it took production's version)
--   20260924110000  public.app_current_role()
--   20260925100000  public.app_portal_patient_ids() (excludes merged-away
--                   records), patients.merged_into / merged_at
--   20260925100600  public.app_role_has_permission() (latest matrix),
--                   public.app_is_staff() (includes registration_lead)
--   20260925100500  lab_results release columns (fhir_patient_lab_results)
-- Clinical tables are touched only behind to_regclass / column checks, so
-- the file applies where one is missing; a function that needs a missing
-- table returns no rows (interop_record_consent refuses: unknown patient).
--
-- What each object is for
--   1. interop.access_audit gains http_status, consent_decision, consent_id,
--      provision_id, actor_kind and restrictions (with CHECKs).
--   2. Internal helpers (interop schema, no API grants): caller_kind(),
--      caller_permissions(), caller_has_any(), ids_ok(),
--      patient_members(), patient_family(), consent_directives_json().
--   3. fhir_gateway_context_v2   role, permissions, actor kind (staff /
--                                patient / none), the portal patient ids,
--                                and one step of one or two rate buckets
--   4. fhir_record_access_v2     one audit row; a 'permit' row only from
--                                staff or the patient whose records were
--                                read; a patient names only their own
--                                records, other accounts no patient at
--                                all; own rate bucket 'fhir_audit'.
--                                v1 fhir_record_access is kept, but
--                                authenticated can no longer execute it.
--   5. fhir_resolve_patients     merge-chain resolution as the caller (RLS)
--   6. fhir_staff_directory      Practitioner directory (name and role only)
--                                with stable minted ids in resource_links
--   7. fhir_link_ids / fhir_link_sources   Medication <-> pharmacy_items ids
--                                (staff holding consult, dispense or
--                                inventory, as pharmacy_items row security)
--   8. Consent: consent_record_history (append-only), change log and audit
--      triggers, update guards (identity, withdrawal and final statuses),
--      provisions immutable and added only with their record, and the
--      functions
--      fhir_consent_directives, interop_record_consent,
--      interop_verify_consent, interop_withdraw_consent,
--      interop_my_consents, interop_consent_summary
--   9. fhir_access_audit_events  AuditEvent source (audit_access holders)
--  10. fhir_interop_admin_status counts and recent requests, no ids
--  11. fhir_patient_lab_results  a portal patient's released lab results
--  12. Phase 1 fixes: search_path = pg_catalog, public on the three Phase 1
--      functions; the function that keeps patients.fhir_id once set
--  13. Indexes, only where no index on the column exists (see section 13)
--  14. The patients.fhir_id trigger (after the indexes: see section 14)
--
-- Locks: the file first sets lock_timeout to 5 seconds for its own
-- transaction (supabase db push runs each migration file in one
-- transaction), so a statement that would queue behind a busy table fails
-- the whole migration instead of holding up that table. The last step that
-- locks public.patients is the fhir_id trigger (section 14), so patient
-- writes wait only from there to the commit, not through the index builds.
-- Patient writes still pause briefly while it commits: apply it at a quiet
-- time, and do not re-run it on production without a reason.
--
-- Decisions taken where the design left room (the safer choice each time):
--   - A caller with no auth.uid() gets 42501 from every new function (v1
--     raised 28000); anon has no EXECUTE at all.
--   - fhir_record_access_v2: purpose must match ^[A-Za-z][A-Za-z0-9_-]{0,15}$
--     or be NULL (v1 truncated free text); a 'permit' row with a
--     denial_reason is refused; a 'deny' row without one is stored as
--     'denied' (as v1); a patient 'permit' row must name at least one
--     patient id; http_status may be NULL; a mismatching p_actor_kind is
--     overridden and flagged in metadata (actor_kind_mismatch).
--   - fhir_resolve_patients: merged = merged_into or merged_at is set. When
--     the chain does not end (more than 10 hops or a loop) or a hop is not
--     visible to the caller, canonical_id / canonical_fhir_id are NULL and
--     member_ids is empty (nothing to act on); an orphaned tombstone
--     (merged_at set, merged_into NULL) resolves to itself with
--     chain_ok = false.
--   - fhir_staff_directory: arrays at most 200 entries; an unknown or
--     non-staff p_role (for example 'guest') returns no rows; inactive staff
--     are returned with active = false (history still names them). It is
--     VOLATILE (it may mint ids): call it with POST.
--   - fhir_consent_directives: a selector (patient ids or consent ids) is
--     required from every caller, staff included. Staff must hold consult,
--     portal_manage or audit_access (the Consent read permissions) for it
--     and for interop_consent_summary: the RPCs are open to every signed-in
--     account through the API, so the gateway's narrowing is not a
--     boundary. (The design said any staff role; the gateway must not load
--     directives for other staff: see the report.)
--   - Consent ownership follows merges: a consent recorded on a record
--     that was later merged away keeps that patient_id (a merge moves rows
--     in public tables only, and patient_id cannot change), so the patient
--     of the kept record sees, withdraws and is summarised with it
--     (interop.patient_members / patient_family, read as the owner;
--     public.canonical_patient_id is not used).
--   - interop_consent_summary follows the gateway's consent evaluator for
--     external sharing (scope patient-privacy; actor external_system,
--     organization, any or unset; no security label; a deny wins; a permit
--     counts only when verified). The design's rule (external_system /
--     organization only, purpose not TREAT, any scope, denies ignored,
--     unverified permits count) disagreed with what the gateway enforces.
--     It adds pending_verification (boolean) to the design's keys, and
--     sharing_state / sharing_reason for the staff chip: 'allowed' only for
--     a verified, in-force permit with no limit (no purpose, action,
--     resource type, data class or security label) and no refusal;
--     'withdrawn'; otherwise 'restricted', with the reason.
--   - The chip counts a refusal only where the gateway's evaluator would
--     apply it: an external-actor deny on an active, started, not
--     withdrawn, not ended patient-privacy record, in its own period. A
--     deny on a draft or proposed record, or one that has not started yet,
--     is not counted (the evaluator ignores it too), so the chip can read
--     Allowed beside it until it is active and started. A refusal limited
--     by purpose, action, resource type, data class or security label is
--     'refused_partly', and a verified full permit beside it is not
--     'allowed'.
--   - 'withdrawn' (sharing_reason and the older external_sharing key) only
--     when a withdrawn patient-privacy record had a permit for an external
--     actor and no deny: a withdrawn refusal, an empty record or a care
--     team permit does not make the chip say Withdrawn. A permit waiting
--     for staff to check it ranks above an older withdrawal.
--   - interop_my_consents(p_patient_id): the page's patient (one of the
--     caller's portal records) and the records merged into it, not every
--     record linked to the sign-in (a shared phone can link several
--     people). NULL is refused (22023): there is no "all my records" call.
--   - interop_withdraw_consent: a portal patient may withdraw only a
--     permission to share (scope patient-privacy or research, no deny
--     provision). A refusal, a treatment consent or an advance directive is
--     changed with clinic staff (42501 for the patient); staff are not
--     limited. The optional p_patient_id names the page's patient: the
--     record must then be that patient's (or of a record merged into it),
--     for staff too, and a patient must name one of their own portal
--     records (42501 otherwise). The portal always passes it, so a sign-in
--     linked to two people (a shared phone) withdraws only for the person
--     the page shows. Without it a patient may still withdraw a record of
--     any person linked to the sign-in (the linkage model): it narrows the
--     request, it is not the ownership check.
--   - fhir_link_ids / fhir_link_sources: staff holding consult, dispense or
--     inventory only (pharmacy_items_select): other staff cannot read the
--     catalogue, so they may not mint or resolve its published ids either.
--   - Consent records: a rejected, inactive or entered-in-error record never
--     comes back into force; only draft, proposed or active records can be
--     verified; provisions can be inserted only in the transaction that
--     created their record, never into a verified or withdrawn one.
--   - fhir_record_access_v2: a portal patient's refusal may name only their
--     own records; an account that is neither staff nor patient may record
--     only refusals naming no patient, at most 30 a minute.
--   - interop_record_consent: status draft / proposed / active only; the
--     patient must exist and not be merged away; provisions: at most 20,
--     only the published keys (no actor_reference).
--   - interop_withdraw_consent keeps 'entered-in-error' when withdrawing a
--     record in that status; a repeat withdrawal returns false.
--   - fhir_access_audit_events: p_from > p_to is refused; the keyset needs
--     both p_after_occurred and p_after_id.
--   - fhir_patient_lab_results: staff are refused even when the account is
--     also linked to a patient record (the design: staff read the tables).
--   - consent_record_history: the service role may read it, not write it
--     (only the trigger writes, as the owner).
--
-- Rollback (in this order; each line is one statement). Dropping the
-- access_audit columns deletes the HTTP status, consent result, actor kind
-- and restrictions of every audit row, and dropping consent_record_history
-- deletes the consent change history: export both first.
--   DROP FUNCTION IF EXISTS public.fhir_gateway_context_v2(integer, integer, boolean);
--   DROP FUNCTION IF EXISTS public.fhir_record_access_v2(uuid, text, text, text, text[], text, text, text, integer, text[], text, text, integer, text, uuid, uuid, text[], text);
--   DROP FUNCTION IF EXISTS public.fhir_resolve_patients(text[], text[]);
--   DROP FUNCTION IF EXISTS public.fhir_staff_directory(text[], text[], text, text, text, integer);
--   DROP FUNCTION IF EXISTS public.fhir_link_ids(text, text[]);
--   DROP FUNCTION IF EXISTS public.fhir_link_sources(text, text[]);
--   DROP FUNCTION IF EXISTS public.fhir_consent_directives(text[], uuid[], uuid, integer);
--   DROP FUNCTION IF EXISTS public.fhir_access_audit_events(uuid, text[], text[], timestamptz, timestamptz, text, text, timestamptz, uuid, integer);
--   DROP FUNCTION IF EXISTS public.fhir_interop_admin_status();
--   DROP FUNCTION IF EXISTS public.fhir_patient_lab_results(uuid[], uuid[], uuid, integer);
--   DROP FUNCTION IF EXISTS public.interop_record_consent(text, text, text, text, text, text, timestamptz, timestamptz, jsonb);
--   DROP FUNCTION IF EXISTS public.interop_verify_consent(uuid);
--   DROP FUNCTION IF EXISTS public.interop_withdraw_consent(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.interop_my_consents(text);
--   DROP FUNCTION IF EXISTS public.interop_consent_summary(text);
--   DROP TRIGGER IF EXISTS consent_records_history ON interop.consent_records;
--   DROP TRIGGER IF EXISTS consent_records_guard ON interop.consent_records;
--   DROP TRIGGER IF EXISTS consent_provisions_no_update ON interop.consent_provisions;
--   DROP TRIGGER IF EXISTS consent_provisions_insert_guard ON interop.consent_provisions;
--   DROP TABLE IF EXISTS interop.consent_record_history;
--   DROP FUNCTION IF EXISTS interop.consent_records_log_change();
--   DROP FUNCTION IF EXISTS interop.consent_records_guard();
--   DROP FUNCTION IF EXISTS interop.consent_provisions_guard_insert();
--   DROP FUNCTION IF EXISTS interop.consent_directives_json(uuid[]);
--   DROP FUNCTION IF EXISTS interop.caller_has_any(text[]);
--   DROP FUNCTION IF EXISTS interop.caller_permissions();
--   DROP FUNCTION IF EXISTS interop.caller_kind();
--   DROP FUNCTION IF EXISTS interop.ids_ok(text[], text, integer);
--   DROP FUNCTION IF EXISTS interop.patient_family(text);
--   DROP FUNCTION IF EXISTS interop.patient_members(text[]);
--   DO $rb$ BEGIN IF to_regclass('public.patients') IS NOT NULL THEN DROP TRIGGER IF EXISTS patients_keep_fhir_id ON public.patients; END IF; END $rb$;
--   DROP FUNCTION IF EXISTS public.tg_patients_keep_fhir_id();
--   ALTER TABLE interop.access_audit DROP COLUMN IF EXISTS http_status, DROP COLUMN IF EXISTS consent_decision, DROP COLUMN IF EXISTS consent_id, DROP COLUMN IF EXISTS provision_id, DROP COLUMN IF EXISTS actor_kind, DROP COLUMN IF EXISTS restrictions;
--   GRANT EXECUTE ON FUNCTION public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text) TO authenticated;
--   ALTER FUNCTION public.fhir_gateway_context(integer) SET search_path = public, pg_catalog;
--   ALTER FUNCTION public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text) SET search_path = public, pg_catalog;
--   ALTER FUNCTION public.fhir_terminology_lookup(text, text[]) SET search_path = public, pg_catalog;
--   DROP INDEX IF EXISTS public.interop_dispenses_prescription_id_idx;
--   DROP INDEX IF EXISTS public.interop_lab_results_order_id_idx;
--   DROP INDEX IF EXISTS public.interop_prescriptions_patient_id_idx;
--   DROP INDEX IF EXISTS public.interop_patient_allergies_patient_id_idx;
--   DROP INDEX IF EXISTS public.interop_patient_documents_patient_id_idx;
--   DELETE FROM public.rate_limits WHERE bucket IN ('fhir_gateway_sensitive', 'fhir_audit');
-- End of rollback. Minted interop.resource_links rows (Practitioner,
-- Medication) are left in place on purpose: deleting them changes every
-- published Practitioner and Medication id when this migration is applied
-- again. The indexes may also stay (they only speed up reads).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Lock timeout for this transaction
-- ----------------------------------------------------------------------------
-- set_config(..., true) is SET LOCAL: it lasts until the migration's
-- transaction ends. Where each statement runs on its own (psql -f without
-- a transaction, as the CI job does) it ends with this statement, silently.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END $$;

-- ----------------------------------------------------------------------------
-- 0. Precondition: the Phase 1 interop schema
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('interop.access_audit') IS NULL
     OR to_regclass('interop.consent_records') IS NULL
     OR to_regclass('interop.consent_provisions') IS NULL
     OR to_regclass('interop.resource_links') IS NULL THEN
    RAISE EXCEPTION 'interop phase 2: apply 20260926110000_interop_foundation.sql first';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. access_audit: HTTP status, consent result, actor kind, restrictions
-- ----------------------------------------------------------------------------
-- New columns are nullable or have a constant default, so existing rows are
-- not rewritten and the append-only triggers are not involved.
ALTER TABLE interop.access_audit
  ADD COLUMN IF NOT EXISTS http_status      smallint,
  ADD COLUMN IF NOT EXISTS consent_decision text,
  ADD COLUMN IF NOT EXISTS consent_id       uuid,
  ADD COLUMN IF NOT EXISTS provision_id     uuid,
  ADD COLUMN IF NOT EXISTS actor_kind       text,
  ADD COLUMN IF NOT EXISTS restrictions     text[] NOT NULL DEFAULT '{}';

-- The CHECKs are added NOT VALID: ADD CONSTRAINT holds an ACCESS EXCLUSIVE
-- lock on access_audit until the migration commits, and a validating ADD
-- would scan every audit row under it (every gateway request waits on the
-- audit insert and answers 503 meanwhile). A NOT VALID CHECK is enforced
-- for every new and updated row. The existing rows cannot break these
-- CHECKs: the columns were just added (NULL, or '{}' for restrictions).
-- To mark them validated later without blocking inserts (SHARE UPDATE
-- EXCLUSIVE lock), run outside a migration:
--   ALTER TABLE interop.access_audit VALIDATE CONSTRAINT access_audit_consent_decision;
--   (and the same for access_audit_actor_kind, access_audit_http_status,
--   access_audit_restrictions_bounded)
DO $$
DECLARE
  v_c text[];
BEGIN
  FOREACH v_c SLICE 1 IN ARRAY ARRAY[
    ARRAY['access_audit_consent_decision',
          'consent_decision IS NULL OR consent_decision IN (''permit'', ''deny'', ''not-applicable'')'],
    ARRAY['access_audit_actor_kind',
          'actor_kind IS NULL OR actor_kind IN (''staff'', ''patient'', ''none'')'],
    ARRAY['access_audit_http_status',
          'http_status IS NULL OR http_status BETWEEN 100 AND 599'],
    ARRAY['access_audit_restrictions_bounded',
          'cardinality(restrictions) <= 12']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'interop.access_audit'::regclass AND conname = v_c[1]) THEN
      EXECUTE format('ALTER TABLE interop.access_audit ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                     v_c[1], v_c[2]);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Internal helpers (interop schema: no API role can call them)
-- ----------------------------------------------------------------------------
-- The caller as the gateway sees them: 'staff' (a known, non-guest app
-- role), 'patient' (a signed-in account linked to at least one portal
-- record that is not merged away), 'none', or NULL when nobody is signed in.
CREATE OR REPLACE FUNCTION interop.caller_kind()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NULL;
  END IF;
  IF COALESCE(public.app_is_staff(), false) THEN
    RETURN 'staff';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_portal_patient_ids()) THEN
    RETURN 'patient';
  END IF;
  RETURN 'none';
END;
$$;

-- The caller's permissions from the server matrix (same list as v1).
CREATE OR REPLACE FUNCTION interop.caller_permissions()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(array_agg(p ORDER BY p), '{}')
    FROM (SELECT public.app_current_role() AS role) AS cr
   CROSS JOIN unnest(ARRAY[
      'register', 'vitals', 'consult', 'dispense', 'inventory', 'export',
      'users', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts',
      'lab_review', 'queue', 'portal_manage', 'merge_patients',
      'lab_release', 'portal_invite']) AS p
   WHERE cr.role IS NOT NULL AND public.app_role_has_permission(cr.role, p);
$$;

CREATE OR REPLACE FUNCTION interop.caller_has_any(p_permissions text[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(bool_or(public.app_role_has_permission(cr.role, p)), false)
    FROM (SELECT public.app_current_role() AS role) AS cr
   CROSS JOIN unnest(p_permissions) AS p
   WHERE cr.role IS NOT NULL;
$$;

-- true when the array has at most p_max entries, none NULL, all matching
-- p_pattern. A NULL array counts as empty.
CREATE OR REPLACE FUNCTION interop.ids_ok(p_ids text[], p_pattern text, p_max integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(cardinality(p_ids), 0) <= p_max
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_ids, '{}')) AS x
                      WHERE x IS NULL OR x !~ p_pattern);
$$;

-- The given patient ids plus every record whose merge chain leads to one of
-- them (reverse walk over merged_into, at most 10 levels). Read as the
-- function owner: it is called only from the definer functions below,
-- which decide first who may see what. A merge moves rows in public
-- tables only, so a consent recorded on a record before it was merged away
-- keeps the old patient_id; this is how such a consent is still found as
-- the kept record's (and its patient's) consent.
CREATE OR REPLACE FUNCTION interop.patient_members(p_ids text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_out text[];
BEGIN
  v_out := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_ids, '{}')) AS x WHERE x IS NOT NULL);
  IF cardinality(v_out) = 0
     OR to_regclass('public.patients') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.patients'::regclass
                       AND attname = 'merged_into' AND NOT attisdropped) THEN
    RETURN v_out;
  END IF;
  WITH RECURSIVE members(mid, depth) AS (
    SELECT x, 0 FROM unnest(v_out) AS x
    UNION
    SELECT c.id::text, m.depth + 1
      FROM members AS m
      JOIN public.patients AS c ON c.merged_into::text = m.mid
     WHERE m.depth < 10
  )
  SELECT array_agg(DISTINCT mid ORDER BY mid) INTO v_out FROM members;
  RETURN v_out;
END;
$$;

-- The whole merge family of one record: follow merged_into forward to the
-- kept record (at most 10 hops; a chain that does not end, or a missing
-- hop, stops the walk where it is), then patient_members() of that record.
-- Always contains p_id. Owner rights, as patient_members().
CREATE OR REPLACE FUNCTION interop.patient_family(p_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cur   text := p_id;
  v_next  text;
  v_hops  integer := 0;
  v_out   text[];
BEGIN
  IF p_id IS NULL THEN
    RETURN '{}';
  END IF;
  IF to_regclass('public.patients') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.patients'::regclass
                       AND attname = 'merged_into' AND NOT attisdropped) THEN
    RETURN ARRAY[p_id];
  END IF;
  LOOP
    SELECT p.merged_into::text INTO v_next FROM public.patients AS p WHERE p.id::text = v_cur;
    EXIT WHEN v_next IS NULL OR v_hops >= 10;
    v_cur := v_next;
    v_hops := v_hops + 1;
  END LOOP;
  IF v_next IS NOT NULL THEN
    v_cur := p_id;                     -- no end within 10 hops: stay put
  END IF;
  v_out := interop.patient_members(ARRAY[v_cur]);
  IF NOT (p_id = ANY (v_out)) THEN
    v_out := v_out || p_id;
  END IF;
  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION interop.patient_members(text[]) IS
  'Internal: the ids plus every patient record merged (directly or through a chain of at most '
  '10) into one of them.';
COMMENT ON FUNCTION interop.patient_family(text) IS
  'Internal: every record of the merge family of one patient record (kept record and its '
  'merged-away members); always contains the input.';
COMMENT ON FUNCTION interop.caller_kind() IS
  'Internal: staff, patient or none for the signed-in caller (NULL when nobody is signed in).';
COMMENT ON FUNCTION interop.caller_permissions() IS
  'Internal: the caller''s permissions from public.app_role_has_permission().';
COMMENT ON FUNCTION interop.caller_has_any(text[]) IS
  'Internal: true when the caller''s role holds any of the permissions.';
COMMENT ON FUNCTION interop.ids_ok(text[], text, integer) IS
  'Internal: an id array is bounded, has no NULL and every entry matches the pattern.';

-- ----------------------------------------------------------------------------
-- 3. fhir_gateway_context_v2
-- ----------------------------------------------------------------------------
-- {role, permissions, actor_kind, patient_ids, rate_allowed,
--  retry_after_seconds}. role/permissions as v1. patient_ids is filled only
-- for actor_kind 'patient' (staff and none get []). Rate: bucket
-- 'fhir_gateway' (p_rate_limit, clamped 1..600, per 60 s) on every call;
-- with p_sensitive also 'fhir_gateway_sensitive' (p_sensitive_rate_limit,
-- clamped 1..600), consulted only when the general bucket allowed the call
-- (a refused call does not use up the sensitive allowance). rate_allowed
-- only when every bucket consulted allows;
-- retry_after_seconds is the longest wait.
CREATE OR REPLACE FUNCTION public.fhir_gateway_context_v2(
  p_rate_limit            integer DEFAULT 60,
  p_sensitive_rate_limit  integer DEFAULT 20,
  p_sensitive             boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_kind    text;
  v_rate    jsonb;
  v_rate2   jsonb;
  v_allowed boolean;
  v_retry   integer;
  v_ids     text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;

  v_rate := public.check_and_increment_rate_limit(
    'fhir_gateway', v_uid::text, LEAST(GREATEST(COALESCE(p_rate_limit, 60), 1), 600), 60);
  v_allowed := COALESCE((v_rate ->> 'allowed')::boolean, false);
  v_retry := (v_rate ->> 'retry_after_seconds')::integer;

  -- The sensitive bucket is consulted only when the general one allowed the
  -- request: a refused request must not use up the sensitive allowance.
  IF COALESCE(p_sensitive, false) AND v_allowed THEN
    v_rate2 := public.check_and_increment_rate_limit(
      'fhir_gateway_sensitive', v_uid::text,
      LEAST(GREATEST(COALESCE(p_sensitive_rate_limit, 20), 1), 600), 60);
    v_allowed := v_allowed AND COALESCE((v_rate2 ->> 'allowed')::boolean, false);
    v_retry := GREATEST(v_retry, (v_rate2 ->> 'retry_after_seconds')::integer);
  END IF;

  v_kind := interop.caller_kind();
  IF v_kind = 'patient' THEN
    SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_ids
      FROM public.app_portal_patient_ids() AS x;
  END IF;

  RETURN jsonb_build_object(
    'role', public.app_current_role(),
    'permissions', to_jsonb(interop.caller_permissions()),
    'actor_kind', v_kind,
    'patient_ids', to_jsonb(v_ids),
    'rate_allowed', v_allowed,
    'retry_after_seconds', CASE WHEN v_allowed THEN NULL ELSE COALESCE(v_retry, 60) END);
END;
$$;

COMMENT ON FUNCTION public.fhir_gateway_context_v2(integer, integer, boolean) IS
  'FHIR gateway: the caller''s role, permissions, actor kind (staff, patient, none), the '
  'portal patient ids of a patient caller, and one step of the general (and, for sensitive '
  'requests, the sensitive) rate bucket. See docs/interoperability/security.md.';

-- ----------------------------------------------------------------------------
-- 4. fhir_record_access_v2 (and v1 closed to authenticated)
-- ----------------------------------------------------------------------------
-- The actor, role and actor kind come from the session, never from the
-- arguments. A 'permit' row is accepted only from a staff caller, or from a
-- portal patient whose p_patient_ids are all their own records (at least
-- one). A portal patient's refusal may name only their own records; any
-- other account may only record refusals that name no patient. Values are
-- checked (22023) and bounded. Own rate bucket 'fhir_audit': 300 rows per
-- account per 60 s for staff and patients, 30 for other accounts (P0001
-- 'rate limited').
CREATE OR REPLACE FUNCTION public.fhir_record_access_v2(
  p_request_id        uuid,
  p_interaction       text,
  p_resource_type     text,
  p_resource_id       text,
  p_patient_ids       text[],
  p_purpose           text,
  p_decision          text,
  p_denial_reason     text,
  p_result_count      integer,
  p_search_params     text[],
  p_user_agent        text,
  p_ip_hash           text,
  p_http_status       integer,
  p_consent_decision  text,
  p_consent_id        uuid,
  p_provision_id      uuid,
  p_restrictions      text[],
  p_actor_kind        text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_ids   text[] := COALESCE(p_patient_ids, '{}');
  v_kind  text;
  v_rate  jsonb;
  v_meta  jsonb;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;

  -- COALESCE: a NULL argument makes a comparison NULL, which must refuse.
  IF COALESCE(
        p_request_id IS NULL
     OR p_interaction NOT IN ('read', 'search')
     OR p_decision NOT IN ('permit', 'deny')
     OR p_resource_type !~ '^[A-Z][A-Za-z]{1,63}$'
     OR (p_resource_id IS NOT NULL AND p_resource_id !~ '^[A-Za-z0-9.-]{1,64}$')
     OR NOT interop.ids_ok(v_ids, '^[A-Za-z0-9._-]{1,128}$', 100)
     OR NOT interop.ids_ok(p_search_params, '^([A-Za-z_][A-Za-z0-9_-]{0,39}|unsupported)$', 20)
     OR NOT interop.ids_ok(p_restrictions, '^[a-z][a-z0-9_:-]{0,63}$', 12)
     OR (p_denial_reason IS NOT NULL AND p_denial_reason !~ '^[a-z][a-z0-9_]{0,63}$')
     OR (p_decision = 'permit' AND p_denial_reason IS NOT NULL)
     OR (p_purpose IS NOT NULL AND p_purpose !~ '^[A-Za-z][A-Za-z0-9_-]{0,15}$')
     OR COALESCE(p_result_count, 0) < 0
     OR (p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$')
     OR (p_http_status IS NOT NULL AND (p_http_status < 100 OR p_http_status > 599))
     OR (p_consent_decision IS NOT NULL AND p_consent_decision NOT IN ('permit', 'deny', 'not-applicable'))
     OR (p_actor_kind IS NOT NULL AND p_actor_kind NOT IN ('staff', 'patient', 'none')), true) THEN
    RAISE EXCEPTION 'invalid audit record' USING ERRCODE = '22023';
  END IF;

  v_kind := interop.caller_kind();

  -- Who may name which patients. Staff: any (permit or deny). A portal
  -- patient: only their own records, for a permit (at least one) and for a
  -- refusal alike (the gateway resolves patient references as the caller,
  -- so it never names a record the patient cannot see). Anyone else: a
  -- refusal naming no patient (the gateway refuses such callers before any
  -- patient is resolved). Otherwise any signed-in account could file
  -- refusals against real patients' ids.
  IF v_kind = 'staff' THEN
    NULL;
  ELSIF v_kind = 'patient' THEN
    IF NOT (v_ids <@ ARRAY(SELECT public.app_portal_patient_ids()))
       OR (p_decision = 'permit' AND cardinality(v_ids) = 0) THEN
      RAISE EXCEPTION 'this account may only name its own records' USING ERRCODE = '42501';
    END IF;
  ELSIF p_decision = 'permit' OR cardinality(v_ids) > 0 THEN
    RAISE EXCEPTION 'this account may only record refusals naming no patient' USING ERRCODE = '42501';
  END IF;

  -- 300 rows a minute for staff and patients; 30 for any other account.
  v_rate := public.check_and_increment_rate_limit(
    'fhir_audit', v_uid::text, CASE WHEN v_kind IN ('staff', 'patient') THEN 300 ELSE 30 END, 60);
  IF NOT COALESCE((v_rate ->> 'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'rate limited' USING ERRCODE = 'P0001';
  END IF;

  v_meta := jsonb_build_object('search_params', to_jsonb(COALESCE(p_search_params, '{}')));
  IF p_actor_kind IS NOT NULL AND p_actor_kind IS DISTINCT FROM v_kind THEN
    v_meta := v_meta || jsonb_build_object('actor_kind_mismatch', true);
  END IF;

  INSERT INTO interop.access_audit (
    request_id, actor_user_id, actor_role, actor_kind, patient_id, patient_ids,
    action, resource_type, resource_id, purpose, decision, denial_reason,
    result_count, source, user_agent, ip_hash, http_status, consent_decision,
    consent_id, provision_id, restrictions, metadata)
  VALUES (
    p_request_id, v_uid, public.app_current_role(), v_kind,
    CASE WHEN cardinality(v_ids) = 1 THEN v_ids[1] END,
    v_ids, p_interaction, p_resource_type, p_resource_id, p_purpose, p_decision,
    CASE WHEN p_decision = 'deny' THEN COALESCE(p_denial_reason, 'denied') END,
    COALESCE(p_result_count, 0), 'fhir_gateway', left(p_user_agent, 200), p_ip_hash,
    p_http_status::smallint, p_consent_decision, p_consent_id, p_provision_id,
    COALESCE(p_restrictions, '{}'), v_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fhir_record_access_v2(uuid, text, text, text, text[], text, text, text, integer, text[], text, text, integer, text, uuid, uuid, text[], text) IS
  'FHIR gateway: append one row to interop.access_audit for the calling account. A permit '
  'row only from staff or from the portal patient whose own records were read; a patient '
  'names only their own records; any other account records refusals naming no patient. '
  'Rate bucket fhir_audit (300 per minute; 30 for accounts that are neither staff nor patient).';

-- v1 stays (rollback target) but the gateway now writes through v2 only.
REVOKE EXECUTE ON FUNCTION public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text) FROM authenticated;

-- ----------------------------------------------------------------------------
-- 5. fhir_resolve_patients (SECURITY INVOKER: row-level security applies)
-- ----------------------------------------------------------------------------
-- For each visible input record: follow merged_into (at most 10 hops) to
-- the kept record. chain_ok is false when the chain does not end within 10
-- hops (or loops), when a hop is not visible to the caller (canonical and
-- members then NULL / empty), or when the chain ends at an orphaned
-- tombstone (merged_at set, merged_into NULL: the kept record was deleted;
-- that record is its own canonical). member_ids = the canonical id plus
-- every visible record whose chain leads to it (reverse walk, 10 levels).
-- Unknown or invisible inputs return no row; fhir_id is compared as text.
CREATE OR REPLACE FUNCTION public.fhir_resolve_patients(
  p_fhir_ids  text[] DEFAULT '{}',
  p_ids       text[] DEFAULT '{}'
)
RETURNS TABLE (
  input              text,
  id                 text,
  fhir_id            text,
  merged             boolean,
  canonical_id       text,
  canonical_fhir_id  text,
  chain_ok           boolean,
  member_ids         text[]
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  r        record;
  v_cur_id text;
  v_cur_fh text;
  v_next   text;
  v_mat    timestamptz;
  v_hops   integer;
  v_ok     boolean;
  v_type   text;
  v_fh     text[];
  v_sql    text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_fhir_ids), 0) + COALESCE(cardinality(p_ids), 0) > 200 THEN
    RAISE EXCEPTION 'at most 200 patient ids' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.patients') IS NULL THEN
    RETURN;
  END IF;
  SELECT format_type(a.atttypid, NULL) INTO v_type
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.patients'::regclass AND a.attname = 'fhir_id' AND NOT a.attisdropped;
  IF v_type IS NULL THEN
    RETURN;
  END IF;

  -- Candidates through the indexes: patients.fhir_id (unique) and the
  -- primary key. When fhir_id is a uuid, only inputs in canonical uuid text
  -- form can equal fhir_id::text, so exactly those are compared as uuids
  -- (a non-uuid input never errors, it simply matches nothing).
  IF v_type = 'uuid' THEN
    v_fh := ARRAY(SELECT DISTINCT f FROM unnest(COALESCE(p_fhir_ids, '{}')) AS f
                   WHERE f ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    v_sql := 'p.fhir_id = ANY ($1::uuid[])';
  ELSE
    v_fh := ARRAY(SELECT DISTINCT f FROM unnest(COALESCE(p_fhir_ids, '{}')) AS f WHERE f IS NOT NULL);
    v_sql := 'p.fhir_id::text = ANY ($1)';
  END IF;
  -- input echoes what was given: the fhir_id text (equal to the input) or the id.
  v_sql := 'SELECT p.fhir_id::text AS input, p.id::text AS pid, p.fhir_id::text AS pfh, '
        || 'p.merged_into::text AS pmi, p.merged_at AS pma FROM public.patients AS p WHERE ' || v_sql
        || ' UNION SELECT p.id::text, p.id::text, p.fhir_id::text, p.merged_into::text, p.merged_at '
        || 'FROM public.patients AS p WHERE p.id::text = ANY ($2) ORDER BY 1, 2';

  FOR r IN EXECUTE v_sql USING v_fh, COALESCE(p_ids, '{}')
  LOOP
    v_cur_id := r.pid;
    v_cur_fh := r.pfh;
    v_next := r.pmi;
    v_mat := r.pma;
    v_hops := 0;
    v_ok := true;

    WHILE v_next IS NOT NULL LOOP
      IF v_hops >= 10 THEN
        v_ok := false;               -- does not end within 10 hops (or loops)
        EXIT;
      END IF;
      SELECT p.id::text, p.fhir_id::text, p.merged_into::text, p.merged_at
        INTO v_cur_id, v_cur_fh, v_next, v_mat
        FROM public.patients AS p
       WHERE p.id::text = v_next;
      IF NOT FOUND THEN
        v_ok := false;               -- a hop the caller cannot see
        EXIT;
      END IF;
      v_hops := v_hops + 1;
    END LOOP;

    input := r.input;
    id := r.pid;
    fhir_id := r.pfh;
    merged := (r.pmi IS NOT NULL OR r.pma IS NOT NULL);

    IF NOT v_ok THEN
      canonical_id := NULL;
      canonical_fhir_id := NULL;
      chain_ok := false;
      member_ids := '{}';
    ELSE
      canonical_id := v_cur_id;
      canonical_fhir_id := v_cur_fh;
      -- The chain ended at a record with no successor: an orphaned tombstone
      -- if it is marked merged.
      chain_ok := v_mat IS NULL;
      WITH RECURSIVE members(mid, depth) AS (
        SELECT v_cur_id, 0
        UNION
        SELECT c.id::text, m.depth + 1
          FROM members AS m
          JOIN public.patients AS c ON c.merged_into::text = m.mid
         WHERE m.depth < 10
      )
      SELECT array_agg(DISTINCT mid ORDER BY mid) INTO member_ids FROM members;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fhir_resolve_patients(text[], text[]) IS
  'FHIR gateway: resolve patient fhir_ids or internal ids (as the caller, under row-level '
  'security) to the kept record of a merge chain and its member records. chain_ok is false '
  'for a chain longer than 10 hops or a loop, a hop the caller cannot see, or an orphaned '
  'tombstone (merged_at without merged_into). Unknown or invisible inputs return no row.';

-- ----------------------------------------------------------------------------
-- 6. fhir_staff_directory (Practitioner / PractitionerRole)
-- ----------------------------------------------------------------------------
-- Staff callers only. Rows: app_users whose role is one of the 8 staff
-- roles (guest, legacy and unknown roles never). Selectors (at most one):
-- p_fhir_ids, p_source_ids (the only mode that returns source_id, which is
-- the account id), p_name (case-insensitive prefix of any word of
-- full_name, 2..64 characters, % and _ are literal), p_role; none = all.
-- A row without a published id gets one (interop.resource_links,
-- Practitioner, a random uuid) before the page is read, so ids are stable.
-- Ordered by fhir_id (C collation), keyset p_after, p_limit 1..101.
-- Returns name, role, active and row times only: never email, phone,
-- credentials or other columns.
-- active: an off-flag (is_active/active false, disabled/deactivated true,
-- deactivated_at/disabled_at set) -> false; is_active/active true -> true;
-- otherwise NULL (unknown stays unknown).
CREATE OR REPLACE FUNCTION public.fhir_staff_directory(
  p_fhir_ids    text[] DEFAULT NULL,
  p_source_ids  text[] DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_role        text DEFAULT NULL,
  p_after       text DEFAULT NULL,
  p_limit       integer DEFAULT 20
)
RETURNS TABLE (
  fhir_id     text,
  source_id   text,
  full_name   text,
  role        text,
  active      boolean,
  created_at  timestamptz,
  updated_at  timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_roles  constant text[] := ARRAY['admin', 'doctor', 'nurse', 'pharmacist', 'volunteer',
                                    'auditor', 'lead_clinician', 'registration_lead'];
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 101);
  v_name   text;
  v_pat    text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT COALESCE(public.app_is_staff(), false) THEN
    RAISE EXCEPTION 'staff only' USING ERRCODE = '42501';
  END IF;
  IF (p_fhir_ids IS NOT NULL)::int + (p_source_ids IS NOT NULL)::int
     + (p_name IS NOT NULL)::int + (p_role IS NOT NULL)::int > 1
     OR NOT interop.ids_ok(p_fhir_ids, '^[A-Za-z0-9.-]{1,64}$', 200)
     OR NOT interop.ids_ok(p_source_ids, '^[A-Za-z0-9._-]{1,128}$', 200)
     OR (p_after IS NOT NULL AND p_after !~ '^[A-Za-z0-9.-]{1,64}$')
     OR (p_role IS NOT NULL AND p_role !~ '^[a-z_]{1,40}$') THEN
    RAISE EXCEPTION 'invalid staff directory query' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NOT NULL THEN
    v_name := lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'));
    IF length(v_name) < 2 OR length(v_name) > 64 THEN
      RAISE EXCEPTION 'name must be 2 to 64 characters' USING ERRCODE = '22023';
    END IF;
    v_pat := replace(replace(replace(v_name, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  IF to_regclass('public.app_users') IS NULL THEN
    RETURN;
  END IF;

  -- Mint missing ids for every row the query can return (app_users is a
  -- small table). ON CONFLICT: a concurrent call minted it first.
  IF p_fhir_ids IS NULL THEN
    INSERT INTO interop.resource_links (fhir_resource_type, fhir_id, source_schema, source_table, source_id)
    SELECT 'Practitioner', gen_random_uuid()::text, 'public', 'app_users', u.id::text
      FROM public.app_users AS u
     WHERE u.role::text = ANY (v_roles)
       AND (p_role IS NULL OR u.role::text = p_role)
       AND (p_source_ids IS NULL OR u.id::text = ANY (p_source_ids))
       AND (v_pat IS NULL
            OR lower(regexp_replace(u.full_name, '\s+', ' ', 'g')) LIKE v_pat ESCAPE '\'
            OR lower(regexp_replace(u.full_name, '\s+', ' ', 'g')) LIKE '% ' || v_pat ESCAPE '\')
       AND NOT EXISTS (
             SELECT 1 FROM interop.resource_links AS l
              WHERE l.fhir_resource_type = 'Practitioner' AND l.source_schema = 'public'
                AND l.source_table = 'app_users' AND l.source_id = u.id::text)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT l.fhir_id,
           CASE WHEN p_source_ids IS NOT NULL THEN u.id::text END,
           u.full_name::text,
           u.role::text,
           CASE
             WHEN COALESCE(to_jsonb(u) ->> 'is_active', '') IN ('false', '0')
               OR COALESCE(to_jsonb(u) ->> 'active', '') = 'false'
               OR COALESCE(to_jsonb(u) ->> 'disabled', '') = 'true'
               OR COALESCE(to_jsonb(u) ->> 'deactivated', '') = 'true'
               OR (to_jsonb(u) ->> 'deactivated_at') IS NOT NULL
               OR (to_jsonb(u) ->> 'disabled_at') IS NOT NULL THEN false
             WHEN COALESCE(to_jsonb(u) ->> 'is_active', '') IN ('true', '1')
               OR COALESCE(to_jsonb(u) ->> 'active', '') = 'true' THEN true
             ELSE NULL
           END,
           (to_jsonb(u) ->> 'created_at')::timestamptz,
           (to_jsonb(u) ->> 'updated_at')::timestamptz
      FROM public.app_users AS u
      JOIN interop.resource_links AS l
        ON l.fhir_resource_type = 'Practitioner' AND l.source_schema = 'public'
       AND l.source_table = 'app_users' AND l.source_id = u.id::text
     WHERE u.role::text = ANY (v_roles)
       AND (p_role IS NULL OR u.role::text = p_role)
       AND (p_fhir_ids IS NULL OR l.fhir_id = ANY (p_fhir_ids))
       AND (p_source_ids IS NULL OR u.id::text = ANY (p_source_ids))
       AND (v_pat IS NULL
            OR lower(regexp_replace(u.full_name, '\s+', ' ', 'g')) LIKE v_pat ESCAPE '\'
            OR lower(regexp_replace(u.full_name, '\s+', ' ', 'g')) LIKE '% ' || v_pat ESCAPE '\')
       AND (p_after IS NULL OR l.fhir_id COLLATE "C" > p_after COLLATE "C")
     ORDER BY l.fhir_id COLLATE "C"
     LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.fhir_staff_directory(text[], text[], text, text, text, integer) IS
  'FHIR gateway: staff directory for Practitioner/PractitionerRole (staff callers only). '
  'Name, role, active and row times of the 8 staff roles, with a stable published id minted '
  'in interop.resource_links. source_id (the account id) only when searching by p_source_ids. '
  'Never email, phone or credentials. VOLATILE (mints ids): call with POST.';

-- ----------------------------------------------------------------------------
-- 7. fhir_link_ids / fhir_link_sources (Medication <-> pharmacy_items)
-- ----------------------------------------------------------------------------
-- Staff holding consult, dispense or inventory only (the rule of
-- pharmacy_items_select, and the gateway's Medication read permissions):
-- other staff cannot read the catalogue, so they may not test its ids,
-- mint published ids for it or map published ids back to it. At most 200
-- ids. The allowlist has one entry: 'Medication' <-> public.pharmacy_items.
-- fhir_link_ids mints a link (a random uuid) only for source ids that exist
-- in the source table; fhir_link_sources only reads, and only returns links
-- whose source row still exists. (Practitioner ids are minted by
-- fhir_staff_directory, not here.)
CREATE OR REPLACE FUNCTION public.fhir_link_ids(p_resource_type text, p_source_ids text[])
RETURNS TABLE (source_id text, fhir_id text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT COALESCE(public.app_is_staff(), false)
     OR NOT interop.caller_has_any(ARRAY['consult', 'dispense', 'inventory']) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_resource_type IS DISTINCT FROM 'Medication'
     OR NOT interop.ids_ok(p_source_ids, '^[A-Za-z0-9._:-]{1,128}$', 200) THEN
    RAISE EXCEPTION 'invalid link query' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.pharmacy_items') IS NULL OR COALESCE(cardinality(p_source_ids), 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO interop.resource_links (fhir_resource_type, fhir_id, source_schema, source_table, source_id)
  SELECT 'Medication', gen_random_uuid()::text, 'public', 'pharmacy_items', i.id::text
    FROM public.pharmacy_items AS i
   WHERE i.id::text = ANY (p_source_ids)
     AND NOT EXISTS (
           SELECT 1 FROM interop.resource_links AS l
            WHERE l.fhir_resource_type = 'Medication' AND l.source_schema = 'public'
              AND l.source_table = 'pharmacy_items' AND l.source_id = i.id::text)
  ON CONFLICT DO NOTHING;

  RETURN QUERY
    SELECT l.source_id, l.fhir_id
      FROM interop.resource_links AS l
      JOIN public.pharmacy_items AS i ON i.id::text = l.source_id
     WHERE l.fhir_resource_type = 'Medication' AND l.source_schema = 'public'
       AND l.source_table = 'pharmacy_items'
       AND l.source_id = ANY (p_source_ids)
     ORDER BY l.source_id;
END;
$$;

COMMENT ON FUNCTION public.fhir_link_ids(text, text[]) IS
  'FHIR gateway: published ids for mBHR rows (allowlist: Medication <-> pharmacy_items), '
  'minting a random id for existing rows that have none. Staff holding consult, dispense or '
  'inventory only (as pharmacy_items row security), at most 200 ids.';

CREATE OR REPLACE FUNCTION public.fhir_link_sources(p_resource_type text, p_fhir_ids text[])
RETURNS TABLE (fhir_id text, source_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT COALESCE(public.app_is_staff(), false)
     OR NOT interop.caller_has_any(ARRAY['consult', 'dispense', 'inventory']) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_resource_type IS DISTINCT FROM 'Medication'
     OR NOT interop.ids_ok(p_fhir_ids, '^[A-Za-z0-9.-]{1,64}$', 200) THEN
    RAISE EXCEPTION 'invalid link query' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.pharmacy_items') IS NULL OR COALESCE(cardinality(p_fhir_ids), 0) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT l.fhir_id, l.source_id
      FROM interop.resource_links AS l
      JOIN public.pharmacy_items AS i ON i.id::text = l.source_id
     WHERE l.fhir_resource_type = 'Medication' AND l.source_schema = 'public'
       AND l.source_table = 'pharmacy_items'
       AND l.fhir_id = ANY (p_fhir_ids)
     ORDER BY l.fhir_id;
END;
$$;

COMMENT ON FUNCTION public.fhir_link_sources(text, text[]) IS
  'FHIR gateway: the mBHR row behind published ids (allowlist: Medication <-> pharmacy_items). '
  'Read only; staff holding consult, dispense or inventory only (as pharmacy_items row '
  'security), at most 200 ids; a link whose row is gone returns nothing.';

-- ----------------------------------------------------------------------------
-- 8a. Consent change history (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interop.consent_record_history (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id       uuid        NOT NULL REFERENCES interop.consent_records (id) ON DELETE RESTRICT,
  event            text        NOT NULL,
  status_before    text,
  status_after     text        NOT NULL,
  changed_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by       uuid,
  changed_by_kind  text        NOT NULL,
  CONSTRAINT consent_record_history_event CHECK (event IN ('created', 'modified', 'withdrawn', 'verified')),
  CONSTRAINT consent_record_history_kind CHECK (changed_by_kind IN ('staff', 'patient', 'system'))
);

COMMENT ON TABLE interop.consent_record_history IS
  'Append-only history of consent record changes (written only by a trigger).';

CREATE INDEX IF NOT EXISTS consent_record_history_consent_idx
  ON interop.consent_record_history (consent_id, changed_at);

DROP TRIGGER IF EXISTS consent_record_history_append_only ON interop.consent_record_history;
CREATE TRIGGER consent_record_history_append_only
  BEFORE UPDATE OR DELETE ON interop.consent_record_history
  FOR EACH ROW EXECUTE FUNCTION interop.refuse_change('consent history is append-only');
DROP TRIGGER IF EXISTS consent_record_history_no_truncate ON interop.consent_record_history;
CREATE TRIGGER consent_record_history_no_truncate
  BEFORE TRUNCATE ON interop.consent_record_history
  FOR EACH STATEMENT EXECUTE FUNCTION interop.refuse_change('consent history is append-only');

ALTER TABLE interop.consent_record_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON interop.consent_record_history FROM PUBLIC, anon, authenticated, service_role;
-- Support tooling may read it; only the trigger below writes it.
GRANT SELECT ON interop.consent_record_history TO service_role;

-- ----------------------------------------------------------------------------
-- 8b. Consent record guards
-- ----------------------------------------------------------------------------
-- Who, whose and what a record is about never changes (a change is a new
-- record), and a withdrawal is final: it cannot be undone or rewritten.
-- The statuses that are not in force are final too: rejected may still
-- become inactive (a withdrawal) or entered-in-error, inactive only
-- entered-in-error, and entered-in-error nothing. Applies to every role,
-- the owner included.
CREATE OR REPLACE FUNCTION interop.consent_records_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'interop.consent_records: patient_id, scope, category, recorded_at, recorded_by and created_at cannot change (record a new consent)'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL AND (
       NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
    OR NEW.withdrawn_by IS DISTINCT FROM OLD.withdrawn_by
    OR NEW.withdrawal_reason IS DISTINCT FROM OLD.withdrawal_reason
    OR NEW.status NOT IN ('inactive', 'entered-in-error')) THEN
    RAISE EXCEPTION 'interop.consent_records: a withdrawn consent cannot be re-activated or rewritten'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (
       OLD.status = 'entered-in-error'
    OR (OLD.status = 'inactive' AND NEW.status <> 'entered-in-error')
    OR (OLD.status = 'rejected' AND NEW.status NOT IN ('inactive', 'entered-in-error'))) THEN
    RAISE EXCEPTION 'interop.consent_records: a rejected, inactive or entered-in-error consent cannot be brought back into force (record a new consent)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interop.consent_records_guard() IS
  'Trigger: consent identity columns never change, a withdrawal is final, and a rejected, '
  'inactive or entered-in-error consent never comes back into force.';

DROP TRIGGER IF EXISTS consent_records_guard ON interop.consent_records;
CREATE TRIGGER consent_records_guard
  BEFORE UPDATE ON interop.consent_records
  FOR EACH ROW EXECUTE FUNCTION interop.consent_records_guard();

-- Provisions never change: a changed rule is a new consent record.
DROP TRIGGER IF EXISTS consent_provisions_no_update ON interop.consent_provisions;
CREATE TRIGGER consent_provisions_no_update
  BEFORE UPDATE ON interop.consent_provisions
  FOR EACH ROW EXECUTE FUNCTION interop.refuse_change('record a new consent instead');

-- Nor can provisions be added to an existing consent: only in the
-- transaction that created the record (its created_at is that
-- transaction's now(), and created_at cannot change), and never to a
-- verified or withdrawn record. So what a verified consent says, and the
-- 'created' history row, always describe all of its provisions.
CREATE OR REPLACE FUNCTION interop.consent_provisions_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rec interop.consent_records%ROWTYPE;
BEGIN
  SELECT * INTO v_rec FROM interop.consent_records WHERE id = NEW.consent_id;
  IF NOT FOUND THEN
    RETURN NEW;                        -- the foreign key refuses it
  END IF;
  IF v_rec.created_at IS DISTINCT FROM now() OR v_rec.verified OR v_rec.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'interop.consent_provisions: provisions are added only with a new consent record (record a new consent)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION interop.consent_provisions_guard_insert() IS
  'Trigger: provisions are inserted only in the transaction that created their consent record, '
  'and never into a verified or withdrawn one.';

DROP TRIGGER IF EXISTS consent_provisions_insert_guard ON interop.consent_provisions;
CREATE TRIGGER consent_provisions_insert_guard
  BEFORE INSERT ON interop.consent_provisions
  FOR EACH ROW EXECUTE FUNCTION interop.consent_provisions_guard_insert();

-- ----------------------------------------------------------------------------
-- 8c. Consent change log: one history row and one audit row per change
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so the rows are written whoever changes the record (the
-- service role has no INSERT on the history). The audit row carries the
-- event name only: no consent content, no reason text.
CREATE OR REPLACE FUNCTION interop.consent_records_log_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_kind   text;
  v_event  text;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NULL;                       -- nothing changed
  END IF;

  v_event := CASE
    WHEN TG_OP = 'INSERT' THEN 'created'
    WHEN OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL THEN 'withdrawn'
    WHEN NOT OLD.verified AND NEW.verified THEN 'verified'
    ELSE 'modified'
  END;
  v_kind := interop.caller_kind();

  INSERT INTO interop.consent_record_history (
    consent_id, event, status_before, status_after, changed_by, changed_by_kind)
  VALUES (
    NEW.id, v_event, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
    v_uid, CASE WHEN v_kind IN ('staff', 'patient') THEN v_kind ELSE 'system' END);

  INSERT INTO interop.access_audit (
    request_id, actor_user_id, actor_role, actor_kind, patient_id, patient_ids,
    action, resource_type, resource_id, decision, result_count, source, metadata)
  VALUES (
    gen_random_uuid(), v_uid, public.app_current_role(), v_kind,
    NEW.patient_id, ARRAY[NEW.patient_id],
    'consent_change', 'Consent', NEW.id::text, 'permit', 1, 'interop_consent',
    jsonb_build_object('event', v_event));
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION interop.consent_records_log_change() IS
  'Trigger: one consent_record_history row and one access_audit row (event name only) per '
  'consent record change.';

DROP TRIGGER IF EXISTS consent_records_history ON interop.consent_records;
CREATE TRIGGER consent_records_history
  AFTER INSERT OR UPDATE ON interop.consent_records
  FOR EACH ROW EXECUTE FUNCTION interop.consent_records_log_change();

-- ----------------------------------------------------------------------------
-- 8d. Consent directives as JSON (shared shape; no internal fields)
-- ----------------------------------------------------------------------------
-- Never includes recorded_by, verified_by, withdrawn_by (account ids),
-- withdrawal_reason, granted_by, granted_by_relationship,
-- source_document_id or provision actor_reference. A provision's
-- names_recipient says only whether it names one specific recipient
-- (actor_reference set and not blank), never who: the gateway withholds
-- such a consent rather than publish the rule for every recipient of
-- that kind.
CREATE OR REPLACE FUNCTION interop.consent_directives_json(p_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'patient_id', r.patient_id,
           'status', r.status,
           'scope', r.scope,
           'category', r.category,
           'policy_uri', r.policy_uri,
           'source_type', r.source_type,
           'verified', r.verified,
           'verified_at', r.verified_at,
           'effective_from', r.effective_from,
           'effective_until', r.effective_until,
           'recorded_at', r.recorded_at,
           'withdrawn', r.withdrawn_at IS NOT NULL,
           'withdrawn_at', r.withdrawn_at,
           'created_at', r.created_at,
           'updated_at', r.updated_at,
           'provisions', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', p.id,
                      'provision_type', p.provision_type,
                      'actor_type', p.actor_type,
                      'names_recipient', p.actor_reference IS NOT NULL
                                         AND btrim(p.actor_reference) <> '',
                      'action', p.action,
                      'purpose', p.purpose,
                      'data_class', p.data_class,
                      'resource_type', p.resource_type,
                      'security_label', p.security_label,
                      'effective_from', p.effective_from,
                      'effective_until', p.effective_until,
                      'created_at', p.created_at)
                    ORDER BY p.created_at, p.id)
               FROM interop.consent_provisions AS p
              WHERE p.consent_id = r.id), '[]'::jsonb))
         ORDER BY r.id), '[]'::jsonb)
    FROM interop.consent_records AS r
   WHERE r.id = ANY (p_ids);
$$;

COMMENT ON FUNCTION interop.consent_directives_json(uuid[]) IS
  'Internal: consent records and provisions as a JSON array ordered by id, without account '
  'ids, withdrawal reasons, granted_by, source documents or actor references (names_recipient '
  'says only whether a provision names one).';

-- ----------------------------------------------------------------------------
-- 8e. fhir_consent_directives (FHIR Consent source)
-- ----------------------------------------------------------------------------
-- Staff holding consult, portal_manage or audit_access (the Consent read
-- permissions): any patient. A portal patient (or a staff account without
-- those permissions that is also a portal patient): their own records,
-- including records merged into them (interop.patient_members: a consent
-- recorded before a merge keeps the old patient id); p_patient_ids must all
-- be among those, and with p_consent_ids only those records come back.
-- Anyone else: 42501. One of p_patient_ids / p_consent_ids is required.
-- patient_id matches exactly (the caller names the merged ids it wants).
-- Ordered by id, keyset p_after, p_limit 1..101.
CREATE OR REPLACE FUNCTION public.fhir_consent_directives(
  p_patient_ids  text[] DEFAULT NULL,
  p_consent_ids  uuid[] DEFAULT NULL,
  p_after        uuid DEFAULT NULL,
  p_limit        integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reader boolean;
  v_own    text[];
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 101);
  v_ids    uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  v_reader := COALESCE(public.app_is_staff(), false)
          AND interop.caller_has_any(ARRAY['consult', 'portal_manage', 'audit_access']);
  IF NOT v_reader THEN
    v_own := interop.patient_members(ARRAY(SELECT public.app_portal_patient_ids()));
    IF cardinality(v_own) = 0 THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF (p_patient_ids IS NULL AND p_consent_ids IS NULL)
     OR NOT interop.ids_ok(p_patient_ids, '^[A-Za-z0-9._-]{1,128}$', 100)
     OR COALESCE(cardinality(p_consent_ids), 0) > 200 THEN
    RAISE EXCEPTION 'a patient or consent id selector is required (bounded)' USING ERRCODE = '22023';
  END IF;
  IF NOT v_reader AND p_patient_ids IS NOT NULL AND NOT (p_patient_ids <@ v_own) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_ids := ARRAY(
    SELECT r.id
      FROM interop.consent_records AS r
     WHERE (p_patient_ids IS NULL OR r.patient_id = ANY (p_patient_ids))
       AND (p_consent_ids IS NULL OR r.id = ANY (p_consent_ids))
       AND (v_reader OR r.patient_id = ANY (v_own))
       AND (p_after IS NULL OR r.id > p_after)
     ORDER BY r.id
     LIMIT v_limit);
  RETURN interop.consent_directives_json(v_ids);
END;
$$;

COMMENT ON FUNCTION public.fhir_consent_directives(text[], uuid[], uuid, integer) IS
  'FHIR gateway: consent directives with their provisions as a JSON array ordered by id. '
  'Staff holding consult, portal_manage or audit_access see any patient; a portal patient sees '
  'only their own records (including records merged into theirs). Never returns account ids, '
  'withdrawal reasons, granted_by, source documents or provision actor references.';

-- ----------------------------------------------------------------------------
-- 8f. Consent management for the app (not called by the gateway)
-- ----------------------------------------------------------------------------
-- Staff holding portal_manage or consult record a consent. Status draft,
-- proposed or active; the patient must exist and not be merged away (record
-- consent on the kept record). p_provisions: a JSON array (at most 20) of
-- objects with only these keys: provision_type, actor_type, action,
-- purpose, data_class, resource_type, security_label, effective_from,
-- effective_until. The tables' CHECKs validate the codes (23514).
CREATE OR REPLACE FUNCTION public.interop_record_consent(
  p_patient_id       text,
  p_scope            text,
  p_category         text,
  p_source_type      text,
  p_status           text DEFAULT 'active',
  p_policy_uri       text DEFAULT NULL,
  p_effective_from   timestamptz DEFAULT NULL,
  p_effective_until  timestamptz DEFAULT NULL,
  p_provisions       jsonb DEFAULT '[]'
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_prov  jsonb := COALESCE(p_provisions, '[]'::jsonb);
  v_pat   jsonb;
  v_e     jsonb;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.app_is_staff(), false)
     OR NOT interop.caller_has_any(ARRAY['portal_manage', 'consult']) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(
        p_patient_id !~ '^[A-Za-z0-9._-]{1,128}$'
     OR p_scope IS NULL OR p_source_type IS NULL
     OR p_category !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
     OR p_status NOT IN ('draft', 'proposed', 'active')
     OR (p_policy_uri IS NOT NULL AND (length(p_policy_uri) > 500
                                       OR p_policy_uri !~ '^[a-z][a-z0-9+.-]*:[^[:space:]]+$'))
     OR jsonb_typeof(v_prov) <> 'array'
     OR jsonb_array_length(v_prov) > 20, true) THEN
    RAISE EXCEPTION 'invalid consent' USING ERRCODE = '22023';
  END IF;
  FOR v_e IN SELECT e FROM jsonb_array_elements(v_prov) AS e LOOP
    IF jsonb_typeof(v_e) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_e) AS k
                   WHERE k NOT IN ('provision_type', 'actor_type', 'action', 'purpose',
                                   'data_class', 'resource_type', 'security_label',
                                   'effective_from', 'effective_until'))
       OR length(COALESCE(v_e ->> 'data_class', '')) > 64
       OR length(COALESCE(v_e ->> 'security_label', '')) > 64 THEN
      RAISE EXCEPTION 'invalid consent provision' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'unknown patient' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(p) INTO v_pat FROM public.patients AS p WHERE p.id::text = p_patient_id;
  IF v_pat IS NULL THEN
    RAISE EXCEPTION 'unknown patient' USING ERRCODE = '22023';
  END IF;
  IF (v_pat ->> 'merged_into') IS NOT NULL OR (v_pat ->> 'merged_at') IS NOT NULL THEN
    RAISE EXCEPTION 'this record was merged: record the consent on the kept record' USING ERRCODE = '22023';
  END IF;

  INSERT INTO interop.consent_records (
    patient_id, status, scope, category, policy_uri, source_type, recorded_by,
    effective_from, effective_until)
  VALUES (
    p_patient_id, p_status, p_scope, p_category, p_policy_uri, p_source_type, v_uid,
    p_effective_from, p_effective_until)
  RETURNING id INTO v_id;

  INSERT INTO interop.consent_provisions (
    consent_id, provision_type, actor_type, action, purpose, data_class,
    resource_type, security_label, effective_from, effective_until)
  SELECT v_id, e ->> 'provision_type', e ->> 'actor_type', e ->> 'action', e ->> 'purpose',
         e ->> 'data_class', e ->> 'resource_type', e ->> 'security_label',
         (e ->> 'effective_from')::timestamptz, (e ->> 'effective_until')::timestamptz
    FROM jsonb_array_elements(v_prov) AS e;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.interop_record_consent(text, text, text, text, text, text, timestamptz, timestamptz, jsonb) IS
  'Consent management: record a consent directive and its provisions for a patient (staff '
  'holding portal_manage or consult). The change is written to the consent history and the '
  'access audit.';

-- Mark a consent verified (staff holding portal_manage or consult). true =
-- verified now; false = it already was. Only a draft, proposed or active
-- consent that is not withdrawn can be verified (22023 otherwise).
CREATE OR REPLACE FUNCTION public.interop_verify_consent(p_consent_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_rec  interop.consent_records%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.app_is_staff(), false)
     OR NOT interop.caller_has_any(ARRAY['portal_manage', 'consult']) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rec FROM interop.consent_records WHERE id = p_consent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown consent' USING ERRCODE = '22023';
  END IF;
  IF v_rec.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawn consent cannot be verified' USING ERRCODE = '22023';
  END IF;
  IF v_rec.status NOT IN ('draft', 'proposed', 'active') THEN
    RAISE EXCEPTION 'only a draft, proposed or active consent can be verified' USING ERRCODE = '22023';
  END IF;
  IF v_rec.verified THEN
    RETURN false;
  END IF;
  UPDATE interop.consent_records
     SET verified = true, verified_by = v_uid, verified_at = now()
   WHERE id = p_consent_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.interop_verify_consent(uuid) IS
  'Consent management: mark a consent verified (staff holding portal_manage or consult). '
  'Returns false when it already was.';

-- Withdraw a consent: staff holding portal_manage or consult, or the portal
-- patient whose record it is. Sets status inactive (entered-in-error is
-- kept), withdrawn_at, withdrawn_by and the reason (at most 500
-- characters). A repeat returns false. A patient owns the consents of their
-- portal records and of every record merged into them. For a patient, a
-- consent that is not theirs is refused exactly like one that does not
-- exist. A patient may withdraw only a permission to share (scope
-- patient-privacy or research, no deny provision): withdrawing a refusal
-- could allow sharing, and a treatment consent or an advance directive is
-- not a sharing choice. Those are changed with clinic staff (42501 for the
-- patient, whatever their status); staff are not limited.
-- p_patient_id (optional) is the page's patient. When given, the consent
-- must be that record's or of a record merged into it (42501 otherwise,
-- staff included), and a patient must name one of their own portal
-- records (public.app_portal_patient_ids(), 42501 otherwise): one sign-in
-- can be linked to several people (a shared phone), and the portal page
-- withdraws only for the person it shows. A malformed id is refused
-- (22023). An earlier draft of this file had no p_patient_id: that version
-- is dropped first, so it cannot stay callable beside this one.
DROP FUNCTION IF EXISTS public.interop_withdraw_consent(uuid, text);
CREATE OR REPLACE FUNCTION public.interop_withdraw_consent(
  p_consent_id  uuid,
  p_reason      text DEFAULT NULL,
  p_patient_id  text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_staff  boolean;
  v_own    text[];
  v_rec    interop.consent_records%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF length(COALESCE(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'the reason is limited to 500 characters' USING ERRCODE = '22023';
  END IF;
  IF p_patient_id IS NOT NULL AND p_patient_id !~ '^[A-Za-z0-9._-]{1,128}$' THEN
    RAISE EXCEPTION 'invalid patient id' USING ERRCODE = '22023';
  END IF;
  v_staff := COALESCE(public.app_is_staff(), false)
         AND interop.caller_has_any(ARRAY['portal_manage', 'consult']);
  IF NOT v_staff AND p_patient_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.app_portal_patient_ids() AS x WHERE x = p_patient_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  -- The records the consent must belong to: the named page patient's
  -- family; else, for a patient, every portal record of the sign-in; else
  -- (staff, no patient named) NULL = not limited.
  v_own := CASE
             WHEN p_patient_id IS NOT NULL THEN interop.patient_members(ARRAY[p_patient_id])
             WHEN NOT v_staff THEN interop.patient_members(ARRAY(SELECT public.app_portal_patient_ids()))
           END;

  SELECT * INTO v_rec FROM interop.consent_records WHERE id = p_consent_id FOR UPDATE;
  IF NOT v_staff AND (NOT FOUND OR NOT (v_rec.patient_id = ANY (v_own))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'unknown consent' USING ERRCODE = '22023';
  END IF;
  IF v_own IS NOT NULL AND NOT (v_rec.patient_id = ANY (v_own)) THEN
    RAISE EXCEPTION 'not allowed: this consent is not the named patient''s' USING ERRCODE = '42501';
  END IF;
  IF NOT v_staff
     AND (v_rec.scope NOT IN ('patient-privacy', 'research')
          OR EXISTS (SELECT 1 FROM interop.consent_provisions AS p
                      WHERE p.consent_id = v_rec.id AND p.provision_type = 'deny')) THEN
    RAISE EXCEPTION 'not allowed: this record is changed with clinic staff' USING ERRCODE = '42501';
  END IF;
  IF v_rec.withdrawn_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE interop.consent_records
     SET status = CASE WHEN status = 'entered-in-error' THEN status ELSE 'inactive' END,
         withdrawn_at = now(),
         withdrawn_by = v_uid,
         withdrawal_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_consent_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.interop_withdraw_consent(uuid, text, text) IS
  'Consent management: withdraw a consent (staff holding portal_manage or consult, or the '
  'portal patient whose record it is; a patient only a permission to share: scope '
  'patient-privacy or research, no deny provision). p_patient_id (optional, the page''s '
  'patient): the consent must be that record''s or of a record merged into it, and a '
  'patient must name one of their own portal records. Final: a withdrawn consent cannot be '
  're-activated.';

-- One portal patient's consent directives (same shape as
-- fhir_consent_directives): p_patient_id must be one of the caller's portal
-- records (public.app_portal_patient_ids(), 42501 otherwise), and the result
-- covers that record and the records merged into it, not every record
-- linked to the sign-in (a shared phone can link several people; the page
-- shows one of them). NULL or a malformed id is refused (22023). An earlier
-- draft of this file had no argument: that version is dropped first, so it
-- cannot stay callable beside this one.
DROP FUNCTION IF EXISTS public.interop_my_consents();
CREATE OR REPLACE FUNCTION public.interop_my_consents(p_patient_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_own  text[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR p_patient_id !~ '^[A-Za-z0-9._-]{1,128}$' THEN
    RAISE EXCEPTION 'a patient id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_portal_patient_ids() AS x WHERE x = p_patient_id) THEN
    RAISE EXCEPTION 'portal patients only, and only their own record' USING ERRCODE = '42501';
  END IF;
  v_own := interop.patient_members(ARRAY[p_patient_id]);
  RETURN interop.consent_directives_json(ARRAY(
    SELECT r.id FROM interop.consent_records AS r
     WHERE r.patient_id = ANY (v_own)
     ORDER BY r.id
     LIMIT 500));
END;
$$;

COMMENT ON FUNCTION public.interop_my_consents(text) IS
  'Consent management: the consent directives (at most 500) of one of the calling portal '
  'patient''s own records and of the records merged into it; same shape as '
  'fhir_consent_directives. Another record, NULL or no portal record: refused.';

-- Summary of external sharing for one patient, over the whole merge family
-- of the record (a consent recorded before a merge still counts). Callers:
-- staff holding consult, portal_manage or audit_access (the roles the
-- patient page shows the chip to), or the portal patient whose record it
-- is. The rule follows the gateway's consent evaluator (evaluateConsent.ts,
-- access class external-sharing) for a request the summary cannot see in
-- full:
--   a record counts when its scope is patient-privacy, it is active, not
--   withdrawn and in its effective period; a provision counts when it is in
--   its own period, carries no security label (mBHR labels no data, so a
--   labelled provision covers nothing) and its actor_type is
--   external_system, organization, any or NULL. Purpose, action, resource
--   type and data class are not weighed (they depend on the request).
--   'not_allowed' when any counted deny provision exists (a patient's
--     refusal counts before it is verified, and it wins over permits);
--   'allowed' when a counted permit provision is on a verified record and
--     names no specific recipient (the evaluator ignores unverified
--     permits, and permits for one named recipient: it cannot tell whether
--     a requester is that recipient);
--   'withdrawn' when neither, and a withdrawn permission exists (below);
--   'not_allowed' otherwise.
-- pending_verification: a counted permit exists only on unverified records.
-- sharing_state / sharing_reason: the staff chip's stricter reading, over
-- patient-privacy records that are draft, proposed or active, not withdrawn
-- and not ended, and their provisions for an external actor
-- (external_system, organization, any or unset) that have not ended. A
-- provision is "in force" when its record is active and started and the
-- provision has started. "Limited": it names a purpose, action, resource
-- type, data class, security label or one specific recipient. First match
-- wins:
--   'restricted' / 'refused'          a deny in force with no limit;
--   'restricted' / 'refused_partly'   a deny in force with a limit (a
--                                     verified full permit beside it is
--                                     therefore not 'allowed');
--   'allowed' / 'permitted'           a permit in force on a verified
--                                     record, with no limit;
--   'restricted' / 'limited'          only such permits with a limit;
--   'restricted' / 'pending_verification'   a permit in force, unverified;
--   'withdrawn' / 'withdrawn'         a withdrawn permission: a withdrawn
--                                     patient-privacy record that had a
--                                     permit for an external actor and no
--                                     deny (a withdrawn refusal, an empty
--                                     record or a care team permit is not);
--   'restricted' / 'not_started'      a permit not in force yet (draft,
--                                     proposed, or a start in the future);
--   'restricted' / 'no_permission'    otherwise.
-- A deny counts only where the evaluator would apply it (in force, as
-- above): a deny on a draft or proposed record, or one that has not
-- started, is not counted, although the patient may already have said it.
-- active_records / withdrawn_records count every scope; last_changed_at is
-- the latest updated_at of the family's records.
CREATE OR REPLACE FUNCTION public.interop_consent_summary(p_patient_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_family     text[];
  v_deny       boolean;
  v_permit     boolean;
  v_unverified boolean;
  v_wd_permit  boolean;
  v_refused    boolean;
  v_partly     boolean;
  v_full       boolean;
  v_limited    boolean;
  v_pending    boolean;
  v_future     boolean;
  v_active     integer;
  v_withdrawn  integer;
  v_last       timestamptz;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR p_patient_id !~ '^[A-Za-z0-9._-]{1,128}$' THEN
    RAISE EXCEPTION 'invalid patient id' USING ERRCODE = '22023';
  END IF;
  IF NOT (COALESCE(public.app_is_staff(), false)
          AND interop.caller_has_any(ARRAY['consult', 'portal_manage', 'audit_access']))
     AND NOT (p_patient_id = ANY (
                interop.patient_members(ARRAY(SELECT public.app_portal_patient_ids())))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  v_family := interop.patient_family(p_patient_id);

  WITH counted AS (
    SELECT r.verified, p.provision_type
      FROM interop.consent_records AS r
      JOIN interop.consent_provisions AS p ON p.consent_id = r.id
     WHERE r.patient_id = ANY (v_family)
       AND r.scope = 'patient-privacy'
       AND r.status = 'active'
       AND r.withdrawn_at IS NULL
       AND (r.effective_from IS NULL OR r.effective_from <= now())
       AND (r.effective_until IS NULL OR r.effective_until > now())
       AND (p.actor_type IS NULL OR p.actor_type IN ('external_system', 'organization', 'any'))
       AND p.security_label IS NULL
       AND NOT (p.provision_type = 'permit' AND COALESCE(btrim(p.actor_reference), '') <> '')
       AND (p.effective_from IS NULL OR p.effective_from <= now())
       AND (p.effective_until IS NULL OR p.effective_until > now()))
  SELECT COALESCE(bool_or(c.provision_type = 'deny'), false),
         COALESCE(bool_or(c.provision_type = 'permit' AND c.verified), false),
         COALESCE(bool_or(c.provision_type = 'permit' AND NOT c.verified), false)
    INTO v_deny, v_permit, v_unverified
    FROM counted AS c;

  WITH chip_rows AS (
    SELECT r.verified, p.provision_type,
           (r.status = 'active'
            AND (r.effective_from IS NULL OR r.effective_from <= now())
            AND (p.effective_from IS NULL OR p.effective_from <= now())) AS in_force,
           (p.purpose IS NOT NULL OR p.action IS NOT NULL OR p.resource_type IS NOT NULL
            OR p.data_class IS NOT NULL OR p.security_label IS NOT NULL
            OR COALESCE(btrim(p.actor_reference), '') <> '') AS limited
      FROM interop.consent_records AS r
      JOIN interop.consent_provisions AS p ON p.consent_id = r.id
     WHERE r.patient_id = ANY (v_family)
       AND r.scope = 'patient-privacy'
       AND r.status IN ('draft', 'proposed', 'active')
       AND r.withdrawn_at IS NULL
       AND (r.effective_until IS NULL OR r.effective_until > now())
       AND (p.actor_type IS NULL OR p.actor_type IN ('external_system', 'organization', 'any'))
       AND (p.effective_until IS NULL OR p.effective_until > now()))
  SELECT COALESCE(bool_or(s.provision_type = 'deny' AND s.in_force AND NOT s.limited), false),
         COALESCE(bool_or(s.provision_type = 'deny' AND s.in_force AND s.limited), false),
         COALESCE(bool_or(s.provision_type = 'permit' AND s.in_force AND s.verified AND NOT s.limited), false),
         COALESCE(bool_or(s.provision_type = 'permit' AND s.in_force AND s.verified AND s.limited), false),
         COALESCE(bool_or(s.provision_type = 'permit' AND s.in_force AND NOT s.verified), false),
         COALESCE(bool_or(s.provision_type = 'permit' AND NOT s.in_force), false)
    INTO v_refused, v_partly, v_full, v_limited, v_pending, v_future
    FROM chip_rows AS s;

  -- A withdrawn permission: a withdrawn patient-privacy record with a
  -- permit for an external actor and no deny provision.
  SELECT count(*) FILTER (WHERE r.status = 'active' AND r.withdrawn_at IS NULL),
         count(*) FILTER (WHERE r.withdrawn_at IS NOT NULL),
         COALESCE(bool_or(
           r.withdrawn_at IS NOT NULL AND r.scope = 'patient-privacy'
           AND EXISTS (SELECT 1 FROM interop.consent_provisions AS p
                        WHERE p.consent_id = r.id AND p.provision_type = 'permit'
                          AND (p.actor_type IS NULL
                               OR p.actor_type IN ('external_system', 'organization', 'any')))
           AND NOT EXISTS (SELECT 1 FROM interop.consent_provisions AS p
                            WHERE p.consent_id = r.id AND p.provision_type = 'deny')), false),
         max(r.updated_at)
    INTO v_active, v_withdrawn, v_wd_permit, v_last
    FROM interop.consent_records AS r
   WHERE r.patient_id = ANY (v_family);

  RETURN jsonb_build_object(
    'external_sharing', CASE WHEN v_deny THEN 'not_allowed'
                             WHEN v_permit THEN 'allowed'
                             WHEN v_wd_permit THEN 'withdrawn'
                             ELSE 'not_allowed' END,
    'pending_verification', NOT v_deny AND NOT v_permit AND v_unverified,
    'sharing_state', CASE WHEN v_refused OR v_partly THEN 'restricted'
                          WHEN v_full THEN 'allowed'
                          WHEN v_limited OR v_pending THEN 'restricted'
                          WHEN v_wd_permit THEN 'withdrawn'
                          ELSE 'restricted' END,
    'sharing_reason', CASE WHEN v_refused THEN 'refused'
                           WHEN v_partly THEN 'refused_partly'
                           WHEN v_full THEN 'permitted'
                           WHEN v_limited THEN 'limited'
                           WHEN v_pending THEN 'pending_verification'
                           WHEN v_wd_permit THEN 'withdrawn'
                           WHEN v_future THEN 'not_started'
                           ELSE 'no_permission' END,
    'active_records', v_active,
    'withdrawn_records', v_withdrawn,
    'last_changed_at', v_last);
END;
$$;

COMMENT ON FUNCTION public.interop_consent_summary(text) IS
  'Consent management: external sharing summary for one patient and every record merged into '
  'it (staff holding consult, portal_manage or audit_access, or the patient). Follows the '
  'gateway consent evaluator for external sharing: patient-privacy scope; active, not '
  'withdrawn, in-period records; in-period provisions without a security label whose actor '
  'type is external_system, organization, any or unset. not_allowed when any such deny '
  'exists; allowed when such a permit is on a verified record; withdrawn when neither and a '
  'withdrawn patient-privacy record had an external permit and no deny; otherwise '
  'not_allowed. pending_verification: only unverified permits exist. sharing_state (for the '
  'staff chip): allowed only for a verified, in-force permit with no limit (purpose, action, '
  'resource type, data class, security label) and no refusal in force; withdrawn; otherwise '
  'restricted. sharing_reason, first match: refused (a deny in force, no limit), '
  'refused_partly (a limited deny in force), permitted, limited, pending_verification, '
  'withdrawn (a withdrawn external permit with no deny), not_started, no_permission. A deny '
  'on a draft, proposed or not yet started record is not counted, as in the evaluator.';

-- ----------------------------------------------------------------------------
-- 9. fhir_access_audit_events (AuditEvent source)
-- ----------------------------------------------------------------------------
-- audit_access holders only. Narrowing required: p_id, p_patient_ids,
-- p_actor_source_ids, or both p_from and p_to at most 31 days apart.
-- Gateway requests only (actions read and search). Newest first, keyset
-- (p_after_occurred, p_after_id), p_limit 1..101. The patient filter
-- matches any overlap with the row's patient_ids.
CREATE OR REPLACE FUNCTION public.fhir_access_audit_events(
  p_id                uuid DEFAULT NULL,
  p_patient_ids       text[] DEFAULT NULL,
  p_actor_source_ids  text[] DEFAULT NULL,
  p_from              timestamptz DEFAULT NULL,
  p_to                timestamptz DEFAULT NULL,
  p_decision          text DEFAULT NULL,
  p_resource_type     text DEFAULT NULL,
  p_after_occurred    timestamptz DEFAULT NULL,
  p_after_id          uuid DEFAULT NULL,
  p_limit             integer DEFAULT 20
)
RETURNS TABLE (
  id                uuid,
  occurred_at       timestamptz,
  action            text,
  resource_type     text,
  resource_id       text,
  patient_ids       text[],
  actor_user_id     uuid,
  actor_role        text,
  actor_kind        text,
  purpose           text,
  decision          text,
  denial_reason     text,
  http_status       smallint,
  result_count      integer,
  consent_decision  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 101);
  v_actors  uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT interop.caller_has_any(ARRAY['audit_access']) THEN
    RAISE EXCEPTION 'audit_access required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(
        NOT interop.ids_ok(p_patient_ids, '^[A-Za-z0-9._-]{1,128}$', 100)
     OR NOT interop.ids_ok(p_actor_source_ids, '^[A-Za-z0-9._-]{1,128}$', 100)
     OR (p_decision IS NOT NULL AND p_decision NOT IN ('permit', 'deny'))
     OR (p_resource_type IS NOT NULL AND p_resource_type !~ '^[A-Z][A-Za-z]{1,63}$')
     OR ((p_after_occurred IS NULL) <> (p_after_id IS NULL))
     OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to)
     OR NOT (
          p_id IS NOT NULL
       OR COALESCE(cardinality(p_patient_ids), 0) > 0
       OR COALESCE(cardinality(p_actor_source_ids), 0) > 0
       OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to - p_from <= interval '31 days')), true) THEN
    RAISE EXCEPTION 'a narrowing selector is required: id, patient, agent or a date range of at most 31 days'
      USING ERRCODE = '22023';
  END IF;
  -- actor_user_id is a uuid: a source id that is not one matches nothing.
  IF p_actor_source_ids IS NOT NULL THEN
    v_actors := ARRAY(
      SELECT s::uuid FROM unnest(p_actor_source_ids) AS s
       WHERE s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  END IF;

  RETURN QUERY
    SELECT a.id, a.occurred_at, a.action, a.resource_type, a.resource_id, a.patient_ids,
           a.actor_user_id, a.actor_role, a.actor_kind, a.purpose, a.decision,
           a.denial_reason, a.http_status, a.result_count, a.consent_decision
      FROM interop.access_audit AS a
     WHERE a.action IN ('read', 'search')
       AND (p_id IS NULL OR a.id = p_id)
       AND (p_patient_ids IS NULL OR a.patient_ids && p_patient_ids)
       AND (v_actors IS NULL OR a.actor_user_id = ANY (v_actors))
       AND (p_from IS NULL OR a.occurred_at >= p_from)
       AND (p_to IS NULL OR a.occurred_at <= p_to)
       AND (p_decision IS NULL OR a.decision = p_decision)
       AND (p_resource_type IS NULL OR a.resource_type = p_resource_type)
       AND (p_after_occurred IS NULL OR (a.occurred_at, a.id) < (p_after_occurred, p_after_id))
     ORDER BY a.occurred_at DESC, a.id DESC
     LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.fhir_access_audit_events(uuid, text[], text[], timestamptz, timestamptz, text, text, timestamptz, uuid, integer) IS
  'FHIR gateway: FHIR access audit rows (read and search) for AuditEvent, audit_access '
  'holders only, with a required id, patient, agent or date-range (at most 31 days) filter. '
  'actor_user_id is an account id: map it through fhir_staff_directory, never publish it.';

-- ----------------------------------------------------------------------------
-- 10. fhir_interop_admin_status
-- ----------------------------------------------------------------------------
-- audit_access or users holders. Counts of gateway requests and refusals
-- (24 h, 7 days), the 20 latest requests and refusals, and consent record
-- counts. No ids of any kind and no patient data.
CREATE OR REPLACE FUNCTION public.fhir_interop_admin_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT interop.caller_has_any(ARRAY['audit_access', 'users']) THEN
    RAISE EXCEPTION 'audit_access or users required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'requests_24h', count(*) FILTER (WHERE a.occurred_at >= now() - interval '24 hours'),
           'denials_24h',  count(*) FILTER (WHERE a.occurred_at >= now() - interval '24 hours' AND a.decision = 'deny'),
           'requests_7d',  count(*),
           'denials_7d',   count(*) FILTER (WHERE a.decision = 'deny'))
    INTO v_out
    FROM interop.access_audit AS a
   WHERE a.action IN ('read', 'search')
     AND a.occurred_at >= now() - interval '7 days';

  v_out := v_out || jsonb_build_object(
    'recent', COALESCE((
      SELECT jsonb_agg(x.entry ORDER BY x.occurred_at DESC)
        FROM (SELECT a.occurred_at,
                     jsonb_build_object('occurred_at', a.occurred_at, 'action', a.action,
                       'resource_type', a.resource_type, 'decision', a.decision,
                       'denial_reason', a.denial_reason, 'actor_role', a.actor_role,
                       'http_status', a.http_status) AS entry
                FROM interop.access_audit AS a
               WHERE a.action IN ('read', 'search')
               ORDER BY a.occurred_at DESC, a.id DESC
               LIMIT 20) AS x), '[]'::jsonb),
    'recent_denials', COALESCE((
      SELECT jsonb_agg(x.entry ORDER BY x.occurred_at DESC)
        FROM (SELECT a.occurred_at,
                     jsonb_build_object('occurred_at', a.occurred_at, 'action', a.action,
                       'resource_type', a.resource_type, 'decision', a.decision,
                       'denial_reason', a.denial_reason, 'actor_role', a.actor_role,
                       'http_status', a.http_status) AS entry
                FROM interop.access_audit AS a
               WHERE a.action IN ('read', 'search') AND a.decision = 'deny'
               ORDER BY a.occurred_at DESC, a.id DESC
               LIMIT 20) AS x), '[]'::jsonb),
    'consent', (
      SELECT jsonb_build_object(
               'records', count(*),
               'active', count(*) FILTER (WHERE r.status = 'active' AND r.withdrawn_at IS NULL),
               'withdrawn', count(*) FILTER (WHERE r.withdrawn_at IS NOT NULL))
        FROM interop.consent_records AS r));
  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.fhir_interop_admin_status() IS
  'Interop admin page: FHIR request and refusal counts (24 h, 7 days), the 20 latest '
  'requests and refusals, and consent record counts. No ids and no patient data. '
  'audit_access or users holders only.';

-- ----------------------------------------------------------------------------
-- 11. fhir_patient_lab_results (portal patients only)
-- ----------------------------------------------------------------------------
-- The same rule as portal_my_lab_results() (20260925100500): the order's
-- patient is one of the caller's portal records, and the result is
-- reviewed, released, not withheld and not superseded. Staff are refused
-- (they read the tables under their own row-level security). Optional
-- filters by result or order id (at most 100 each). Ordered by result id,
-- keyset p_after, p_limit 1..101.
CREATE OR REPLACE FUNCTION public.fhir_patient_lab_results(
  p_result_ids  uuid[] DEFAULT NULL,
  p_order_ids   uuid[] DEFAULT NULL,
  p_after       uuid DEFAULT NULL,
  p_limit       integer DEFAULT 100
)
RETURNS TABLE (
  id                      uuid,
  order_id                uuid,
  result_value            text,
  result_unit             text,
  reference_range         text,
  interpretation          text,
  result_date             timestamptz,
  reviewed_at             timestamptz,
  released_to_patient_at  timestamptz,
  amended_at              timestamptz,
  created_at              timestamptz,
  updated_at              timestamptz,
  patient_id              text,
  visit_id                text,
  test_name               text,
  test_code               text,
  priority                text,
  order_status            text,
  ordered_at              timestamptz,
  collected_at            timestamptz,
  order_created_at        timestamptz,
  order_updated_at        timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_own    text[];
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 101);
BEGIN
  IF (SELECT auth.uid()) IS NULL OR COALESCE(public.app_is_staff(), false) THEN
    RAISE EXCEPTION 'portal patients only' USING ERRCODE = '42501';
  END IF;
  v_own := ARRAY(SELECT public.app_portal_patient_ids());
  IF cardinality(v_own) = 0 THEN
    RAISE EXCEPTION 'portal patients only' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_result_ids), 0) > 100 OR COALESCE(cardinality(p_order_ids), 0) > 100 THEN
    RAISE EXCEPTION 'at most 100 ids' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.lab_results') IS NULL OR to_regclass('public.lab_orders') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT r.id, r.order_id, r.result_value::text, r.result_unit::text, r.reference_range::text,
           r.interpretation::text, r.result_date, r.reviewed_at, r.released_to_patient_at,
           r.amended_at, r.created_at, r.updated_at,
           o.patient_id::text, o.visit_id::text, o.test_name::text, o.test_code::text,
           o.priority::text, o.status::text, o.ordered_at, o.collected_at,
           o.created_at, o.updated_at
      FROM public.lab_results AS r
      JOIN public.lab_orders AS o ON o.id = r.order_id
     WHERE o.patient_id::text = ANY (v_own)
       AND r.reviewed_at IS NOT NULL
       AND r.released_to_patient_at IS NOT NULL
       AND r.withheld_at IS NULL
       AND r.superseded_by IS NULL
       AND (p_result_ids IS NULL OR r.id = ANY (p_result_ids))
       AND (p_order_ids IS NULL OR r.order_id = ANY (p_order_ids))
       AND (p_after IS NULL OR r.id > p_after)
     ORDER BY r.id
     LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.fhir_patient_lab_results(uuid[], uuid[], uuid, integer) IS
  'FHIR gateway (patient self-access): the calling portal patient''s lab results that are '
  'reviewed, released, not withheld and not superseded, with their order. Staff are refused.';

-- ----------------------------------------------------------------------------
-- 12. Phase 1 fixes
-- ----------------------------------------------------------------------------
-- pg_catalog first, so a public object can never shadow a built-in.
ALTER FUNCTION public.fhir_gateway_context(integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.fhir_terminology_lookup(text, text[]) SET search_path = pg_catalog, public;

-- patients.fhir_id is the published Patient id. Once set it is kept: an
-- update that changes it keeps the old value silently (it never raises, so
-- a device sync that sends an old copy of the row cannot fail on it). The
-- identity guard of 20260924110100 still refuses the change outright for
-- API callers without 'register'; this trigger covers everyone else,
-- register holders, the service role and definer functions included.
CREATE OR REPLACE FUNCTION public.tg_patients_keep_fhir_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.fhir_id IS NOT NULL AND NEW.fhir_id IS DISTINCT FROM OLD.fhir_id THEN
    NEW.fhir_id := OLD.fhir_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_patients_keep_fhir_id() IS
  'Trigger: keeps patients.fhir_id (the published Patient id) once it is set.';
-- The trigger itself is created in section 14, after the indexes.

-- ----------------------------------------------------------------------------
-- 13. Indexes for the Phase 2 searches, only where none exists
-- ----------------------------------------------------------------------------
-- An index is created only when the table and column exist and no valid,
-- non-partial index already starts with the column (so a database that has
-- one under another name, for example after production drift, gets no
-- duplicate). What the repository's migrations leave in place:
--   dispenses(prescription_id)   none. FK to prescriptions ON DELETE
--       CASCADE; MedicationDispense by prescription (authorizingPrescription
--       and MedicationRequest -> dispenses) scans the table without it.
--       Only idx_dispenses_authorizing_rx (another column) and a partial
--       (updated_at) index exist (20260503010200:106, 20260925100400:155).
--   lab_results(order_id)        none usable. idx_lab_results_order was
--       dropped (20251027000000:97); idx_lab_results_released is partial
--       (released rows only, 20260925100500:151). Every DiagnosticReport and
--       lab Observation reads results by order (and the FK cascade).
--   prescriptions(patient_id)    none. MedicationRequest patient= search.
--   patient_allergies(patient_id) present in the repository
--       (idx_patient_allergies_patient_id, 20251025000000:92): created only
--       where it is missing (AllergyIntolerance patient= search).
--   patient_documents(patient_id) present in the repository
--       (idx_patient_documents_patient, idx_documents_patient): created
--       only where missing (DocumentReference patient= search).
-- Plain CREATE INDEX (a migration runs in a transaction, where CONCURRENTLY
-- is not allowed): it blocks writes to that table while it builds. Where
-- a table is large enough for that to matter, build the index first,
-- outside a transaction, with the same name:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS interop_lab_results_order_id_idx ON public.lab_results (order_id);
--   (likewise interop_dispenses_prescription_id_idx, interop_prescriptions_patient_id_idx)
-- This block then finds a valid index on the column and builds nothing. An
-- INVALID index of that name (a failed CONCURRENTLY build) is dropped and
-- built again here.
DO $$
DECLARE
  v_spec  text[];
  v_rel   regclass;
  v_att   smallint;
BEGIN
  FOREACH v_spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['dispenses', 'prescription_id', 'interop_dispenses_prescription_id_idx',
          'MedicationDispense by prescription; FK to prescriptions (ON DELETE CASCADE) had no index.'],
    ARRAY['lab_results', 'order_id', 'interop_lab_results_order_id_idx',
          'DiagnosticReport and lab Observation read results by order; the full index was dropped in 20251027000000.'],
    ARRAY['prescriptions', 'patient_id', 'interop_prescriptions_patient_id_idx',
          'MedicationRequest search by patient.'],
    ARRAY['patient_allergies', 'patient_id', 'interop_patient_allergies_patient_id_idx',
          'AllergyIntolerance search by patient (created only where no patient_id index existed).'],
    ARRAY['patient_documents', 'patient_id', 'interop_patient_documents_patient_id_idx',
          'DocumentReference search by patient (created only where no patient_id index existed).']
  ] LOOP
    v_rel := to_regclass('public.' || v_spec[1]);
    IF v_rel IS NULL THEN
      RAISE NOTICE 'interop phase 2: table public.% not found, index skipped', v_spec[1];
      CONTINUE;
    END IF;
    SELECT a.attnum INTO v_att
      FROM pg_attribute AS a
     WHERE a.attrelid = v_rel AND a.attname = v_spec[2] AND NOT a.attisdropped;
    IF v_att IS NULL THEN
      RAISE NOTICE 'interop phase 2: column public.%.% not found, index skipped', v_spec[1], v_spec[2];
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_index AS i
                WHERE i.indrelid = v_rel AND i.indkey[0] = v_att
                  AND i.indpred IS NULL AND i.indisvalid) THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_index AS i
                WHERE i.indexrelid = to_regclass('public.' || quote_ident(v_spec[3])) AND NOT i.indisvalid) THEN
      EXECUTE format('DROP INDEX public.%I', v_spec[3]);
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', v_spec[3], v_spec[1], v_spec[2]);
    EXECUTE format('COMMENT ON INDEX public.%I IS %L', v_spec[3], 'Interop phase 2: ' || v_spec[4]);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 14. patients.fhir_id trigger (the last step that locks public.patients)
-- ----------------------------------------------------------------------------
-- CREATE TRIGGER locks public.patients against writes until the migration
-- commits, so it runs after the index builds, and DROP TRIGGER (which also
-- blocks reads) runs only when the trigger is missing or not the one this
-- file creates. A re-run that finds it in place takes no lock on patients.
DO $$
BEGIN
  IF to_regclass('public.patients') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.patients'::regclass
                       AND attname = 'fhir_id' AND NOT attisdropped) THEN
    RAISE NOTICE 'interop phase 2: public.patients.fhir_id not found, fhir_id trigger skipped';
    RETURN;
  END IF;
  -- tgtype 19 = ROW | BEFORE | UPDATE; tgenabled 'O' = enabled.
  IF EXISTS (SELECT 1 FROM pg_trigger AS t
              WHERE t.tgrelid = 'public.patients'::regclass
                AND t.tgname = 'patients_keep_fhir_id'
                AND NOT t.tgisinternal
                AND t.tgfoid = 'public.tg_patients_keep_fhir_id()'::regprocedure
                AND t.tgtype = 19
                AND t.tgenabled = 'O'
                AND t.tgattr = ''::int2vector
                AND t.tgqual IS NULL) THEN
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS patients_keep_fhir_id ON public.patients;
  CREATE TRIGGER patients_keep_fhir_id
    BEFORE UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.tg_patients_keep_fhir_id();
END $$;

-- ----------------------------------------------------------------------------
-- 15. Grants
-- ----------------------------------------------------------------------------
-- Internal helpers and trigger functions: no API role.
REVOKE ALL ON FUNCTION interop.caller_kind() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.caller_permissions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.caller_has_any(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.ids_ok(text[], text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.consent_directives_json(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.consent_records_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.consent_records_log_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.consent_provisions_guard_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.patient_members(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION interop.patient_family(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_patients_keep_fhir_id() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.fhir_gateway_context_v2(integer, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_record_access_v2(uuid, text, text, text, text[], text, text, text, integer, text[], text, text, integer, text, uuid, uuid, text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_resolve_patients(text[], text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_staff_directory(text[], text[], text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_link_ids(text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_link_sources(text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_consent_directives(text[], uuid[], uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_access_audit_events(uuid, text[], text[], timestamptz, timestamptz, text, text, timestamptz, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_interop_admin_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_patient_lab_results(uuid[], uuid[], uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.interop_record_consent(text, text, text, text, text, text, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.interop_verify_consent(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.interop_withdraw_consent(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.interop_my_consents(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.interop_consent_summary(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fhir_gateway_context_v2(integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_record_access_v2(uuid, text, text, text, text[], text, text, text, integer, text[], text, text, integer, text, uuid, uuid, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_resolve_patients(text[], text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_staff_directory(text[], text[], text, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_link_ids(text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_link_sources(text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_consent_directives(text[], uuid[], uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_access_audit_events(uuid, text[], text[], timestamptz, timestamptz, text, text, timestamptz, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_interop_admin_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fhir_patient_lab_results(uuid[], uuid[], uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.interop_record_consent(text, text, text, text, text, text, timestamptz, timestamptz, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.interop_verify_consent(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.interop_withdraw_consent(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.interop_my_consents(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.interop_consent_summary(text) TO authenticated, service_role;
