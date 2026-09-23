# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This branch

`laniakea-explore-version` is an **exploration** cut of the galaxy game: universe, supercluster, galaxy and system views, the Codex, the probe scan, and the navigation HUD. Travel is free and there is no logistics, fabrication, colonies, research or milestones — do not reintroduce them here. Negative-energy condensate is the one resource: it is found at civilisations and spent only on probe sweeps.

Saves live in Firebase behind Google login: `users/{uid}/discoveries`, `users/{uid}/anomalies`, `users/{uid}/scans`, and the navigation fields of `users/{uid}.settings` (`lastView`, `lastSuperclusterSeed`, `lastGalaxySeed`, `lastSystemId`, `address`, plus `condensate` and the display toggles), written with `merge: true`.

**Pre-release persistence policy.** There are no production users and no supported legacy saves. Schema, navigation, seed, and generator changes may invalidate existing local or development Firestore data; do not add migrations or compatibility fallbacks for them. It is acceptable to clear that data while developing. The generation tests protect deliberate deterministic behaviour in the current version, not backward compatibility with prior saves.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # Type-check then build for production
npm run lint      # ESLint
npm run preview   # Serve the production build locally
```

`npm test` runs the vitest suite (universe generation, galaxy generation, galaxy shapes, projection, fly projection, anomalies). `ANOMALY_ODDS=1 npx vitest run src/game/anomalies.odds.test.ts --silent=false` prints civilisations per supercluster over 400 superclusters (target ~1 in 50), black holes over 3,000 galaxies, and each stage's and structure's rate per civilisation. `ANOMALY_CIVILIZATION_CHANCE` is 1 in 1,500,000 against ~31k galaxies per supercluster, so tests that need civilisations find them with `findCivilizationSeeds` (`civilizationSeeds.testutil.ts`) rather than by sampling.

## Code style

Do not write code comments. The code should speak for itself; only add a comment when something is genuinely impossible to express in the code (e.g. an external constraint or a deliberate RNG-ordering requirement), and keep it to one line.

## Architecture

**Stack:** Vite + React 19 + TypeScript + PixiJS v8 (`@pixi/react`) + Zustand + Firebase

### Layer separation

```
src/game/     — pure logic, no rendering
src/store/    — Zustand stores (consumed by both UI and Pixi layers)
src/pixi/     — PixiJS rendering components
src/ui/       — React DOM overlay components (HUD, Codex, planet panel, settings)
src/firebase/ — auth, user settings and discovery persistence
```

### Galaxy generation (`src/game/`)

`galaxyGen.ts` generates a `Galaxy` from a seed using the **mulberry32 PRNG** (`createRng`). Every random decision—star positions, names, types—flows from a single deterministic RNG instance, so the same seed always produces the same galaxy.

Three star populations are generated:
- **Bulge** – central cluster, K/M heavy (old stars)
- **Disk** – inter-arm background, dim K/M stars (`DISK_SIZE_SCALE = 0.6`)
- **Arms** – spiral arms, A/F heavy at inner end grading to G/K toward outer (star-forming regions)

`GalaxyConfig` (constructed from the RNG) holds per-galaxy variants: `numArms`, `galaxyEllipse`, `spiralTwist`, `numStars`, and nebula color palettes. All shape constants that don't vary per galaxy live in `constants.ts`.

### Rendering (`src/pixi/GalaxyStage.tsx`)

`PixiApp` wraps the `@pixi/react` `<Application>` and mounts one of `SuperclusterWorld`, `GalaxyWorld` or `SolarSystem` for the current `view`.

**Camera** is managed via mutable refs (`camera.current = { x, y, scale }`) — deliberately not React state to avoid re-renders on every frame. Pan via pointer drag or WASD (Shift boosts), zoom via scroll wheel with cursor-anchored math. `useCamera` eases key panning in screen pixels on `Ticker.shared` and holds still while `isZoomAnimating()` (every `zoomAnim.ts` animation registers itself) or `viewTransitioning` is set; keys typed into inputs are ignored through `keyboard.ts`'s `isEditable`, shared with `useFlyCamera`. Shift-drag or right-drag turns the disk (`useOrbit`, shared with the supercluster via an `OrbitConfig`); `useCamera` takes a `shouldPan` predicate so it declines the orbit gesture, and the tap handler ignores a tap that ended one.

**The galaxy camera is orthographic** (`createGalaxyCamera`, `perspectiveStrength: 0`). That is what makes turning it affordable: the gas cannot be re-projected per particle per frame at ~10^5 particles, so it is baked flat and re-oriented by container transforms, and a container transform is affine while a perspective divide is not — with perspective on, the stars would drift off the gas as the disk turned. `galaxyDepthScale` gives the stars back a near/far size cue as a stylistic effect, the way `superclusterDepthScale` does. Tilt is clamped by `clampGalaxyTilt` clear of both edge-on (no click targets) and face-on (no depth). The opening tilt settle is just the camera starting `GALAXY_INTRO_TILT_OFFSET` flat of its target and letting the orbit ease carry it home.

**Nebula rendering** bakes once per galaxy in a `useEffect`, in **plane coordinates**. Particles are batched into a `Map<color, Particle[]>` so each unique color issues a single PixiJS `fill()` call, then bucketed into `GALAXY_GAS_SLABS` bands by **height** — height is what a yaw turn leaves alone, so a band's geometry survives the turn and only its screen offset moves. Each band is a `Graphics` inside a spin container (`rotation = yaw`) inside a squash container (`scale.y = cos(tilt)`, `y = -height * sin(tilt)`), which is the whole orthographic projection of a fixed-height point. The bands of one layer share a single filtered parent (`BlurFilter` + `DisplacementFilter`, animated per-frame via `Ticker.shared`) — a filtered container renders as one unit so nothing can sort into it, but no star ever falls between two bands of the same layer, so nothing needs to. Gas and core are two such layers.

Being baked flat, the gas cannot carry a per-particle depth tint, so `DepthFadeFilter` (`depthFadeFilter.ts`) reproduces `galaxyDepthAlpha` in the shader: depth is linear in screen y for a flat disk, so the fade is a vertical ramp, and the tick feeds it the galactic centre's screen y (`camera.y`) and the ramp's half-span in screen pixels. It must be a filter rather than a gradient alpha mask: pixi's `MaskFilter` sets `clipToViewport: false`, so a mask sizes its framebuffer from the masked container's *unclipped* global bounds — at the 24x zoom of the enter-system animation that exceeds `MAX_RENDERBUFFER_SIZE` and every draw that frame fails with an incomplete framebuffer.

**Stars are re-projected every frame the disk turns.** `StarNode` registers its container and sprite into a `StarViews` map and the tick writes transforms through `applyStarProjection` (`starView.ts`) — 700-odd stars are nothing to project, but re-rendering that many React components per frame would be. They are direct children of `galaxyRoot` with `zIndex = projected.depth`, so the near half of the disk sorts in front of the gas and the far half behind it.

**Background starfield** is split into two `Graphics` objects (dim ≤0.7 brightness, bright >0.7) so their alpha can be pulsed independently on each tick.

**Star picking** is resolved on the stage's `pointertap` in `GalaxyWorld`, not by a per-star `onClick`: PixiJS only fires a click when press and release resolve to the same object, and in the projected disk a one-pixel wobble between them lands on a neighbouring star's hit area and the click is dispatched on their common ancestor instead. The handler projects the pointer into `galaxyRoot` space and takes the nearest star within `min(GALAXY_PICK_SCREEN_PX / camera.scale, GALAXY_PICK_MAX_WORLD)`, breaking ties frontmost-first, and ignores taps that ended a pan or an orbit (`hasDragged` from `useCamera`, `didOrbit` from `useOrbit`). The same scan runs on `pointermove` to set the canvas cursor, so the cursor and the click agree at every zoom; `StarNode` is `eventMode="none"` and carries no hit area, keeping every star out of Pixi's hit-test tree. Selecting a star marks it visited, records it in the Codex (and Firestore), pushes a `system` address segment and zooms into the system view.

**Star textures** (`src/pixi/textures.ts → createStarTexture`) are generated per star on a canvas: radial gradient core + 4 diffraction-spike ellipses composited with `destination-over`. Created inside `useMemo` in `StarNode` and destroyed on unmount — do not use module-level caches for PixiJS textures.

**View transitions** (`zoomAnim.ts`, `useZoomController.ts`): entering a galaxy or system zooms into the target and fades via `viewTransitioning`; `fireBackZoom` and `fireCodexNavigate` let the HUD and Codex trigger the zoom-out animation of whichever view is mounted.

### `SolarSystem.tsx` — system view

`SolarSystem` reads `system` from `gameStore` and `showOrbitRings` from `uiStore`.

**Planet generation** (`src/game/planetGen.ts → generateSystemLayout(seed)`): 3–7 planets per system placed in four radial zones determined by `getPlanetZone(idx, total)`:
- `hot` (inner 30%) — small rocky planets, rare moons, earth-tone colors
- `habitable` (30–50%) — medium rocky planets, possible moons, blue/green/brown palette (usually rolled down to `marginal`)
- `gas` (50–75%) — large gas giants with banded textures, rings common, up to 5 moons
- `ice` (75–100%) — ice giants, ringed, up to 3 moons, blue/violet palette

Brown dwarfs (`L`) get 2–4 ice planets; neutron stars (`N`) get 2–4 moonless hot planets. Passing a `dysonSphere` or `matrioshkaBrain` anomaly kind as the third argument turns every hot and habitable ring into `marginal`, so every caller (gameStore, `SolarSystem`, Codex) must pass the host's kind. Passing `homeworld` turns the habitable ring — or the outermost hot ring when the ring count leaves none — into an `ecumenopolis` without changing the ring count, so planet names stay put. Passing `populated = true` as the fourth argument does the same with a `populated` world, so every caller also passes `galaxyAnomalies.populated.has(id)` — the Codex through `populatedWorldIds(galaxySeed)`. Passing `living = true` as the fifth argument alongside `dysonSphere` turns every ring that is not gas or ice into a `foundry`, which shares the `marginal` zone config so every draw and name stays put; callers pass the host's `living` flag (the Codex from its anomaly record). Orbit radii grow by a factor of 1.55–2.2 per ring from a base of ~380–500 units. A 70% chance asteroid belt is inserted after a random planet. Sol uses the hand-authored `SOL_SYSTEM_LAYOUT` / `SOL_SYSTEM_PLANETS` from `hardcoded.ts`.

`generatePlanets(layout)` names planets and moons from a separate name RNG (`seed ^ 0xb1a2c3d4`), with moons numbered by Roman numeral (`Planet I`, `Planet II`). Keep that RNG isolated when deterministic names within the current generator are desired; it is not a legacy-save compatibility requirement.

**Orbital speeds** use Kepler-like constants: `ORBITAL_K = 3500` for planets, `MOON_K = 430` for moons (both `/ orbitRadius^1.5`).

**Rendering layers** (bottom to top): nebula glow sprite (`createNebulaGlowTexture`, `screen` blend, alpha-animated) → depth-sorted scene of orbit rings, asteroid belt, planets, moons and the star (sun sprite plus corona).

**Sun:** `createSunTexture` sprite (or `createBrownDwarfTexture` / `createNeutronStarTexture`) with a pulsing scale animation. The corona is 12 long rays + 22 short rays drawn as `Graphics` lines in `screen` blend mode; it rotates continuously and oscillates in alpha.

**Planet bodies:** albedo texture sprites per zone with a rotating body shadow facing away from the star. All planets get two concentric atmosphere glow circles. Ringed planets use a bezier half-ellipse technique: back half drawn first (behind the planet body), front half drawn last (in front), so the planet sits inside the ring plane correctly. Clicking a planet sets `selectedPlanetName`, which opens `PlanetPanel` (zone and moons).

**Asteroid belt:** `createAsteroidBelt` draws 1250–2500 particles batch-drawn per color using a Gaussian radial distribution. Belt slowly rotates each tick.

**Orbit rings** toggled via `showOrbitRings` (uiStore); visibility is set imperatively on the stored `Graphics` refs when the toggle changes.

### Zustand stores

- `gameStore` — the active `Galaxy` and its derived `galaxyAnomalies`, `supercluster`, `system` (active `StarSystem | null`, with generated `planets`), visited sets per galaxy/supercluster seed, and `regenerateGalaxy(seed?)`, `regenerateSupercluster(seed?)`, `setSystem`, `restoreGalaxyAndSystem`, `markDotVisited`, `markSystemVisited`, `restoreVisited`
- `uiStore` — `view` (`'universe' | 'supercluster' | 'galaxy' | 'system'`, also saved as `settings.lastView`), transition flags, `universePose` (unsaved fly-camera pose restored when returning to the universe), `showAttractorLabels`, `showOrbitRings`, `showHUD`, `showScanlines`, `showAnomalyDebug` (unsaved; `anomalyDebug.ts` rings civilisation galaxies, labels anomaly hosts and each region's stage, and in the universe view scans superclusters within 600 Mly nearest first and labels each with the rarest anomaly its civilisations hold, cached by seed), `selectedPlanetName`, `anomalyPanelOpen`, and the address breadcrumb stack (`pushAddress`, `popAddress`, `removeAddressType`, `clearAddress`)
- `codexStore` — discovery records (supercluster → galaxy → system), seeded with Laniakea / Milky Way / Sol
- `anomalyStore` — catalogued `AnomalyRecord`s keyed `${galaxySeed}-${systemId}`, plus `latest` for the toast; `remove*` return the removed keys so the Codex can delete them in Firestore
- `scanStore` — negative-energy condensate, scan mode (`active`), the running sweep's `progress`, the last `outcome` for the probe readout, and the catalogued `findings` keyed by id
- `flightStore` — the universe camera's position rounded to whole Mly, written by the `Universe` tick only when it changes and cleared on unmount, so the HUD can show it without the Pixi layer re-rendering React every frame
- `authStore` — Firebase user; `initAuth` loads settings, discoveries and anomalies, restores visited flags, and restores the last supercluster/galaxy/system and view. A fresh `localStorage` nav entry (`lib/navLocalStorage.ts`, < 30s old) wins over Firestore's debounced write

`useSettingsPersist` mirrors navigation and display settings to `localStorage` synchronously and to Firestore on a 2s debounce.

### Probe scan

Von Neumann probes carry negative-energy condensate, so they reach areas rather than addresses: a sweep narrows the search, it never pins a system. `ProbeButton` (`ui/Probes.tsx`, in `ShipHUD` beside the Codex) arms scan mode in the universe and supercluster views; `ProbePanel` shows the cost hint, the sweep's progress and its outcome above the HUD.

**Negative-energy condensate.** `CONDENSATE_START` to begin with, `CONDENSATE_PER_HOMEWORLD` each time `useAnomalyWatcher` catalogues a new homeworld — missions at living civilisations will replace that. The balance lives in `scanStore` and persists through `settings.condensate`, and a Settings row grants a homeworld's worth for testing. Write the resource out in full wherever a player can read it — never shorten it to "condensate".

**Aiming.** While scan mode is on, a sweep is anchored on a dot and then pulled open: the press must land on a supercluster (universe) or galaxy (supercluster) dot, and the drag away from it sets the radius, not a look or a pan (`scanSelect.ts` owns the gesture, marks the anchor and shows the running cost; `useFlyCamera`, `useCamera`'s `shouldPan`, `useOrbit` and both tap handlers stand down, so the shift-drag that turns a field elsewhere only aims here; Escape disarms scan mode outright, as does hiding the HUD, since `ProbeButton` goes with it). Anchoring on a real dot is what makes the sphere's depth readable — it is centred on an object whose distance the player can already see, so the shell reads as a volume around it rather than a circle on the screen. **A sweep is a sphere in world space, never the screen region**: a screen-shaped volume would cover different galaxies after the camera turned, and in the universe view turning is the whole interaction. Each view supplies `anchorAt` (its own dot pick, frontmost first, returning the dot's world position, name and screen position — hovering it before pressing marks the dot) and `aimAt`, which re-projects the anchor every frame and converts the drag's screen distance to a world radius — divided by `projectUniverseMark`'s pixels-per-unit at the anchor's depth in the universe, taken as-is in the orthographic supercluster. The sweep then takes every galaxy within that radius in 3D, including ones the drag never reached. A press that lands on no dot starts nothing and is never charged; an unaffordable sweep is refused before the drag resolves.

**Cost and precision** (`game/scan.ts`) follow the sphere's radius: `scanCost` charges `SCAN_COST_MIN` to launch the wave plus `SCAN_*_SPAN` scaled by reach — `scanRadiusFraction` raised to `SCAN_COST_RADIUS_EXPONENT`, clamped at `SCAN_*_FULL_RADIUS` — and `scanPrecisionRadius` returns `SCAN_PRECISION_FRACTION` of the radius, floored at `SCAN_*_MIN_RADIUS`, so the loop is sweep wide, then re-scan the hit to split it. **Widening a wave must beat launching another one.** The exponent is deliberately below 3, so cost grows slower than the volume it buys and one wide sweep covers a region for a fraction of what tiling it with small ones costs (`scan.test.ts` pins that coverage-per-credit falls off monotonically as the sweeps get smaller); the flat launch cost is what makes a swarm of cheap sweeps expensive on top of that. Searching by tiling is the failure mode both exist to price out. A narrowing re-sweep inside a contact still costs near the floor, so the three or four of them the loop wants stay affordable. A universe sweep surveys every supercluster inside the sphere; `SCAN_UNIVERSE_MAX_TARGETS` is only a ceiling against pathological density, above which the candidates sorted outward from the centre are sampled by stride. **A sweep must hear what it covers** — a sampled sweep never converges, since whether a rescan catches a civilisation is then a lottery of where the stride lands rather than of how tightly it was aimed.

**Running** (`scanRun.ts`). A sweep resolves progressively on the view's tick inside `SCAN_BUDGET_MS`, like the anomaly debug scanner. The universe run owns the whole sweep, not just the survey: it walks the chunks `universeChunksNear` reports for the sphere one per step — the sphere's own volume, never the chunks the camera happens to have loaded, so the same sweep costs and finds the same thing whatever is on screen — then samples the candidates by stride and walks each one's galaxy seeds `SCAN_SEEDS_PER_STEP` at a time, caching each supercluster's strongest profile by seed. Those seeds come from `superclusterGalaxySeeds`, a generator over the same dot stream `generateSupercluster` consumes, so a step never builds a whole supercluster in one frame and the two can never disagree about the RNG order; the supercluster run only walks its dots. Both read `civilizationProfile(galaxySeed)`, which replays the civilisation RNG's first three draws — the roll, living, then the stage — so a sweep never generates a galaxy. Surveying every candidate is affordable because a supercluster is ruled out without being built: a dot's seed follows from its index alone (`superclusterGalaxySeedAt`), so `superclusterMayHoldCivilization` hashes the civilisation roll over every index one could hold (`SC_MAX_GALAXY_DOTS`, the attractor and filament dot bounds) and only the ~1 in 50 that pass are walked. Indices past a supercluster's real dot count can only add a false pass, which the walk then rejects, so the filter is a superset and never hides a civilisation (`scan.test.ts` pins both directions). It is the hot loop of every sweep: `hasCivilization`'s roll is inlined into it, over `firstRandom`, which is `createRng`'s first draw without the closure. Reordering those draws moves every scan result as well as every anomaly.

**Findings.** A finding is forgotten with the supercluster that holds it (Codex forget) or cleared wholesale from the Settings row, locally and in Firestore; nothing else removes one. `mergeSignals` collapses everything a sweep found into one `ScanContact` — the centroid, a radius covering every signal but never tighter than the sweep's precision, and the strongest signal's strength (stage tier, one tier higher while living, capped at `SCAN_STRENGTH_TIERS`). Strength is never written out in words anywhere a player reads: it is spent on how far a signal carries, and the probe readout says only `Contact` or `No contact`. `recordSweep` writes the finding to `scanStore` and `users/{uid}/scans/{id}`. **The two scopes report differently, because they resolve differently.** A universe sweep answers with a region, so every one of them is recorded, including a barren one (`strength` `NO_CONTACT_STRENGTH`, no signals): a volume the probes ruled out is a reading, and it is what cools an overlapping heat. A universe sweep with a contact is kept even when the sphere held nothing else to route through, since a sweep tight enough to hold one supercluster still heard it; `drawScanWeb` draws such a finding's nodes as dots, having no edges to colour. A supercluster sweep resolves to the galaxy itself, so it records only when it heard something and a barren one is simply `No contact`. A `ScanFinding` carries the sphere that was swept (`x`/`y`/`z`/`radius`, anchored on the dot the sweep started from), the merged contact (`markX`/`markY`/`markZ`, `strength`, `sources`), the resolution it read at (`bloom`, the sweep's `scanPrecisionRadius`), how much of its own sphere it actually surveyed (`confidence`, the surveyed fraction of the candidates, 1 for a supercluster sweep), every signal it heard (`signals`, flat `x`/`y`/`z`/`strength`), and the probe route it walked (`nodes`, `edges`). `ScanContact.radius` is not drawn; `scanPrecisionRadius` only floors it.

**The route and its heat** (`game/scanGraph.ts`, universe scope only). A universe finding draws as the graph the probes traversed, not as the volume: the route visits **every** dot inside the swept sphere — and `buildScanGraph` sorts them outward from the anchor and links each to the nearest node already reached, so the route is a tree radiating from the anchor through the whole sphere. `SCAN_GRAPH_MAX_NODES` is a draw and storage ceiling, not a design one: it only bites on the largest supercluster sweeps, where the route is then stride-sampled outward. Node positions are stored flat and absolute; the heat is not stored. Every draw recomputes it from every finding in scope. **Heat means one thing only: how sure the probes are that something is here.** It is never how loud the thing was — `heatAt` peaks at 1 for any contact and `signalReach` spends the signal's strength on how far it carries (`SCAN_HEAT_REACH_MIN`…`MAX` of the bloom) instead, so a faint civilisation and an overwhelming one both go hot where they sit and the ramp cannot be misread as distance. It takes the **maximum** over a finding's own signals, so two civilisations read as two peaks rather than one blob between them. `readHeat` then **multiplies** the readings of every sweep whose sphere covers the node and raises the product by `SCAN_HEAT_OVERLAP_SHARPEN` per extra sweep: independent readings of one volume agree only where the contact is, so a second sweep over a region collapses the swell hard, a third harder, and a barren sweep zeroes it outright. **A sweep only rules out what it surveyed, and silence never outvotes a contact.** A universe sweep deep-surveys at most `SCAN_UNIVERSE_MAX_TARGETS` of its candidates, so a wide barren one has heard nothing over most of its own sphere: its silence multiplies by `1 - confidence` instead of by zero, and only a sweep that reached every candidate cools a volume outright. **A sweep that surveyed all of its own sphere always cools it**, even inside another sweep's contact: it heard nothing there, and that is exactly how a tight barren re-sweep cuts half of a wide sweep's swell away and narrows it. Only a *sampled* sweep's silence is dropped where `detectedAt` says some sweep resolved a contact — within that sweep's own `bloom` of one of its signals it heard the thing rather than bloomed toward it, so a sweep that sampled past it was never checking there. A full-confidence barren sweep can never cover a true signal to begin with, since it would have heard it, so nothing is lost by letting it cool. Heat stays zero wherever no covering sweep heard anything, so a partial sweep still never invents warmth. That, plus each sweep's own `bloom`, is the whole narrowing loop. The field is about as wide as the sweep resolves and no wider: `heatBloom` scales `bloom` by `SCAN_HEAT_BLOOM_SCALE` before the falloff, so a contact hands back a neighbourhood the size of the sweep's own precision rather than a dot, and the falloff goes as the *square* of that spread so the swell has an edge. Both matter at real density — roughly one supercluster in fifty holds a civilisation, so a wide sweep hears dozens, and a bloom broader than the sweep's resolution saturates the whole route red. A sweep is also clamped to `SCAN_UNIVERSE_MAX_RADIUS` while aiming, since past the full-cost sphere it costs nothing more and only floods the map. `jitteredHeat` then adds decoys on top of it: `decoyHeat` takes the upper tail of `heatNoise` (smooth value noise over a cell of the sweep's own resolution, `SCAN_HEAT_NOISE_CELL`, above `SCAN_HEAT_DECOY_THRESHOLD`) up to `SCAN_HEAT_NOISE_AMOUNT`, decaying by `SCAN_HEAT_NOISE_DECAY` for each sweep that covered the node, so re-scanning buys clarity as well as focus. **The noise only ever adds warmth, never removes it** — a contact the probes really heard reads hot wherever it sits, whatever civilisation it is, because a ramp that sometimes cools a true reading means nothing at all. Some warm places are lies; none of the cold ones are — the noise is spatially correlated on purpose, because per-node noise averages out over a long route and leaves the true gradient readable, while a false warm neighbourhood does not. `SCAN_HEAT_STEPS` quantises what is drawn on top of that. The hottest node is therefore never a pin: the gradient points at a neighbourhood, and only overlapping sweeps split it.

**Drawing** (`scanShell.ts`, `scanWeb.ts`, `scanOverlay.ts`). The live aim is still a wireframe sphere (`scanShell.ts`) — five latitude rings and four meridians, each segment sorted into a back or a front `Graphics` by its depth against the centre's, no fill — in cyan, red when it costs more than you hold, holding through the sweep. `frontIsLowerDepth` flips that depth test for the supercluster, where a larger `projected.depth` is nearer. A universe finding instead draws its route (`drawScanWeb`): each edge is projected as a straight screen line (a projection maps a line to a line, so the ends alone place it) and bucketed into `SCAN_HEAT_STEPS` levels by its heat, so each level's segments stroke once in one `heatColor` off the `SCAN_HEAT_COLORS` ramp, cold through to hot. A short route splits each edge into `SCAN_WEB_SEGMENTS` pieces for a gradient along it; past `SCAN_WEB_GRADIENT_MAX_NODES` the edges are already short enough to carry one colour each, which is what keeps a thousands-of-node route affordable. An edge sorts front or back whole, by its mean depth against the anchor node's. The geometry is rebuilt only when the projection basis, the camera scale or the findings change — the pulse rides on the layers' alpha, so a still frame redraws nothing. In both views the back half is a node of its own (`backNode`) that the view puts under the dot field while the front half goes over it, which is what makes the web read as a volume the dots are inside of. A supercluster finding draws none of that: the sweep resolved to the galaxy, so `createSuperclusterScanOverlay` simply crosshairs each signal's dot in `SCAN_MARK_COLOR` — no web, no heat, no swept volume kept on screen, and nothing left to narrow. Neither overlay carries any text: the ramp is the only thing in either view that means anything, and `ProbePanel`'s `HeatLegend` spells that meaning out from the same `SCAN_HEAT_COLORS`. A probe reports that something is there, never what it is.

### Navigation

`ui/navigation.ts` holds `travelToSupercluster`, `travelToGalaxy` and `travelToSystem`, used by the Codex to jump anywhere it has recorded; each rebuilds the address stack from scratch. Travel is free. The view stack is `universe → supercluster → galaxy → system`: the universe view is the only way to reach a new supercluster, and Back from a supercluster (its `onNavigateBack`) clears the address to the Observable Universe root and returns to it.

### Anomalies

Eight rare finds: black holes, and the works of civilisations — homeworld ecumenopolises, Dyson spheres, Matrioshka brains, Nicoll-Dyson beams, Caplan thrusters, Alderson disks and Alcubierre cannons. `src/game/anomalies.ts → generateAnomalies(galaxy)` places them, and every rate lives in `constants.ts` (`ANOMALY_*`). They are derived, never stored on the galaxy: `gameStore.galaxyAnomalies` is recomputed wherever `makeGalaxy` runs, and an anomaly never changes its host's data — every difference is applied while rendering. The Milky Way hosts none.

**Stages.** A galaxy holds at most one civilisation (`ANOMALY_CIVILIZATION_CHANCE`), so roughly one supercluster in fifty holds any: a full-radius universe sweep covers thousands of superclusters and hears every civilisation among them, while a sweep small enough to read as a neighbourhood usually hears none. It rolls living (`ANOMALY_LIVING_CHANCE`), then a stage from `ANOMALY_STAGE_WEIGHTS` — ruined ones only from `ANOMALY_RUINED_MIN_STAGE` up — and `CIVILIZATION_STAGE_PLANS` names what that stage built. A ruined civilisation leaves the same structures, ruined.
1. One populated world, its home.
2. A homeworld ecumenopolis.
3. Homeworld with a swarm around the home star, plus 1–2 populated worlds.
4. As stage 3, plus Dyson spheres at other stars (a Dyson Complex while living), and 2–3 populated worlds.
5. As stage 4, plus a random 1–2 of Matrioshka brain, Nicoll-Dyson beam and Caplan thruster.
6. Alderson disk, Dyson spheres, brain, beam, thruster and Alcubierre cannon, plus 2–3 populated worlds.

Negative-energy condensate, which powers Alcubierre travel, is scarce: it is why a civilisation stays inside one region, and why the Alcubierre cannon is a deterrent, since firing it would spend nearly all of a civilisation's negative-energy condensate. The order is deliberate: a civilisation harvests its own star and settles another world before it builds at any other star (`anomalies.test.ts` checks the plans for it). Dyson spheres are closed swarms, not rigid shells, and the Alderson disk's lore leans on exotic material and star lifting because the physics cannot carry it.

**Placement.** The home region (`ANOMALY_HOME_RADIUS`) is centred on a G/K star in the disk, bar or outer arm — or on any G/K star outside the bulge and starbursts, which is how ellipticals get one. Distances are in the plane. A structure whose rule finds no host is skipped.
- Dyson sphere — 1–3 F/G/K stars inside the region, never bulge or starburst, weighted toward the centre; at least two when the stage wants a brain.
- Matrioshka brain — the non-bulge, non-starburst K star nearest the centre, only when at least two Dyson spheres were placed.
- Caplan thruster — among F/G/K stars outside the region in the top `ANOMALY_THRUSTER_HEIGHT_FRACTION` of `relativeHeight` (|z| over the population's scale height), the one nearest the region. `direction` is its heading away from home.
- Nicoll-Dyson beam — an F/G/K star 0.8–1.2 region radii from the centre. `direction` points at the brain if there is one, otherwise at the centre.
- Black holes are independent of civilisations: every non-L/N star within `ANOMALY_BLACK_HOLE_REACH` of a neutron star rolls `ANOMALY_BLACK_HOLE_CHANCE`, then active or quiescent.
- Home — every civilisation has one, placed after the black holes with no RNG draw: the unoccupied G/K star outside the bulge and starbursts nearest the region centre — inside the region if one is free, otherwise anywhere — and only then the nearest unoccupied host of any class. It becomes the stage plan's `home` kind, or at stage 1 the civilisation's one populated world. When the plan has `homeSwarm` the homeworld carries `swarm: true`; there is no standalone swarm kind, so the swarm is noted on the homeworld's lore rather than catalogued.
- Populated worlds — living civilisations only, placed after the home: `ANOMALY_STAGE_POPULATED` unoccupied F/G/K stars outside the bulge and starbursts inside the region. They are not anomalies: `GalaxyAnomalies.populated` holds their host ids, nothing catalogues them, and their only difference is one `populated` planet.
- Alcubierre cannon — stage 6 only, placed after the populated worlds with no RNG draw, on the unoccupied, unpopulated F/G/K star outside the bulge and starbursts farthest from the centre inside the region, or the nearest one outside it when the region has none left. `direction` points away from home, in the plane.

**RNG isolation.** Anomalies never draw from the galaxy or planet RNGs. The civilisation RNG is `seed ^ 0x6c8e9cf5`, and its first draw is the civilisation roll so `hasCivilization(seed)` answers without generating the galaxy, followed by living, stage, the stage-5 megastructure pick and the Dyson count; black holes use `seed ^ 0x3c6ef372`; populated worlds use `seed ^ 0x51ed270b`; each anomaly's seed is `galaxySeed ^ imul(hostId, 0x165667b1)`, which fixes integrity and the active flag, while render detail comes from `anomalyVisualRng`. Reordering the draws in `placeCivilization` moves anomalies in galaxies players have already explored. `anomalies.test.ts` checks every host against its rule.

**Catalogue.** `useAnomalyWatcher` (mounted in `App`) subscribes to `gameStore.system`: entering an uncatalogued host adds a record to `anomalyStore`, saves it to `users/{uid}/anomalies/{galaxySeed}-{systemId}` (`firebase/anomalies.ts`) and sets `latest`, which `AnomalyToast` shows for five seconds. That covers galaxy taps, Codex travel and restores in one place. `initAuth` calls `anomalyStore.setAll` before `restoreGalaxyAndSystem` so restoring into a host does not toast again. Codex forget removes the records inside whatever was forgotten, locally and in Firestore. Names, tiers, lore, rumours and survey notes live in `anomalyLore.ts`.

**System view** (`src/pixi/anomalies/`). `createAnomalyVisual` returns an `AnomalyVisual`: `nodes` added to `depthScene`, an `extent` passed to `createSystemCamera` as `extraExtent`, star and corona alpha, an optional nebula colour, and a per-tick `update`. Dyson shells and the brain's nested shells are `shellLattice.ts` panel sets with a clustered integrity mask, redrawn every frame into a back `Graphics` at `zIndex -SHELL_Z` and a front one at `+SHELL_Z`; for anything outside the sphere that split around the star at 0 is exact. Loose bodies — debris, the black hole, the lens, beam and jet segments — take `zIndex` from their own depth. The accretion disk is 16 wedges, each in its own squash container, so the half behind the horizon sorts under it. A homeworld with `swarm` mounts `dysonSwarm.ts`, a dense `collectorSwarm` of many inclined rings, gold while living and dark with wider gaps when ruined. The Caplan thruster (`caplanThruster.ts`) rings its star in a `collectorSwarm` and holds an engine hull behind the star, against its heading, inside the innermost orbit. While living, focused collector rays heat a hotspot on the star, a gas stream and a hydrogen counter-jet join the hotspot to the intake, and an oxygen exhaust jet runs from the nozzle out past the planets, every stream and jet segment sorting by its own depth; a ruined thruster is a cold hull with a broken intake ring and struts. Every structure is selectable and opens `AnomalyPanel`, and `ShipHUD` shows a line for it in the system view. The homeworld has no structure of its own: `ecumenopolis.ts` draws its built-over albedo and city lights redrawn each tick against the body shadow's terminator (lit end to end when living, a few lights on a schedule when ruined), and its `PlanetPanel` links to `AnomalyPanel`. A living Dyson sphere is a Dyson Complex: `foundry.ts` draws each foundry world's terraced albedo and its furnace lights, through `lightCity` with its own palette. A populated world keeps the habitable albedo (`drawHabitablePlanet` returns the canvas), and `createSettlementLights` samples that canvas for land and scatters small cities and rural lights over it, lit on the night side the same way. The Alderson disk (`aldersonDisk.ts`) replaces the inner system: `generateSystemLayout` drops the hot, habitable and gas giant rings and records them in `dismantledRings`, which `generatePlanets` skips names for so the outer planets keep theirs. The disk runs from a hole around the star out to `innermostClearance`, taken from `diskRim` — the first ring outside the hot and habitable zones, kept on the layout even when its gas giant is dismantled — less its rings and moons, split into 36 wedges projected with perspective and redrawn only when the basis changes, each wedge sorting by its own depth so the star sits between the far and near halves; a ruined disk is weathered toward bare rock, keeps a few lights on a schedule, and loses runs of wedges back to a broken wall short of the rim. The Alcubierre cannon (`alcubierreCannon.ts`) wraps its star in the Nicoll-Dyson beam's orbiting collector rings (`collectorSwarm.ts`, shared by both) and is a barrel of warp coils on its bearing inside the innermost orbit, each coil sorting by its own depth, that is a deterrent and never fires while living: its coils hold their charge around a contained bubble at the breech, and a test pulse runs breech to muzzle every 11s. A ruined cannon was fired once; its coils are split, and the charge its collectors still push in dies at the first broken coil.

**Galaxy view.** Dyson sphere hosts are drawn dimmer, redder and smaller, home-swarm hosts slightly so, and brain hosts with `createShroudedStarTexture`, through `StarNode`'s `display` override (`starDisplays` in `GalaxyWorld`). `anomalySigns.ts` adds the black hole's X-ray flicker, the Caplan exhaust jet, the 12-segment beam and the living cannon's steady barrel glow straight to `galaxyRoot`, so they sort through the disk; they are re-projected in `orient()` and fade in above `ANOMALY_SIGN_MIN_SCALE` (`ANOMALY_BEAM_SIGN_MIN_SCALE` for the beam). Picking is unchanged, since every anomaly sits on a star.

**Supercluster.** Dots whose seed passes `hasCivilization` are collected when the field is built, and the tick blends their tint toward `SC_CIVILIZATION_TINT` between `SC_CIVILIZATION_TINT_MIN_SCALE` and `SC_CIVILIZATION_TINT_FULL_SCALE`.

**Archive and Codex.** `InfoPanel`'s Anomalies section shows one rumour for each uncatalogued kind, and the lore, count and first find once one is catalogued. Codex galaxy and system rows get a `◬` marker, and search matches anomaly names.

### Nebula color design

Nebula is a structure-driven tint layer: inner arm particles use cool blue/violet (`innerNebulaColors`), outer arm particles use the galaxy's `nebulaColors` palette, and core glow always uses warm white/gold (`CORE_COLORS`). Nebula color is never derived from individual star colors.

### `Universe.tsx` — universe view

The top zoom level: one universe for every player, generated from `UNIVERSE_SEED`. Each dot is a supercluster, and tapping one opens it in the supercluster view.

**Generation** (`src/game/universe.ts`, generated a chunk at a time, typed arrays):
- **Voronoi foam.** Superclusters sit on the walls and filaments between voids. Each cell of `UNIVERSE_VOID_CELL` holds one jittered void centre drawn from a hash of its cell index, so a centre never depends on sampling order. A sample's weight comes from its distance to the bisector planes of its nearest void centres: wall (1st–2nd) and filament (1st–3rd), through a compact polynomial kernel. Acceptance and brightness use only `+ - * /` and `Math.sqrt`, never `Math.exp` or `Math.hypot`: those are not guaranteed bit-identical across browser engines, and a single flipped acceptance would give players different universes.
- **Chunks.** A chunk is one void cell, so all its samples share the same 27 void centres. `getUniverseChunk(ci, cj, ck)` runs `UNIVERSE_CHUNK_TRIALS` trials from the chunk's own RNG, each drawing exactly five numbers (position, acceptance, brightness), and keeps the last `UNIVERSE_CHUNK_CACHE` chunks in an LRU. The grid is `2^UNIVERSE_CHUNK_AXIS_BITS` chunks per axis, and only the ball of `UNIVERSE_LATTICE_RADIUS` inside it is populated: roughly 330 million superclusters. `universeChunksNear` lists the chunks within a radius, nearest first.
- **Laniakea.** `LANIAKEA_SEED` is anchored at the highest-weight point near the origin and heads the chunk that holds it. Positions are stored relative to it, so it sits at (0,0,0) at the centre of its observable universe.
- **Scale.** Generation runs in lattice units (`UNIVERSE_VOID_CELL`, the wall and filament widths, the anchor radius), and `runTrial` multiplies each position by `UNIVERSE_SCALE` on the way out, so world units are Mly and the ball of `UNIVERSE_RADIUS` is the real 93 billion light years across. Rescaling only the output leaves every acceptance bit-identical, so seeds never move. `universeChunksNear` and `universeWebWeight` take world units and divide back. Every camera distance (`UNIVERSE_NEAR`, `UNIVERSE_FOG_FAR`, `UNIVERSE_DOT_SIZE`, the speeds, the refresh and start backoff) is in world units and was scaled with it, so flight feels the same as the density rose.
- **Seeds.** A supercluster's seed is its chunk and trial index packed into 32 bits (7 bits per axis, 11 for the trial), passed through an invertible mix and XORed with `UNIVERSE_SEED`. `locateSupercluster(seed)` inverts that and replays the one trial by seeking the mulberry32 stream (`chunkSeed + imul(5 * trial, 0x6d2b79f5)`), so any seed resolves to its position without generating anything else; `getSuperclusterCoords` uses it for the HUD address. A trial whose seed would equal `LANIAKEA_SEED` is rejected. Names come from `generateSuperclusterName(seed)`, which matches `generateSupercluster(seed).name` because the name is that RNG's first draw.
- **Stability.** `universe.test.ts` pins every seed, position and brightness in six sample chunks, and 1,000 names. These checks make intentional changes to the current scheme visible. They do not require preserving old Codex records, seed formats, or pre-universe JUMP navigation: no migration or fallback mapping is needed before launch.

**Camera.** This view is first-person with perspective, unlike the orthographic orbit views, because the player flies through the web rather than turning it. `useFlyCamera` owns a `FlyCamera` (position, yaw, pitch) in refs:
- Dragging turns the view with an eased target, grab-style.
- WASD flies along the look direction, Q/E turn the look yaw left and right, Shift boosts, and the wheel sets cruise speed.
- Keys are read by `event.code` from `window` and ignored while typing in an input.
- Flight stops at `UNIVERSE_RADIUS`, and input freezes during zoom animations and view transitions.
- `flyProjection.ts` holds the maths: `projectUniverseField` does one fused pass over a chunk's dots (cull behind `UNIVERSE_NEAR` and off screen, size by `UNIVERSE_DOT_SIZE * focal / depth`, alpha by distance fog to `UNIVERSE_FOG_FAR`). `projectSkyDirection` turns the unit-sphere skybox by rotation only.

**Rendering.** The view refreshes its chunk list whenever the camera has moved `UNIVERSE_CHUNK_REFRESH` since the last one, covering `UNIVERSE_FOG_FAR` plus that margin, and generates missing chunks nearest first within `UNIVERSE_CHUNK_BUDGET_MS` a frame; far chunks arrive already deep in fog. One `ParticleContainer` over the supercluster dot texture draws only the visible dots: each tick projects every active chunk and copies what survives into a growing particle pool (writing `particle.color` directly with the tier's BGR tint), with parallel slot arrays for picking. It sits in a world container at the screen centre. With no saved pose the camera opens backed off from the current supercluster rather than from Laniakea. A `screenCamera` ref (`{ x, y, scale }`) mirrors that container, so `useZoomController`, `animateZoomTo` and the Codex zoom-out work unchanged as 2D zooms of the projected field. The camera faces the current supercluster on mount, which is why `getCurrentPos` is the screen centre.

**Overlays and picking.**
- Visited rings (superclusters with Codex records) and the current crosshair use `dotOverlays.ts`, shared with the supercluster view.
- Picking reads the arrays from the last tick. A dot whose drawn disc contains the cursor wins, frontmost first; otherwise the nearest within `UNIVERSE_PICK_SCREEN_PX` wins. Dots fogged below `UNIVERSE_PICK_MIN_ALPHA` are never picked.
- Hover re-picks every tick, so the name label follows while flying.
- A tap saves the pose to `uiStore.universePose` (unsaved, so returning puts you back where you were), regenerates the supercluster, clears the address and zooms in.
- A speed readout replaces the scale bar, since perspective has no fixed scale.
- `universeMinimap.ts` draws a fixed-angle 2.5D globe of `UNIVERSE_RADIUS` in the top right (under the auth button), with Laniakea at its centre, the camera's plane footprint, a height stalk up to its position dot and a short heading line. Its frame is drawn once; only the marker is redrawn each tick.

### `Supercluster.tsx` — supercluster view

The top-level zoom level above individual galaxies.

**Data model** (`SuperclusterData` from `gameStore`):
- `dots` — individual galaxy dots (`SuperclusterDot`: `x`, `y`, `z`, `seed`, `brightness`, `visited`, `name`)
- `attractors` — named gravitational attractor regions (galaxy groups/clusters within the supercluster)
- `backgroundStars` — fixed screen-space starfield

**Rendering** is a re-projected 3D field, not a baked 2D one. `useOrbit` owns an orthographic
`Camera3D` (yaw/tilt, `perspectiveStrength: 0`) that eases toward a drag target every tick, and the
scene re-projects `dot.z` into screen space on every frame:

- The ~31k dots live in one `ParticleContainer` (`position`/`vertex`/`color` dynamic) over a single
  tinted dot sprite, wrapped in a `BlurFilter` + `screen`-blend container. Graphics geometry cannot
  be re-emitted per frame at this count — do not go back to `circle()` batches here.
- `projectSuperclusterField` (`projection.ts`) projects the whole field in one fused pass into
  typed arrays; per-point calls through the scratch objects cost more than the arithmetic. The tick
  then only copies into particles. Everything else (labels, overlays, hit tests) is few enough to
  use `projectPlanePointWithBasis` per point.
- Depth reads through aerial perspective: `superclusterDepthAlpha` hazes far dots and
  `superclusterDepthScale` shrinks them. Orthographic means the size cue is stylistic, not
  perspective — that is what keeps `ScaleBar`'s `SC_WORLD_HALF_MLY / SC_WORLD_HALF` exact.
- Dots are bucketed into 5 brightness tiers (yellow → orange → pink → violet → purple) for colour,
  radius and base alpha, and into 10 blink groups whose phase multiplies that alpha.
- Visited dots, the current-galaxy crosshair, and attractor labels are all reprojected each tick.
  Labels live in an unrotated container so they stay screen-facing, and fade with depth.
- Attractor labels and the supercluster title are rendered via `createPointerLabel` (from
  `labels.ts`). Attractor label visibility is toggled by `showAttractorLabels` and hidden when
  zoomed out below scale 0.25.

**Input:** left-drag pans and the wheel zooms as before (`useCamera`); shift-drag, right-drag or
Q/E turns the field (`isOrbitGesture`, and `OrbitConfig.keyYawSpeed` for the keys, which only the
supercluster sets). `useCamera` takes a `shouldPan` predicate so it declines the
orbit gesture rather than panning during it, and the tap handler ignores a pointertap that ended
an orbit drag.

**Navigation:** Tapping a dot (within `15 / camera.scale` px of its *projected* position, only
active at scale ≥ 0.5) marks it visited, records it in the Codex, calls `regenerateGalaxy(dot.seed)`, resolves the nearest
attractor (within `SC_ATTRACTOR_LABEL_MAX_DIST`), pushes address breadcrumbs, and switches `view`
to `'galaxy'`. Overlapping dots resolve to the frontmost by depth. Attractor resolution uses true 2D world distance, not the projected or 3D distance.

### `TopNavBar.tsx`

Purely decorative top-of-screen overlay (`aria-hidden`) — two angled SVG polylines (left/right) flanking a center notch, styled to match the HUD's cyan trapezoid line language. No state, no props.

### `ShipHUD.tsx` — navigation HUD

Bottom-of-screen trapezoid panel (SVG outline + tick marks), hidden when `showHUD` is off. It shows the address breadcrumb and the `x.y.z` coordinates of each supercluster/galaxy/system segment — or, in the universe view where the address has none, the live camera position from `flightStore` in the same Mly-from-Laniakea frame as supercluster coordinates — flanked by trapezoid buttons:

- `Codex` (left) — opens the discovery drawer: search, travel to any recorded supercluster/galaxy/system, and a forget mode that deletes records locally and in Firestore.
- `NavBack` — pops the view/address stack (`system → galaxy → supercluster → universe`), using the mounted view's `fireBackZoom` animation when available; disabled in the universe view. There is no JUMP: every supercluster is reached through the universe.

### Other overlays

- `ConfigPanel` — HUD, scan lines, attractor labels (supercluster view) and orbit rings (system view) toggles, plus the per-view `TutorialPanel`.
- `InfoPanel` — the "Stellar Archive" drawer describing each spectral class and the Anomaly Archive.
- `AnomalyPanel` / `AnomalyToast` — the anomaly detail panel (opened by `uiStore.anomalyPanelOpen`) and the first-discovery banner above the HUD.
- `LoginScreen` / `AuthButton` — Google sign-in gate and sign-out.
