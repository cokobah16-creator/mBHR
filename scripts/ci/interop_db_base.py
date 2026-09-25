#!/usr/bin/env python3
"""Print the SQL a plain PostgreSQL needs before the interop migration can run.

The repository's migration history cannot replay on an empty database (see
docs/interoperability/testing.md), so the interop CI job builds only what
20260926110000_interop_foundation.sql depends on: the Supabase API roles, an
auth.uid() that reads request.jwt.claims (as Supabase's does), a minimal
public.app_users, and the real definitions of the helper functions, copied
from the migration files that define them (the latest definition wins).
"""
import re
import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

PRELUDE = """
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END$$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA auth, extensions, public TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$f$;
CREATE TABLE IF NOT EXISTS public.app_users (
  id text PRIMARY KEY, full_name text NOT NULL, role text NOT NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
"""

FUNCTIONS = [
    ("20260924110000_rls_permission_helpers.sql", "app_current_role"),
    ("20260925100600_registration_lead_portal_invite.sql", "app_role_has_permission"),
    ("20260925100600_registration_lead_portal_invite.sql", "app_is_staff"),
]


def function_sql(file: str, name: str) -> str:
    text = (MIGRATIONS / file).read_text()
    starts = [m.start() for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\." + name + r"\(", text)]
    if not starts:
        sys.exit(f"{name} not found in {file}")
    start = starts[-1]
    body = text.index("AS $$", start) + len("AS $$")
    end = text.index("$$;", body) + len("$$;")
    return text[start:end]


def main() -> None:
    parts = [PRELUDE, (MIGRATIONS / "20260517153407_generic_rate_limits.sql").read_text()]
    parts += [function_sql(f, n) for f, n in FUNCTIONS]
    parts.append(
        "GRANT EXECUTE ON FUNCTION public.app_current_role(), "
        "public.app_role_has_permission(text, text), public.app_is_staff() TO authenticated;"
    )
    print("\n\n".join(parts))


if __name__ == "__main__":
    main()
