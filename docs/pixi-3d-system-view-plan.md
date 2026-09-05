# Pixi Projected-3D System View Plan

## Goal

Turn the current face-on solar-system map into a cinematic three-dimensional view while
keeping PixiJS as the renderer and preserving the existing game model, generated planet
art, navigation, selection, stations, orbit toggle, and scale bar.

The target is projected 3D, or 2.5D, rather than a general-purpose 3D engine. Planets and
moons remain textured Pixi sprites. Their positions are calculated in three dimensions,
projected into screen space, and depth-sorted every frame. Orbit paths, rings, lighting,
and the asteroid belt reinforce the same camera angle.

The finished view should provide:

- a visibly tilted orbital plane;
- planets and moons passing in front of and behind the star;
- mild perspective scaling between the near and far sides of the system;
- planet illumination that faces the star rather than a fixed corner of the texture;
- correct pointer selection at every orbital position;
- no change to deterministic system generation or orbital timing;
- stable performance for the largest generated system and asteroid belt.

Implement phases in order. Every phase should leave the system view usable.

---

## Rendering decision

Use a custom projection layer on top of ordinary Pixi containers, sprites, graphics, and
filters.

Do not use `PerspectiveMesh` as the scene foundation. In PixiJS 8 it perspective-warps a
textured two-dimensional plane; it does not provide a 3D scene graph, a camera, sphere
geometry, lighting, picking, or automatic depth ordering.

Do not build a general mesh-based 3D pipeline inside Pixi. A custom vertex pipeline would
also require sphere geometry, camera matrices, depth-buffer integration, material and
lighting shaders, interaction ray casting, and a separate path for every existing Pixi
effect. If free-flight cameras and physically modeled spherical bodies become a firm
requirement, use a Three.js scene beneath a Pixi or DOM HUD instead of extending this plan.

For this plan, the camera is initially fixed at a designed angle. Existing left-drag pan
and wheel zoom remain unchanged. Camera orbit controls are deferred until the fixed view
has shipped and been evaluated.

---

## Current-state findings

1. `SolarSystem.tsx` owns scene construction and all per-frame orbital updates. Planet and
   moon positions are currently calculated directly with `cos(angle) * radius` and
   `sin(angle) * radius`.
2. Planets are nested containers. Atmosphere, body sprite, rings, extractor graphics, and
   fabricator graphics move together, which should remain true after projection.
3. Moons are children of their planet container. That works in the flat view, but a
   perspective projection cannot be represented by nested 2D transforms without scaling
   the moon distance twice. Moons need absolute system-space positions before projection.
4. All planet orbits are currently accumulated into one `Graphics`, so they cannot pass
   behind and in front of the star independently.
5. Planet and moon textures already contain strong procedural surface detail and baked
   sphere shading. The surface generation is reusable, but the fixed upper-left lighting
   conflicts with a central star once planets move through projected depth.
6. The asteroid belt is efficient because thousands of points are batch-drawn into one
   `Graphics`. Preserve that batching; do not turn every asteroid into a normal Pixi
   display object.
7. The existing camera transforms one world container for pan and zoom. Projected body
   positions can remain local coordinates inside that container, so the camera and zoom
   transition systems do not need to be replaced.
8. Planet selection uses a circular local hit area. A projected planet is still a
   camera-facing circular sprite, so the existing event model remains valid.
9. The scale bar assumes a constant world-to-screen scale. Mild perspective means it
   represents the system's center plane, which must be treated as the measurement
   reference.

---

## Coordinate and camera model

### Coordinate system

Use the following system-space axes:

- `x`: horizontal coordinate in the orbital plane;
- `z`: depth coordinate in the orbital plane;
- `y`: height above or below the orbital plane.

The star is always at `(0, 0, 0)`. A coplanar planet at angle `a` and radius `r` is:

```ts
{
  x: Math.cos(a) * r,
  y: 0,
  z: Math.sin(a) * r,
}
```

