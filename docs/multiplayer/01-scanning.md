# Scanning: finding a signal across the universe

Players start uniformly over the whole universe, so the nearest base is usually thousands of Mly away. Today's sweeps cannot reach that far. This plan adds a long-range search that finds a direction first and a volume last, and makes each stage a skill.

It ships before bases exist: NPC civilisations are the first signal sources, and bases join them later (see [Bases](02-bases.md)).

## The problem in numbers

With uniform starts, the typical distance to the nearest base is:

| Players | Nearest base | Chance a 1,000 Mly sweep holds any base |
|---|---|---|
| 100 | ~9,000 Mly | ~0.1% |
| 1,000 | ~4,000 Mly | ~1% |
| 10,000 | ~1,900 Mly | ~10% |
| 100,000 | ~900 Mly | ~60% |

`SCAN_UNIVERSE_MAX_RADIUS` is 1,000 Mly, so spheres alone would be blind guessing below tens of thousands of players.

## Signal sources

- **Strength** falls off with distance and rises with the source's loudness, so a faint signal is either a quiet source nearby or a loud one far away.
- **Civilisations** are loud by stage tier, one tier louder while living, the way `mergeSignals` already ranks them.
- **Bases** are loud by the loot they hold (see [Base economy](04-base-economy.md)). A shielded base is silent.
- **Unsettled ships** are silent.

## The search

### 1. All-sky listen

- One cheap scan returns the whole sky's signal strength by direction, at 20–30° cells.
- Drawn as an overlay on the CMB backdrop, which `cmbShell.ts` already shades per direction.
- It carries no distance.

### 2. Bearings

- Aim a cone at a warm patch. A narrower cone costs more and returns a sharper direction.
- A bearing carries no distance either.

### 3. Triangulation

- Fly the ship elsewhere and take the bearing again. Where the cones cross is the source.
- Range error goes as distance² × angular error ÷ baseline. A source 4,000 Mly away read to 2° from a 1,000 Mly baseline is pinned to about ±550 Mly, inside one sweep, for about 5 negative-energy condensate of flight.
- Baselines perpendicular to the bearing work best. Knowing that is the skill.

### 4. Closing in

- A universe sweep narrows the fix to a supercluster.
- A supercluster sweep narrows it to a galaxy.
- A new galaxy sweep narrows it to the system.

## Decoys that parallax

The listen and bearing decoys are correlated with where the listener stands, not only with where the signal sits. A real source triangulates: bearings from two places cross at one point. A false signal moves when the listener moves, and its bearings never agree. Telling them apart takes a second bearing, not trust in the heat.

The existing sweep decoys (`decoyHeat`) are unchanged.

## Tuning against player count

- **Signal reach** is a server value, set so a typical player hears a handful of sources, never none and never hundreds. With uniform placement it shrinks as the player count grows.
- **`FUEL_PER_MLY` and tank capacity** follow the same curve. A full tank of 50 reaches 10,000 Mly, which fits 1,000 players and is too tight for 100.
- **While the universe is empty**, NPC civilisations fill the sky so there is always something to hear.

## Phase 1: Search prototype (no UI)

Pure logic in `src/game/`, with vitest simulations.

- `skyListen(listener, sources, noiseSeed) → SkyMap`: strength per direction cell, with listener-correlated decoys.
- `takeBearing(listener, direction, halfAngle, sources) → Bearing`: a noisy direction whose angular error narrows with the cone.
- `triangulate(bearings) → { centre, radius } | null`: the crossing of two or more cones.
- Costs for a listen and a bearing, beside `scanCost`.
- A simulated searcher that places sources uniformly, listens, takes two bearings on the strongest patch, sweeps the crossing, and reports the negative-energy condensate spent and whether it found a source. Run it at 100, 1,000 and 10,000 sources.
- A test that a decoy's bearings from two positions never cross within tolerance, and a real source's always do.

Exit: a typical search at 1,000 sources finds one for a sensible share of one tank, and a careless searcher (short, parallel baselines) pays clearly more than a careful one.

## Phase 2: Server routes

Only the server knows where sources are, so listening and bearings run there like sweeps do.

- `POST /api/listen` and `POST /api/bearing`: price with the shared costs, settle the harvest, refuse an unaffordable scan, then survey in the sweep pool and deduct in one transaction.
- The listen survey cannot walk every supercluster in the universe. Civilisations need a sky index: the server keeps a coarse table of civilisation positions and loudness per region, built once per key from `rollSupercluster`, so a listen reads the table rather than rolling millions of superclusters.
- Findings are kept in `users/{uid}/scans` beside sweep findings: a listen's sky map, and each bearing's origin, direction and angular error.
- Rate limits as for sweeps.

## Phase 3: Listening UI

- A listen button in scan mode in the universe view, and the sky map overlaid on the CMB.
- Aiming a bearing: a cone dragged from the ship toward a patch, with its cost shown as it narrows.
- Bearings drawn as cones through the universe, their crossing highlighted, and a sweep that can be anchored on the crossing.
- `ProbePanel` explains the sky map's ramp as `HeatLegend` does for sweeps.

## Phase 4: Galaxy sweep

- A sweep in the galaxy view that resolves a signal to its system, following the supercluster sweep's rules: it records only when it heard something, and crosshairs the star.

## Phase 5: Documentation

- Update CLAUDE.md's **Probe scan** section with listening, bearings, triangulation and the galaxy sweep.
