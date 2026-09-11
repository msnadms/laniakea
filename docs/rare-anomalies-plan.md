# Rare Anomalies Plan

## Goal

Add five rare finds to exploration: **black holes**, **ruined Dyson spheres**, **Matrioshka
brains**, **Nicoll-Dyson beams** and **Shkadov thrusters**. Each one is:

- **placed by rules**, not by a flat roll, so players can learn where to look;
- **visible one level up** as a subtle sign in the galaxy view, so a sharp-eyed player can go
  straight to it instead of searching every star;
- **rendered in the system view** as its own structure;
- **catalogued** in a permanent Anomaly Archive when found.

The four megastructures all belong to a single lost civilisation per galaxy, so they cluster
and point at each other. That lets one find lead to the next.

Implement phases in order. Every phase should leave the app usable.

---

## Invariants (existing saves)

Existing discovery records point at systems by id, name and seed, so these must hold
throughout:

1. `generateGalaxy`, `generateSystemLayout`, `generatePlanets` and `generateSupercluster` keep
   their exact RNG sequences. The identity and geometry digests in `galaxyGen.test.ts` must
   pass without being re-baselined.
2. An anomaly never changes its host system's data: star type, size, colour, seed or planets.
   Every difference is applied when rendering. Planet names and Codex records stay identical
   to what existing saves recorded.
3. Anomaly generation uses its own RNGs, with new XOR constants that appear nowhere else in
   `src/` (checked: `0x6c8e9cf5`, `0x3c6ef372`, `0x165667b1` are unused).
4. Found anomalies are stored in a new `users/{uid}/anomalies` collection. `discoveries` and
   `settings` are not touched. The existing rule for `users/{userId}/{document=**}` already
   covers it.
5. The Milky Way hosts no anomalies, so Sol and the hand-authored nearby systems stay as they
   are.

---

## Current-state findings

1. **`StarSystem` doesn't record its population.** `generateGalaxy` tracks
   bulge/disk/arm/bar/halo/starburst in a local array and throws it away. The placement rules
   need it. Adding a `population` field costs no RNG draw. However, the Milky Way override
   replaces the whole system object with `NEARBY_SYSTEMS_DATA`, so it has to carry the field
   across explicitly.
2. **Galaxy-view stars have no room for extras.** `StarNode` draws only a sprite and a visited
   ring, and `orient()` in `GalaxyWorld` writes their transforms through
   `applyStarProjection`. Signs need their own overlay, re-projected in the same `orient()`
   call and animated in the same tick.
3. **Picking already works for anomalies.** `pickStar` resolves taps to host stars, and every
   anomaly sits on a host star, so no picking changes are needed.
4. **The system view depth-sorts everything.** `SolarSystem` builds all bodies in one effect,
   and `depthScene` sorts by projected depth with the star at `zIndex = 0`. A shell can be
   split into back and front halves at `±r · sinTilt`, the same way moon orbits are.
5. **The system camera only frames planets.** `createSystemCamera` / `getSystemExtent` only
   account for planets and moons. A black hole on a wide orbit needs the extent widened.
6. **Size budget for shells.** The sun's radius is `system.size * 120` (about 90–240), and the
   innermost planet orbits at 380–500 (200–280 for neutron stars). Shells must fit between the
   two.
7. **No toast component survived the gameplay rip-out.** One is needed for "anomaly
   catalogued".
8. **The Codex already derives badges per row.** It computes the habitable dot for each row
   with `generateSystemLayout`. Anomaly badges can use the same pattern, reading from the
   anomaly records.
9. **Supercluster dots can be re-tinted.** Their particles get a tier tint when built, and
   colour is a dynamic property, so a few hundred dots can be re-tinted per frame at no real
   cost.

---

## Placement rules

### The civilisation

`generateAnomalies(galaxy)` rolls for a civilisation first. **That roll must be the first draw
of the civilisation RNG**, so `hasCivilization(galaxySeed)` can answer from the seed alone,
without generating the galaxy. The supercluster sign in Phase 6 depends on this.

If the roll succeeds, the civilisation gets a **home region**: its centre is an eligible G or K
star in the disk, bar or outer arm, with a radius of about `0.25 · GALAXY_RADIUS`. The
megastructures are then placed relative to that region.

