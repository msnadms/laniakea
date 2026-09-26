import { useApplication } from '@pixi/react';
import { Circle, Container, Graphics, Particle, ParticleContainer, ParticleShader, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';
import type { FederatedPointerEvent } from 'pixi.js';
import {
  CAMERA_INITIAL_SCALE,
  GALAXY_ORBIT_EASE,
  GALAXY_ORBIT_SENSITIVITY,
  SKY_LOOKS,
  SYSTEM_CAMERA_MIN_SCALE,
} from '../game/constants';
import { createRng } from '../game/galaxyGen';
import { generateSystemLayout, MOON_K, ORBITAL_K } from '../game/planetGen';
import type { PlanetLayout } from '../game/planetGen';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { SkyBackdrop } from './SkyBackdrop';
import type { SkyLens } from './sky';
import { ScaleBar } from './ScaleBar';
import { createMoonOrbitGraphics, createSystemOrbitGraphics } from './systemOrbitGraphics';
import {
  addSystemPoints,
  clampGalaxyTilt,
  createSystemCamera,
  getSystemExtent,
  orbitPoint,
  projectOrbitPointWithBasis,
  projectSystemPointWithBasis,
  updateProjectionBasis,
  viewSpaceDirectionWithBasis,
  type Point3D,
  type ProjectedPoint,
  type ProjectionBasis,
} from './projection';
import {
  ASTEROID_TEXTURE_RADIUS,
  createAsteroidTextures,
  createBrownDwarfTexture,
  createNebulaGlowTexture,
  createNeutronStarTexture,
} from './textures';
import { createBodyGeometry, createPlanetBody, createSurfaceTexture, type BodyLook, type PlanetBody } from './planetBody';
import { paintEcumenopolis, paintGiantPlanet, paintHabitablePlanet, paintMoon, paintRockyPlanet, type SurfaceJob } from './planetSurfaces';
import { useCamera } from './useCamera';
import { isOrbitGesture, useOrbit, type OrbitConfig } from './useOrbit';
import { useZoomController } from './useZoomController';
import { createAnomalyVisual } from './anomalies';
import { createCityLights, createSettlementLights, type CityLights } from './ecumenopolis';
import { createFoundryAlbedoTexture, createFurnaceLights } from './foundry';
import { createSunBody, sunGlowColor } from './sunBody';

type MoonState = {
  visual: Container;
  body: PlanetBody;
  angle: number;
  speed: number;
  dist: number;
  baseScale: number;
  localPoint: Point3D;
  systemPoint: Point3D;
  projected: ProjectedPoint;
  lightDirection: Point3D;
};

type PlanetState = {
  visual: Container;
  body: PlanetBody;
  angle: number;
  speed: number;
  orbitRadius: number;
  baseScale: number;
  moons: MoonState[];
  systemPoint: Point3D;
  projected: ProjectedPoint;
  lightDirection: Point3D;
  cityLights: CityLights | null;
  moonOrbitFar: Graphics | null;
  moonOrbitNear: Graphics | null;
  moonOrbitRadius: number;
};

const ASTEROID_COLORS = [0x888888, 0x999999, 0xaaaaaa, 0x776655, 0x887766, 0x998877];
const ASTEROID_SIZE_SCALE = 1.15;
const SYSTEM_NICE_VALUES = [1, 2, 5, 10, 20, 30, 60];
const SURFACE_BUDGET_MS = 5;
const INTRO_TILT_OFFSET = 8 * Math.PI / 180;

const SYSTEM_ORBIT: OrbitConfig = {
  createCamera: () => createSystemCamera({ planets: [] }),
  clampTilt: clampGalaxyTilt,
  sensitivity: GALAXY_ORBIT_SENSITIVITY,
  ease: GALAXY_ORBIT_EASE,
};
const RING_BANDS = 28;
const RING_INNER_FRACTION = 0.56;

function halfEllipse(gfx: Graphics, rx: number, ry: number, front: boolean) {
  const k = 0.5522847498;
  const side = front ? 1 : -1;
  const startX = front ? -rx : rx;
  gfx.moveTo(startX, 0)
    .bezierCurveTo(startX, side * k * ry, startX * k, side * ry, 0, side * ry)
    .bezierCurveTo(-startX * k, side * ry, -startX, side * k * ry, -startX, 0);
}

function mixColor(a: number, b: number, t: number) {
  const channel = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function createPlanetRings(rx: number, ry: number, rotation: number, color: number, seed: number): { back: Graphics; front: Graphics } {
  const rng = createRng((seed ^ 0x2f6b1d93) >>> 0);
  const back = new Graphics();
  const front = new Graphics();
  const bandWidth = rx * (1 - RING_INNER_FRACTION) / RING_BANDS;
  const gapAt = 0.55 + rng() * 0.25;
  const gapWidth = 0.03 + rng() * 0.04;
  const tint = mixColor(0xd8c8a0, color, 0.3);
  let density = 0.5;
  for (let band = 0; band < RING_BANDS; band++) {
    const along = (band + 0.5) / RING_BANDS;
    density = Math.min(1, Math.max(0.08, density + (rng() - 0.5) * 0.35));
    const gap = Math.abs(along - gapAt) < gapWidth ? 0.08 : 1;
    const fade = Math.min(1, along / 0.12) * Math.min(1, (1 - along) / 0.1 + 0.2);
    const alpha = 0.62 * density * gap * fade;
    const shade = mixColor(tint, 0xffffff, rng() * 0.25);
    if (alpha < 0.02) continue;
    const bandScale = RING_INNER_FRACTION + along * (1 - RING_INNER_FRACTION);
    const style = { color: shade, width: bandWidth * 1.15, alpha };
    halfEllipse(back, rx * bandScale, ry * bandScale, false);
    back.stroke(style);
    halfEllipse(front, rx * bandScale, ry * bandScale, true);
    front.stroke(style);
  }
  back.rotation = rotation;
  front.rotation = rotation;
  return { back, front };
}

function ringOrientation(seed: number) {
  const first = ((seed ^ 0x85ebca6b) >>> 0) / 0x100000000;
  const second = (Math.imul(seed ^ 0xc2b2ae35, 0x27d4eb2d) >>> 0) / 0x100000000;
  return { rotation: (first - 0.5) * 1.2, flattening: 0.34 + second * 0.34 };
}

type AsteroidBelt = {
  far: ParticleContainer;
  near: ParticleContainer;
  update: (basis: ProjectionBasis, spin: number) => void;
  destroy: () => void;
};

function createAsteroidBelt(gapIdx: number, planets: PlanetLayout[], seed: number, clearance: number): AsteroidBelt {
  const rng = createRng(seed);
  const beltInnerR = Math.max(planets[gapIdx].orbitRadius * 1.12, clearance * 1.25);
  const beltOuterR = beltInnerR * 1.10;
  const beltCenter = (beltInnerR + beltOuterR) / 2;
  const beltSigma = (beltOuterR - beltInnerR) / 1.5;
  const numAsteroids = Math.floor(rng() * 1250) + 1250;
  const { atlas, frames } = createAsteroidTextures(seed);
  const radii: number[] = [];
  const angles: number[] = [];
  const sizes: number[] = [];
  const flips: number[] = [];
  const colors: number[] = [];
  const farParticles: Particle[] = [];
  const nearParticles: Particle[] = [];

  for (let index = 0; index < numAsteroids; index++) {
    const u1 = Math.max(rng(), 1e-10);
    const u2 = rng();
    const radius = beltCenter + beltSigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (radius <= 0) continue;
    radii.push(radius);
    angles.push(rng() * Math.PI * 2);
    colors.push(ASTEROID_COLORS[Math.floor(rng() * ASTEROID_COLORS.length)]);
    sizes.push((rng() * 5 + 1) * ASTEROID_SIZE_SCALE / ASTEROID_TEXTURE_RADIUS);
    flips.push(rng() < 0.5 ? -1 : 1);
    const texture = frames[Math.floor(rng() * frames.length)];
    farParticles.push(new Particle({ texture, anchorX: 0.5, anchorY: 0.5, alpha: 0.92 }));
    nearParticles.push(new Particle({ texture, anchorX: 0.5, anchorY: 0.5, alpha: 0 }));
  }

  const createHalf = (particles: Particle[]) => {
    const node = new ParticleContainer({
      texture: atlas,
      shader: new ParticleShader(),
      particles,
      dynamicProperties: { position: true, vertex: true, rotation: true, color: true, uvs: false },
    });
    node.boundsArea = new Rectangle(-beltOuterR * 2, -beltOuterR * 2, beltOuterR * 4, beltOuterR * 4);
    node.eventMode = 'none';
    node.update();
    return node;
  };
  const far = createHalf(farParticles);
  const near = createHalf(nearParticles);
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };

  return {
    far,
    near,
    update(basis, spin) {
      for (let index = 0; index < radii.length; index++) {
        const radius = radii[index];
        projectOrbitPointWithBasis(angles[index] + spin, radius, basis, projected);
        const { depth, scale } = projected;
        const isNear = depth > 0;
        const shown = isNear ? nearParticles[index] : farParticles[index];
        const hidden = isNear ? farParticles[index] : nearParticles[index];
        hidden.alpha = 0;
        shown.alpha = 0.92;
        shown.x = projected.x;
        shown.y = projected.y;
        shown.rotation = Math.atan2(-shown.y, -shown.x);
        shown.scaleX = sizes[index] * scale;
        shown.scaleY = sizes[index] * scale * flips[index];
        const litFraction = 0.5 * (1 - depth / radius);
        shown.tint = shadeColor(colors[index], 0.5 + 0.5 * litFraction);
      }
    },
    destroy() {
      for (const frame of frames) frame.destroy(false);
      atlas.destroy(true);
    },
  };
}

function shadeColor(color: number, brightness: number) {
  const r = Math.round(((color >> 16) & 0xff) * brightness);
  const g = Math.round(((color >> 8) & 0xff) * brightness);
  const b = Math.round((color & 0xff) * brightness);
  return (r << 16) | (g << 8) | b;
}

function createNebulaSprite(color: number, sunRadius: number): Sprite {
  const sprite = new Sprite(createNebulaGlowTexture(color));
  sprite.anchor.set(0.5);
  const size = Math.max(sunRadius * 30, 3000);
  sprite.width = size;
  sprite.height = size;
  sprite.blendMode = 'screen';
  return sprite;
}

const BODY_LOOKS: Record<PlanetLayout['zone'], BodyLook> = {
  hot: { bump: 3, specular: 0, limbDarkening: 0.15, ambient: 0.03, atmosphere: 0xffa060, atmosphereStrength: 0.18 },
  marginal: { bump: 3, specular: 0, limbDarkening: 0.15, ambient: 0.03, atmosphere: 0xb0a898, atmosphereStrength: 0.08 },
  habitable: { bump: 1.5, specular: 0.6, limbDarkening: 0.1, ambient: 0.03, atmosphere: 0x5a9aff, atmosphereStrength: 0.8 },
  populated: { bump: 1.5, specular: 0.6, limbDarkening: 0.1, ambient: 0.03, atmosphere: 0x5a9aff, atmosphereStrength: 0.8 },
  ecumenopolis: { bump: 1.6, specular: 0.45, limbDarkening: 0.15, ambient: 0.04, atmosphere: 0x8aa8ff, atmosphereStrength: 0.6 },
  foundry: { bump: 0, specular: 0, limbDarkening: 0.15, ambient: 0.04, atmosphere: 0xff8c50, atmosphereStrength: 0.35 },
  gas: { bump: 0, specular: 0, limbDarkening: 0.6, ambient: 0.03, atmosphere: 0xe8d8b8, atmosphereStrength: 0.45 },
  ice: { bump: 0, specular: 0, limbDarkening: 0.6, ambient: 0.03, atmosphere: 0x88ccff, atmosphereStrength: 0.6 },
};

const MOON_LOOK: BodyLook = { bump: 3.5, specular: 0, limbDarkening: 0.1, ambient: 0.02, atmosphere: 0x000000, atmosphereStrength: 0 };

function createFlatDetailCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(128,0,0)';
  context.fillRect(0, 0, 4, 4);
  return canvas;
}

