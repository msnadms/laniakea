# Pixi Projected-3D Galaxy View Plan

## Goal

Give the galaxy map the same tilted, volumetric presentation as the projected system view,
while keeping PixiJS as the renderer and preserving deterministic generation, star
selection, the galaxy-to-system zoom transition, the scale bar, and current performance.

The target is projected 3D, or 2.5D, on a **fixed camera angle**. Stars, nebula particles,
and the core glow are placed in three dimensions, projected once per galaxy, and drawn in
depth order. The galaxy is static geometry, so unlike the system view there is no per-frame
projection work at all.

The finished view should provide:

- a visibly tilted galactic plane with real disk thickness;
- a spheroidal core bulge rather than a flat rotated ellipse;
- bright stars reading as embedded inside the nebula rather than pasted over it;
- an unchanged star-selection experience at every position;
- an exact scale bar;
- no change to the seed-to-galaxy contract;
- no measurable per-frame cost over the current view.

Implement phases in order. Every phase should leave the galaxy view usable.

---

## Rendering decision

Reuse the projection approach already shipped for the system view. `systemProjection.ts`
is already geometry-agnostic: `projectSystemPoint` takes any point, any camera, and returns
`{ x, y, depth, scale }`. Only `createSystemCamera` and `getSystemExtent` are layout-bound.
Promote the module to a shared `src/pixi/projection.ts` and give the galaxy its own camera
factory.

Do not introduce a second projection implementation, a mesh pipeline, or Three.js. The
galaxy needs less machinery than the system view did, not more.

### Orthographic, not perspective

**Reversed after the Phase 3 checkpoint.** The galaxy now uses
`focalLength: GALAXY_RADIUS * 3`, `perspectiveStrength: 0.5` — first tried at `0.8`, which
read as fish-eyed, and dialled back to a 1.37x near-to-far size gradient.

The reasoning below is sound but rests on a false premise: that "tilt and depth ordering
supply essentially all of the perceived depth". They supply none. An orthographic tilt of a
flat disk is *the same operation* as a vertical squash — projected X equals plane X and
projected Y equals plane Y times `cos(tilt)`, and there is no other information in the
image. Depth ordering adds nothing either, because screen-blended star sprites do not
occlude. The view read as a squashed 2D galaxy, because that is exactly what it was.

Perspective is the one cue that survives a near-flat, non-occluding particle field, and it
needs a genuinely short focal length: at the `GALAXY_RADIUS * 8` proposed below the near/far
size difference is 4.5%, which is invisible, and correctly described as negligible.

The scale bar cost is real but narrow, and is now pinned by a test: at zero depth the
perspective factor is exactly 1, so the linear world-pixel-to-light-year conversion stays
exact along the horizontal line through the galactic centre — the axis the bar measures.
`projectSystemPoint` also floors the perspective denominator at a tenth of the focal length,
so no outlier can invert the projection.

The original argument follows.

Use `perspectiveStrength: 0` for the galaxy.

A galaxy is viewed from a distance where perspective foreshortening across the disk is
physically negligible, and mild perspective would silently break the scale bar, which
converts world pixels to light years with a single linear factor
(`GalaxyStage.tsx`, `radiusLy / GALAXY_RADIUS`). Tilt and depth ordering supply essentially
all of the perceived depth. Keep the projection module perspective-capable so the decision
stays reversible.

### Zero yaw

Use `yaw: 0` for the galaxy camera.

`GalaxyConfig.orientation` already rotates the whole galaxy in its own plane, and is
already applied inside `place()` in `galaxyShapes.ts`. Camera yaw would duplicate that with
no added variety while destroying the scale bar's exactness. With zero yaw and orthographic
projection, screen X maps 1:1 to disk X, so the scale bar stays literally correct along the
horizontal axis. Per-galaxy visual variety comes from `orientation`, as it does today.

---

## Current-state findings

1. The galaxy is pure 2D. `StarSystem` has `x` and `y` only; `sampleStar` and
   `galaxyShapes.ts` produce two-dimensional placements through `place()`.
2. **Nothing in the galaxy animates.** Star positions are static; only nebula alpha,
   background-star pulsing, and the displacement filter move. Projection is therefore a
   one-time bake per seed, not a ticker workload.
3. `StarNode` is a `pixiContainer` at `x={system.x} y={system.y}` with a local `Circle`
   hit area at the container origin. If projected coordinates are written to the container,
   **picking keeps working with no changes** — the whole hit-testing phase the system view
   needed does not recur here.
