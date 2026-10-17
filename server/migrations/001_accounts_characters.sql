-- NexGameWorld Alpha 0.7.0: accounts and character persistence foundation.
-- Apply to a DURABLE PostgreSQL database only. Do not execute on Render's
-- 30-day Free Postgres or on the ephemeral filesystem of the Free web service.
-- No plaintext passwords, sessions or recovery codes may be stored here.
BEGIN;

CREATE TABLE IF NOT EXISTS ngw_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ngw_account_username_length CHECK (char_length(username) BETWEEN 3 AND 24)
);
CREATE UNIQUE INDEX IF NOT EXISTS ngw_accounts_username_lower_unique
  ON ngw_accounts (lower(username));

CREATE TABLE IF NOT EXISTS ngw_sessions (
  token_digest BYTEA PRIMARY KEY CHECK (octet_length(token_digest) = 32),
  account_id UUID NOT NULL REFERENCES ngw_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ngw_sessions_account_idx ON ngw_sessions(account_id);
CREATE INDEX IF NOT EXISTS ngw_sessions_expiry_idx ON ngw_sessions(expires_at);

CREATE TABLE IF NOT EXISTS ngw_recovery_codes (
  code_digest BYTEA PRIMARY KEY CHECK (octet_length(code_digest) = 32),
  account_id UUID NOT NULL REFERENCES ngw_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ngw_recovery_codes_account_idx
  ON ngw_recovery_codes(account_id);

CREATE TABLE IF NOT EXISTS ngw_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ngw_accounts(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 3 AND 24),
  race_id TEXT NOT NULL DEFAULT 'hornfolk',
  class_id TEXT NOT NULL DEFAULT 'warrior',
  appearance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(appearance) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ngw_character_race_length CHECK (char_length(race_id) BETWEEN 2 AND 40),
  CONSTRAINT ngw_character_class_length CHECK (char_length(class_id) BETWEEN 2 AND 40)
);
-- Active character nicknames are unique globally; a later rename or class
-- change does not invalidate the character/account identity (UUID).
CREATE UNIQUE INDEX IF NOT EXISTS ngw_characters_active_nickname_idx
  ON ngw_characters(lower(nickname)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ngw_characters_account_idx
  ON ngw_characters(account_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ngw_character_progress (
  character_id UUID PRIMARY KEY REFERENCES ngw_characters(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 60),
  experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
  gold INTEGER NOT NULL DEFAULT 30 CHECK (gold >= 0),
  health INTEGER NOT NULL DEFAULT 120 CHECK (health >= 0),
  resource INTEGER NOT NULL DEFAULT 0 CHECK (resource BETWEEN 0 AND 100),
  world_radius INTEGER NOT NULL DEFAULT 261 CHECK (world_radius IN (87,174,261)),
  position_normal JSONB NOT NULL DEFAULT '[0,0,1]'::jsonb
    CHECK (jsonb_typeof(position_normal) = 'array' AND jsonb_array_length(position_normal) = 3),
  heading DOUBLE PRECISION NOT NULL DEFAULT 0,
  inventory JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(inventory) = 'array'),
  equipment JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(equipment) = 'object'),
  quests JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(quests) = 'object'),
  action_bar JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(action_bar) = 'array'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ngw_save_imports (
  character_id UUID PRIMARY KEY REFERENCES ngw_characters(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'browser_alpha_0_6',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