Moons use the same representation relative to their planet, then add the planet's absolute
system-space position before projection. A small seeded moon inclination may be added only
after the base projection is stable.

### Camera state

Add a render-only camera type. It does not belong in Zustand or saved game data.

```ts
export interface SystemCamera3D {
  yaw: number;
  tilt: number;
  focalLength: number;
  perspectiveStrength: number;
}
```

Initial values:

- `tilt`: approximately 58 degrees away from face-on;
- `yaw`: approximately -18 degrees;
- `focalLength`: four times the outermost orbit radius;
- `perspectiveStrength`: approximately 0.35.

`focalLength` is layout-relative so small brown-dwarf and neutron-star systems receive the
same visual perspective as large ordinary systems. It must always exceed the maximum
possible camera-space depth with a generous safety margin.

### Projection result

Create `src/pixi/systemProjection.ts` as a pure module with no Pixi or React imports.

```ts
export interface SystemPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface ProjectedSystemPoint {
  x: number;
  y: number;
  depth: number;
  scale: number;
}
```

Projection performs these operations:

1. Rotate `x/z` around the system origin using camera yaw.
2. Tilt the result into screen Y and camera depth.
3. Calculate perspective scale as `focalLength / (focalLength - depth)`.
4. Blend that scale toward `1` using `perspectiveStrength`.
5. Multiply projected X and Y by the blended perspective scale.

Define positive depth as closer to the camera. Higher depth therefore maps to a higher Pixi
`zIndex` and renders later.

The projection API should include:

- `orbitPoint(angle, radius, height?)`;
- `addSystemPoints(a, b)`;
- `projectSystemPoint(point, camera)`;
- `projectOrbitPoint(angle, radius, camera)`;
- `viewSpaceDirection(vector, camera)` for lighting;
- `createSystemCamera(layout)` for safe layout-relative defaults.

Keep these functions allocation-light. The ticker should reuse state objects or assign
scalar values directly rather than create several temporary arrays per body per frame.

### Projection invariants

- The origin always projects to `(0, 0)` with scale `1`.
- With zero tilt and zero perspective strength, an orbit remains a circle.
- With nonzero tilt and zero perspective strength, an orbit becomes an orthographic
  ellipse.
- Near-side points have greater depth and `scale >= 1`.
- Far-side points have lower depth and `scale <= 1`.
- All generated layouts keep the perspective denominator positive.
- Projecting the same seed, layout, camera, and elapsed time is deterministic.

---

## Target scene structure

Replace the implicit construction order with explicit layers:

```text
worldRef
  systemRoot
    nebulaLayer
    depthScene (sortableChildren = true)
      depth-banded system orbit graphics
      depth-banded asteroid graphics
      star visual at depth 0
      planet visuals at projected depth
      moon visuals at projected depth
    screenEffectLayer
```

`systemRoot` remains inside the existing world camera, so pan, zoom, intro zoom, back zoom,
and the scale bar keep using the current camera ref.

The star's body, corona, and core glow should be grouped into one depth item at depth `0`.
The broad nebula glow remains below the entire depth scene so it never occludes a planet.
If the corona looks wrong when a planet crosses it, split the star into a depth-sorted core
and a low-alpha, non-occluding outer glow.

Use numeric depth directly for `zIndex`; do not convert it to an integer rank. Pixi can sort
numeric `zIndex` values, and continuous depth avoids ties as bodies orbit.

---

## Phase 1 - Pure projection and regression coverage

**Why:** projection, depth sign, and perspective safety should be testable without mounting
Pixi or relying on visual inspection.

### Work

- Add `src/pixi/systemProjection.ts` with the types, camera construction, coordinate
  helpers, projection, and view-space direction transform.
- Add `src/pixi/systemProjection.test.ts` using Vitest.
- Derive focal length from the outermost planet orbit plus its largest moon distance.
- Keep the rendered view face-on during this phase by using zero tilt and zero perspective
  strength from `SolarSystem.tsx`.