4. `config.galaxyEllipse` (0.75–1.0) is applied as a Y-squash inside `place()` and again to
   nebula particle offsets in `GalaxyStage.tsx`. It is a *fake tilt*. A real tilt would
   compound with it and over-flatten every galaxy.
5. The nebula is roughly 30k–60k particles (`NEBULA_PARTICLES_PER_STEP = 1000` across
   `NEBULA_STEPS` per arm) batched by color into a single `Graphics`, with `BlurFilter` and
   `DisplacementFilter` applied to the containing `Container`. Batching must survive.
6. A filtered container is rendered as one unit. Display objects outside it cannot sort into
   it. Any star/nebula depth interleaving therefore costs one extra filter pass per nebula
   slab, which is why interleaving is deferred to its own phase and treated as optional.
7. The core glow samples a rotated ellipse with a lens-shaped half-width. It is a 2D
   silhouette standing in for a 3D bulge.
8. `generateGalaxy` already demonstrates the isolated-RNG pattern: the neutron-star pass
   uses `createRng((seed ^ 0x4e5a6b7c) >>> 0)` specifically so the primary sequence and all
   star positions are unaffected. Height sampling must use the same trick.
9. `handleSelectSystem` in `GalaxyStage.tsx` anchors the zoom transition on raw `sys.x` and
   `sys.y`. Those become projected coordinates.
10. `BackgroundStars` is screen-space with its own parallax and is unaffected.
11. Hyperlanes are described in `CLAUDE.md` but are not currently rendered anywhere. They
    are out of scope; the plan only has to leave them projectable.

---

## Coordinate and camera model

### Coordinate system

Match the system view's axes so one projection module serves both:

- `x`: horizontal coordinate in the galactic plane;
- `z`: depth coordinate in the galactic plane;
- `y`: height above or below the galactic plane.

The galactic center is `(0, 0, 0)`. Generation continues to produce in-plane coordinates as
it does today; the existing 2D `y` becomes galactic-plane `z`:

```ts
{ x: placedX, y: sampledHeight, z: placedY }
```

This is a pure renaming at the projection boundary. `galaxyShapes.ts` keeps returning
`[x, y]` pairs in plane coordinates and does not need to learn about the third axis.

### Camera state

```ts
export interface GalaxyCamera3D {
  yaw: 0;
  tilt: number;
  focalLength: number;
  perspectiveStrength: 0;
}
```

Initial values:

- `tilt`: approximately 62 degrees away from face-on — slightly flatter than the system
  view's 58 so spiral structure stays legible;
- `yaw`: `0`, per the decision above;
- `focalLength`: `GALAXY_RADIUS * 8`, unused while perspective strength is zero but kept
  safely above any achievable depth;
- `perspectiveStrength`: `0`.

The camera is render-only. It does not belong in Zustand, in save data, or in the address
breadcrumb stack.

### Disk thickness

Add a scale height per star population, expressed as a fraction of `GALAXY_RADIUS`. Real
galaxies are extremely thin relative to their radius; the values below are deliberately
exaggerated for legibility but should stay small enough that the disk still reads as a disk.

| population  | scale height | shape                |
|-------------|--------------|----------------------|
| `arm`       | `0.012`      | thin, star-forming   |
| `bar`       | `0.020`      | thin                 |
| `disk`      | `0.030`      | thicker old disk     |
| `starburst` | `0.045`      | irregular clumps     |
| `bulge`     | `0.110`      | spheroid             |
| `halo`      | `0.180`      | thickest, sparse     |

Sample height as a sum of two uniforms minus one — the same cheap Gaussian approximation
already used for nebula and core offsets — times the scale height, so most stars sit near
the plane and outliers are rare.

Bulge and halo stars should additionally be pulled toward a spheroid rather than a slab:
scale their height by their in-plane radius relative to the bulge extent, so the bulge reads
as a ball and not a thick coin.

### Determinism

Sample every height from an isolated RNG:

```ts
const heightRng = createRng((seed ^ 0x1b873593) >>> 0);
```

seeded after all positions exist, in a second pass over the finished array — exactly as the
neutron-star pass does. This guarantees the primary sequence is untouched, so **star count,
positions, types, names, sizes, and per-system seeds are all identical to today for every
existing seed.**

