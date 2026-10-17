# NexGameWorld online server

**Active**: WebSocket `/ws/nexgameworld` (protocol 2), health at `/health`.
The flat NexGame WebSocket and world tick are retired. Old server code and tests
remain in Git history and `archive/flat-prototype-0.3.7.1`.

The server owns nine shared dolgonogs (including Stormbeak), damage, aggro,
spherical mob movement, stuns, a 30-second corpse plus a 30-second respawn,
personal kill credits, group invites (5 members), room-scoped world/party chat
and the 18-slot shared chest.

The live chest uses `NGW_CHEST_DATA_FILE`. By default it is placed next to
the old `CHEST_DATA_FILE` so an existing Render persistent disk may be reused.
On startup, old `CHEST_DATA_FILE` is deleted if its path differs from the new
file. `/health` exposes `legacyCleanup` with status `removed`, `not_found`,
`error` or `skipped_same_storage_path`.

Current alpha limits: accounts are absent; browser-reported character level and
equipped items are bounded but not authenticated. Personal inventory, currency,
quests and loot collection are local; the shared chest data is stored server-side.
Render free instances may sleep and non-persistent storage can be lost on deploy.
