# Shared universe: server/client split and secret anomaly key

This plan assumes only that everyone shares one universe. It doesn't commit to an RTS, combat or an economy. It builds the pieces any shared universe needs: a trusted server, a hidden map of civilisations, and resources the client can't forge. Colyseus rooms are left as a thin last phase.

## The rule that drives everything

The universe's geometry stays public, but its secrets do not.

- **Public, still generated on the client:** universe, superclusters, galaxies, stars, planets, the sky. These are the heavy parts, and they're not worth hiding.
- **Secret, decided on the server:** where civilisations are, what stage each one reached, which worlds are populated, and where black holes are.

## Phase 0: Service scaffold

- Add `server/` with its own `package.json` and tsconfig: Colyseus plus Express, `firebase-admin`, run with `tsx` in dev.
  - It imports `src/game/` directly. Nothing there depends on Pixi or the DOM (`d3-delaunay` runs fine in Node).
  - Add an ESLint boundary rule so nothing under `src/` can import `server/`.
- Every route verifies the Firebase ID token (`Authorization: Bearer …`) with `admin.auth().verifyIdToken`.
- The client gets a small `src/net/api.ts` (fetch plus token). `npm run dev:server` runs beside `npm run dev`, and Vite proxies `/api`.
- Hosting: Fly.io or Cloud Run. Both take websockets later, and Fly handles Colyseus's sticky sessions more simply.

## Phase 1: Secret anomaly key

**Why a keyed hash, not an XOR salt.** Swapping `CIVILIZATION_SALT` for a secret 32-bit number doesn't work. Once a player has found one civilisation, they can try all 2^32 salts offline in minutes and recover every civilisation. The secret has to be a 256-bit key used in HMAC-SHA256 (`node:crypto`), which is safe to expose outputs from.

**Roll civilisations per supercluster.** Today's `superclusterMayHoldCivilization` hashes every possible dot index, about 40k per supercluster. That's fine as a cheap inlined hash, but far too slow with HMAC across thousands of superclusters per sweep. The fix:

- Roll once per supercluster: `HMAC(key, "civ", scSeed)` gives (a) whether it holds a civilisation, at about 1 in 50, and (b) which dot index `k` it sits at, over `SC_MAX_GALAXY_DOTS`. An index past the real dot count means no civilisation, which is the same superset logic already in use.
- The chance of two civilisations in one supercluster is already about 0.02%, so this is practically the same distribution. Pre-release policy allows the generator change. Retune the rate with the `ANOMALY_ODDS` test.
- Sweeps do about 40,000× less hashing per supercluster, which matters once the server pays for every player's sweeps.

**Hand the client seeds, not results.** Change `generateAnomalies(galaxy)` to `generateAnomalies(galaxy, seeds: AnomalySeeds)`, where:

```ts
interface AnomalySeeds { civilization: number | null; blackHoles: number; populated: number }
```

- A server-only `deriveAnomalySeeds(key, scSeed, galaxySeed)` fills it from HMAC outputs. `civilization` is `null` unless this galaxy is the supercluster's dot `k`.
- `src/game/anomalies.ts` stays pure and never sees the key. The client still runs the placement code itself, so the galaxy, system and Codex rendering paths don't change. The response is three numbers, and knowing them tells you nothing about any other galaxy.
- `hasCivilization`, `civilizationProfile` and `superclusterMayHoldCivilization` move to `server/src/anomalyKey.ts` and take the key.
- Tests pass a fixed test key. `findCivilizationSeeds` takes the key too.

**Client changes:**

- `GET /api/galaxy/:scSeed/:galaxySeed/anomaly-seeds`. The server records this as the player's current galaxy (used in Phase 3) and rate-limits it with a per-user token bucket. Otherwise walking every galaxy through the endpoint becomes a way to search.
- `gameStore`: `makeGalaxy` sets `galaxyAnomalies` to empty and fills it when the seeds arrive. Start the fetch on the dot tap, so the zoom animation covers the network time. Cache results by galaxy seed.
- `Supercluster.tsx` civilisation tint: it can no longer come from `hasCivilization`. Tint only galaxies the player has catalogued a civilisation in, taken from `anomalyStore`.
- `Codex.tsx` `populatedWorldIds`: read from cached seeds, fetched when a galaxy row expands.
- `anomalyDebug.ts`: becomes a dev-only server route (`/api/debug/...`, enabled by an env flag), or is removed.

