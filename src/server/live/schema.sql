-- Live-mode data layer. Idempotent: safe to apply more than once.
-- Counts and costs only; no company data is ever stored here.

CREATE TABLE IF NOT EXISTS invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text UNIQUE NOT NULL,
  label text UNIQUE NOT NULL,
  max_runs int NOT NULL CHECK (max_runs >= 0),
  mode text NOT NULL DEFAULT 'synthetic' CHECK (mode IN ('synthetic', 'live')),
  runs_used int NOT NULL DEFAULT 0,
  disabled boolean NOT NULL DEFAULT false,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- Upgrade path for tables created before the per-code mode existed.
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'synthetic'
  CHECK (mode IN ('synthetic', 'live'));

CREATE TABLE IF NOT EXISTS live_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code_id uuid NOT NULL REFERENCES invite_codes(id),
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'budget_exhausted', 'released')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  searched int,
  enriched int,
  provider_cost_usd numeric(10,4),
  model_cost_usd numeric(10,4),
  error_category text
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- Live mode is OFF until switched on.
INSERT INTO settings (key, value) VALUES ('live_enabled', 'false')
  ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS rate_hits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