Be explicit about what this does *and does not* preserve: the seed-to-galaxy contract holds,
but the rendered silhouette of every existing galaxy changes, because tilting the disk is
the entire point of the project. Screenshots and any saved discovery records that assumed a
face-on layout will look different. Nothing in game state depends on it.

### Projection invariants

- The galactic center projects to `(0, 0)`.
- With zero tilt, the projected galaxy is pixel-identical to the current view.
- With zero yaw and zero perspective strength, projected X equals plane X exactly, so the
  scale bar remains exact.
- Plane `z` compresses by `cos(tilt)`; height `y` contributes `-sin(tilt)` to screen Y.
- Near-side points have greater depth.
- Projecting the same seed and camera is deterministic.

---

## Target scene structure

```text
stage
  BackgroundStars (screen space, unchanged)
  worldRef (pan/zoom camera, unchanged)
    galaxyRoot
      nebulaContainer (blur + displacement filter, unchanged)
        coreGfx    (projected spheroid bulge)
        nebulaGfx  (projected disk particles)
      depthScene (sortableChildren = true)
        StarNode containers at projected positions, zIndex = depth
  ScaleBar (screen space, unchanged)
```

`galaxyRoot` sits inside the existing world camera, so pan, wheel zoom, the intro zoom, the
back zoom, and the scale bar all keep using the current camera ref with no changes.

The nebula stays below the star layer as one filtered unit in the base implementation.
Phase 4 evaluates splitting it.

---

## Phase 1 - Shared projection module and galaxy camera

**Why:** the galaxy should not get a second copy of the projection math, and the tilt should
be switchable so every later phase can be compared against the current view.

### Work

- Rename `src/pixi/systemProjection.ts` to `src/pixi/projection.ts` and
  `systemProjection.test.ts` to `projection.test.ts`. Keep every existing export and its
  behavior; rename `SystemPoint3D` / `ProjectedSystemPoint` / `SystemCamera3D` to
  `Point3D` / `ProjectedPoint` / `Camera3D`, re-exporting the old names if that keeps the
  `SolarSystem.tsx` diff small.
- Add `createGalaxyCamera()` returning the fixed galaxy camera described above.
- Add a `GALAXY_TILT` constant to `src/game/constants.ts` alongside the other camera
  constants.
- Do not change any rendering yet. Land this with the galaxy still drawn face-on.

### Tests

Extend `projection.test.ts` with galaxy-specific cases:

- zero tilt reproduces input plane coordinates exactly;
- orthographic tilt compresses plane `z` by `cos(tilt)` and leaves plane `x` untouched;
- height above the plane moves a point up-screen and increases depth as expected;
- depth ordering across the near and far edges of `GALAXY_RADIUS`;
- the galaxy camera reports zero yaw and zero perspective strength, so the scale-bar
  assumption is enforced by a test rather than by convention.

### Acceptance

- The system view is visually unchanged.
- The galaxy view is visually unchanged.
- `npm run build`, `npm run lint`, and `npm test` pass.

**Files:** `src/pixi/projection.ts`, `src/pixi/projection.test.ts`,
`src/pixi/SolarSystem.tsx`, `src/game/constants.ts`.

---

## Phase 2 - Star heights, projected placement, and depth sorting

**Why:** this is the minimum slice that produces a three-dimensional galaxy, and it is the
checkpoint that decides whether the remaining phases are worth doing.

### Generation

- Add `z: number` to `StarSystem` in `game/types.ts` as the height above the galactic plane.
  Name it `z` for consistency with `SuperclusterDot`, and document that it is a height while
  the field named `y` is a plane coordinate.
- Add a `population: StarPopulation` field, or a compact height-only field, so the renderer
  can reason about scale height. `populations[]` already exists inside `generateGalaxy`; the
  simplest change is to sample the height there and store only the result.
- Sample heights in a second pass using the isolated `heightRng`.
- Persisted discovery records in `firebase/discoveries.ts` may carry the new field; treat a
  missing `z` as `0` on load so pre-existing records still resolve.

### Rendering

- Give the star layer container `sortableChildren = true`.
- In `StarNode`, project once with `useMemo` keyed on the system and camera, then set the
  container `x`, `y`, and `zIndex` from the result. The projection is per-star and static;
  it must not run on the ticker.
- Multiply the existing sprite scale by `projected.scale`, which is exactly `1` under
  orthographic projection — a no-op today, and correct if perspective is ever enabled.
