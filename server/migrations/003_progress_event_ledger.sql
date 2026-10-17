-- NexGameWorld 0.7.2: server-verified progression, idempotent rewards.
-- Additive. The existing characters and their saved progress are unchanged.
BEGIN;

CREATE TABLE IF NOT EXISTS ngw_progress_events (
  character_id UUID NOT NULL REFERENCES ngw_characters(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL CHECK (char_length(event_key) BETWEEN 12 AND 128),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('mob_kill', 'quest_reward', 'starter_pack')),
  xp_granted INTEGER NOT NULL DEFAULT 0 CHECK (xp_granted BETWEEN 0 AND 100000),
  gold_granted INTEGER NOT NULL DEFAULT 0 CHECK (gold_granted BETWEEN 0 AND 100000),
  loot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(loot)='array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id,event_key)
);

CREATE INDEX IF NOT EXISTS ngw_progress_events_created_idx
  ON ngw_progress_events(created_at);

COMMIT;
