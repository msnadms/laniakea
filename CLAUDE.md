# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This branch

`laniakea-explore-version` is an **exploration-only** cut of the galaxy game: supercluster, galaxy and system views, the Codex, and the navigation HUD. There is no economy, logistics, fabrication, colonies, research, milestones, fuel, travel cost or probe detection — do not reintroduce them here.

Saves live in Firebase behind Google login: `users/{uid}/discoveries`, `users/{uid}/anomalies`, and the navigation fields of `users/{uid}.settings` (`lastView`, `lastSuperclusterSeed`, `lastGalaxySeed`, `lastSystemId`, `address`, plus the display toggles), written with `merge: true`. Discovery records point at systems by id, name and seed, so the generators' RNG sequences must stay stable — `galaxyGen.test.ts` guards this.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # Type-check then build for production
npm run lint      # ESLint
npm run preview   # Serve the production build locally
```

`npm test` runs the vitest suite (galaxy generation, galaxy shapes, projection, anomalies). `ANOMALY_ODDS=1 npx vitest run src/game/anomalies.odds.test.ts --silent=false` prints how often each anomaly turns up over 3,000 galaxies against its target.

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

**Camera** is managed via mutable refs (`camera.current = { x, y, scale }`) — deliberately not React state to avoid re-renders on every frame. Pan via pointer drag, zoom via scroll wheel with cursor-anchored math. Shift-drag or right-drag turns the disk (`useOrbit`, shared with the supercluster via an `OrbitConfig`); `useCamera` takes a `shouldPan` predicate so it declines the orbit gesture, and the tap handler ignores a tap that ended one.

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

Brown dwarfs (`L`) get 2–4 ice planets; neutron stars (`N`) get 2–4 moonless hot planets. Passing a `dysonSphere` or `matrioshkaBrain` anomaly kind as the third argument turns every hot and habitable ring into `marginal`, so every caller (gameStore, `SolarSystem`, Codex) must pass the host's kind. Orbit radii grow by a factor of 1.55–2.2 per ring from a base of ~380–500 units. A 70% chance asteroid belt is inserted after a random planet. Sol uses the hand-authored `SOL_SYSTEM_LAYOUT` / `SOL_SYSTEM_PLANETS` from `hardcoded.ts`.

`generatePlanets(layout)` names planets and moons from a separate name RNG (`seed ^ 0xb1a2c3d4`), with moons numbered by Roman numeral (`Planet I`, `Planet II`). Keep that RNG isolated so names stay stable for existing saves.

**Orbital speeds** use Kepler-like constants: `ORBITAL_K = 3500` for planets, `MOON_K = 430` for moons (both `/ orbitRadius^1.5`).

**Rendering layers** (bottom to top): nebula glow sprite (`createNebulaGlowTexture`, `screen` blend, alpha-animated) → depth-sorted scene of orbit rings, asteroid belt, planets, moons and the star (sun sprite plus corona).

**Sun:** `createSunTexture` sprite (or `createBrownDwarfTexture` / `createNeutronStarTexture`) with a pulsing scale animation. The corona is 12 long rays + 22 short rays drawn as `Graphics` lines in `screen` blend mode; it rotates continuously and oscillates in alpha.

**Planet bodies:** albedo texture sprites per zone with a rotating body shadow facing away from the star. All planets get two concentric atmosphere glow circles. Ringed planets use a bezier half-ellipse technique: back half drawn first (behind the planet body), front half drawn last (in front), so the planet sits inside the ring plane correctly. Clicking a planet sets `selectedPlanetName`, which opens `PlanetPanel` (zone and moons).

**Asteroid belt:** `createAsteroidBelt` draws 1250–2500 particles batch-drawn per color using a Gaussian radial distribution. Belt slowly rotates each tick.

**Orbit rings** toggled via `showOrbitRings` (uiStore); visibility is set imperatively on the stored `Graphics` refs when the toggle changes.

### Zustand stores

- `gameStore` — the active `Galaxy` and its derived `galaxyAnomalies`, `supercluster`, `system` (active `StarSystem | null`, with generated `planets`), visited sets per galaxy/supercluster seed, and `regenerateGalaxy(seed?)`, `regenerateSupercluster(seed?)`, `setSystem`, `restoreGalaxyAndSystem`, `markDotVisited`, `markSystemVisited`, `restoreVisited`
- `uiStore` — `view` (`'supercluster' | 'galaxy' | 'system'`), transition flags, `showAttractorLabels`, `showOrbitRings`, `showHUD`, `showScanlines`, `showAnomalyDebug` (unsaved; `anomalyDebug.ts` rings civilisation galaxies and labels anomaly hosts), `selectedPlanetName`, `anomalyPanelOpen`, and the address breadcrumb stack (`pushAddress`, `popAddress`, `removeAddressType`, `clearAddress`)
- `codexStore` — discovery records (supercluster → galaxy → system), seeded with Laniakea / Milky Way / Sol
- `anomalyStore` — catalogued `AnomalyRecord`s keyed `${galaxySeed}-${systemId}`, plus `latest` for the toast; `remove*` return the removed keys so the Codex can delete them in Firestore
- `authStore` — Firebase user; `initAuth` loads settings, discoveries and anomalies, restores visited flags, and restores the last supercluster/galaxy/system and view. A fresh `localStorage` nav entry (`lib/navLocalStorage.ts`, < 30s old) wins over Firestore's debounced write

`useSettingsPersist` mirrors navigation and display settings to `localStorage` synchronously and to Firestore on a 2s debounce.

### Navigation

`ui/navigation.ts` holds `travelToSupercluster`, `travelToGalaxy` and `travelToSystem`, used by the Codex to jump anywhere it has recorded; each rebuilds the address stack from scratch. Travel is free.

### Anomalies

Five rare finds: black holes, ruined Dyson spheres, Matrioshka brains, Nicoll-Dyson beams and Shkadov thrusters. `src/game/anomalies.ts → generateAnomalies(galaxy)` places them, and every rate lives in `constants.ts` (`ANOMALY_*`). They are derived, never stored on the galaxy: `gameStore.galaxyAnomalies` is recomputed wherever `makeGalaxy` runs, and an anomaly never changes its host's data — every difference is applied while rendering. The Milky Way hosts none.

**Placement.** The four megastructures belong to at most one lost civilisation per galaxy (`ANOMALY_CIVILIZATION_CHANCE`), whose home region (`ANOMALY_HOME_RADIUS`) is centred on a G/K star in the disk, bar or outer arm — or on any G/K star outside the bulge and starbursts, which is how ellipticals get one. Distances are in the plane.
- Ruined Dyson sphere — 1–3 F/G/K stars inside the region, never bulge or starburst, weighted toward the centre.
- Matrioshka brain — the non-bulge, non-starburst K star nearest the centre, only when at least two Dyson spheres were placed.
- Shkadov thruster — among F/G/K stars outside the region in the top 5% of `relativeHeight` (|z| over the population's scale height), the one nearest the region. `direction` is its heading away from home.
- Nicoll-Dyson beam — an F/G/K star 0.8–1.2 region radii from the centre. `direction` points at the brain if there is one, otherwise at the centre.
- Black holes are independent of civilisations: every non-L/N star within `ANOMALY_BLACK_HOLE_REACH` of a neutron star rolls `ANOMALY_BLACK_HOLE_CHANCE`, then active or quiescent.

**RNG isolation.** Anomalies never draw from the galaxy or planet RNGs. The civilisation RNG is `seed ^ 0x6c8e9cf5`, and its first draw is the civilisation roll so `hasCivilization(seed)` answers without generating the galaxy; black holes use `seed ^ 0x3c6ef372`; each anomaly's seed is `galaxySeed ^ imul(hostId, 0x165667b1)`, which fixes integrity and the active flag, while render detail comes from `anomalyVisualRng`. Reordering the draws in `placeCivilization` moves anomalies in galaxies players have already explored. `anomalies.test.ts` checks every host against its rule.

**Catalogue.** `useAnomalyWatcher` (mounted in `App`) subscribes to `gameStore.system`: entering an uncatalogued host adds a record to `anomalyStore`, saves it to `users/{uid}/anomalies/{galaxySeed}-{systemId}` (`firebase/anomalies.ts`) and sets `latest`, which `AnomalyToast` shows for five seconds. That covers galaxy taps, Codex travel and restores in one place. `initAuth` calls `anomalyStore.setAll` before `restoreGalaxyAndSystem` so restoring into a host does not toast again. Codex forget removes the records inside whatever was forgotten, locally and in Firestore. Names, tiers, lore, rumours and survey notes live in `anomalyLore.ts`.

**System view** (`src/pixi/anomalies/`). `createAnomalyVisual` returns an `AnomalyVisual`: `nodes` added to `depthScene`, an `extent` passed to `createSystemCamera` as `extraExtent`, star and corona alpha, an optional nebula colour, and a per-tick `update`. Dyson shells, the brain's nested shells and the Shkadov mirror are `shellLattice.ts` panel sets with a clustered integrity mask, redrawn every frame into a back `Graphics` at `zIndex -SHELL_Z` and a front one at `+SHELL_Z`; for anything outside the sphere that split around the star at 0 is exact. Loose bodies — debris, the black hole, the lens, beam and jet segments — take `zIndex` from their own depth. The accretion disk is 16 wedges, each in its own squash container, so the half behind the horizon sorts under it. Every structure is selectable and opens `AnomalyPanel`, and `ShipHUD` shows a line for it in the system view.

**Galaxy view.** Dyson hosts are drawn dimmer, redder and smaller, and brain hosts with `createShroudedStarTexture`, through `StarNode`'s `display` override (`starDisplays` in `GalaxyWorld`). `anomalySigns.ts` adds the black hole's X-ray flicker, the Shkadov wake and the 12-segment beam straight to `galaxyRoot`, so they sort through the disk; they are re-projected in `orient()` and fade in above `ANOMALY_SIGN_MIN_SCALE` (`ANOMALY_BEAM_SIGN_MIN_SCALE` for the beam). Picking is unchanged, since every anomaly sits on a star.

**Supercluster.** Dots whose seed passes `hasCivilization` are collected when the field is built, and the tick blends their tint toward `SC_CIVILIZATION_TINT` between `SC_CIVILIZATION_TINT_MIN_SCALE` and `SC_CIVILIZATION_TINT_FULL_SCALE`.

**Archive and Codex.** `InfoPanel`'s Anomalies section shows one rumour for each uncatalogued kind, and the lore, count and first find once one is catalogued. Codex galaxy and system rows get a `◬` marker, and search matches anomaly names.

### Nebula color design

Nebula is a structure-driven tint layer: inner arm particles use cool blue/violet (`innerNebulaColors`), outer arm particles use the galaxy's `nebulaColors` palette, and core glow always uses warm white/gold (`CORE_COLORS`). Nebula color is never derived from individual star colors.

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

**Input:** left-drag pans and the wheel zooms as before (`useCamera`); shift-drag or right-drag
turns the field (`isOrbitGesture`). `useCamera` takes a `shouldPan` predicate so it declines the
orbit gesture rather than panning during it, and the tap handler ignores a pointertap that ended
an orbit drag.

**Navigation:** Tapping a dot (within `15 / camera.scale` px of its *projected* position, only
active at scale ≥ 0.5) marks it visited, records it in the Codex, calls `regenerateGalaxy(dot.seed)`, resolves the nearest
attractor (within `SC_ATTRACTOR_LABEL_MAX_DIST`), pushes address breadcrumbs, and switches `view`
to `'galaxy'`. Overlapping dots resolve to the frontmost by depth. Attractor resolution uses true 2D world distance, not the projected or 3D distance.

### `TopNavBar.tsx`

Purely decorative top-of-screen overlay (`aria-hidden`) — two angled SVG polylines (left/right) flanking a center notch, styled to match the HUD's cyan trapezoid line language. No state, no props.

### `ShipHUD.tsx` — navigation HUD

Bottom-of-screen trapezoid panel (SVG outline + tick marks), hidden when `showHUD` is off. It shows the address breadcrumb and the `x.y.z` coordinates of each supercluster/galaxy/system segment, flanked by trapezoid buttons:

- `Codex` (left) — opens the discovery drawer: search, travel to any recorded supercluster/galaxy/system, and a forget mode that deletes records locally and in Firestore.
- `NavBack` — pops the view/address stack (`system → galaxy → supercluster`), using the mounted view's `fireBackZoom` animation when available.
- `NavJump` — only active in the supercluster view; generates a new random supercluster behind a `fireCodexNavigate` zoom-out.

### Other overlays

- `ConfigPanel` — HUD, scan lines, attractor labels (supercluster view) and orbit rings (system view) toggles, plus the per-view `TutorialPanel`.
- `InfoPanel` — the "Stellar Archive" drawer describing each spectral class and the Anomaly Archive.
- `AnomalyPanel` / `AnomalyToast` — the anomaly detail panel (opened by `uiStore.anomalyPanelOpen`) and the first-discovery banner above the HUD.
- `LoginScreen` / `AuthButton` — Google sign-in gate and sign-out.
