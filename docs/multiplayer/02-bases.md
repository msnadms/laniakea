# Bases: habitable worlds and server state

A base is where a player's species lives. It is founded on a habitable world the player found, and it is separate from NPC civilisations: not a civilisation stage, and not placed by the anomaly key.

## Habitable worlds

The generator already makes them rare: the `habitable` ring is usually rolled down to `marginal`. That scarcity is the point.

- **One base per world.** A claimed world is gone for everyone else, so good worlds are contested before any combat.
- **Worlds differ in quality.** Size, moons, ocean coverage and the host star set the population cap and collector rates.
- **Civilisation worlds are off-limits**, including homeworlds and populated worlds.
- **Worlds are public, bases are secret.** Finding a world is ordinary exploration over public seeds. Finding a base is only possible through [scanning](01-scanning.md), since bases are server state.
- **Rendering.** A base draws like a populated world, through `createSettlementLights`, brightening as it grows.

## Phase 1: World quality

- `worldQuality(planet)` in `src/game/`: population cap and collector rates from the planet's size, moons, ocean coverage and host star.
- Tests that every habitable world scores within range and that the ordering matches intuition (larger, wetter, G-hosted worlds score higher).

## Phase 2: Bases as server state

- `users/{uid}/base/current`: world address, founding time, population, stored resources and collector state. Server-written only; extend `firestore.rules`.
- `POST /api/base/found`: checks the world is habitable, unclaimed and not a civilisation's, and that the ship is in that system. Claims `world/bases/claims/{superclusterSeed}-{galaxySeed}-{systemId}-{planet}` in the same transaction.
- A base's position and loudness become a signal source for the listen, bearing and sweep surveys, beside `profileOf`. Bases change, unlike civilisations, so the sky index holds them in Firestore and updates a base's entry when its loudness moves.
- Move the per-player rate limits and sweep locks into Firestore so the API can run on more than one instance.

## Phase 3: Rendering

- A claimed world draws its base's settlement lights, for its owner and for anyone who has found it.
- Other players' claimed worlds show as taken when they are visited, without revealing whose.