### Tests

- origin projection;
- face-on orbit cardinal points;
- orthographic tilt at cardinal points;
- near/far depth ordering;
- monotonic perspective scaling;
- yaw rotation;
- focal-length safety for representative ordinary, brown-dwarf, neutron-star, and Sol
  layouts;
- moon absolute-position composition;
- normalized view-space lighting direction.

### Acceptance

- Projection tests pass.
- The system view is visually unchanged with the compatibility camera.
- `npm run build`, `npm run lint`, and `npm test` pass.

**Files:** `src/pixi/systemProjection.ts`, `src/pixi/systemProjection.test.ts`,
`src/pixi/SolarSystem.tsx`.

---

## Phase 2 - Projected bodies and depth sorting

**Why:** this is the minimum slice that creates a three-dimensional system.

### Planet state

Replace the current render state with explicit system-space and visual state. Keep orbital
angles and speeds unchanged.

```ts
type PlanetState = {
  visual: Container;
  angle: number;
  speed: number;
  orbitRadius: number;
  baseScale: number;
  moons: MoonState[];
};
```

`baseScale` is the scale established by assigning the desired sprite dimensions. Each tick
must apply `baseScale * projected.scale`; setting the container scale directly without
remembering its base value would lose the current body size.

### Moon ownership

Move moon visuals out of each `planetContainer` and add them as siblings in `depthScene`.
Keep their logical state associated with the parent `PlanetState`.

Each tick:

1. Calculate the planet's absolute system-space point.
2. Project and place the planet visual.
3. Calculate each moon's local orbit point.
4. Add the planet and moon system-space points.
5. Project and place the moon visual.
6. Assign both visuals' `zIndex` from projected depth.

Atmosphere, planetary rings, extractor graphics, and fabricator graphics remain children of
the planet visual. They inherit the planet's projected position and scale together.

### Interaction

- Preserve the planet container's circular local hit area.
- Preserve `eventMode`, cursor, event propagation, and selected-planet store behavior.
- Confirm that a near-side scale change also scales the hit area with the visual.
- Keep moons non-interactive unless separate moon selection is introduced as an unrelated
  feature.

### Acceptance

- The default camera produces a clearly tilted system.
- Every planet completes a smooth projected orbit.
- Planets pass behind the star on the far half and in front on the near half.
- Moons remain centered on their moving planet and pass in front of and behind it.
- Clicking every planet works on both halves of its orbit.
- Extractor and fabricator graphics remain attached and update from their existing store
  subscriptions.
- Orbital periods and generated starting angles have not changed.

**Files:** `src/pixi/SolarSystem.tsx`, `src/pixi/systemProjection.ts`.

---

## Phase 3 - Projected orbit paths, rings, and asteroid belt

**Why:** circular guide rings and a face-on belt would contradict the projected bodies.

### System orbit paths

Create `src/pixi/systemOrbitGraphics.ts`. Sample each orbit into 96 segments through the
same projection function used for bodies. Do this only when the layout or camera changes,
not every ticker frame.

To allow orbit lines to pass through scene depth without creating one display object per
line segment:

1. Divide the layout's possible depth range into 16 ordered bands.
2. Assign each sampled line segment to a band using its average projected depth.
3. Draw all segments from all planet orbits in the same band into one `Graphics`.
4. Give each band graphic the representative depth as its `zIndex`.

This produces at most 16 system-orbit graphics rather than hundreds. Bodies can sort
between those bands. Preserve the existing white, low-alpha visual treatment and orbit
visibility toggle.

Avoid drawing a line across the orbit's final-to-first seam through the center. Sample the
closing segment explicitly.

### Moon orbit paths

Moon paths move with their planet and are much smaller. Use two local graphics per planet:
a far half behind the planet body and a near half in front. Project the local ring using the
moon's seeded inclination, but keep the graphics centered on the planet's projected point.