| Anomaly | Tier | Chance | Host rule |
|---|---|---|---|
| **Ruined Dyson sphere** | Relic | 1–3 in every civilisation galaxy | F/G/K star inside the home region. Never in the bulge or a starburst, and never an A star (too short-lived). Hosts nearer the centre are more likely. |
| **Shkadov thruster** | Relic | 40% of civilisation galaxies | F/G/K star outside the home region, among the top 5% of stars by distance from the disk plane (relative to their population's scale height), preferring those nearest the region. The star was pushed away from home, and it shows. |
| **Nicoll-Dyson beam** | Relic | 30% of civilisation galaxies | F/G/K star on the region's rim (0.8–1.2 × radius). The beam points at the Matrioshka brain if there is one, otherwise at the region centre. |
| **Matrioshka brain** | Mythic | 12% of civilisation galaxies with at least 2 Dyson spheres | The K star nearest the region centre, where the civilisation ended. |

### Black holes

Black holes are **independent of civilisations** and use their own RNG. The rule is **they only
form where neutron stars have gathered**: a candidate host is a non-L, non-N star within
`0.12 · GALAXY_RADIUS` of a neutron star, with a per-candidate chance. Galaxies without neutron
stars have no black holes. Neutron stars are already a visible star class, so the rule can be
learned. Each black hole also rolls whether it's **quiescent** or **active** (bright disk and
jets).

### Shared rules

- One anomaly per host.
- Hosts are never L or N stars, and never in the Milky Way.
- Each anomaly carries a seed made from `galaxySeed ^ (hostId * 0x165667b1)`. Its visual
  details (integrity, orientation, variant) come from that seed, so a system always looks the
  same.

### Starting rates (to calibrate)

| | Target |
|---|---|
| Civilisation galaxies | ~5% |
| At least one black hole | ~30% of galaxies |
| Ruined Dyson sphere | ~1 in 20 galaxies, then 1–3 among ~500 stars |
| Shkadov thruster | ~1 in 50 galaxies |
| Nicoll-Dyson beam | ~1 in 65 galaxies |
| Matrioshka brain | ~1 in 250 galaxies |

Put all rates in `constants.ts`.

---

## Data model

`src/game/anomalies.ts`:

```ts
export type AnomalyKind = 'blackHole' | 'dysonSphere' | 'matrioshkaBrain' | 'nicollDysonBeam' | 'shkadovThruster';

export interface Anomaly {
  kind: AnomalyKind;
  hostId: number;
  seed: number;
  integrity: number;
  direction: { x: number; y: number; z: number } | null;
  active: boolean;
}

export interface Civilization { x: number; y: number; radius: number }

export interface GalaxyAnomalies {
  civilization: Civilization | null;
  byHost: ReadonlyMap<number, Anomaly>;
}

export function hasCivilization(galaxySeed: number): boolean;
export function generateAnomalies(galaxy: Galaxy): GalaxyAnomalies;
```

- **Integrity** is how much of the structure survives: 0.25–0.6 for Dyson spheres, 0.5–0.8 for
  Shkadov mirrors, 0.85–0.97 for the brain.
- **Direction** means different things per kind: for a beam, the plane direction it points;
  for a thruster, where the star is heading.
- **Where it lives:** `gameStore` holds `galaxyAnomalies` next to `galaxy`, recomputed in every
  branch that calls `makeGalaxy` (initial state, `regenerateGalaxy`, and
  `restoreGalaxyAndSystem` when the seed changes). `generateGalaxy` itself stays untouched.

---

## Phase 1: Generation and tests (no UI)

1. **Add `population`.** Add it to `StarSystem` in `generateGalaxy`, and carry it through the
   `NEARBY_SYSTEMS_DATA` override.
2. **Write the generator.** Write `anomalies.ts` following the rules above, with
   `hasCivilization` using the first civilisation-RNG draw.
3. **Store it.** Add `galaxyAnomalies` to `gameStore`.
4. **Write `anomalies.test.ts`:**
   - the same seed gives the same result, and `generateAnomalies` doesn't mutate the galaxy
     (digest it before and after);
   - `hasCivilization(seed)` agrees with `generateAnomalies(...).civilization !== null`;
   - every host satisfies its kind's rule (class, population, region, height, neutron-star
     distance);
   - there's at most one anomaly per host, and none in the Milky Way;
   - beams point at the brain or the region centre, within tolerance;
   - `galaxyGen.test.ts` still passes unchanged.
5. **Add an odds report.** `anomalies.odds.test.ts` is skipped unless `ANOMALY_ODDS=1`. It
   samples ~3,000 galaxy seeds and prints the per-kind frequencies against the targets above.
   Tune the constants until they match.

## Phase 2: Catalogue plumbing