**Key handling:** set `ANOMALY_KEY` (32 random bytes) as a server env secret, never in the repo, with a separate dev key in `server/.env.local`. If the key leaks, rotate it, which re-rolls every civilisation. Pre-release, that's acceptable.

## Phase 2: Probe sweeps move to the server

- Split `src/pixi/scanRun.ts` into:
  - A pure `src/game/scanSurvey.ts`: the chunk walk, stride sampling, graph building and `mergeSignals`. It takes an injected `profileOf(scSeed) → { index, profile } | null`.
  - A client shell that only animates progress and draws results.
- `POST /api/scan { scope, anchor, radius, superclusterSeed? }`. In one Firestore transaction the server:
  1. Recomputes `scanCost` (shared code) and rejects the sweep if the balance is short.
  2. Deducts negative-energy condensate.
  3. Runs the survey. Its cache of recently generated universe chunks stays warm across all players.
  4. Writes `users/{uid}/scans/{id}` and returns the `ScanFinding`.
- The client keeps aiming, the live cost preview (`scanCost` is pure) and all drawing. `scanStore.progress` eases along while the request is in flight. Streaming real progress can wait until a websocket exists.
- Big universe sweeps go to a `worker_threads` pool so they don't stall other requests. Add a per-user limit on concurrent sweeps.

## Phase 3: The server owns negative-energy condensate and cataloguing

- The balance moves out of `settings.condensate` into `users/{uid}/ledger/state`, which the client can read but only the server writes. Add an append-only `ledger/entries` log (sweep costs, homeworld awards) for debugging.
- `useAnomalyWatcher` stops writing anything itself and calls `POST /api/catalogue { scSeed, galaxySeed, systemId }`. The server:
  - Accepts only the player's current galaxy, recorded in Phase 1. Without that check the endpoint becomes a way to probe for anomalies.
  - Regenerates the galaxy, checks that the host really is an anomaly, and writes the anomaly record.
  - Awards `CONDENSATE_PER_HOMEWORLD` once per (player, anomaly), tracked in `ledger/awarded/{key}`. Forgetting a Codex entry deletes the record, so the award ledger can't live there: today, forget-then-revisit farms negative-energy condensate.
- The Settings "grant" row becomes a dev-only route.
- **Firestore rules**: right now `firestore.rules` lets the client write anything under `users/{uid}`. Tighten it:
  - The client can still write `settings` (navigation and display fields) and `discoveries`.
  - `scans`, `anomalies`, `ledger` and the global `world/*` collection become read-only for clients (reads still limited to the owner where appropriate).
  - Clients can still delete their own `scans` and `anomalies`, so Codex forget keeps working.

## Phase 4: First shared feature

This is the smallest step that makes the universe feel shared, with no real-time networking.

- On cataloguing, the server writes `world/anomalies/{key}` with `firstBy`, `firstAt` and `count`, readable by everyone.
- `AnomalyPanel` shows "First catalogued by …, N explorers since". Ask players for a display name rather than showing their Google name.

## Phase 5 (optional): Presence rooms

- A Colyseus `GalaxyRoom` per galaxy seed, created when someone enters and disposed when the room empties, joined using the same Firebase token.
- Synced state is only which players are in the galaxy and which star each is at. It renders as a marker layer projected like `anomalySigns.ts`.
- This answers the real design question, whether seeing another explorer out there feels like anything, before committing to any RTS mechanics.

## Open decisions, with defaults

| Question | Default |
|---|---|
| Should black holes be secret too? | Yes. It costs nothing extra, and they're collectibles. |
| Is travel still free and instant? | Yes for now, but the server records position, so travel time or cost can be added later without a rewrite. |
| Keep Firestore or switch to Postgres? | Keep Firestore through Phase 4. Revisit when there's shared world state that changes often (units, territory). |
| Is a player's scan heat private? | Yes, per player. Sharing scans is a later design choice. |

## Order

Do Phase 1 first: every later phase relies on the server being the only party that knows where civilisations are.

One visible side effect of Phase 1: the supercluster view loses its civilisation tint for galaxies the player hasn't catalogued yet. Most of the plan just moves client-only logic behind the server, but that one changes what players see.