- Leave the hit area, `eventMode`, cursor, visited ring, current ring, and texture creation
  untouched.

### Navigation

- Update `handleSelectSystem` in `GalaxyStage.tsx` to anchor `animateZoomTo` on the star's
  projected coordinates rather than `sys.x` / `sys.y`.
- Leave the address breadcrumb payload on the unprojected plane coordinates
  (`buildAddressComponent(sys.name, sys.x, sys.y, 0, 'system')`). Breadcrumbs describe game
  space, not screen space. Consider passing the sampled height as the `z` argument, which
  the component already accepts and currently receives as `0`.
- Verify the back-zoom path in `useZoomController`, whose `getCurrentPos` returns the
  current system, projects the same way.

### Acceptance

- The galaxy is visibly tilted and the arms read as an inclined disk.
- The bulge reads as a thickened core rather than a flat ellipse.
- Every star is still clickable, including near the top and bottom edges of the disk.
- Selecting a star zooms to the correct on-screen position with no jump at handoff.
- Back navigation from the system view returns to the correct place.
- Star count, types, names, and per-system seeds are identical to the previous build for a
  fixed seed. Assert this with a test over several fixed seeds.
- No new per-frame work appears in a profile.

**Files:** `src/game/types.ts`, `src/game/galaxyGen.ts`, `src/pixi/StarNode.tsx`,
`src/pixi/GalaxyStage.tsx`, `src/firebase/discoveries.ts`.

---

## Phase 3 - Nebula thickness, projected clouds, and a spheroidal core

**Why:** projected stars over a face-on nebula would contradict each other immediately, and
the nebula is what actually sells the galaxy's volume.

### Reinterpreting `galaxyEllipse`

`galaxyEllipse` is currently doing the job the tilt is about to do. Leaving it at 0.75–1.0
under a 62-degree tilt compounds to roughly a 0.35–0.47 vertical squash, and every galaxy
becomes a sliver.

Recommended change: keep the field and its single `rng()` call so the RNG sequence length is
unchanged, but compress the range to something like `rng() * 0.08 + 0.92` so it becomes
genuine mild in-plane ellipticity rather than a stand-in for inclination. Elliptical galaxies
continue to override it with `axisRatio`, which is real in-plane shape and should be left
alone; their thickness comes from the bulge spheroid instead.

This changes sampled values but not call order, so star identity is preserved and only
silhouettes change — consistent with what Phase 2 already accepted.

### Nebula particles

- In `GalaxyStage.tsx`, replace the `offsetY * config.galaxyEllipse` term with two separate
  offsets: an in-plane offset along the plane's `z` axis, and a height offset scaled by a
  nebula scale height. Nebula gas is thinner than the stellar disk; start near
  `0.010 * GALAXY_RADIUS` and tune.
- Project each particle at bake time before pushing it into its color batch. This is a few
  multiplies per particle inside a loop that already runs once per galaxy; it is not a
  meaningful cost.
- Do not change the batching structure. `flushParticleBatches` and the
  one-`fill()`-per-color contract stay exactly as they are.
- ~~Particle radius stays in screen units. Under orthographic projection it does not need
  depth scaling, and per-particle radius scaling would defeat the purpose of batching.~~
  Radius is a per-circle argument to `gfx.circle`, not batch state — only colour and alpha
  are — so scaling it by the projected scale is free and batching is unaffected. With
  perspective enabled it is also required, or near gas would read as flat.

### Core glow

- Replace the rotated-ellipse sampling in `GalaxyStage.tsx` with spheroid sampling: draw
  three roughly Gaussian unit offsets, scale by `scaleX`, the bulge height, and `scaleY`,
  then rotate in-plane by `config.orientation + glow.angle` and project.
- `coreGlow()` in `galaxyShapes.ts` gains a height scale per galaxy type. The existing
  `lens`, `lensFloor`, `plateau`, and `falloff` controls describe the in-plane silhouette
  and carry over unchanged.
- The barred case in particular should keep its bar lens in-plane and take its thickness
  from the new height term.

### Filters

`BlurFilter` and `DisplacementFilter` stay on the single nebula container, and the
displacement scale keeps tracking `camera.current.scale` as it does now. No filter changes
in this phase.

### Acceptance

- Arms, core, and stars agree on a single camera angle.
- The core reads as a three-dimensional bulge at every zoom level.
- No galaxy type renders as an over-flattened sliver.
- Nebula bake time is within noise of the current build; measure it for the largest
  generated galaxy.