If perspective makes the local path drift noticeably from the moon, rebuild moon ring
points as absolute coordinates and depth-band them with the system orbits. Do not add this
complexity unless the mismatch is visible at maximum zoom.

### Planetary rings

Retain the existing back/body/front composition. Change fixed ring flattening into seeded
ring orientation values generated from the planet seed. The front and back halves must use
the same orientation and line styles.

Planetary ring orientation is render-only and derived from the existing seed. It must not
consume or alter the gameplay generation RNG sequence.

### Asteroid belt

Preserve batched drawing by placing the current asteroid graphic inside an orbital-plane
projection container:

- rotate the belt in its local plane as it does today;
- flatten the projection parent on Y according to camera tilt;
- apply the same camera yaw to the projection parent;
- keep perspective disabled for individual asteroid particles in the first implementation.

The individual asteroids are small enough that their slight Y-axis deformation should not
be perceptible. If it is visible at maximum zoom, replace the points with a Pixi v8
`ParticleContainer` using one tiny shared asteroid texture and dynamic position/scale
properties. Do not begin with thousands of independently interactive sprites.

For stronger depth, split generated asteroids into the same 16 depth bands and vary band
alpha slightly. That preserves batched graphics while allowing planets and the star to sort
through the belt.

### Acceptance

- Orbit paths align with planets at all cardinal points.
- Orbit paths visibly continue behind and in front of the star.
- Toggling orbit rings updates system and moon paths immediately.
- Planetary rings retain correct back/body/front occlusion.
- The asteroid belt occupies the same projected plane as the planets.
- Belt animation does not allocate or rebuild thousands of objects per frame.

**Files:** `src/pixi/SolarSystem.tsx`, `src/pixi/systemOrbitGraphics.ts`,
`src/pixi/systemProjection.ts`.

---

## Phase 4 - Star-relative body lighting

**Why:** fixed upper-left highlights undermine the depth effect. Correct illumination is a
larger visual gain than actual sphere geometry.

### Texture split

Change the generated planet and moon textures from fully lit body images into albedo images:

- keep terrain, oceans, continents, ice caps, clouds, craters, bands, and storms;
- keep the transparent circular boundary;
- remove or disable `applySphereShading` for dynamically lit bodies;
- retain a low-alpha atmosphere rim either in the texture or the existing atmosphere
  graphics;
- keep the brown dwarf, normal star, and neutron star on their specialized emissive paths.

These texture functions are currently used only by the solar-system renderer, so they can
be renamed to make the albedo contract explicit instead of adding a permanent boolean
option.

### Lighting filter

Add `src/pixi/systemBodyLighting.ts` with a Pixi v8 filter that:

1. Converts sprite UV into a normalized disc coordinate.
2. Reconstructs the visible hemisphere normal using
   `z = sqrt(max(0, 1 - x*x - y*y))`.
3. Samples the generated albedo texture.
4. Calculates diffuse light from a view-space direction toward the star.
5. Adds low ambient light so the night side is readable.
6. Adds a subtle atmosphere rim for habitable and gas bodies.
7. Preserves source alpha outside the generated planet disc.

Use one filter instance per lit body because its light direction differs. Reuse each filter
for that body's lifetime; update uniforms in the ticker rather than recreate filters.

Calculate the light direction from the body's absolute system-space position toward the
origin, then transform the direction using the same yaw and tilt as the camera. Do not infer
lighting only from projected screen X/Y; doing so cannot distinguish the near and far halves
of the orbit and produces incorrect phases.

Suggested defaults:

- rocky/moon ambient: `0.10-0.16`;
- habitable ambient: `0.14-0.20`;
- gas/ice ambient: `0.16-0.22`;
- broad, restrained specular only on oceans and atmospheres;
- no cast shadows between moons and planets in the initial implementation.

### Fallback

If per-body filters cause unacceptable render-target overhead, replace the filter with a
reusable circular shadow-overlay texture. Rotate and offset the overlay toward the
star-facing side of each billboard. This is less physically correct but retains orbital
phases without introducing full 3D meshes.

