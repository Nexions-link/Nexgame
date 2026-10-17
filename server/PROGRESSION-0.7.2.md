# NexGameWorld 0.7.2 — isolated server progress foundation

**Status:** developed and tested independently. **NOT connected to the live game,
WebSocket join, account HTTP API, or public save keys.** Old flat saves are never imported.

## Current components

- `progress-rules.js`: canonical inventory validation, equipment ownership,
  server-verified mob rewards, level/XP calculations and conservative movement
  checkpoints. Uses existing `items.js`, `loot-tables.js`, spherical mob roster.
- `progress-store.js`: PostgreSQL transactions with row locking, strict owner
  checks and optimistic `revision` compare-and-swap. No new HTTP endpoints.
- `migrations/003_progress_event_ledger.sql`: additive event ledger with
  unique `(character_id,event_key)`; existing accounts and progress are unchanged.
- `tests/progress-rules.test.mjs`: offline domain checks for forged rewards,
  impossible loot, item conservation, ownership, full bags and checkpoints.
- `tests/progress-postgres.test.mjs`: **disposable PostgreSQL only**. Validates
  exactly-once persistence with repeated/concurrent events, stale revisions,
  rollback, deleted and foreign heroes, equipment operations, and checkpoints.

## Source of truth

Only server-authenticated, server-confirmed actions may call these methods.
Never expose `recordMobKill`, `saveServerCheckpoint`, equip, or arbitrary
progress writes directly as client-submitted API operations. A future
integration must resolve the `accountId` and `characterId` from the
authenticated, bound server-side session; not from a packet.

- Mob event identity is **per character + server world-run UUID + radius + mob ID + respawn life**. The world-run UUID changes when Render restarts, so a new mob life #1 does not collide with a kill from the previous process. Within one server lifetime, repeated credits for the same life remain idempotent.
- XP and gold match the current mob's server-defined values; loot IDs and
  quantities must match that mob's allowed tables.
- The progress lock serializes events; duplicates return without awarding
  anything; stale independent writes fail with `stale_revision`.
- Inventory uses 12 base slots (up to 108 as future bag expansion) and
  the existing item catalog. A full bag aborts the entire reward transaction.
- Equipment can be transferred only from an actual bag slot and observes
  level/slot requirements. No player packet may supply free items.
- Checkpoint saving accepts only server-validated position and heading
  on the existing planet. The game server must first validate movement speed
  and collisions, and throttle checkpoints; this module doesn't do so.
- Quest completion/turn-in and vendor/gather/chest item transfers still need
  dedicated server-side authoritatively verified event producers. They must
  use the same transaction and conservation rules instead of trusting the
  old browser inventory.

## Release gates before connecting the world

1. Validate migration 003 in disposable PostgreSQL, then apply **additive**
   schema to Neon after checking migrations and backups; never clear alpha data.
2. Establish authenticated WebSocket character selection with a single
   active session/lease per character and reconnect handling.
3. Convert server-verified movement, mobs, quests, vendors, harvesting,
   chest and item use to produce authoritative events; prohibit client-authored
   XP/gold/level/inventory/gear and arbitrary heal consumption.
4. Wire outbox or retry-safe durable credit handling so a DB outage never
   silently loses a committed mob kill or creates duplicate loot.
5. Verify character progression end-to-end across Safari refresh,
   concurrent devices, Render restarts, Neon outages and item transactions.
6. Keep the original main game's login-free prototype unchanged until all
   gates pass and the new online mode is released.

**Important:** the progress table's default equipment and inventory are
empty. The browser's former starter axe and healing potion are not magically
migrated into database characters. A future server-only starter_pack event
and initial 12-slot bag initialization must be implemented and audited
before launch. Don't grant arbitrary starter loot from client requests.
