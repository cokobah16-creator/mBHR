/*
  # SMART-on-FHIR + Backend Services OAuth schema

  TEFCA QHIN Phase C-1.

  Backs the new tefca-oauth edge function:
    GET  /.well-known/smart-configuration
    GET  /.well-known/openid-configuration
    GET  /.well-known/jwks.json
    POST /oauth/token   — client_credentials with private_key_jwt (RFC 7523)

  Phase C-2 will add /oauth/authorize (authorization_code + PKCE) and
  /oauth/register (dynamic client registration). Refresh tokens, IAS app
  support, and the IDP-issued id_token live there too.

  Tables
    oauth_clients              registered clients (QHIN partners + IAS apps)
    oauth_access_tokens        active bearer tokens (token_hash, scopes, exp)
    oauth_authorization_codes  authorization code grants (Phase C-2)
    oauth_refresh_tokens       refresh tokens (Phase C-2)
    oauth_signing_keys         server-side signing keypairs (ES256)

  Security
    - All tables have RLS enabled.
    - service_role has full access (the edge function uses the service-role key).
    - oauth_signing_keys.private_key_pem is a placeholder for later encryption.
      A follow-up should pgsodium-encrypt this column or move it to Supabase Vault.
*/

CREATE TABLE IF NOT EXISTS oauth_clients (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                text UNIQUE NOT NULL,
  client_name              text NOT NULL,
  client_type              text NOT NULL CHECK (client_type IN ('backend-services','public','confidential')),
  redirect_uris            text[] DEFAULT '{}',
  jwks                     jsonb,
  jwks_uri                 text,
  token_endpoint_auth_method text NOT NULL DEFAULT 'private_key_jwt'
                             CHECK (token_endpoint_auth_method IN (
                               'private_key_jwt','client_secret_basic','none'
                             )),
  allowed_scopes           text[] NOT NULL DEFAULT '{}',
  qhin_partner_id          text REFERENCES tefca_qhin_partners(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','suspended','revoked')),
  contact_email            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_clients_jwks_or_uri_required
    CHECK (
      token_endpoint_auth_method <> 'private_key_jwt'
      OR jwks IS NOT NULL
      OR jwks_uri IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_status ON oauth_clients(status);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_qhin_partner ON oauth_clients(qhin_partner_id);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text UNIQUE NOT NULL,
  client_id       text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scope           text NOT NULL,
  subject         text,
  qhin_partner_id text REFERENCES tefca_qhin_partners(id) ON DELETE SET NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  ip_address      text
);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_client
  ON oauth_access_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expiry
  ON oauth_access_tokens(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code                  text PRIMARY KEY,
  client_id             text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri          text NOT NULL,
  scope                 text NOT NULL,
  code_challenge        text,
  code_challenge_method text CHECK (code_challenge_method IN ('S256','plain')),
  user_id               text,
  patient_id            text,
  expires_at            timestamptz NOT NULL,
  used_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash text PRIMARY KEY,
  client_id  text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scope      text NOT NULL,
  subject    text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_signing_keys (
  kid             text PRIMARY KEY,
  algorithm       text NOT NULL DEFAULT 'ES256' CHECK (algorithm IN ('ES256','RS256')),
  private_key_pem text NOT NULL,
  public_jwk      jsonb NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  rotated_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_oauth_signing_keys_active
  ON oauth_signing_keys(active) WHERE active = true;

COMMENT ON COLUMN oauth_signing_keys.private_key_pem IS
  'PEM-encoded private key. SECURITY: pgsodium-encrypt or move to Vault before production.';

ALTER TABLE oauth_clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_signing_keys          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'oauth_clients',
    'oauth_access_tokens',
    'oauth_authorization_codes',
    'oauth_refresh_tokens',
    'oauth_signing_keys'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = t AND policyname = 'service_role manages ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        'service_role manages ' || t, t
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oauth_clients' AND policyname = 'Admins read oauth_clients'
  ) THEN
    CREATE POLICY "Admins read oauth_clients"
      ON oauth_clients
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = auth.uid()::text
          AND app_users.role = 'admin'
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION oauth_clients_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_oauth_clients_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_oauth_clients_touch_updated_at
      BEFORE UPDATE ON oauth_clients
      FOR EACH ROW EXECUTE FUNCTION oauth_clients_touch_updated_at();
  END IF;
END $$;

COMMENT ON TABLE oauth_clients IS
  'Registered SMART/SMART-Backend-Services clients (QHIN partners and IAS apps)';
COMMENT ON TABLE oauth_access_tokens IS
  'Active bearer tokens issued by /oauth/token. token_hash is sha-256 of the raw token.';
COMMENT ON TABLE oauth_signing_keys IS
  'Server-side signing keypair store. ES256 by default, RS256 supported.';
