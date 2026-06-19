# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # Type-check then build for production
npm run lint      # ESLint
npm run preview   # Serve the production build locally
```

No test suite exists in this project.

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

**Camera** is managed via mutable refs (`camera.current = { x, y, scale }`) — deliberately not React state to avoid re-renders on every frame. Pan via pointer drag, zoom via scroll wheel with cursor-anchored math.

**Nebula rendering** runs once per galaxy in a `useEffect`. Particles are batched into a `Map<color, Particle[]>` so each unique color issues a single PixiJS `fill()` call. The nebula uses `BlurFilter` + `DisplacementFilter` (animated per-frame via `Ticker.shared`) for organic movement.

**Background starfield** is split into two `Graphics` objects (dim ≤0.7 brightness, bright >0.7) so their alpha can be pulsed independently on each tick.

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
- `uiStore` — `view` (`'supercluster' | 'galaxy' | 'system'`), `showHyperlanes`, `showAttractorLabels`, `showOrbitRings`, address breadcrumb stack (`pushAddress`, `removeAddressType`)

### Nebula color design

Nebula is a structure-driven tint layer: inner arm particles use cool blue/violet (`innerNebulaColors`), outer arm particles use the galaxy's `nebulaColors` palette, and core glow always uses warm white/gold (`CORE_COLORS`). Nebula color is never derived from individual star colors.

### `Supercluster.tsx` — supercluster view

The top-level zoom level above individual galaxies. `Supercluster` wraps a `@pixi/react` `<Application>`; `SuperclusterWorld` is the scene.

**Data model** (`SuperclusterData` from `gameStore`):
- `dots` — individual galaxy dots (`SuperclusterDot`: `x`, `y`, `z`, `seed`, `brightness`, `visited`, `name`)
- `attractors` — named gravitational attractor regions (galaxy groups/clusters within the supercluster)
- `backgroundStars` — fixed screen-space starfield

**Rendering:**
- Dots are bucketed into 5 `BRIGHTNESS_TIERS` (yellow → orange → pink → violet → purple) and batch-drawn with a `BlurFilter` + `screen` blend mode for a glow effect.
- Visited dots get a white circle outline drawn around them.
- Attractor labels and the supercluster title are rendered via `createPointerLabel` (from `labels.ts`). Attractor label visibility is toggled by `showAttractorLabels` and hidden when zoomed out below scale 0.25.
- A displacement filter (`createDisplacementSetup`) animates the dot field organically.
- A `ScaleBar` converts world pixels to Million Light Years (`SC_WORLD_HALF_MLY / SC_WORLD_HALF`).

**Navigation:** Tapping a dot (within `15 / camera.scale` px, only active at scale ≥ 0.5) marks it visited, calls `regenerateGalaxy(dot.seed)`, resolves the nearest attractor (within `SC_ATTRACTOR_LABEL_MAX_DIST`), pushes address breadcrumbs, and switches `view` to `'galaxy'`.