1. **Store.** `src/store/anomalyStore.ts` holds `records: Record<string, AnomalyRecord>` keyed
   by `${galaxySeed}-${systemId}`, plus `latest` for the toast, with `add` and `setAll`.
   `AnomalyRecord` holds kind, supercluster seed/name, galaxy seed/name, system id/name and
   `discoveredAt`.
2. **Firestore.** `src/firebase/anomalies.ts` provides `saveAnomalyDiscovery` and
   `loadAnomalies`. `initAuth` loads records in its existing `Promise.all`, and calls `setAll`
   **before** `restoreGalaxyAndSystem`, so restoring into a host system doesn't show the toast
   again.
3. **Detection.** `useAnomalyWatcher` is mounted in `App`. It subscribes to `gameStore.system`,
   and when the system is a host that hasn't been recorded, it records it and sets `latest`.
   That covers galaxy taps, Codex travel and restores in one place.
4. **Toast.** `AnomalyToast` is a line-style banner above `ShipHUD`, e.g. `ANOMALY CATALOGUED ▸
   Ruined Dyson Sphere`, that dismisses itself after 5 seconds. It shows on first discovery
   only.
5. **Panel.** `AnomalyPanel` follows the `PlanetPanel` pattern, opened by `uiStore.anomalyPanelOpen`.
   It shows the name, tier, integrity, lore and survey notes. Until Phase 3, a HUD line in the
   system view opens it, so this phase works before any visuals exist.
6. **Codex forget.** Forgetting removes anomaly records along with what was forgotten: a system
   removes its own record, and a galaxy or supercluster removes every record inside it. Removal
   happens both locally (`anomalyStore.remove*`) and in Firestore, wired into the same Codex
   handlers that already call `deleteSystemDiscovery` / `deleteGalaxyDiscovery` /
   `deleteSuperclusterDiscovery`. Revisiting a forgotten host catalogues it again and shows
   the toast again.

## Phase 3: System-view visuals

Code lives in `src/pixi/anomalies/`, with one builder per kind behind a shared interface:

```ts
interface AnomalyVisual {
  nodes: Container[];
  extent: number;
  starAlpha: number;
  coronaAlpha: number;
  update(dt: number, elapsed: number, basis: ProjectionBasis): void;
  destroy(): void;
}
```

`SolarSystem` builds the visual after the star. It adds `nodes` to `depthScene`, scales the sun
sprite and corona by `starAlpha` / `coronaAlpha`, and calls `update` from `onTick`.
`ProjectionLayout` gets an optional `extraExtent` so `getSystemExtent` / `createSystemCamera`
can frame the visual. Each node gets a `hitArea` that opens `AnomalyPanel`, the same way
planets do.

**Shared geometry.** `shellLattice.ts` builds panel centres on a sphere or a spherical cap, and
removes panels by integrity using a seeded, **clustered** mask, so gaps look like tears rather
than salt-and-pepper. `drawProjectedPanels` projects them each frame into a back `Graphics`
(depth < 0) and a front `Graphics`, redrawn each frame. Budget: at most ~600 quads per
structure. Check frame time on the largest case.

Build them in this order, since each reuses the one before:

1. **Ruined Dyson sphere**
   - **Shell:** a lattice at `sunRadius · 1.5` turning slowly around the system's vertical
     axis.
   - **Back panels:** dark silhouettes against the star.
   - **Front panels:** dim outer faces with a faint rim light.
   - **Debris:** 20–40 loose panels drifting on eccentric orbits.
   - **Star:** corona alpha × `1 - 0.5 · integrity`.
2. **Matrioshka brain**
   - **Shells:** 3–5 nested lattices, from `sunRadius · 1.3` out to 0.8 × the innermost planet
     orbit. Inner shells show only through gaps in the outer ones.
   - **Colour:** ember, fading to deep red outward (waste heat).
   - **Motion:** a few slow arcs of brightening panels sweep across the outer shell, like
     thought.
   - **Star:** no corona, sun sprite alpha around 0.08, nebula glow tinted dull red.
3. **Shkadov thruster**
   - **Mirror:** a cracked spherical cap (half-angle ~60°) at `sunRadius · 2.2`, fixed on the
     side given by `direction`. It's a statite, so it doesn't rotate.
   - **Plume:** extra corona rays packed into a cone on the opposite side.
4. **Nicoll-Dyson beam**
   - **Swarm:** ~300 collector points on several inclined orbits.
   - **Lens:** a bright node offset along the beam axis.
   - **Beam:** a tapered, additive line from the lens to 3 × the system extent. It sputters
     in irregular pulses rather than burning steadily, because it's ruined.
