-- Checks for 20260925170000_hotfix_portal_access_status.sql.
--
-- The "Database migrations" workflow runs this after a rehearse with "only"
-- set to 20260925170000, on the throwaway local copy of production's schema
-- (no rows). Any failure stops the run. Everything is rolled back.
\set ON_ERROR_STOP 1

BEGIN;

-- The function the portal calls, with Wave B's signature and result, run as
-- a role that reads the patient tables without row-level security, and not
-- callable with the anon key.
DO $$
DECLARE
  f      regprocedure := to_regprocedure('public.portal_access_status()');
  fn     record;
  t      record;
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'portal_access_status() does not exist, so every portal sign-in is refused';
  END IF;

  IF pg_get_function_result(f) <> 'TABLE(patient_id text, portal_enabled boolean, changed_at timestamp with time zone)' THEN
    RAISE EXCEPTION 'portal_access_status() does not return Wave B''s TABLE(patient_id text, portal_enabled boolean, changed_at timestamptz), so 20260925100100 could not replace it';
  END IF;

  SELECT p.prosecdef, p.provolatile, p.proconfig, p.proowner, r.rolsuper, r.rolbypassrls
    INTO fn
    FROM pg_proc AS p JOIN pg_roles AS r ON r.oid = p.proowner
   WHERE p.oid = f;
  IF NOT fn.prosecdef THEN
    RAISE EXCEPTION 'portal_access_status() is not SECURITY DEFINER, so row-level security hides the patient''s records from it';
  END IF;
  IF fn.provolatile <> 's' THEN
    RAISE EXCEPTION 'portal_access_status() is not STABLE';
  END IF;
  IF NOT coalesce(fn.proconfig @> ARRAY['search_path=public, pg_catalog'], false) THEN
    RAISE EXCEPTION 'portal_access_status() does not pin search_path to public, pg_catalog';
  END IF;

  IF has_function_privilege('public', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'portal_access_status() can be called with the anon key';
  END IF;
  IF NOT (has_function_privilege('authenticated', f, 'EXECUTE')
          AND has_function_privilege('service_role', f, 'EXECUTE')) THEN
    RAISE EXCEPTION 'authenticated or service_role cannot call portal_access_status()';
  END IF;

  -- SECURITY DEFINER only skips row-level security when the owner is exempt.
  FOR t IN
    SELECT c.oid::regclass AS rel, c.relowner, c.relforcerowsecurity
      FROM pg_class AS c
     WHERE c.oid = to_regclass('public.patients')
  LOOP
    IF t.relforcerowsecurity THEN
      RAISE EXCEPTION '% has FORCE ROW LEVEL SECURITY, so portal_access_status() cannot see the caller''s rows', t.rel;
    END IF;
    IF t.relowner <> fn.proowner AND NOT (fn.rolsuper OR fn.rolbypassrls) THEN
      RAISE EXCEPTION 'portal_access_status() is owned by a role that % row-level security applies to', t.rel;
    END IF;
  END LOOP;

  -- Wave B's CREATE OR REPLACE runs as the migration role, as this does.
  IF NOT pg_has_role(current_user, fn.proowner, 'USAGE') THEN
    RAISE EXCEPTION 'portal_access_status() is owned by a role the migration role is not, so 20260925100100 could not replace it';
  END IF;
END $$;

-- Test rows (the copy has none; all rolled back). Values for columns a
-- table does not have are skipped; other NOT NULL columns with no default
-- get a plain value of their type. Ids are uuid-shaped so they fit text or
-- uuid columns. If a row breaks one of the table's rules, say which rule,
-- so the log shows the mismatch; nothing about the schema is printed when
-- the rows go in.
DO $$
DECLARE
  r            jsonb;
  a            record;
  v_rel        regclass;
  v_cols       text[];
  v_vals       text[];
  v_constraint text;
  v_column     text;
  v_def        text;
BEGIN
  FOR r IN SELECT jsonb_array_elements($rows$[
    {"table": "public.patients", "values": {"id": "00000000-0000-4000-8000-00000000cfa1",
      "given_name": "Hotfix", "family_name": "Check A", "sex": "female", "dob": "1990-01-01",
      "phone": "+2340000000101", "email": "hotfix-check-a@example.invalid",
      "address": "Hotfix check", "state": "Hotfix check", "lga": "Hotfix check",
      "auth_uid": "00000000-0000-4000-8000-00000000c0a1", "portal_enabled": true}},
    {"table": "public.patients", "values": {"id": "00000000-0000-4000-8000-00000000cfb2",
      "given_name": "Hotfix", "family_name": "Check B", "sex": "female", "dob": "1990-01-01",
      "phone": "+2340000000102", "email": "hotfix-check-b@example.invalid",
      "address": "Hotfix check", "state": "Hotfix check", "lga": "Hotfix check",
      "auth_uid": "00000000-0000-4000-8000-00000000c0b2", "portal_enabled": false}},
    {"table": "public.patients", "values": {"id": "00000000-0000-4000-8000-00000000cfc3",
      "given_name": "Hotfix", "family_name": "Check C", "sex": "female", "dob": "1990-01-01",
      "phone": "+2340000000103", "email": "hotfix-check-c@example.invalid",
      "address": "Hotfix check", "state": "Hotfix check", "lga": "Hotfix check",
      "portal_enabled": true}},
    {"table": "public.patients", "values": {"id": "00000000-0000-4000-8000-00000000cfd4",
      "given_name": "Hotfix", "family_name": "Check D", "sex": "female", "dob": "1990-01-01",
      "phone": "+2340000000104", "email": "hotfix-check-d@example.invalid",
      "address": "Hotfix check", "state": "Hotfix check", "lga": "Hotfix check",
      "portal_enabled": true}},
    {"table": "public.patients", "values": {"id": "00000000-0000-4000-8000-00000000cfe5",
      "given_name": "Hotfix", "family_name": "Check E", "sex": "female", "dob": "1990-01-01",
      "phone": "+2340000000105", "email": "hotfix-check-e@example.invalid",
      "address": "Hotfix check", "state": "Hotfix check", "lga": "Hotfix check",
      "portal_enabled": true}},
    {"table": "public.patient_portal_users", "values": {"id": "00000000-0000-4000-8000-00000000c0c3",
      "patient_id": "00000000-0000-4000-8000-00000000cfc3", "phone_number": "+2340000000203",
      "email": "hotfix-check-portal-c@example.invalid", "account_status": "active", "consent_given": true,
      "given_name": "Hotfix", "family_name": "Check", "sex": "female", "dob": "1990-01-01"}},
    {"table": "public.patient_portal_users", "values": {"id": "00000000-0000-4000-8000-00000000c0d5",
      "patient_id": "00000000-0000-4000-8000-00000000cfd4", "phone_number": "+2340000000204",
      "email": "hotfix-check-portal-d@example.invalid", "account_status": "active", "consent_given": true,
      "given_name": "Hotfix", "family_name": "Check", "sex": "female", "dob": "1990-01-01"}},
    {"table": "public.patient_portal_users", "values": {"id": "00000000-0000-4000-8000-00000000c0e6",
      "patient_id": "00000000-0000-4000-8000-00000000cfe5", "phone_number": "+2340000000205",
      "email": "hotfix-check-portal-e@example.invalid", "account_status": "active", "consent_given": true,
      "given_name": "Hotfix", "family_name": "Check", "sex": "female", "dob": "1990-01-01"}}
  ]$rows$::jsonb)
  LOOP
    v_rel := to_regclass(r ->> 'table');
    CONTINUE WHEN v_rel IS NULL;
    v_cols := '{}';
    v_vals := '{}';
    FOR a IN
      SELECT att.attname::text AS name,
             format_type(att.atttypid, att.atttypmod) AS typ,
             att.atttypid,
             t.typtype,
             t.typcategory,
             att.attnotnull AND NOT att.atthasdef
               AND att.attidentity = '' AND att.attgenerated = '' AS needs_value
        FROM pg_attribute AS att JOIN pg_type AS t ON t.oid = att.atttypid
       WHERE att.attrelid = v_rel AND att.attnum > 0 AND NOT att.attisdropped
       ORDER BY att.attnum
    LOOP
      IF (r -> 'values') ? a.name THEN
        v_cols := v_cols || quote_ident(a.name);
        v_vals := v_vals || format('%L::%s', r -> 'values' ->> a.name, a.typ);
      ELSIF a.needs_value THEN
        v_cols := v_cols || quote_ident(a.name);
        v_vals := v_vals || CASE
          WHEN a.typtype = 'e' THEN format('%L::%s',
            (SELECT e.enumlabel FROM pg_enum AS e WHERE e.enumtypid = a.atttypid
              ORDER BY e.enumsortorder LIMIT 1), a.typ)
          WHEN a.typcategory = 'B' THEN 'false'
          WHEN a.typcategory = 'N' THEN format('0::%s', a.typ)
          WHEN a.typcategory = 'D' THEN format('now()::%s', a.typ)
          WHEN a.typcategory = 'A' OR a.typ IN ('json', 'jsonb') THEN format('%L::%s', '{}', a.typ)
          WHEN a.typ = 'uuid' THEN 'gen_random_uuid()'
          ELSE format('%L::%s', 'hotfix-check', a.typ)
        END;
      END IF;
    END LOOP;

    BEGIN
      EXECUTE format('INSERT INTO %s (%s) VALUES (%s)',
                     v_rel, array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
    EXCEPTION
      WHEN check_violation OR foreign_key_violation OR unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        SELECT pg_get_constraintdef(oid) INTO v_def
          FROM pg_constraint WHERE conrelid = v_rel AND conname = v_constraint;
        RAISE EXCEPTION 'the test rows break % rule %: %',
          v_rel, v_constraint, coalesce(v_def, '(a unique index)');
      WHEN not_null_violation THEN
        GET STACKED DIAGNOSTICS v_column = COLUMN_NAME;
        RAISE EXCEPTION 'the test rows leave %.% empty, and it is NOT NULL', v_rel, v_column;
      WHEN OTHERS THEN
        RAISE EXCEPTION 'the test rows could not be added to %: % (%)', v_rel, SQLERRM, SQLSTATE;
    END;
  END LOOP;
END $$;

-- Each signed-in portal user gets exactly their own records (linked by
-- auth_uid), with portal access as the patient record says; nobody else
-- gets anything.
DO $$
DECLARE
  v_changed  boolean;
  c          record;
  v_got      text;
  v_dates    integer;
BEGIN
  SELECT count(*) = 1 INTO v_changed
    FROM pg_attribute
   WHERE attrelid = to_regclass('public.patients')
     AND attname = 'portal_enabled_changed_at' AND attnum > 0 AND NOT attisdropped;

  -- patient_portal_users rows do not count until Wave B (the anon key can
  -- still add and activate them on production), so the three portal-account
  -- logins get nothing. Where Wave B's function is already in place, the
  -- migration left it alone and these answers do not apply.
  IF to_regclass('public.patient_portal_access_events') IS NOT NULL THEN
    RAISE NOTICE 'Wave B''s portal_access_status() is in place; the hotfix''s sign-in answers were not checked';
    RETURN;
  END IF;

  FOR c IN
    SELECT * FROM (VALUES
      ('the patient linked by auth_uid, portal on',
       '{"sub":"00000000-0000-4000-8000-00000000c0a1","role":"authenticated"}',
       '00000000-0000-4000-8000-00000000cfa1:true'),
      ('the patient linked by auth_uid, portal off',
       '{"sub":"00000000-0000-4000-8000-00000000c0b2","role":"authenticated"}',
       '00000000-0000-4000-8000-00000000cfb2:false'),
      ('the portal account whose id is the login',
       '{"sub":"00000000-0000-4000-8000-00000000c0c3","role":"authenticated"}',
       ''),
      ('the portal account matched by the phone claim',
       '{"sub":"00000000-0000-4000-8000-00000000c0d4","role":"authenticated","phone":"+2340000000204"}',
       ''),
      ('the portal account named in app_metadata.portal_user_id',
       '{"sub":"00000000-0000-4000-8000-00000000c0e5","role":"authenticated","app_metadata":{"portal_user_id":"00000000-0000-4000-8000-00000000c0e6"}}',
       ''),
      ('a signed-in account with no patient record',
       '{"sub":"00000000-0000-4000-8000-00000000c0f9","role":"authenticated","phone":"+2340000000999"}',
       ''),
      ('a request with no user id',
       '{"role":"authenticated"}',
       '')
    ) AS v(who, claims, expected)
  LOOP
    PERFORM set_config('request.jwt.claims', c.claims, true);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(string_agg(s.patient_id || ':' || s.portal_enabled, ',' ORDER BY s.patient_id), ''),
           count(s.changed_at)
      INTO v_got, v_dates
      FROM public.portal_access_status() AS s;
    RESET ROLE;
    IF v_got <> c.expected THEN
      RAISE EXCEPTION 'portal_access_status() for % returned [%], expected [%]', c.who, v_got, c.expected;
    END IF;
    IF NOT v_changed AND v_dates <> 0 THEN
      RAISE EXCEPTION 'portal_access_status() returned a changed_at for %, but patients has no portal_enabled_changed_at', c.who;
    END IF;
  END LOOP;
END $$;

-- The anon key is refused.
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
DO $$
BEGIN
  PERFORM count(*) FROM public.portal_access_status();
  RAISE EXCEPTION 'anon called portal_access_status()';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- Wave B can replace this function later. Add the two columns
-- 20260925100000 adds (if missing) and run 20260925100100's statement
-- (L492-522, copied as is). Its body also needs patient_portal_users and
-- current_portal_user_id(), which production has; without them this part
-- is skipped (Wave B would fail there for its own reasons).
DO $$
DECLARE
  v_id_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO v_id_type
    FROM pg_attribute
   WHERE attrelid = 'public.patients'::regclass AND attname = 'id' AND NOT attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.patients'::regclass
                    AND attname = 'merged_into' AND NOT attisdropped) THEN
    EXECUTE format('ALTER TABLE public.patients ADD COLUMN merged_into %s', v_id_type);
  END IF;
  ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS portal_enabled_changed_at timestamptz;
END $$;

CREATE TEMP TABLE hotfix_check_before ON COMMIT DROP AS
  SELECT oid, proacl FROM pg_proc WHERE oid = 'public.portal_access_status()'::regprocedure;

DO $wave_b$
BEGIN
  IF to_regclass('public.patient_portal_users') IS NULL
     OR to_regprocedure('public.current_portal_user_id()') IS NULL THEN
    RAISE NOTICE 'no patient_portal_users or current_portal_user_id(): replacement by 20260925100100 not tried';
    RETURN;
  END IF;
  CREATE OR REPLACE FUNCTION public.portal_access_status()
  RETURNS TABLE (patient_id text, portal_enabled boolean, changed_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $$
    SELECT p.id::text,
           COALESCE(p.portal_enabled, false) AND p.merged_into IS NULL,
           p.portal_enabled_changed_at
      FROM public.patients AS p
     WHERE (SELECT auth.uid()) IS NOT NULL
       AND p.auth_uid::text = (SELECT auth.uid())::text
    UNION
    SELECT p.id::text,
           COALESCE(p.portal_enabled, false)
             AND p.merged_into IS NULL
             AND COALESCE(ppu.account_status, 'active') = 'active',
           p.portal_enabled_changed_at
      FROM public.patient_portal_users AS ppu
      JOIN public.patients AS p ON p.id::text = ppu.patient_id::text
     WHERE (SELECT auth.uid()) IS NOT NULL
       AND (
            ppu.id::text = (SELECT auth.uid())::text
         OR ppu.id::text = (SELECT public.current_portal_user_id())
         OR (
              ppu.phone_number IS NOT NULL
          AND ppu.phone_number = NULLIF((SELECT auth.jwt()) ->> 'phone', '')
         )
       );
  $$;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '20260925100100 could not replace the hotfix''s portal_access_status(): % (%)', SQLERRM, SQLSTATE;
END $wave_b$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc AS p JOIN hotfix_check_before AS b ON b.oid = p.oid
                  WHERE p.proacl IS NOT DISTINCT FROM b.proacl) THEN
    RAISE EXCEPTION 'replacing portal_access_status() the way 20260925100100 does changed who may call it';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a1","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.portal_access_status()
       WHERE patient_id = '00000000-0000-4000-8000-00000000cfa1' AND portal_enabled) <> 1 THEN
    RAISE EXCEPTION 'after 20260925100100''s replacement the auth_uid-linked patient is not allowed in';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;

\echo 'portal_access_status hotfix checks passed'
