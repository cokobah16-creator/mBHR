-- ============================================================================
-- Interoperability foundation: the interop schema (FHIR R4, first delivery)
-- ============================================================================
-- Additive only. Creates a new, non-public schema and the gateway's three
-- database functions. No existing table, column, policy or function is
-- changed, and no data is read or written outside interop.*.
--
-- Depends on (earlier migrations; resolved when the functions run, not when
-- they are created):
--   20260520000004  public.check_and_increment_rate_limit()
--   20260924110000  public.app_current_role(), public.app_is_staff()
--   20260925100600  public.app_role_has_permission() (latest matrix)
-- Nothing in this file depends on the clinical tables.
--
--   1. Schema interop. Not listed in supabase/config.toml [api] schemas, so
--      the Data API never serves it, and no API role gets USAGE on it:
--      anon and authenticated cannot read or write any interop table even
--      by name. The gateway reaches it only through the functions in 4.
--   2. Tables
--        resource_links      mBHR row <-> published FHIR identity
--        terminology_map     local codes -> reviewed standard codes
--        consent_records     patient data-sharing directives (FHIR Consent)
--        consent_provisions  permit/deny rules inside a consent
--        access_audit        append-only FHIR access log
--      Row-level security is on for every table with no policies, so even a
--      role that is later granted a table sees nothing until a policy says so.
--   3. Guards: access_audit refuses UPDATE, DELETE and TRUNCATE for every
--      role; consent records and provisions refuse DELETE and TRUNCATE
--      (withdrawal is recorded, history is kept).
--   4. Functions for the /fhir/R4 gateway (SECURITY DEFINER, signed-in
--      callers only; each reveals or writes facts about the caller alone):
--        fhir_gateway_context(p_rate_limit)  caller's role, permissions and
--                                            one rate-limit step
--        fhir_record_access(...)             one audit row, actor = caller
--        fhir_terminology_lookup(domain, codes)  verified mappings only
--
-- Identifiers are text where the mBHR row ids they point at are text
-- (patients.id and visits.id are device-generated ULIDs), and uuid where
-- they are auth.users ids. auth.uid() is compared with uuid columns as a
-- uuid, never through ::text.
--
-- Rollback (nothing else references these objects):
--   DROP FUNCTION IF EXISTS public.fhir_terminology_lookup(text, text[]);
--   DROP FUNCTION IF EXISTS public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text);
--   DROP FUNCTION IF EXISTS public.fhir_gateway_context(integer);
--   DROP SCHEMA IF EXISTS interop CASCADE;
--   DELETE FROM public.rate_limits WHERE bucket = 'fhir_gateway';
-- Dropping the schema deletes the audit trail and any consent records:
-- export them first. See docs/interoperability/README.md#rollback.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS interop;
COMMENT ON SCHEMA interop IS
  'Interoperability (FHIR) data. Not exposed through the Data API; reached only '
  'through public.fhir_* functions. See docs/interoperability/README.md.';

REVOKE ALL ON SCHEMA interop FROM PUBLIC;
REVOKE ALL ON SCHEMA interop FROM anon, authenticated;
GRANT USAGE ON SCHEMA interop TO service_role;