- The nebula still issues one `fill()` per unique color.

**Files:** `src/pixi/GalaxyStage.tsx`, `src/game/galaxyShapes.ts`,
`src/game/galaxyConfig.ts`.

---

## Phase 4 - Star and nebula depth interleaving (evaluate, then decide)

**Why:** stars currently draw entirely over the nebula. Near-side gas passing in front of
far-side stars is the last major depth cue.

**Status: built.** The Phase 3 checkpoint did read flat, so this phase was entered along with
the perspective reversal above.

One correction to the approach: the slabs cannot live inside a shared parent container. A
filtered container renders as one unit, so the gas layers have to be *siblings* of the star
containers under `galaxyRoot`, which carries `sortableChildren`. Stars are banded into the
same three depth slabs and each band gets a `zIndex` that interleaves with the gas
(`GALAXY_LAYER_Z`), so draw order runs far gas, far stars, core, mid gas, mid stars, near
gas, near stars. The near half of the disk therefore passes in front of the core bulge and
the far half behind it, which turned out to be the strongest single cue in the whole plan.

All three slabs share one `DisplacementFilter` instance, so the gas keeps drifting as one
field instead of shearing at the slab seams.

### The constraint

The nebula is one filtered container, and Pixi renders a filtered container as a single unit.
Stars outside it cannot sort into it. Interleaving therefore requires splitting the nebula
into several separately filtered containers — one extra offscreen render pass each.

### Approach if pursued

- Split nebula particles into depth slabs, assigned by projected depth at bake time, each its
  own filtered `Graphics` with its own `zIndex`. Shipped at five (`NEBULA_DEPTH_SLABS`) rather
  than the three proposed here; that constant is the first thing to turn down if the view ever
  costs frame time, and every dependent value — slab tints, layer `zIndex`es, the star bands —
  derives from it.
- Slab the batches, not the particles: each slab keeps its own color `Map` so batching is
  preserved within the slab. Worst case this triples the number of `fill()` calls, from a
  handful to still a handful.
- Sort star containers between the slabs by `zIndex`.
- Measure the frame cost of three blur plus displacement passes at the widest zoom before
  committing. If it costs more than a couple of milliseconds, stop at two slabs, or abandon
  the phase.

### Expect a small payoff

Nebula particles use `screen` blend mode, which is very close to order-independent. Correct
depth ordering will therefore change the image far less than it would for opaque geometry.
The visible difference is mostly around the dense core. This is a genuine reason to keep the
phase cheap or skip it.

### Acceptance

- Near-side gas visibly passes in front of far-side stars.
- Frame time at maximum zoom-out is within one millisecond of Phase 3.
- If neither holds, revert to the single-container nebula and record the measurement in this
  document.

**Files:** `src/pixi/GalaxyStage.tsx`.

---

## Phase 5 - Presentation polish

**Why:** small, cheap cues do most of the remaining work once the geometry is right.

- **Intro tilt.** Mirror the system view, which opens 8 degrees off its target tilt and
  settles. Because galaxy geometry is baked, an animated tilt would mean re-baking; instead
  animate only the star layer's tilt, or approximate the settle with a brief `scale.y` ease
  on `galaxyRoot`. Do not rebuild the nebula per frame.
- **Aerial perspective.** Attenuate star alpha slightly with depth so the far edge of the
  disk sits back. Compute once, at bake time, from projected depth.
- **Depth-tinted haze.** Implemented per slab, not per particle. `flushParticleBatches`
  averages alpha across every particle of a color and issues one `fill()` at that average, so
  a per-particle depth bias averages straight back out. Once Phase 4 gave each slab its own
  color map, a whole-slab factor (`NEBULA_SLAB_TINT`) survives the averaging exactly.
- **Edge and halo stars.** Brown dwarfs from `edgeStar` and the halo population get the
  largest scale heights, which will scatter them convincingly out of the plane. Verify they
  do not drift so far that they leave the expected galactic silhouette.
- **Scale bar.** No code change. Confirm by inspection that the bar still measures the
  horizontal axis, and add a test asserting the camera's zero-yaw, zero-perspective contract
  if Phase 1 did not already.

### Acceptance

- Entering the galaxy view has a deliberate feel rather than a hard cut.
- The disk has a legible near and far edge.
- The scale bar reads correctly against known galaxy radii.

