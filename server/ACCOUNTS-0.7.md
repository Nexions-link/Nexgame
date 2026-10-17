# NexGameWorld 0.7.0 — Account foundation (work in progress)

This branch is deliberately **not deployed** to `main`, the live Render
service, or Nexions.ru. The current Alpha 0.6.31 game remains accessible.

## Hosting and data safety
- Existing `nexgame-world` Render **Free** web service runs in Frankfurt;
  Free instances have an ephemeral filesystem and cannot keep permanent
  player data or persistent disks. The current chest file is NOT a durable
  character database.
- A Neon Free PostgreSQL database (`nexgameworld-production`, Frankfurt) has
  been created and the six initial account-related tables have been staged.
  Do not start permanent accounts using a 30-day Free Render PostgreSQL database.
- Connect to PostgreSQL using a server-only `DATABASE_URL` secret, never a
  client-side key. Set up managed point-in-time recovery and an independent
  encrypted off-Render logical backup, then test restoration.
- Running the SQL migration: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/001_accounts_characters.sql`.
  Do not apply without verifying the target database.
- Run foundation tests with `cd server && node --test tests/accounts-foundation.test.mjs`.

## Alpha password policy
- Minimum password length is **8 characters** (previously 12), maximum 128.
- Passwords are salted and hashed; plaintext is never persisted.
- Recommend that players choose a unique password not used for email or other services.

## Clean start for the authenticated online world
- **Every newly registered account starts with zero characters.** The player
  creates a new character at level 1 with the database-defined starting
  experience, inventory, equipment, quests and currency. The existing offline
  character, localStorage data, multiplayer positions and legacy chest do not
  become account characters.
- **There is no legacy import, character claiming, account linking or transfer
  of progress.** Do not add migration UI, save-import endpoints, or server
  logic that copies old progression into the authenticated version.
- The authenticated world must resolve character IDs only from the current
  account's new database records. Still bind that NEW character to its owner
  and authenticated WebSocket session when joining multiplayer; this is not
  linking a legacy character.
- Keep the existing alpha world and old browser/server saves untouched until
  the complete online release, successful verification, and a separate
  scheduled cleanup of obsolete player data. **No deletion now.**
- Scope of later cleanup: archived accounts/characters, offline browser save
  keys, old multiplayer player snapshots and player-related temporary files.
  Do not delete world geometry, assets, NPC or mob data, Atlas, current game
  code, or the fresh online production accounts. Inventory/quests/progress
  that belong to new authenticated characters must survive any cleanup.
- Before cleanup: enumerate each storage location, distinguish old/new
  records, take a restorable backup, check the release, and obtain an explicit
  confirmation for the actual deletion step.

## Identity and character model
- An account owns zero to three characters. Character IDs are independent
  UUIDs, with a global case-insensitive nickname uniqueness constraint.
- A character has `race_id`, `class_id`, and `appearance` already, allowing
  future changes without resetting progression. First alpha permits only
  `hornfolk` warrior; appearance editor is not yet exposed.
- Progress includes level, XP, gold, HP, rage, radius, sphere normal and
  heading, inventory, equipment, quests and action bar.
- Client input must be validated against item/skill/quest catalogs, with
  server-owned changes for rewards, currency, loot and equipment; the raw
  progress JSON may NOT be accepted as an unrestricted client overwrite.
- Concurrent character sessions should use a single active owner/lease or
  revision-aware transactions. Character create enforces the three-slot limit
  inside an account-locked database transaction.
- New character creation must insert a fresh default progress row; reject
  or ignore client-provided `level`, `gold`, XP, inventory, equipment, position
  or any `legacySave` / `import` payload. Never copy old browser data.

## Planned API routes (not active yet)
- `POST /api/ngw/register`: username and password, returns recovery codes once.
- `POST /api/ngw/login`: username and password, returns short-lived session.
  mechanism (no sensitive tokens in query strings).
- `POST /api/ngw/logout`, `GET /api/ngw/me`, `POST /api/ngw/recover`.
- `GET /api/ngw/characters`, `POST /api/ngw/characters`, `GET /api/ngw/characters/:id`.
  `POST /api/characters/:id/select`.
- WebSocket `/ws/nexgameworld` must require a valid authenticated session
  and verify ownership of the selected character before joining. Unauthenticated
  visitors must not receive mutable progress or impersonate a nickname.
- The game runs in a cross-origin iframe when upstream fallback is used:
  account UI should be served from the first-party Nexions.ru portal; do not
  rely on third-party cookies working in iPhone Safari. Use an audited
  cross-origin bearer-session exchange and strict CORS origin allowlist.
- Add rate limiting (IP/account), constant-time verification, secure recovery,
  audit logging without passwords/tokens, and CSRF protections as applicable.
  Recovery codes must be securely generated and shown only once; do not log them.

## Activation gates
1. Durable Neon database provisioned and a separate recoverable backup tested.
2. Auth HTTP handlers, session renewal, and abuse protection integrated.
3. Character-select UI and game startup gate integrated while portal-preview
   globe remains public and unaffected.
4. Server-driven progression, inventory, XP, loot and quests are synced and
   protected against duplicate rewards; new characters start at default values.
5. Two-client integration tests, Safari reload, logout, server restart, and
   live backup restore pass.
6. Release through `Nexgame/main` and portal auto-sync to Nexions.ru.
7. Only after release and verification, plan a **separate** cleanup of legacy
   player data. Do not run destructive SQL or clear browser saves automatically.