export function SolarSystem() {
  const { isInitialised } = useApplication();
  const worldRef = useRef<Container>(null);
  const galaxySeed = useGameStore((state) => state.galaxy.seed);
  const system = useGameStore((state) => state.system);
  const showOrbitRings = useUIStore((state) => state.showOrbitRings);
  const showOrbitRingsRef = useRef(showOrbitRings);
  const orbitGfxRef = useRef<Graphics[]>([]);
  const { orbitCamera: viewOrbit, didOrbit } = useOrbit(SYSTEM_ORBIT);
  const skyLens = useRef<SkyLens | null>(null);
  const publishSkyLens = useCallback((lens: SkyLens | null) => { skyLens.current = lens; }, []);
  const shouldPan = useCallback((event: FederatedPointerEvent) => !isOrbitGesture(event), []);
  const { camera, isReady, hasDragged } = useCamera(worldRef, CAMERA_INITIAL_SCALE - 0.3, SYSTEM_CAMERA_MIN_SCALE, shouldPan);

  useEffect(() => {
    showOrbitRingsRef.current = showOrbitRings;
    for (const gfx of orbitGfxRef.current) gfx.visible = showOrbitRings;
  }, [showOrbitRings]);

  useZoomController(camera, worldRef, isReady, {
    onNavigateBack: () => {
      useUIStore.getState().setSelectedPlanet(null);
      useUIStore.getState().removeAddressType('system');
      useGameStore.getState().setSystem(null);
      useUIStore.getState().setView('galaxy');
    },
  });

  useEffect(() => {
    if (!isInitialised || !worldRef.current || !system) return;
    const world = worldRef.current;
    const anomaly = useGameStore.getState().galaxyAnomalies.byHost.get(system.id);
    const populated = useGameStore.getState().galaxyAnomalies.populated.has(system.id);
    const layout = generateSystemLayout(system.seed, system.starType, anomaly?.kind, populated, anomaly?.living);
    const isBrownDwarf = system.starType === 'L';
    const isNeutronStar = system.starType === 'N';
    const sunRadius = system.size * 120 * (isBrownDwarf ? 0.5 : isNeutronStar ? 0.8 : 1);
    const planetExtent = getSystemExtent(layout);
    const innermost = layout.planets[0];
    const clearanceBody = layout.diskRim ?? innermost;
    const anomalyVisual = anomaly
      ? createAnomalyVisual({
        anomaly,
        sunRadius,
        starColor: system.color,
        innermostOrbit: innermost?.orbitRadius ?? planetExtent,
        innermostClearance: clearanceBody
          ? clearanceBody.orbitRadius - Math.max(clearanceBody.radius * 2.4, ...clearanceBody.moons.map((moon) => moon.dist + moon.radius))
          : planetExtent,
        planetExtent,
        skyLens,
        onSelect: () => {
          if (hasDragged.current || didOrbit.current) return;
          useUIStore.getState().setSelectedPlanet(null);
          useUIStore.getState().setAnomalyPanelOpen(true);
        },
      })
      : null;
    const projectionLayout = { planets: layout.planets, extraExtent: anomalyVisual?.extent };
    const systemCamera = createSystemCamera(projectionLayout);
    systemCamera.yaw = viewOrbit.current.yaw;
    systemCamera.tilt = viewOrbit.current.tilt - INTRO_TILT_OFFSET;
    const orbitCamera = { ...systemCamera };
    const moonOrbitTiltCos = Math.cos(orbitCamera.tilt);
    const projectionBasis = updateProjectionBasis(systemCamera);
    const systemExtent = getSystemExtent(projectionLayout);
    const systemRoot = new Container();
    const nebulaLayer = new Container();
    const depthScene = new Container();
    const screenEffectLayer = new Container();
    depthScene.sortableChildren = true;
    systemRoot.addChild(nebulaLayer, depthScene, screenEffectLayer);
    const planets: PlanetState[] = [];
    let systemOrbitGfx = createSystemOrbitGraphics(layout.planets, orbitCamera);
    const moonOrbitGfx: Graphics[] = [];
    const bodyTextures: Texture[] = [];
    const bodies: PlanetBody[] = [];
    const bodyGeometry = createBodyGeometry();
    const flatDetail = createSurfaceTexture(createFlatDetailCanvas());
    const surfaceJobs: { job: SurfaceJob; textures: Texture[] }[] = [];
    const generatedPlanets = system.planets ?? [];

    for (const orbitGfx of systemOrbitGfx) depthScene.addChild(orbitGfx);

    function paintedTextures(job: SurfaceJob, immediate: boolean) {
      if (immediate) job.step(Infinity);
      const albedo = createSurfaceTexture(job.surface.albedo);
      const detail = createSurfaceTexture(job.surface.detail);
      bodyTextures.push(albedo, detail);
      if (!immediate) surfaceJobs.push({ job, textures: [albedo, detail] });
      return { albedo, detail };
    }

    function addBody(albedo: Texture, detail: Texture, look: BodyLook, radius: number) {
      const body = createPlanetBody(bodyGeometry, albedo, detail, look, radius);
      bodies.push(body);
      return body;
    }

    for (let ring = 0; ring < layout.planets.length; ring++) {
      const planetLayout = layout.planets[ring];
      const planetVisual = new Container();
      const radius = planetLayout.radius;
      const planetSeed = (system.seed + ring * 0x9e3779b9) >>> 0;
      const orientation = ringOrientation(planetSeed);
      const rings = planetLayout.hasRings
        ? createPlanetRings(radius * 2.4, radius * orientation.flattening, orientation.rotation, planetLayout.color, planetSeed)
        : null;
      if (rings) planetVisual.addChild(rings.back);

      const isEcumenopolis = planetLayout.zone === 'ecumenopolis';
      const isFoundry = planetLayout.zone === 'foundry';
      const isHabitable = planetLayout.zone === 'habitable' || planetLayout.zone === 'populated';
      const surfaceJob = planetLayout.zone === 'gas' || planetLayout.zone === 'ice'
        ? paintGiantPlanet(planetLayout.color, planetSeed, planetLayout.zone === 'ice')
        : isHabitable
          ? paintHabitablePlanet(planetLayout.color, planetSeed)
          : isEcumenopolis
            ? paintEcumenopolis(planetLayout.color, planetSeed, anomaly?.living ?? false)
            : isFoundry
              ? null
              : paintRockyPlanet(planetLayout.color, planetSeed);
      const landCanvas = isHabitable && surfaceJob ? surfaceJob.surface.albedo : null;
      const builtTexture = isFoundry ? createFoundryAlbedoTexture(planetLayout.color, planetSeed) : null;
      if (builtTexture) bodyTextures.push(builtTexture);
      const surface = surfaceJob
        ? paintedTextures(surfaceJob, planetLayout.zone === 'populated')
        : { albedo: builtTexture!, detail: flatDetail };
      const planetBody = addBody(surface.albedo, surface.detail, BODY_LOOKS[planetLayout.zone], radius);
      planetVisual.addChild(planetBody.mesh);
      const cityLights = isEcumenopolis
        ? createCityLights(planetSeed, radius, anomaly?.living ?? false, anomaly?.integrity ?? 1)
        : isFoundry
          ? createFurnaceLights(planetSeed, radius)
          : landCanvas && planetLayout.zone === 'populated'
            ? createSettlementLights(landCanvas, planetSeed, radius)
            : null;
      if (cityLights) planetVisual.addChild(cityLights.node);
      if (rings) planetVisual.addChild(rings.front);

      const planet: PlanetState = {
        visual: planetVisual,
        body: planetBody,
        angle: planetLayout.angle,
        speed: ORBITAL_K / Math.pow(planetLayout.orbitRadius, 1.5),
        orbitRadius: planetLayout.orbitRadius,
        baseScale: 1,
        moons: [],
        systemPoint: { x: 0, y: 0, z: 0 },
        projected: { x: 0, y: 0, depth: 0, scale: 1 },
        lightDirection: { x: 0, y: 0, z: 0 },
        cityLights,
        moonOrbitFar: null,
        moonOrbitNear: null,
        moonOrbitRadius: 0,
      };

      if (planetLayout.moons.length > 0) {
        const moonOrbits = createMoonOrbitGraphics(planetLayout.moons.map((moon) => moon.dist), orbitCamera);
        planet.moonOrbitFar = moonOrbits.far;
        planet.moonOrbitNear = moonOrbits.near;
        planet.moonOrbitRadius = Math.max(...planetLayout.moons.map((moon) => moon.dist));
        moonOrbitGfx.push(moonOrbits.far, moonOrbits.near);
        depthScene.addChild(moonOrbits.far, moonOrbits.near);

        for (let moonIndex = 0; moonIndex < planetLayout.moons.length; moonIndex++) {
          const moonLayout = planetLayout.moons[moonIndex];
          const moonSeed = (system.seed + ring * 0x9e3779b9 + (moonIndex + 1) * 0x7f4a9c3b) >>> 0;
          const moonSurface = paintedTextures(paintMoon(moonLayout.color, moonSeed), false);
          const moonBody = addBody(moonSurface.albedo, moonSurface.detail, MOON_LOOK, moonLayout.radius);
          const moonVisual = new Container();
          moonVisual.addChild(moonBody.mesh);
          depthScene.addChild(moonVisual);
          planet.moons.push({
            visual: moonVisual,
            body: moonBody,
            angle: moonLayout.angle,
            speed: MOON_K / Math.pow(moonLayout.dist, 1.5),
            dist: moonLayout.dist,
            baseScale: 1,
            localPoint: { x: 0, y: 0, z: 0 },
            systemPoint: { x: 0, y: 0, z: 0 },
            projected: { x: 0, y: 0, depth: 0, scale: 1 },
            lightDirection: { x: 0, y: 0, z: 0 },
          });
        }
      }

      const planetData = generatedPlanets[ring];
      if (planetData) {
        planetVisual.hitArea = new Circle(0, 0, radius * 1.5);
        planetVisual.eventMode = 'static';
        planetVisual.cursor = 'pointer';
        planetVisual.on('pointerdown', (event) => {
          if (isOrbitGesture(event)) return;
          event.stopPropagation();
          useUIStore.getState().setAnomalyPanelOpen(false);
          useUIStore.getState().setSelectedPlanet(planetData.name);
        });
      }

      depthScene.addChild(planetVisual);
      planets.push(planet);
    }

    for (const gfx of [...systemOrbitGfx, ...moonOrbitGfx]) gfx.visible = showOrbitRingsRef.current;
    orbitGfxRef.current = [...systemOrbitGfx, ...moonOrbitGfx];

    const asteroidBelt = layout.asteroidGapIdx === null
      ? null
      : createAsteroidBelt(layout.asteroidGapIdx, layout.planets, layout.asteroidSeed, anomalyVisual?.extent ?? 0);
    let asteroidSpin = 0;
    if (asteroidBelt) {
      asteroidBelt.far.zIndex = -1;
      asteroidBelt.near.zIndex = 1;
      depthScene.addChild(asteroidBelt.far, asteroidBelt.near);
    }

    const coronaAlpha = anomalyVisual?.coronaAlpha ?? 1;
    const starAlpha = anomalyVisual?.starAlpha ?? 1;
    const sunTexture = isBrownDwarf
      ? createBrownDwarfTexture(system.seed)
      : isNeutronStar
        ? createNeutronStarTexture(system.seed)
        : null;
    const sunSprite = sunTexture ? new Sprite(sunTexture) : null;
    const sunBaseScale = sunRadius * 4 / (sunTexture?.width ?? 1);
    if (sunSprite) {
      sunSprite.anchor.set(0.5);
      sunSprite.scale.set(sunBaseScale);
      sunSprite.alpha = starAlpha;
    }
    const sunBody = sunSprite ? null : createSunBody(system.starType, system.seed, sunRadius, coronaAlpha);
    if (sunBody) sunBody.mesh.alpha = starAlpha;
    const starVisual = new Container();
    starVisual.addChild(sunSprite ?? sunBody!.mesh);
    starVisual.zIndex = 0;
    starVisual.eventMode = 'none';
    depthScene.addChild(starVisual);

    if (anomalyVisual) {
      for (const node of anomalyVisual.nodes) depthScene.addChild(node);
    }

    const nebulaSprite = createNebulaSprite(anomalyVisual?.nebulaColor ?? (sunBody ? sunGlowColor(system.starType) : system.color), sunRadius);
    const nebulaTexture = nebulaSprite.texture;
    nebulaSprite.eventMode = 'none';
    nebulaLayer.addChild(nebulaSprite);
    world.addChildAt(systemRoot, 0);

    function updateProjectionPresentation() {
      if (systemCamera.tilt !== orbitCamera.tilt) {
        orbitCamera.tilt = systemCamera.tilt;
        for (const gfx of systemOrbitGfx) gfx.destroy();
        systemOrbitGfx = createSystemOrbitGraphics(layout.planets, orbitCamera);
        for (const gfx of systemOrbitGfx) {
          gfx.visible = showOrbitRingsRef.current;
          depthScene.addChild(gfx);
        }
        orbitGfxRef.current = [...systemOrbitGfx, ...moonOrbitGfx];
      }
      asteroidBelt?.update(projectionBasis, asteroidSpin);
    }

    function updateBodies(dt: number, elapsed: number) {
      for (const planet of planets) {
        planet.angle += planet.speed * dt;
        orbitPoint(planet.angle, planet.orbitRadius, 0, planet.systemPoint);
        projectSystemPointWithBasis(planet.systemPoint, projectionBasis, planet.projected);
        planet.visual.position.set(planet.projected.x, planet.projected.y);
        planet.visual.scale.set(planet.baseScale * planet.projected.scale);
        planet.visual.zIndex = planet.projected.depth;
        planet.visual.alpha = 0.9 + 0.1 * Math.max(0, Math.min(1, (planet.projected.depth / systemExtent + 1) * 0.5));
        planet.lightDirection.x = -planet.systemPoint.x;
        planet.lightDirection.y = -planet.systemPoint.y;
        planet.lightDirection.z = -planet.systemPoint.z;
        viewSpaceDirectionWithBasis(planet.lightDirection, projectionBasis, planet.lightDirection);
        planet.body.setLight(planet.lightDirection);
        planet.cityLights?.update(planet.lightDirection, elapsed);
        if (planet.moonOrbitFar && planet.moonOrbitNear) {
          planet.moonOrbitFar.position.set(planet.projected.x, planet.projected.y);
          planet.moonOrbitNear.position.set(planet.projected.x, planet.projected.y);
          const tiltScale = projectionBasis.cosTilt / moonOrbitTiltCos;
          planet.moonOrbitFar.scale.set(planet.projected.scale, planet.projected.scale * tiltScale);
          planet.moonOrbitNear.scale.set(planet.projected.scale, planet.projected.scale * tiltScale);
          const moonDepth = planet.moonOrbitRadius * projectionBasis.sinTilt;
          planet.moonOrbitFar.zIndex = planet.projected.depth - moonDepth;
          planet.moonOrbitNear.zIndex = planet.projected.depth + moonDepth;
        }

        for (const moon of planet.moons) {
          moon.angle += moon.speed * dt;
          orbitPoint(moon.angle, moon.dist, 0, moon.localPoint);
          addSystemPoints(planet.systemPoint, moon.localPoint, moon.systemPoint);
          projectSystemPointWithBasis(moon.systemPoint, projectionBasis, moon.projected);
          moon.visual.position.set(moon.projected.x, moon.projected.y);
          moon.visual.scale.set(moon.baseScale * moon.projected.scale);
          moon.visual.zIndex = moon.projected.depth;
          moon.lightDirection.x = -moon.systemPoint.x;
          moon.lightDirection.y = -moon.systemPoint.y;
          moon.lightDirection.z = -moon.systemPoint.z;
          viewSpaceDirectionWithBasis(moon.lightDirection, projectionBasis, moon.lightDirection);
          moon.body.setLight(moon.lightDirection);
        }
      }
    }

    if (anomalyVisual?.surface) surfaceJobs.push(anomalyVisual.surface);
    updateProjectionPresentation();
    updateBodies(0, 0);
    anomalyVisual?.update(0, 0, projectionBasis);
    sunBody?.update(0, projectionBasis);
    let elapsed = 0;
    const onTick = (ticker: Ticker) => {
      const dt = ticker.deltaMS / 1000;
      const deadline = performance.now() + SURFACE_BUDGET_MS;
      while (surfaceJobs.length > 0 && performance.now() < deadline) {
        const next = surfaceJobs[0];
        if (!next.job.step(deadline)) break;
        for (const texture of next.textures) texture.source.update();
        surfaceJobs.shift();
      }
      elapsed += dt;
      const introProgress = Math.min(1, elapsed / 0.9);
      const easedIntro = 1 - Math.pow(1 - introProgress, 3);
      systemCamera.yaw = viewOrbit.current.yaw;
      systemCamera.tilt = viewOrbit.current.tilt - INTRO_TILT_OFFSET * (1 - easedIntro);
      updateProjectionBasis(systemCamera, projectionBasis);
      updateProjectionPresentation();
      sunSprite?.scale.set(sunBaseScale * (1 + Math.sin(elapsed * 0.9) * 0.07));
      sunBody?.update(elapsed, projectionBasis);
      nebulaSprite.alpha = 0.65 + 0.15 * Math.sin(elapsed * 0.22);
      asteroidSpin += 0.025 * dt;
      updateBodies(dt, elapsed);
      anomalyVisual?.update(dt, elapsed, projectionBasis);
    };
    Ticker.shared.add(onTick);

    return () => {
      Ticker.shared.remove(onTick);
      anomalyVisual?.destroy();
      asteroidBelt?.destroy();
      orbitGfxRef.current = [];
      world.removeChild(systemRoot);
      systemRoot.destroy({ children: true });
      sunTexture?.destroy(true);
      sunBody?.destroy();
      nebulaTexture.destroy(true);
      for (const body of bodies) body.destroy();
      bodyGeometry.destroy();
      flatDetail.destroy(true);
      for (const texture of bodyTextures) texture.destroy(true);
    };
  }, [system, isInitialised, hasDragged, didOrbit, viewOrbit]);

  return (
    <>
      <SkyBackdrop themeSeed={galaxySeed} viewSeed={system?.seed ?? galaxySeed} look={SKY_LOOKS.system} camera={camera} orbit={viewOrbit} onLens={publishSkyLens} />
      <pixiContainer ref={worldRef} />
      <ScaleBar camera={camera} unitsPerWorldPx={1 / 180} unit="Light Minutes" niceValues={SYSTEM_NICE_VALUES} />
    </>
  );
}