**Files:** `src/pixi/GalaxyStage.tsx`, `src/pixi/StarNode.tsx`, `src/pixi/zoomAnim.ts`.

---

## Performance rules

- Project at bake time. Nothing about this feature belongs on `Ticker.shared`.
- Keep the nebula batched by color. Never promote a nebula particle to a display object.
- Keep star projection inside `useMemo` in `StarNode`, keyed so it recomputes only when the
  galaxy seed changes.
- Do not add a filter without measuring it. Filters are the only real risk in this plan.
- Continue destroying per-star textures on unmount. The projection work adds no new
  resources to clean up, and must not become an excuse to introduce a module-level texture
  cache.

---

## Validation checklist

### Automated

- `npm run build`, `npm run lint`, `npm test`.
- Projection unit tests, including the galaxy camera contract.
- A determinism test over several fixed seeds asserting unchanged star count, positions,
  types, names, sizes, and per-system seeds.

### Visual

- Every galaxy type — spiral, barred, elliptical, irregular — at several seeds.
- The full zoom range, from maximum zoom-out to `CAMERA_MAX_SCALE`.
- Star selection at the top edge, bottom edge, dense core, and sparse halo.
- Galaxy to system and back, including the intro and back zoom transitions.
- Supercluster to galaxy entry, confirming no frame is drawn at the wrong angle.

### Outstanding

Everything automated has been run, and the first visual pass drove the perspective reversal,
Phase 4, and a 4-6x increase in every scale height. What remains is a frame-time measurement
of the six filtered gas layers at maximum zoom-out, and taste tuning of the tilt, scale
heights and perspective strength.

### Cleanup

- Regenerate the galaxy at least 20 times while watching memory and GPU resource counts.
- Confirm ticker callbacks, filters, graphics, textures, and the displacement setup are all
  still torn down in the existing `useEffect` cleanup.

---

## Risks and mitigations

### Determinism regression

Sampling heights inline in `sampleStar` would shift the RNG sequence and silently change
every existing galaxy's stars. Mitigation: the isolated `heightRng` second pass, plus a
fixed-seed regression test that fails loudly if the sequence moves.

### Compounded flattening

`galaxyEllipse` plus a real tilt over-squashes every galaxy. Mitigation: Phase 3's range
compression, verified across all four galaxy types before the phase is considered done.

### Filter cost from nebula slabs

Each nebula slab is an offscreen pass. Mitigation: Phase 4 is optional, measured, and
reversible, and the screen blend mode means the payoff is small enough to walk away from.

### Scale-bar honesty

Perspective or camera yaw would make the linear world-pixel-to-light-year conversion wrong.
Mitigation: zero yaw and zero perspective strength, asserted by a test rather than left as a
convention someone later "improves".

### Depth sorting cost with many stars

`sortableChildren` re-sorts on change. With 400–699 static children whose `zIndex` never
changes after the bake, this is a one-time sort. Mitigation: never mutate star `zIndex` on
the ticker; if Phase 5's alpha attenuation is implemented, change alpha only.

### Hyperlanes arriving later

Delaunay hyperlanes are documented but unrendered. When added, their endpoints must be
projected and the lines depth-banded the way `systemOrbitGraphics.ts` bands orbit paths.
Mitigation: none needed now; the projection module already supports it.

---

## Out of scope

- camera orbit or free-flight controls for the galaxy;
- per-frame re-projection of any kind;
- rendering hyperlanes;
- true volumetric or raymarched nebula;
- three-dimensional supercluster projection, which has its own `z` data and deserves its own
  plan;
- changing galaxy generation parameters, star counts, star types, or naming;
- storing camera tilt in save data;
- changes to travel cost, detection, or any other game system.

---

## Recommended delivery sequence

1. Promote the projection module, add the galaxy camera and its tests, ship no visual change.
2. Sample star heights from an isolated RNG, project stars, depth-sort, fix the zoom anchor.
3. Give the nebula and core real thickness and reinterpret `galaxyEllipse`.
4. Evaluate depth interleaving; build it only if step 3 still looks flat.
5. Add intro tilt and aerial perspective.
6. Profile galaxy regeneration and confirm cleanup.

The visual checkpoint after step 3 should decide whether steps 4 and 5 are worth building.
Tilt, disk thickness, and a spheroidal core produce most of the perceived depth; everything
after that is polish.