-- Tables and functions created in interop from now on start with no grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA interop REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA interop REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION interop.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2a. resource_links
-- ----------------------------------------------------------------------------
-- The published FHIR identity of an mBHR row, for resources whose source id
-- cannot serve as the FHIR id. The first delivery derives every id
-- deterministically (see docs/interoperability/resource-mapping.md) and
-- does not write here yet.
CREATE TABLE IF NOT EXISTS interop.resource_links (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fhir_resource_type   text        NOT NULL,
  fhir_id              text        NOT NULL,
  source_schema        text        NOT NULL DEFAULT 'public',
  source_table         text        NOT NULL,
  source_id            text        NOT NULL,
  profile_url          text,
  version_id           bigint      NOT NULL DEFAULT 1,
  source_last_updated  timestamptz,
  fhir_last_updated    timestamptz NOT NULL DEFAULT now(),
  active               boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_links_type_format CHECK (fhir_resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
  CONSTRAINT resource_links_fhir_id_format CHECK (fhir_id ~ '^[A-Za-z0-9.-]{1,64}$'),
  CONSTRAINT resource_links_version_positive CHECK (version_id >= 1),
  CONSTRAINT resource_links_fhir_identity UNIQUE (fhir_resource_type, fhir_id),
  CONSTRAINT resource_links_source_identity UNIQUE (source_schema, source_table, source_id, fhir_resource_type)
);

CREATE INDEX IF NOT EXISTS resource_links_source_idx
  ON interop.resource_links (source_table, source_id);

DROP TRIGGER IF EXISTS resource_links_touch ON interop.resource_links;
CREATE TRIGGER resource_links_touch BEFORE UPDATE ON interop.resource_links
  FOR EACH ROW EXECUTE FUNCTION interop.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2b. terminology_map
-- ----------------------------------------------------------------------------
-- A local mBHR code and the standard code it corresponds to. Only rows a
-- person has reviewed (review_status = 'verified', with reviewer and time)
-- are ever published; suggestions (from people or tools) stay 'unverified'.
CREATE TABLE IF NOT EXISTS interop.terminology_map (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text        NOT NULL,
  local_system   text        NOT NULL,
  local_code     text        NOT NULL,
  local_display  text,
  fhir_system    text        NOT NULL,
  fhir_code      text        NOT NULL,
  fhir_display   text,
  version        text,
  review_status  text        NOT NULL DEFAULT 'unverified',
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  review_note    text,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terminology_map_domain CHECK (domain IN (
    'condition', 'vitals', 'lab_test', 'medication', 'allergy', 'gender', 'other')),
  CONSTRAINT terminology_map_review_status CHECK (review_status IN ('unverified', 'verified', 'rejected')),
  CONSTRAINT terminology_map_verified_has_reviewer CHECK (
    review_status <> 'verified' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT terminology_map_systems_are_uris CHECK (
    local_system ~ '^[a-z][a-z0-9+.-]*:' AND fhir_system ~ '^[a-z][a-z0-9+.-]*:'),
  CONSTRAINT terminology_map_codes_nonblank CHECK (
    btrim(local_code) <> '' AND btrim(fhir_code) <> '')
);

-- One active mapping per local code and target system.
CREATE UNIQUE INDEX IF NOT EXISTS terminology_map_active_unique
  ON interop.terminology_map (domain, local_system, local_code, fhir_system)
  WHERE active;
CREATE INDEX IF NOT EXISTS terminology_map_lookup_idx
  ON interop.terminology_map (domain, local_code)
  WHERE active AND review_status = 'verified';

DROP TRIGGER IF EXISTS terminology_map_touch ON interop.terminology_map;
CREATE TRIGGER terminology_map_touch BEFORE UPDATE ON interop.terminology_map
  FOR EACH ROW EXECUTE FUNCTION interop.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2c. consent_records and consent_provisions
-- ----------------------------------------------------------------------------
-- A patient's data-sharing directive. status and scope use the FHIR R4
-- Consent codes (consent-state-codes, consent-scope), so a record maps to a
-- Consent resource without translation. Nothing enforces or displays these
-- yet: see docs/interoperability/consent.md. The existing
-- public.patient_consent_records (yes/no per consent type) is unchanged.
CREATE TABLE IF NOT EXISTS interop.consent_records (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                text        NOT NULL,
  status                    text        NOT NULL DEFAULT 'draft',
  scope                     text        NOT NULL,
  category                  text        NOT NULL,
  policy_uri                text,
  source_type               text        NOT NULL,
  source_document_id        text,
  granted_by                text,
  granted_by_relationship   text,
  recorded_by               uuid,
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  verified                  boolean     NOT NULL DEFAULT false,
  verified_by               uuid,
  verified_at               timestamptz,
  effective_from            timestamptz,
  effective_until           timestamptz,
  withdrawn_at              timestamptz,
  withdrawn_by              uuid,
  withdrawal_reason         text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_records_status CHECK (status IN (
    'draft', 'proposed', 'active', 'rejected', 'inactive', 'entered-in-error')),
  CONSTRAINT consent_records_scope CHECK (scope IN (
    'adr', 'research', 'patient-privacy', 'treatment')),
  CONSTRAINT consent_records_source_type CHECK (source_type IN (
    'paper_form', 'portal', 'verbal_witnessed', 'imported', 'mbhr_consent_record')),
  CONSTRAINT consent_records_period CHECK (
    effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
  CONSTRAINT consent_records_verified_stamp CHECK (
    NOT verified OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  -- A withdrawn consent is no longer in force.
  CONSTRAINT consent_records_withdrawn_inactive CHECK (
    withdrawn_at IS NULL OR status IN ('inactive', 'entered-in-error'))
);

CREATE INDEX IF NOT EXISTS consent_records_patient_idx
  ON interop.consent_records (patient_id, status);

DROP TRIGGER IF EXISTS consent_records_touch ON interop.consent_records;
CREATE TRIGGER consent_records_touch BEFORE UPDATE ON interop.consent_records
  FOR EACH ROW EXECUTE FUNCTION interop.touch_updated_at();

CREATE TABLE IF NOT EXISTS interop.consent_provisions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id       uuid        NOT NULL REFERENCES interop.consent_records (id) ON DELETE RESTRICT,
  provision_type   text        NOT NULL,
  actor_type       text,
  actor_reference  text,
  action           text,
  purpose          text,
  data_class       text,
  resource_type    text,
  security_label   text,
  effective_from   timestamptz,
  effective_until  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_provisions_type CHECK (provision_type IN ('permit', 'deny')),
  CONSTRAINT consent_provisions_actor_type CHECK (actor_type IS NULL OR actor_type IN (
    'organization', 'practitioner', 'care_team', 'patient_portal', 'external_system', 'any')),
  -- FHIR consentaction codes.
  CONSTRAINT consent_provisions_action CHECK (action IS NULL OR action IN (
    'collect', 'access', 'use', 'disclose', 'correct')),
  -- HL7 v3 PurposeOfUse codes mBHR distinguishes.
  CONSTRAINT consent_provisions_purpose CHECK (purpose IS NULL OR purpose IN (
    'TREAT', 'ETREAT', 'HOPERAT', 'PATRQT', 'HRESCH', 'PUBHLTH')),
  CONSTRAINT consent_provisions_resource_type CHECK (
    resource_type IS NULL OR resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
  CONSTRAINT consent_provisions_period CHECK (
    effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from)
);

CREATE INDEX IF NOT EXISTS consent_provisions_consent_idx
  ON interop.consent_provisions (consent_id);

-- ----------------------------------------------------------------------------
-- 2d. access_audit (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interop.access_audit (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at            timestamptz NOT NULL DEFAULT now(),
  request_id             uuid        NOT NULL,
  actor_user_id          uuid,
  actor_role             text,
  actor_practitioner_id  text,
  patient_id             text,
  patient_ids            text[]      NOT NULL DEFAULT '{}',
  client_id              text,
  organization_id        text,
  action                 text        NOT NULL,
  resource_type          text,
  resource_id            text,
  purpose                text,
  scope                  text,
  decision               text        NOT NULL,
  denial_reason          text,
  break_glass            boolean     NOT NULL DEFAULT false,
  result_count           integer     NOT NULL DEFAULT 0,
  source                 text        NOT NULL DEFAULT 'fhir_gateway',
  user_agent             text,
  ip_hash                text,
  metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT access_audit_action CHECK (action IN (
    'read', 'search', 'create', 'update', 'delete', 'export',
    'consent_change', 'authorization_approval', 'authorization_denial',
    'break_glass', 'client_registration_change')),
  CONSTRAINT access_audit_decision CHECK (decision IN ('permit', 'deny')),
  CONSTRAINT access_audit_denial_reason CHECK (
    (decision = 'deny') = (denial_reason IS NOT NULL)),
  CONSTRAINT access_audit_patient_ids_bounded CHECK (cardinality(patient_ids) <= 100),
  CONSTRAINT access_audit_result_count CHECK (result_count >= 0),
  CONSTRAINT access_audit_text_lengths CHECK (
    length(coalesce(user_agent, '')) <= 200
    AND length(coalesce(denial_reason, '')) <= 100
    AND length(coalesce(resource_id, '')) <= 64
    AND length(coalesce(ip_hash, '')) <= 64)
);

CREATE INDEX IF NOT EXISTS access_audit_occurred_idx ON interop.access_audit (occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_audit_patient_idx ON interop.access_audit (patient_id, occurred_at DESC)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS access_audit_patient_ids_idx ON interop.access_audit USING gin (patient_ids);
CREATE INDEX IF NOT EXISTS access_audit_actor_idx ON interop.access_audit (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_audit_client_idx ON interop.access_audit (client_id, occurred_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS access_audit_denied_idx ON interop.access_audit (occurred_at DESC)
  WHERE decision = 'deny';

-- ----------------------------------------------------------------------------
-- 3. Guards
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION interop.refuse_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'interop.%: % is not allowed (%)', TG_TABLE_NAME, TG_OP, TG_ARGV[0]
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS access_audit_append_only ON interop.access_audit;
CREATE TRIGGER access_audit_append_only
  BEFORE UPDATE OR DELETE ON interop.access_audit
  FOR EACH ROW EXECUTE FUNCTION interop.refuse_change('the audit trail is append-only');
DROP TRIGGER IF EXISTS access_audit_no_truncate ON interop.access_audit;
CREATE TRIGGER access_audit_no_truncate
  BEFORE TRUNCATE ON interop.access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION interop.refuse_change('the audit trail is append-only');

DROP TRIGGER IF EXISTS consent_records_keep_history ON interop.consent_records;
CREATE TRIGGER consent_records_keep_history
  BEFORE DELETE ON interop.consent_records
  FOR EACH ROW EXECUTE FUNCTION interop.refuse_change('record a withdrawal instead');
DROP TRIGGER IF EXISTS consent_records_no_truncate ON interop.consent_records;
CREATE TRIGGER consent_records_no_truncate
  BEFORE TRUNCATE ON interop.consent_records
  FOR EACH STATEMENT EXECUTE FUNCTION interop.refuse_change('record a withdrawal instead');

DROP TRIGGER IF EXISTS consent_provisions_keep_history ON interop.consent_provisions;
CREATE TRIGGER consent_provisions_keep_history
  BEFORE DELETE ON interop.consent_provisions
  FOR EACH ROW EXECUTE FUNCTION interop.refuse_change('consent history is kept');
DROP TRIGGER IF EXISTS consent_provisions_no_truncate ON interop.consent_provisions;
CREATE TRIGGER consent_provisions_no_truncate
  BEFORE TRUNCATE ON interop.consent_provisions
  FOR EACH STATEMENT EXECUTE FUNCTION interop.refuse_change('consent history is kept');

-- Row-level security on, no policies: no API role reads or writes these
-- tables directly, whatever grants a later change adds.
ALTER TABLE interop.resource_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE interop.terminology_map    ENABLE ROW LEVEL SECURITY;
ALTER TABLE interop.consent_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE interop.consent_provisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interop.access_audit       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA interop FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA interop FROM PUBLIC, anon, authenticated;
-- Support tooling with the service role may read everything and add rows;
-- the guards above still apply to it.
GRANT SELECT, INSERT, UPDATE ON interop.resource_links, interop.terminology_map,
  interop.consent_records, interop.consent_provisions TO service_role;
GRANT SELECT, INSERT ON interop.access_audit TO service_role;

-- ----------------------------------------------------------------------------
-- 4a. fhir_gateway_context: the caller's role and permissions, one rate step
-- ----------------------------------------------------------------------------
-- Returns {role, permissions, rate_allowed, retry_after_seconds}. The role
-- comes from app_current_role() (active app_users row for auth.uid()), and
-- the permissions from the server's own matrix, app_role_has_permission().
-- A portal patient or unknown account gets role null and no permissions.
-- The rate limit counts per account ('fhir_gateway' bucket, 60 s window);
-- p_rate_limit is clamped to 1..600.
CREATE OR REPLACE FUNCTION public.fhir_gateway_context(p_rate_limit integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_role  text;
  v_perms text[];
  v_rate  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000';
  END IF;

  v_rate := public.check_and_increment_rate_limit(
    'fhir_gateway', v_uid::text, LEAST(GREATEST(COALESCE(p_rate_limit, 60), 1), 600), 60);

  v_role := public.app_current_role();
  SELECT COALESCE(array_agg(p ORDER BY p), '{}')
    INTO v_perms
    FROM unnest(ARRAY[
      'register', 'vitals', 'consult', 'dispense', 'inventory', 'export',
      'users', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts',
      'lab_review', 'queue', 'portal_manage', 'merge_patients',
      'lab_release', 'portal_invite']) AS p
   WHERE v_role IS NOT NULL AND public.app_role_has_permission(v_role, p);

  RETURN jsonb_build_object(
    'role', v_role,
    'permissions', to_jsonb(v_perms),
    'rate_allowed', COALESCE((v_rate ->> 'allowed')::boolean, false),
    'retry_after_seconds', (v_rate ->> 'retry_after_seconds')::integer);
END;
$$;

COMMENT ON FUNCTION public.fhir_gateway_context(integer) IS
  'FHIR gateway: the caller''s mBHR role and permissions and one rate-limit step. '
  'See docs/interoperability/security.md.';

-- ----------------------------------------------------------------------------
-- 4b. fhir_record_access: one audit row, attributed to the caller
-- ----------------------------------------------------------------------------
-- The actor and their role are taken from the session, never from the
-- arguments, so a caller can only ever write rows about themselves. Values
-- are checked and bounded; the row id is returned.
CREATE OR REPLACE FUNCTION public.fhir_record_access(
  p_request_id     uuid,
  p_action         text,
  p_resource_type  text,
  p_resource_id    text,
  p_patient_ids    text[],
  p_purpose        text,
  p_decision       text,
  p_denial_reason  text,
  p_result_count   integer,
  p_search_params  text[],
  p_user_agent     text,
  p_ip_hash        text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_ids  text[] := COALESCE(p_patient_ids, '{}');
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000';
  END IF;
  -- COALESCE: a NULL argument makes a comparison NULL, which must refuse.
  IF COALESCE(
        p_request_id IS NULL
     OR p_action NOT IN ('read', 'search')
     OR p_decision NOT IN ('permit', 'deny')
     OR p_resource_type !~ '^[A-Z][A-Za-z]{1,63}$'
     OR (p_resource_id IS NOT NULL AND p_resource_id !~ '^[A-Za-z0-9.-]{1,64}$')
     OR cardinality(v_ids) > 100
     OR cardinality(COALESCE(p_search_params, '{}')) > 20
     OR COALESCE(p_result_count, 0) < 0
     OR (p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$'), true) THEN
    RAISE EXCEPTION 'invalid audit record' USING ERRCODE = '22023';
  END IF;

  INSERT INTO interop.access_audit (
    request_id, actor_user_id, actor_role, patient_id, patient_ids, action,
    resource_type, resource_id, purpose, decision, denial_reason, result_count,
    source, user_agent, ip_hash, metadata)
  VALUES (
    p_request_id, v_uid, public.app_current_role(),
    CASE WHEN cardinality(v_ids) = 1 THEN v_ids[1] END,
    v_ids, p_action, p_resource_type, p_resource_id,
    left(p_purpose, 16), p_decision,
    CASE WHEN p_decision = 'deny' THEN left(COALESCE(p_denial_reason, 'denied'), 100) END,
    COALESCE(p_result_count, 0), 'fhir_gateway', left(p_user_agent, 200), p_ip_hash,
    jsonb_build_object('search_params', to_jsonb(COALESCE(p_search_params, '{}'))))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text) IS
  'FHIR gateway: append one row to interop.access_audit for the calling account.';

-- ----------------------------------------------------------------------------
-- 4c. fhir_terminology_lookup: reviewed mappings for local codes (staff only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fhir_terminology_lookup(p_domain text, p_codes text[])
RETURNS TABLE (local_code text, fhir_system text, fhir_code text, fhir_display text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT COALESCE(public.app_is_staff(), false) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT tm.local_code, tm.fhir_system, tm.fhir_code, tm.fhir_display
      FROM interop.terminology_map AS tm
     WHERE tm.domain = p_domain
       AND tm.local_code = ANY (p_codes[1:200])
       AND tm.active
       AND tm.review_status = 'verified'
     ORDER BY tm.local_code, tm.fhir_system;
END;
$$;

COMMENT ON FUNCTION public.fhir_terminology_lookup(text, text[]) IS
  'FHIR gateway: verified, active terminology mappings for local codes. Staff only.';

REVOKE ALL ON FUNCTION public.fhir_gateway_context(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fhir_terminology_lookup(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fhir_gateway_context(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fhir_record_access(uuid, text, text, text, text[], text, text, text, integer, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fhir_terminology_lookup(text, text[]) TO authenticated;
