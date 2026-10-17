-- NexGameWorld Alpha 0.7.1: durable sign-in and registration throttling.
-- Additive, does not touch world data or existing accounts.
BEGIN;
CREATE TABLE IF NOT EXISTS ngw_auth_rate_limits (
  bucket_key TEXT PRIMARY KEY CHECK (char_length(bucket_key) BETWEEN 6 AND 100),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ngw_auth_rate_limits_last_attempt_idx
  ON ngw_auth_rate_limits(last_attempt_at);
COMMIT;
