-- NexGameWorld 0.7.2: unique proof of mentor quest kill objectives.
-- Evidence is recorded by the trusted PvE server, never by browser payloads.
BEGIN;
CREATE TABLE IF NOT EXISTS ngw_mentor_kill_evidence (
 character_id UUID NOT NULL REFERENCES ngw_characters(id) ON DELETE CASCADE,
 event_key TEXT NOT NULL CHECK (char_length(event_key) BETWEEN 12 AND 128),
 quest_step SMALLINT NOT NULL CHECK (quest_step IN (1,10)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(character_id,event_key)
);
CREATE INDEX IF NOT EXISTS ngw_mentor_evidence_step_idx
 ON ngw_mentor_kill_evidence(character_id,quest_step);
COMMIT;