### Acceptance

- The illuminated hemisphere always faces the star.
- Near-side and far-side planets show plausible phases.
- Surface detail remains legible on the lit side.
- There is no baked highlight visible on the night side.
- No filter, texture, or GPU resource leaks when entering and leaving system view
  repeatedly.
- Maximum generated moon count remains smooth on the target browser and hardware.

**Files:** `src/pixi/textures.ts`, `src/pixi/systemBodyLighting.ts`,
`src/pixi/SolarSystem.tsx`, `src/pixi/systemProjection.ts`.

---

## Phase 5 - Camera and presentation polish

**Why:** add controlled motion only after projection, sorting, and interaction are stable.

### Fixed-camera polish

- Ease from a slightly flatter tilt to the final tilt during the existing system intro
  zoom.
- Add very subtle background-star parallax based on camera pan. Keep the background in
  screen space and do not rotate it with the orbital plane.
- Reduce far-side orbit alpha slightly to strengthen depth without hiding navigation cues.
- Apply a small depth-based saturation or brightness falloff, capped so resource-bearing
  planets remain readable.
- Keep the scale bar defined at the star's depth plane. If perspective strength is raised
  enough to make that materially misleading, label the bar as a center-plane measure or
  disable perspective scaling while the bar is visible.

### Optional camera orbit

Only add camera orbit after the fixed presentation is approved.

- Keep left drag for pan.
- Use right drag or modified left drag for yaw and tilt.
- Prevent the browser context menu only while interacting with the canvas.
- Clamp tilt to approximately 20-75 degrees so orbits never collapse into a line or return
  to the old face-on presentation accidentally.
- Rebuild orbit graphics only when yaw or tilt changes.
- Update projected bodies every tick using the latest camera ref without React state
  updates.
- Provide a short reset-to-default action before persisting camera angle as a user setting.
- Confirm touch behavior separately; do not overload one-finger pan without a deliberate
  gesture design.

Do not put yaw or tilt in the global UI store unless another UI component needs to observe
them. Mutable refs are consistent with the existing camera architecture and avoid a React
render on every pointer move.

### Acceptance

- Entry animation introduces depth without causing motion sickness or delaying control.
- Existing pan, wheel zoom, intro zoom, and back navigation still work.
- Camera input never triggers planet selection after crossing the drag threshold.
- Orbit graphics do not rebuild during ordinary orbital animation.
- The system remains understandable at minimum and maximum zoom.

**Files:** `src/pixi/SolarSystem.tsx`, `src/pixi/useCamera.ts` or a new
`src/pixi/useSystemCamera3D.ts`, `src/pixi/BackgroundStars.tsx`,
`src/pixi/systemOrbitGraphics.ts`.

---

## Performance rules

- Do not use React state for ticker-driven coordinates, scales, depth, light direction, or
  camera angle.
- Do not regenerate procedural textures during orbit animation or camera movement.
- Do not recreate filters in the ticker.
- Do not redraw static system orbit paths unless layout or camera projection changes.
- Keep asteroid rendering batched by color and, if needed, depth band.
- Reuse temporary point objects or scalar locals in the ticker.
- Keep `sortableChildren` scoped to the system depth scene rather than the application
  stage.
- Limit projected orbit sampling to the lowest segment count that remains smooth at maximum
  zoom; begin with 96 system segments and 48 moon segments.
- Destroy every generated texture and filter during the existing system effect cleanup.
- Keep one ticker callback for the system rather than registering callbacks per body.

Measure at least these cases in browser development tools:

- seven-planet ordinary system;
- maximum generated moon count;
- largest asteroid belt caused by the outermost eligible gap;
- maximum camera zoom;
- repeated galaxy-to-system-to-galaxy navigation;
- orbit rings both enabled and disabled.

The implementation should not materially increase steady-state JavaScript allocations. If
GPU frame time increases, inspect per-body filter passes before reducing orbital detail.

