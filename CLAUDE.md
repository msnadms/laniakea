# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # Type-check then build for production
npm run lint      # ESLint
npm run preview   # Serve the production build locally
```

`npm test` runs the vitest suite (projection, logistics and fabricator logic).

## Code style

Do not write code comments. The code should speak for itself; only add a comment when something is genuinely impossible to express in the code (e.g. an external constraint or a deliberate RNG-ordering requirement), and keep it to one line.

## Architecture

**Stack:** Vite + React 19 + TypeScript + PixiJS v8 (`@pixi/react`) + Zustand

### Layer separation

```
src/game/     — pure logic, no rendering
src/store/    — Zustand stores (consumed by both UI and Pixi layers)
src/pixi/     — PixiJS rendering components
src/ui/       — React DOM overlay components (config panel, system info)
```

### Galaxy generation (`src/game/`)

`galaxyGen.ts` generates a `Galaxy` from a seed using the **mulberry32 PRNG** (`createRng`). Every random decision—star positions, names, types, hyperlanes—flows from a single deterministic RNG instance, so the same seed always produces the same galaxy.

Three star populations are generated:
- **Bulge** – central cluster, K/M heavy (old stars)
- **Disk** – inter-arm background, dim K/M stars (`DISK_SIZE_SCALE = 0.6`)
- **Arms** – spiral arms, A/F heavy at inner end grading to G/K toward outer (star-forming regions)

**Hyperlanes** are derived from Delaunay triangulation (`d3-delaunay`) with distance cutoffs: same-arm pairs use the larger `MAX_LANE_DIST_ARM`, cross-arm/disk pairs use the tighter `MAX_LANE_DIST`.

`GalaxyConfig` (constructed from the RNG) holds per-galaxy variants: `numArms`, `galaxyEllipse`, `spiralTwist`, `numStars`, and nebula color palettes. All shape constants that don't vary per galaxy live in `constants.ts`.

### Rendering (`src/pixi/GalaxyStage.tsx`)

`GalaxyStage` wraps the `@pixi/react` `<Application>`. Inside it, `GalaxyWorld` is the main scene.

**Camera** is managed via mutable refs (`camera.current = { x, y, scale }`) — deliberately not React state to avoid re-renders on every frame. Pan via pointer drag, zoom via scroll wheel with cursor-anchored math. Shift-drag or right-drag turns the disk (`useOrbit`, shared with the supercluster via an `OrbitConfig`); `useCamera` takes a `shouldPan` predicate so it declines the orbit gesture, and the tap handler ignores a tap that ended one.

**The galaxy camera is orthographic** (`createGalaxyCamera`, `perspectiveStrength: 0`). That is what makes turning it affordable: the gas cannot be re-projected per particle per frame at ~10^5 particles, so it is baked flat and re-oriented by container transforms, and a container transform is affine while a perspective divide is not — with perspective on, the stars would drift off the gas as the disk turned. `galaxyDepthScale` gives the stars back a near/far size cue as a stylistic effect, the way `superclusterDepthScale` does. Tilt is clamped by `clampGalaxyTilt` clear of both edge-on (no click targets) and face-on (no depth). The opening tilt settle is just the camera starting `GALAXY_INTRO_TILT_OFFSET` flat of its target and letting the orbit ease carry it home.

**Nebula rendering** bakes once per galaxy in a `useEffect`, in **plane coordinates**. Particles are batched into a `Map<color, Particle[]>` so each unique color issues a single PixiJS `fill()` call, then bucketed into `GALAXY_GAS_SLABS` bands by **height** — height is what a yaw turn leaves alone, so a band's geometry survives the turn and only its screen offset moves. Each band is a `Graphics` inside a spin container (`rotation = yaw`) inside a squash container (`scale.y = cos(tilt)`, `y = -height * sin(tilt)`), which is the whole orthographic projection of a fixed-height point. The bands of one layer share a single filtered parent (`BlurFilter` + `DisplacementFilter`, animated per-frame via `Ticker.shared`) — a filtered container renders as one unit so nothing can sort into it, but no star ever falls between two bands of the same layer, so nothing needs to. Gas and core are two such layers.

Being baked flat, the gas cannot carry a per-particle depth tint, so `DepthFadeFilter` (`depthFadeFilter.ts`) reproduces `galaxyDepthAlpha` in the shader: depth is linear in screen y for a flat disk, so the fade is a vertical ramp, and the tick feeds it the galactic centre's screen y (`camera.y`) and the ramp's half-span in screen pixels. It must be a filter rather than a gradient alpha mask: pixi's `MaskFilter` sets `clipToViewport: false`, so a mask sizes its framebuffer from the masked container's *unclipped* global bounds — at the 24x zoom of the enter-system animation that exceeds `MAX_RENDERBUFFER_SIZE` and every draw that frame fails with an incomplete framebuffer.

**Stars are re-projected every frame the disk turns.** `StarNode` registers its container and sprite into a `StarViews` map and the tick writes transforms through `applyStarProjection` (`starView.ts`) — 700-odd stars are nothing to project, but re-rendering that many React components per frame would be. They are direct children of `galaxyRoot` with `zIndex = projected.depth`, so the near half of the disk sorts in front of the gas and the far half behind it.

**Background starfield** is split into two `Graphics` objects (dim ≤0.7 brightness, bright >0.7) so their alpha can be pulsed independently on each tick.

**Star picking** is resolved on the stage's `pointertap` in `GalaxyWorld`, not by a per-star `onClick`: PixiJS only fires a click when press and release resolve to the same object, and in the projected disk a one-pixel wobble between them lands on a neighbouring star's hit area and the click is dispatched on their common ancestor instead. The handler projects the pointer into `galaxyRoot` space and takes the nearest star within `min(GALAXY_PICK_SCREEN_PX / camera.scale, GALAXY_PICK_MAX_WORLD)`, breaking ties frontmost-first, and ignores taps that ended a pan or an orbit (`hasDragged` from `useCamera`, `didOrbit` from `useOrbit`). The same scan runs on `pointermove` to set the canvas cursor, so the cursor and the click agree at every zoom; `StarNode` is `eventMode="none"` and carries no hit area, keeping every star out of Pixi's hit-test tree.

**Star textures** (`src/pixi/textures.ts → createStarTexture`) are generated per star on a canvas: radial gradient core + 4 diffraction-spike ellipses composited with `destination-over`. Created inside `useMemo` in `StarNode` and destroyed on unmount — do not use module-level caches for PixiJS textures.

### `SolarSystem.tsx` — system view

`SolarSystemStage` wraps a `@pixi/react` `<Application>` (background `0x050810`); `SolarSystem` is the scene. Reads `system` from `gameStore` and `showOrbitRings` from `uiStore`.

**Planet generation** (`src/game/planetGen.ts → generateSystemLayout(seed)`): 3–7 planets per system placed in four radial zones determined by `getPlanetZone(idx, total)`:
- `hot` (inner 30%) — small rocky planets, rare moons, earth-tone colors
- `habitable` (30–50%) — medium rocky planets, possible moons, blue/green/brown palette
- `gas` (50–75%) — large gas giants with banded textures (`createGasGiantTexture`), rings common, up to 5 moons
- `ice` (75–100%) — ice giants, ringed, up to 3 moons, blue/violet palette

Orbit radii grow by a factor of 1.55–2.2 per ring from a base of ~380–500 units. A 40% chance asteroid belt is inserted between two adjacent planets, sized by gap index.

**Orbital speeds** use Kepler-like constants: `ORBITAL_K = 3500` for planets, `MOON_K = 430` for moons (both `/ orbitRadius^1.5`).

**Rendering layers** (bottom to top): nebula glow sprite (`createNebulaGlowTexture`, `screen` blend, alpha-animated) → orbit ring `Graphics` → optional asteroid belt → planets/moons → corona container → sun sprite.

**Sun:** `createSunTexture` sprite scaled to `starSize * 120 * 4` px, with a pulsing scale animation (`sin` wave). The corona is 12 long rays + 22 short rays drawn as `Graphics` lines in `screen` blend mode; it rotates continuously and oscillates in alpha.

**Planet bodies:** rocky/habitable → `createBodyGfx` (filled circle + specular highlight circle); gas/ice → `createGasGiantTexture` sprite. All planets get two concentric atmosphere glow circles. Ringed planets use a bezier half-ellipse technique: back half drawn first (behind the planet body), front half drawn last (in front), so the planet sits inside the ring plane correctly.

**Asteroid belt:** `createAsteroidBelt` draws 1250–2500 particles batch-drawn per color using a Gaussian radial distribution centered between adjacent orbit radii. Belt slowly rotates each tick.

**Orbit rings** toggled via `showOrbitRings` (uiStore); visibility is set imperatively on the stored `Graphics` refs when the toggle changes.

**Resources** (`generatePlanets`): each planet and moon gets resources matching its zone — hot→alloys, habitable→nutrients+alloys, gas→exotic, ice→exotic+nutrients. Named with Roman numerals (`System I`, `System II a`, etc.).

### Zustand stores

- `gameStore` — holds the active `Galaxy`, `supercluster`, `system` (active `StarSystem | null`), `regenerateGalaxy(seed?)`, `setSystem(system)`, `markSystemVisited(id)` actions
- `uiStore` — `view` (`'supercluster' | 'galaxy' | 'system'`), `showHyperlanes`, `showAttractorLabels`, `showOrbitRings`, address breadcrumb stack (`pushAddress`, `removeAddressType`); also owns ship resource state (`exoticMatter`, `helium3Reserves`, `alloys`, `nutrients`, `metallicHydrogen`, `neutronStarMatter`, `railgunAmmo`, `detectionRating`), upgrade tiers (`storageA/B`, `weaponA/B`, `driveA/B`, `logisticsA/B`) and the derived-cap helpers `computeStorageCap`, `computeWeaponCap`, `computeDriveMultiplier`, `computeLogisticsCap`, `computeMaterialBandwidth`
- `extractorStore` — placed `Extractor`s keyed by `ExtractorKey`; `peekAccumulated`/`collectExtractor` derive accrued resources from elapsed time (`ACCUMULATION_RATE_PER_MS`) scaled by `storageB`/`logisticsB` tiers. Also owns the extractor-upgrade-module system: `ownedUpgrades` (inventory) and `nodeEquipped` (per-extractor `[slot0, slot1]` upgrade ids, see `getExtractorMultipliers`). `receiveFabricatorItems` deposits finished fabricator output — materials/rares to `stockpileStore`, modules to `ownedUpgrades`
- `fabricatorStore` — placed `Fabricator`s and their `fabricatorStates` (per-fabricator production slots). See **Fabricator production model** below
- `stockpileStore` — the ship's uncapped hold of crafted goods: `materials` (intermediate materials, with `hasMaterials`/`consumeMaterials`/`addMaterial`) and `rares` (rare assemblies from advanced fabricators, `addRare`). Persisted via `firebase/stockpile.ts`
- `logisticsStore` — drone delivery `routes`, each a **DAG** over map-node ids (membership derived from `LogisticsRoute.edges`). See **Logistics routes are DAGs** below

### Fabricator production model

Fabrication is an **instant dispatch event**, not elapsed-time production. A
`FabricatorProductionSlot` persists only its target, priority, partial raw/material inputs, and
local byproducts. Basic fabricators include five slots and can configure a sixth; advanced
fabricators include eight. Buffer depth remains 3 batches for tier 1 and 5 for tier 2.

`processFabricator` is a pure fixed-point pass. It evaluates slots by configured priority,
processes every feasible batch, and makes new material output and byproducts available to later
slots during the same visit. It stops only when a complete pass makes no progress. Returned
`SlotRunResult`s describe batches, inputs, products, byproduct movement, jams, and shortages.

How much a slot may take per pass is the fabricator's `Fabricator.fillMode` (`SlotFillMode`), set
in `FabricatorSidebar` and persisted with the fabricator. `priority` (the default, and what every
old save loads as) lets each slot top up its whole `depth`-batch buffer before the next one draws.
`shared` starts the per-pass quota at one batch and raises it only when a complete pass makes no
progress, so priority still decides who goes first but only ever wins by a batch at a time and a
scarce input spreads across the slots. The split belongs to the fabricator, not to `RouteEdge`: an
edge terminates at a map node, which has no notion of slots and may host several fabricators.

Statuses are `idle`, `ready`, `starved`, `jammed`, and `flowing` (the last dispatch produced
output). A byproduct that cannot be consumed or routed fills its local buffer and jams its
producer. Changing a target refunds partial raw inputs to ship cargo and materials/byproducts to
the stockpile. Old timed save slots are migrated on load; queued and in-progress legacy output
is credited once before obsolete fields are removed.

### Logistics routes are DAGs

`LogisticsRoute` is `{ id, name, edges: { from, to }[] }` over **map-node ids**
(`extractorNodeId` / `fabricatorNodeId` in `game/types.ts`, one node per system per kind), not
entity keys; `resolveNodeGroups` maps a node id back to its extractors/fabricators.

**Membership is derived, not stored** — a node is on the route iff it has an edge, via
`routeNodes(edges)`. There is no node list to keep in sync and an isolated node is unrepresentable
by construction. `routeIsValid(edges)` requires an acyclic, weakly connected graph; the editor blocks cycles
at link time via `wouldCreateCycle`. In the UI this means clicking a node **opens its sidebar**
rather than toggling membership; you join a node to the route by dragging a link to it, and drop
it by cutting its links (or clicking it in the Flow chain, which unlinks it entirely).

`computeRouteCost` is priced for a **drone tour, not a ship jump** — the distinction the whole
automation loop rests on, since a route is dispatched over and over while the ship jumps once.
Exotic is a dispatch fee plus `hopExotic` summed over edges (free within a system,
`galaxyTravelCost` within a galaxy, `superclusterTravelCost` across galaxies in a supercluster,
flat fallback otherwise) scaled by `ROUTE_HOP_DISCOUNT`, because drones fly the DAG one way rather
than the ship's round trip. Helium is **not** the ship's flat `HELIUM_PER_JUMP` per edge: that
made cost scale with topology while income did not, so every added node taxed every future
dispatch and an eight-edge network cost more helium per run than its extractors made in a day.
Instead it is a small `ROUTE_HELIUM_PER_HOP` plus `ROUTE_HELIUM_PER_UNIT` per unit moved, so the
bill tracks cargo delivered rather than mere network size, and a large idle network is nearly free
to keep running. Hub-and-spoke still prices correctly because hops are summed over edges.

Exotic carries the same weighting for the same reason. Geography alone must never dominate the
bill: a sprawling multi-galaxy network reached ~500 exotic per dispatch of which the throughput
term was under 5%, leaving the player no lever but deleting nodes — the topology tax the helium
change had just removed, surviving in the other resource. `ROUTE_HOP_DISCOUNT` and
`ROUTE_EXOTIC_PER_UNIT` are therefore balanced against each other so that hauling more costs more
and a wasteful route reads as wasteful. Exotic still leans harder on distance than helium does,
because distance pressure is what pushes the player outward.

A route can cost more fuel than the ship can physically hold (`computeStorageCap`), which is a
wall rather than a price — no amount of extraction fixes it, only a storage upgrade or a colony
sponsor. `optimizedRoutePreview` therefore separates that hold from ordinary poverty with its own
reason string. The test is `cost > tank`, not `cost + reserve > tank`: breaching only the fuel
floor is ordinary insufficiency and must stay manually dispatchable, since the modal's manual
override keys off the `'Insufficient route fuel'` reason.

`dispatchRoute` traverses in topological order carrying a per-node `Cargo` (`raw` + `materials`).
At each node it collects from extractors, feeds fabricators, and **carries finished materials
forward along out-edges** rather than dumping them to the ship — so one dispatch can run
extractor → fab A → fab B and bring the end product home. Branches always split by downstream
demand and support raw/material filters, a `materialDraw` cap, and a `hold`/`stockpile` surplus
choice. There are no edge priorities or weights: an explicit filter exempts an edge from demand
capping, and everything else is demand-proportional. Each edge independently enforces
`computeMaterialBandwidth`. Equal choices use stable lexical tie-breaking, so edge creation order
cannot change results.

Raw reserves live on the **extractor** (`Extractor.reserve`, "leave in ground"), not on edges, so
one source cannot carry conflicting per-edge reserves. The fuel floor is one ship-wide pair
(`uiStore.fuelReserveExotic` / `fuelReserveHelium3`) rather than per-route, since every route
draws from the same tanks.

Routes are activated under a `dispatchMode` (`fill` waits for `sourceFillPercent`, `batch` waits
for a craftable batch) plus detection-ceiling and jam policies. `restoreRoutes` migrates older
saves: `unitCap`→`materialDraw`, `overflow: 'next'`→`'stockpile'`, `requireRecipeReady`→`batch`,
and the largest legacy `minimumShipReserve` seeds the global fuel floor; edge priority, weight,
per-edge reserves, and the `quiet` flag are dropped.
An automated route that cannot afford fuel or would breach its detection ceiling **holds** (staying active
and retrying as detection decays); only `pauseOnJam` deactivates it, since a jam needs the player.
Route risk is spent through `raiseDetectionBy` (detection points), not `raiseDetection` (a 0-1 probability).
`useLogisticsAutomation` runs the same `dispatchRoute` path as manual operation and persists each
completed run.

**The intended cadence is a check-in every day or so, not a watched tab.** Three things carry that.
`runAutomation` skips a route whose dry run moves less than `MIN_DISPATCH_UNITS` and expects no
batch, so a trickle of demand cannot bleed a full dispatch fee. Extractors already accrue offline
from `lastCollectedAt`, but routes do not, so the automation hook's **first** tick calls
`catchUpAutomation` instead of `runAutomation` — it re-dispatches until a pass yields nothing
(bounded by `AUTOMATION_CATCHUP_PASSES`), converting a day of banked extractor output in one go
rather than over an hour of real time. Because detection heat is charged per dispatch and cannot
decay during a synchronous catch-up, the hook hands `catchUpAutomation` the offline span and it
opens a `catchUpDetectionCredit` — the heat the ship *would* have shed while away, capped at
`AUTOMATION_CATCHUP_CREDIT_CAP` — that each dispatch spends before charging real heat. Without it
the headroom for converting an absence would be the constant `detectionCeiling` no matter how long
that absence was, so a week away would pay no better than an hour. The credit is cleared when the
catch-up returns. It terminates on its own because each pass drains the
extractors below `sourceFillPercent`, and it cannot run away because the detection ceiling holds
the route once accumulated heat plus risk crosses it (and the credit is finite). `AUTOMATION_POLL_MS` is 60s: an extractor
gains a fraction of a unit per tick at any realistic rate, so polling faster buys nothing and
multiplies the Firestore fan-out.

**Detection risk** (`routeDetectionRisk`) models warp-drive signatures from dispatched drones, so it
is **route-scoped per dispatch** and prices *traffic concentration*, never distance — distance is
already paid in fuel by `hopExotic`. Risk is `Σ over superclusters m(m-1)/DETECTION_DENSITY_DIVISOR`
where `m` is the route's hops inside that supercluster, plus `DETECTION_CROSSING_POINTS` per
supercluster-crossing edge. Working many hops through one region is what gets you found; a long jump
to a fresh supercluster is nearly free, which is the point — the meter exists to push the player
outward. `dispatchRoute` charges the risk as **fractional heat** (`raiseDetectionHeat`), not as
whole bars — with `DETECTION_HEAT_PER_BAR` at 1 that means every dispatch of a route larger than a
few hops is visible on the meter, and the sustainable size of a single route is set by where its
per-dispatch risk crosses the passive decay rate.

A **Signal Dampener** *weights down* the hops incident to its station rather than erasing them: an
edge counts as `DETECTION_DAMPENED_HOP_WEIGHT` per dampened endpoint (a node counts as dampened
when it has extractors and all of them are dampened), so a fully masked route floors at a residual
instead of zero. Zeroing was the wrong shape — in the usual extractor-leaves-into-a-fabricator-hub
topology every edge is extractor-incident, so one module per extractor bought permanent immunity
and the meter stopped existing.

Passive decay scales with the drone fleet: `computeDetectionDecayPerMs(logisticsA)` multiplies the
base rate by `DETECTION_DECAY_LOGISTICS_MULT`. Decay is global while `logisticsA` also raises the
route cap, so without this a player who bought more routes got heat they could not shed and the
whole network parked at its ceiling — the upgrade paid for throughput the detection budget could
not fund. `resolveAutomationPolicy` clamps `detectionCeiling` to `MAX_DETECTION_CEILING` (4), one
bar clear of the lethal 5, so no automated dispatch can land on death.

### Recipe data

Every recipe is a `Craftable` (`ALL_CRAFTABLES`, `getCraftable`) with `cost` (raw), `materials`
(intermediates), `category`, plus `outputs` (units per craft), `byproducts`
(deposited into the slot's byproduct buffer) and `produces` (the id actually deposited — this is
how **alternate recipes** work: `graphene_lattice_carbide` produces `graphene_lattice`).

In `src/data/materials.ts`: `CRAFTABLE_MATERIALS` excludes `byproductOnly` entries (no recipe, so
never a fabricator target) and `STOCKED_MATERIALS` excludes alternates (so a material appears
once in the stockpile UI). Use those, not raw `CRAFT_MATERIALS`, when listing materials in UI.

### Nebula color design

Nebula is a structure-driven tint layer: inner arm particles use cool blue/violet (`innerNebulaColors`), outer arm particles use the galaxy's `nebulaColors` palette, and core glow always uses warm white/gold (`CORE_COLORS`). Nebula color is never derived from individual star colors.

### `Supercluster.tsx` — supercluster view

The top-level zoom level above individual galaxies. `Supercluster` wraps a `@pixi/react` `<Application>`; `SuperclusterWorld` is the scene.

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
active at scale ≥ 0.5) marks it visited, calls `regenerateGalaxy(dot.seed)`, resolves the nearest
attractor (within `SC_ATTRACTOR_LABEL_MAX_DIST`), pushes address breadcrumbs, and switches `view`
to `'galaxy'`. Overlapping dots resolve to the frontmost by depth. Travel cost and attractor
resolution still use true 2D world distance, not the projected or 3D distance.

### `TopNavBar.tsx`

Purely decorative top-of-screen overlay (`aria-hidden`) — two angled SVG polylines (left/right) flanking a center notch, styled to match the HUD's cyan trapezoid line language. No state, no props.

### `ShipHUD.tsx` — ship HUD overlay

Bottom-of-screen HUD rendered as a fixed-position trapezoid panel (SVG outline + tick marks). Composed of small `memo`-wrapped subcomponents:

- `StatBar` / `VerticalCargoBar` — horizontal and vertical fill bars for resource rows (exotic matter, helium-3, railgun ammo) and cargo (alloys/nutrients/metallic hydrogen/neutron star matter via `CargoIcons`); both go into a "low" visual state under 25% fill.
- `DetectionBars` — 5-segment discrete meter (not a continuous bar) for `detectionRating`.
- `NavBack` / `NavRegen` — trapezoid nav buttons; `NavBack` pops the view/address stack (`system → galaxy → supercluster`), `NavRegen` re-rolls the supercluster (cost-gated by `driveA`, see `travelCosts.ts`), both can trigger the Pixi `fireBackZoom`/`fireCodexNavigate` transition animations.
- `LogisticsSystem` — owns the open/closed state for the drone logistics panel; renders `LogisticsButton` ("AUTO") plus `LogisticsModal` when open.
- `UpgradesButton` — toggles `ShipUpgradePanel` (ship workshop) via `uiStore`.

All values are read individually via separate `useUIStore` selectors (not a single destructure) to keep re-renders scoped to the rows that actually changed. `hudFlash` (bumped on failed/blocked actions) replays a CSS alert animation by toggling a class via `useEffect` + `animationend`; `hudNotify`/`hudNotifyMsg` drive a transient toast-style message keyed by the counter so repeated identical messages still re-trigger the animation.

### Logistics network (`LogisticsModal.tsx`, `LogisticsMap.tsx`, `logisticsStore.ts`)

The logistics modal is split into two files: `LogisticsMap.tsx` owns map projection/rendering (pure-ish, no route-editing logic), `LogisticsModal.tsx` owns the route editor, dispatch flow, and inventory/fabricator sidebars.

**`LogisticsMap.tsx`:**
- `projectNodes` collapses extractors/fabricators into one map node per system (`getSystemKey`/`fabricator:` prefix for fabricators), then projects them onto a fixed `MAP_SIZE` (320) SVG canvas. Single-galaxy routes project using system-local coordinates; multi-galaxy routes blend galaxy-level and system-level offsets (`SYS_TO_SC` ratio) so stations in different galaxies still spread out sensibly.
- Node positions are normalized against the median distance from centroid (clamped to 3× median) rather than the max, so one outlier station doesn't compress everything else into the center; `resolveOverlaps` then iteratively pushes overlapping nodes apart (up to 8 passes).
- `StationMap` renders nodes as circles with a resource-type icon (`ICON_PATHS` from `CargoIcons`, or a diamond for fabricators), draws the route's dashed directional edges, and highlights the node currently active in a dispatch animation. It also owns **edge editing**: pointer-down on any node starts a rubber-band drag (green when `canLink` allows the link, red otherwise), releasing over another node calls `onAddEdge`, and clicking an edge's invisible fat hit-line calls `onRemoveEdge`. A plain click calls `onNodeClick`, which docks that node's sidebar; a `draggedRef` suppresses the click that would otherwise fire at the end of a drag.
- Fabricator nodes get a status ring colored by `SlotStatus` (solid for `flowing`, dashed otherwise); edges show measured last-run material use/capacity and expose cargo composition on hover. Disconnected islands receive a red warning ring.

**`LogisticsModal.tsx`:**
- Left panel lists saved `LogisticsRoute`s (capped by `logisticsA` tier) with dry-run readiness, expected edge demand, shortages, route-scoped risk, activation controls, and fabricator warnings.
- Middle panel edits the weakly connected DAG plus each edge's filters, material draw, and surplus behavior. It also configures activation policy; per-extractor reserves live in `NodeSidebar` and the shared fuel floor in the Reserves tab. Clicking a node docks `NodeSidebar` or `FabricatorSidebar`; fabricator slots show partial buffers, priority controls, last-run batches/shortages, byproducts, and status.
- Right panel (440px) tabs between **Reserves**, **Materials**, and **Modules**. Every group is a collapsible `Section`; recipe tooltips describe inputs and instant-dispatch output rather than craft time.
- `FabricatorSidebar` also exposes a per-fabricator **Draw from Hold** toggle (`Fabricator.drawFromHold`,
  set via `fabricatorStore.setDrawFromHold`). While it is on, the fabricator feeds itself from the ship's
  own cargo (minus the ship-wide fuel floor) and stockpile materials, capped by `computeMaterialBandwidth`,
  so it runs without being on a route. `runHoldFeeds` performs that pass for every enabled fabricator on
  each `useLogisticsAutomation` tick, in sorted key order so a scarce hold is split the same way every run
  (`loadFromHold` runs the same `processFabricator` code as dispatch and deposits output through
  `receiveFabricatorItems`); flipping the toggle on also feeds once immediately.
  `previewHoldFeed` drives the sidebar's "next draw" summary line.
- `handleDispatch` snapshots pre-dispatch accumulated amounts, calls `dispatchRoute`, then builds a `DispatchAnim` (per-node reveal of cost/collection lines, 500ms per hop) purely for visual feedback — the actual resource transfer already happened synchronously in the store.
- All mutations that affect Firebase-backed state (`ownedUpgrades`/`nodeEquipped`, fabricator states, routes, extractor `lastCollectedAt`) are mirrored to Firestore (`firebase/extractorUpgrades.ts`, `firebase/fabricators.ts`, `firebase/logisticsRoutes.ts`, `firebase/extractors.ts`) immediately after each local store update. The post-run fan-out shared by manual dispatch, hold feeding and automation lives in one place — `store/persistRun.ts → persistFabricatorRun(uid, { fabricatorKeys, extractorKeys })` — so a new feed path cannot forget one of the writes.

### Fabricator crafting

Fabricators are the crafting layer — named `Fabricator` in code, UI strings and the Firestore `fabricators` collection alike. Firestore loaders retain one-time compatibility for the older `settlements` collection, `first_colony` quest id, timed production slots, pending outputs, and ordered `nodeKeys` routes. Every recipe — intermediate material or extractor module — is a `Craftable` (`src/data/upgrades.ts → ALL_CRAFTABLES`, looked up with `getCraftable`); see **Recipe data** above for the full field set.

**Intermediate materials** (`src/data/materials.json`, typed re-export in `materials.ts`) are real-science intermediates in three tiers (`MATERIAL_TIER_LABELS`: Refined → Engineered → Exotic) — graphene lattice, boron nitride ceramic, deuterium slush, silica aerogel, tritium residue; high-entropy alloy billet, YBCO tape, metamaterial film, BEC cell, tritium getter bed; Casimir plate stack, Penning positron trap, degenerate matter core, muon-catalysed fusion cell. Higher tiers consume lower tiers, so the tree bottoms out in raw extractor output. The graph is deliberately **wide, not linear**: every tier-1 material feeds several downstream recipes so tier-1 demand competes. Two materials have alternate routes (`graphene_lattice_carbide`, `silica_aerogel_vacuum`) trading a different raw mix for a better yield.

**Extractor upgrade modules** (`src/data/upgrades.json`, typed re-export in `upgrades.ts`): data-driven defs (`EXTRACTOR_UPGRADES`) with raw `cost`, intermediate `materials`, and `effect` (`rate`, `storage`, or `detection` `upgType` + `multiplier`). Modules sit at the top of the tree and are earned only via fabricator production, then equipped two-per-extractor; a `detection` module (Signal Dampener) excludes that extractor from `routeDetectionRisk` entirely rather than reducing a numeric detection value.

**Advanced fabricators** are the second fabricator tier (`Fabricator.tier`: `1` basic, `2` advanced; `FABRICATOR_TIER_LABELS`). They are not built directly: a planet only offers a basic fabricator, and an existing tier-1 fabricator is upgraded in place from `PlanetPanel` (`fabricatorStore.upgradeFabricator`) by paying `FABRICATOR_UPGRADE_COST` in raw resources plus `FABRICATOR_UPGRADE_MATERIALS` from the stockpile, so a basic fabricator has to run before one can exist. They craft everything a basic fabricator can, plus the `'rare'` category: **rare assemblies** (`src/data/rareResources.json`, typed re-export in `rareResources.ts`) — neutronium keel, zero-point capacitor, antihydrogen reservoir, frame-dragging gyroscope, closed ecology column — grouped by `role` (`RARE_ROLE_LABELS`) and reserved for player bases. Rare recipes take raw resources plus tier-2/3 intermediates, and their output lands in `stockpileStore.rares` rather than `materials`. `fabricatorCanCraft(tier, category)` gates rare targets to tier 2 in both `setSlotTarget` and `feedFabricator`; the slot picker only lists rare sections for an advanced fabricator, and advanced nodes render amber (rather than green) on the logistics map and in-system.

On dispatch, each visited fabricator immediately emits every feasible batch. Materials ride eligible route edges and are available to downstream fabricators in the same topological traversal; sink output is deposited by `receiveFabricatorItems`. A route that cannot collect, process, or deliver useful cargo returns without charging fuel.
