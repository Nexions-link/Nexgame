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

## Server-side economy and quests (isolated, not live)

- `economy-rules.js`: prices come **only** from `ITEM_CATALOG` and
  `MERCHANT_STOCK`; herbalist potion price is fixed at 10; selling needs
  real inventory items. Quests, prices, XP and currency are never taken
  from client-supplied claimed values.
- `economy-store.js`: all mutations run in an authenticated-owner-scoped
  progress transaction. Buy/sell and chest transfers also have durable
  UUID idempotency receipts. Retrying the same request cannot transact twice;
  reusing the UUID for a different action is rejected.
- `migrations/004_economy_quests.sql`: one durable 18-slot house chest
  shared across all characters, permanent operation receipts, global resource
  respawn timestamps and database-timed gathering casts. For any shared chest
  mutation, the chest row is locked and saved atomically with the player's
  inventory. A failed transfer rolls back *both sides*.
- Gathering uses the client game's real stage locations and quests from
  `planet-test/gather-world.js`. The actor must have the matching stage active,
  be in range, not be in combat and complete 1.5 seconds on the **DB clock**.
  Nodes then respawn after 32 seconds globally. The three herbalist quests
  require quantities actually held in the player's saved backpack.
  Quest rewards are single-use and recorded in the existing progress ledger.
- `migrations/005_mentor_evidence.sql` records every verified mentor kill
  objective once per character and server-world epoch. The complete existing
  twelve-step mentor chain is mapped to server-confirmed mob kills and
  proximity-confirmed relic/scout interactions. Reward amounts are fixed and
  each hand-in is recorded once in the progress ledger.
- The current vendor and NPC coordinates are preserved from the spherical
  offline game: merchant (6,11), herbalist (8,1), mentor (-1.5,-5),
  house chest (-33.2,-7.4). Quest resource visuals near the lake are
  matched with the original dry-ground adjustment.

**Trust boundary:** `context.normal`, `context.radius` and `context.inCombat`
MUST come from an authenticated, validated **server-controlled world player**;
never forward a browser-supplied interaction context into these methods.
`serverCredit` must come directly from the authoritative PvE kill event.
Proximity checks here do not replace real-time server movement and cast
interruption checks. Before online activation, bind the same server run UUID
to kill rewards and mentor evidence and unify quest kill credit with the
actual mob reward pipeline in one retry-safe operation.

**Chest migration warning:** `server/chest.js` is still the legacy active
multiplayer file-based chest. New `ngw_shared_chests` is separate and empty.
Do not import untrusted browser snapshots, do not leave both chest authorities
active after cutover, and do not delete the old file before the whole online
migration is verified. No old character progress is imported.

**Validation:** GitHub Actions executes pure economy rules and full transaction
tests against a disposable PostgreSQL 16 database. Tests cover purchase price
tampering, wrong owners, stale revisions, receipt replay, competing withdrawals,
full backpacks, shared resource respawn, quest turn-in and the complete mentor
chain. Live Render and the WebSocket are deliberately unchanged.

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
