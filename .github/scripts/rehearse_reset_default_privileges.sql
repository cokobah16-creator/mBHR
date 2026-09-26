-- Run on the local stack just before production's schema is loaded into it.
--
-- A fresh local stack gives every new table, sequence and function that the
-- connecting role (postgres) creates in public to anon, authenticated and
-- service_role. `supabase db dump` writes each object's grants relative to
-- Postgres's own defaults, not those, so it never revokes them: in the copy,
-- a function production keeps to the service role could be run by any
-- signed-in user, and a table production closed to anon was open to it.
-- Without these defaults each object gets exactly production's grants. The
-- dump ends with production's own ALTER DEFAULT PRIVILEGES, which puts the
-- defaults back before any pending migration runs.
-- Only the defaults for public: there they add to Postgres's own, so taking
-- them away leaves exactly what the dump expects. Role-wide defaults replace
-- Postgres's own instead; production has none, and if the local stack ever
-- has some the log says so.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT CASE d.defaclobjtype
             WHEN 'r' THEN 'TABLES'
             WHEN 'S' THEN 'SEQUENCES'
             WHEN 'f' THEN 'FUNCTIONS'
             WHEN 'T' THEN 'TYPES'
           END AS kind,
           string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                    ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
                      ', ') AS grantees
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
     WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND d.defaclnamespace = 'public'::regnamespace
       AND d.defaclobjtype IN ('r', 'S', 'f', 'T')
       AND a.grantee <> d.defaclrole
     GROUP BY 1
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON %s FROM %s',
                   current_user, r.kind, r.grantees);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_default_acl
              WHERE defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                AND defaclnamespace = 0) THEN
    RAISE WARNING 'The local stack has role-wide default privileges for %; grants in the copy may differ from production.', current_user;
  END IF;
END $$;
