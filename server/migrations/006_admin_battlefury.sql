-- A unique item: no copies elsewhere, including if a save is manipulated.
ALTER TABLE ngw_character_progress
 ADD CONSTRAINT ngw_admin_battlefury_exclusive CHECK (
  jsonb_array_length(jsonb_path_query_array(COALESCE(inventory,'[]'::jsonb),
   '$[*] ? (@.id == "adminBattlefury")'::jsonpath)) +
   CASE WHEN equipment->'weapon'->>'id'='adminBattlefury' THEN 1 ELSE 0 END <= 1
  AND (character_id='ccfdf7dc-fdbf-4857-9d9f-5b8b0301fd98'::uuid
   OR (NOT (COALESCE(inventory,'[]'::jsonb) @> '[{"id":"adminBattlefury"}]'::jsonb)
       AND equipment->'weapon'->>'id' IS DISTINCT FROM 'adminBattlefury'))
 );