---

## Validation checklist

### Automated

- Projection unit tests cover all stated invariants.
- Existing deterministic generation tests, if added elsewhere, continue to pass unchanged.
- `npm test` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Visual

- Ordinary, brown-dwarf, neutron-star, and Sol layouts all use the same visual camera
  language.
- No planet, moon, station, ring, or atmosphere is stretched into an ellipse.
- The star correctly occludes far-side bodies, and near-side bodies correctly occlude the
  star core.
- Orbit lines do not jump across depth bands or show a closing seam.
- Moons never detach from their parent planet.
- Planet phases change continuously without flipping at orbit quadrants.
- Asteroids, planet orbits, and moon orbits agree on which side is near.
- Orbit-ring toggle, selection panel, extractor placement, and fabricator placement still
  update immediately.
- The selected planet remains selected while it moves and while camera pan/zoom occurs.
- Intro and back transitions do not briefly display the system at the wrong camera angle.

### Cleanup

- Enter and leave at least 20 systems while watching memory and GPU resource counts.
- Confirm all ticker callbacks, store subscriptions, textures, filters, graphics, and event
  handlers are removed on unmount.
- Confirm no destroyed texture is reused by a later system.

---

## Risks and mitigations

### Depth sorting across nested containers

Pixi sorts siblings, not arbitrary descendants. A moon nested inside a planet cannot sort
globally against the star or another planet. Flatten all independently orbiting bodies into
`depthScene`; keep only visual attachments nested under a body.

### Transparent glow ordering

Additive corona and atmosphere graphics may look incorrect when depth-sorted like opaque
bodies. Keep broad glows below the depth scene, then depth-sort only the compact core and
body silhouettes. Prefer a visually stable composite over physically exact transparent
ordering.

### Perspective and the scale bar

Perspective creates depth-dependent scale. Keep perspective mild and define the current
scale bar at the star's depth plane. If players interpret it as exact everywhere, use
orthographic projection by setting perspective strength to zero; tilt and depth sorting
still provide most of the 3D effect.

### Filter cost

Pixi filters may introduce offscreen render passes. The system contains relatively few
bodies, but the maximum moon layout must be measured. Retain the shadow-overlay fallback
and avoid stacking separate filters for diffuse light, atmosphere, and color correction.

### Procedural texture assumptions

The generated texture art is painted directly into a circular disc rather than a true
latitude/longitude map. Dynamic normal lighting will look spherical, but surface features
will not rotate around the body. Body axial rotation and spherical texture remapping are
explicitly out of scope for this version.

### Camera controls competing with selection

The fixed camera avoids this risk for the first release. If orbit controls are added, reuse
the existing drag threshold and suppress the click following any camera drag.

---

## Out of scope

- true polygonal spheres;
- a general Pixi 3D scene graph;
- axial rotation with equirectangular surface maps;
- physically correct eccentric or inclined gameplay orbits;
- planetary or lunar eclipses;
- cast shadows from rings or moons;
- HDR, bloom pipelines, or deferred lighting;
- ray-cast picking;
- changing orbital periods, planet generation, resources, or game balance;
- storing camera yaw and tilt in save data;
- replacing the DOM HUD or planet panel.

---

## Recommended delivery sequence

1. Land the pure projection module and unit tests with a face-on compatibility camera.
2. Enable the designed camera and project planets, moons, and the star with depth sorting.
3. Project orbit paths, planetary rings, and the asteroid belt.
4. Replace baked body shading with star-relative lighting.
5. Profile the maximum generated system and fix cleanup or batching regressions.
6. Add intro motion and subtle depth polish.
7. Evaluate optional camera orbit controls as a separate product decision.

The visual checkpoint after step 2 should determine whether the project needs steps 4-7.
Tilted motion and correct occlusion produce most of the perceived 3D effect; dynamic phases
and camera motion are polish, not prerequisites for a successful conversion.