5. **Black hole**
   - **Orbit:** a companion at 1.3 × the planet extent, on a Kepler speed like the planets.
     This is where `extraExtent` is needed.
   - **Body:** a black event horizon with a thin additive photon ring.
   - **Disk:** the accretion disk is a particle ring in a squash container (the asteroid-belt
     technique), split into back and front halves around the horizon.
   - **Active variant:** a brighter disk, plus two flickering jets whose endpoints are
     projected with `projectSystemPointWithBasis`.
   - **Stretch goal:** a lensing distortion on nearby background stars.

## Phase 4: Galaxy-view signs

`src/pixi/anomalySigns.ts` builds a sign container per galaxy and adds it to `galaxyRoot`. It
exposes `project(basis)`, called from `orient()`, and `tick(elapsed, cameraScale)`, called from
the existing tick. Signs fade in above `ANOMALY_SIGN_MIN_SCALE`, so zooming in and scanning is
rewarded.

| Anomaly | Sign |
|---|---|
| Ruined Dyson sphere | The host star is drawn dimmer, redder and smaller than its class allows. `StarNode` takes optional `displayColor` / `displaySize`, computed in `GalaxyWorld`; `system.color` is untouched. |
| Matrioshka brain | A faint deep-red smudge with no spikes, dimmer than any brown dwarf, drawn with a new `createShroudedStarTexture`. |
| Black hole | Every few seconds, a tiny pale-violet X-ray flicker next to the host. |
| Nicoll-Dyson beam | A thin, sputtering additive line across the disk, about `0.8 · GALAXY_RADIUS` long, pointing home. It's split into ~12 segments, each with its own `zIndex`, so it sorts correctly through the disk. This is the loudest sign in any galaxy. |
| Shkadov thruster | A short, faint wake pointing back toward the home region. The host already sits unusually far above the disk plane. |

Picking needs no changes.

## Phase 5: Archive and Codex

1. **Archive.** `InfoPanel` gets an **Anomalies** section below Spectral Classification:
   - **Before discovery:** the row shows `UNCATALOGUED` plus one survey rumour, which is the
     placement rule written as lore.
   - **After discovery:** the row shows the lore, the number found, and where the first one
     was found.
2. **Codex.** System and galaxy rows get a `◬` marker when they host a catalogued anomaly (read
   from `anomalyStore`), and search also matches anomaly names.

Draft lore (brief, flowing, understated):

- **Black hole:** *A companion that gives no light of its own. The star beside it is being drawn
  out a thread at a time, and the thread glows only in the moment before it is gone.*
  Rumour: *They are found where neutron stars have gathered.*
- **Ruined Dyson sphere:** *The shell was never finished, or it was finished and then taken
  apart. The star still burns behind the gaps, warming no one.*
  Rumour: *Some yellow and orange stars burn dimmer than their class allows.*
- **Matrioshka brain:** *Shell inside shell, each living on the heat the last one threw away.
  Something in there is still thinking, very slowly, and has not noticed that it is alone.*
  Rumour: *Where the shells are many, look to the heart of them.*
- **Nicoll-Dyson beam:** *A swarm built to gather a star's light and send it somewhere far away.
  It still fires, in stutters now, toward a place that stopped answering long ago.*
  Rumour: *The line across the disk points home.*
- **Shkadov thruster:** *A mirror the size of a world holds half the star's light against
  itself, and the star, pushed by its own shine, has been leaving for a million years. Whoever
  set it moving is not aboard.*
  Rumour: *Some stars sit high above the disk, trailing a wake back the way they came.*

## Phase 6: Scanning for civilisations in the supercluster

At high zoom, galaxies where `hasCivilization(dot.seed)` is true get a faint red-shifted tint.
The indices are collected once when the dots are built, and the tick blends their particle tint
by zoom. The check costs one RNG draw per dot, about 31k draws, once per supercluster.

## Phase 7: Documentation

Add an **Anomalies** section to `CLAUDE.md` covering the placement rules, the RNG isolation, the
`anomalies` collection, and where each sign and visual lives.

---

## Decisions

1. **Rates.** Start from the targets above: ~5% civilisation galaxies, ~1-in-250 brains.
2. **Milky Way.** No anomalies.
3. **Forgetting.** Forgetting removes the anomaly records inside what was forgotten (Phase 2).
4. **Supercluster scanning.** In scope (Phase 6).
5. **Main game.** Out of scope. Anomalies exist only in this version.
