-- NexGameWorld 0.7.2: economy and quest infrastructure, independent of WebSocket.
-- Additive tables only; no legacy player data is imported or removed.
BEGIN;
CREATE TABLE IF NOT EXISTS ngw_shared_chests (
  chest_id TEXT PRIMARY KEY CHECK (chest_id='hearth-house'),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision>=0),
  slots JSONB NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb
    CHECK (jsonb_typeof(slots)='array' AND jsonb_array_length(slots)=18),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ngw_shared_chests(chest_id) VALUES('hearth-house')
ON CONFLICT(chest_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ngw_economy_receipts (
  character_id UUID NOT NULL REFERENCES ngw_characters(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('merchant_buy','merchant_sell','chest_deposit','chest_withdraw')),
  payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest)=32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(character_id,request_id)
);
CREATE INDEX IF NOT EXISTS ngw_economy_receipts_created_idx ON ngw_economy_receipts(created_at);

CREATE TABLE IF NOT EXISTS ngw_gather_nodes (
  node_id TEXT PRIMARY KEY CHECK (node_id ~ '^gather:[1-3]:[0-9]+$'),
  ready_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ngw_gather_casts (
  character_id UUID PRIMARY KEY REFERENCES ngw_characters(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL CHECK (node_id ~ '^gather:[1-3]:[0-9]+$'),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+INTERVAL '20 seconds')
);
COMMIT;
