CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'developer' CHECK (plan IN ('internal','developer','commercial')),
  monthly_quota integer NOT NULL DEFAULT 1000 CHECK (monthly_quota >= 0),
  rate_limit_per_minute integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'default',
  scopes text[] NOT NULL DEFAULT ARRAY['products:read','providers:read','usage:read'],
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS usage_events (
  id bigserial PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  route text NOT NULL,
  provider text,
  cache_hit boolean,
  status_code integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_client_date_idx ON usage_events(client_id, created_at DESC);
