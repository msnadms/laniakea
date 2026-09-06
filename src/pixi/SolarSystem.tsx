import { useApplication } from '@pixi/react';
import { Circle, Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { CAMERA_INITIAL_SCALE, SYSTEM_CAMERA_MIN_SCALE } from '../game/constants';
import { createRng } from '../game/galaxyGen';
import { generateSystemLayout, MOON_K, ORBITAL_K } from '../game/planetGen';
import type { PlanetLayout } from '../game/planetGen';
import { makeExtractorKey, makeFabricatorKey } from '../game/types';
import { useExtractorStore } from '../store/extractorStore';
import { useFabricatorStore } from '../store/fabricatorStore';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { BackgroundStars } from './BackgroundStars';
import { createExtractorGfx } from './extractorGfx';
import { createFabricatorGfx } from './fabricatorGfx';
import { ScaleBar } from './ScaleBar';
import { createMoonOrbitGraphics, createSystemOrbitGraphics } from './systemOrbitGraphics';
import {
  addSystemPoints,
  createSystemCamera,
  getSystemExtent,
  orbitPoint,
  projectSystemPointWithBasis,
  updateProjectionBasis,
  viewSpaceDirectionWithBasis,
  type Point3D,
  type ProjectedPoint,
} from './projection';
import {
  createBodyShadowTexture,
  createBrownDwarfTexture,
  createGasGiantAlbedoTexture,
  createHabitablePlanetAlbedoTexture,
  createMoonAlbedoTexture,
  createNebulaGlowTexture,
  createNeutronStarTexture,
  createRockyPlanetAlbedoTexture,
  createSunTexture,
} from './textures';
import { useCamera } from './useCamera';
import { useZoomController } from './useZoomController';

type MoonState = {
  visual: Container;
  shadow: Sprite;
  shadowStrength: number;
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
  shadow: Sprite;
  shadowStrength: number;
  angle: number;
  speed: number;
  orbitRadius: number;
  baseScale: number;
  moons: MoonState[];
  systemPoint: Point3D;
  projected: ProjectedPoint;
  lightDirection: Point3D;
  moonOrbitFar: Graphics | null;
  moonOrbitNear: Graphics | null;
  moonOrbitRadius: number;
};

const ASTEROID_COLORS = [0x888888, 0x999999, 0xaaaaaa, 0x776655, 0x887766, 0x998877];
const SYSTEM_NICE_VALUES = [1, 2, 5, 10, 20, 30, 60];

function createPlanetRings(rx: number, ry: number, rotation: number): { back: Graphics; front: Graphics } {
  const k = 0.5522847498;
  const s1 = { color: 0xddcc99, width: 5, alpha: 0.65 };
  const s2 = { color: 0xeeddbb, width: 2, alpha: 0.35 };
  const back = new Graphics();
  back.moveTo(rx, 0).bezierCurveTo(rx, -k * ry, k * rx, -ry, 0, -ry).bezierCurveTo(-k * rx, -ry, -rx, -k * ry, -rx, 0).stroke(s1);
  back.moveTo(rx * 0.78, 0).bezierCurveTo(rx * 0.78, -k * ry * 0.78, k * rx * 0.78, -ry * 0.78, 0, -ry * 0.78).bezierCurveTo(-k * rx * 0.78, -ry * 0.78, -rx * 0.78, -k * ry * 0.78, -rx * 0.78, 0).stroke(s2);
  back.rotation = rotation;
  const front = new Graphics();
  front.moveTo(-rx, 0).bezierCurveTo(-rx, k * ry, -k * rx, ry, 0, ry).bezierCurveTo(k * rx, ry, rx, k * ry, rx, 0).stroke(s1);
  front.moveTo(-rx * 0.78, 0).bezierCurveTo(-rx * 0.78, k * ry * 0.78, -k * rx * 0.78, ry * 0.78, 0, ry * 0.78).bezierCurveTo(k * rx * 0.78, ry * 0.78, rx * 0.78, k * ry * 0.78, rx * 0.78, 0).stroke(s2);
  front.rotation = rotation;
  return { back, front };
}

function ringOrientation(seed: number) {
  const first = ((seed ^ 0x85ebca6b) >>> 0) / 0x100000000;
  const second = (Math.imul(seed ^ 0xc2b2ae35, 0x27d4eb2d) >>> 0) / 0x100000000;
  return { rotation: (first - 0.5) * 1.2, flattening: 0.34 + second * 0.34 };
}

function createAsteroidBelt(gapIdx: number, planets: PlanetLayout[], seed: number): Container {
  const rng = createRng(seed);
  const beltInnerR = planets[gapIdx].orbitRadius * 1.12;
  const beltOuterR = beltInnerR * 1.10;
  const beltCenter = (beltInnerR + beltOuterR) / 2;
  const beltSigma = (beltOuterR - beltInnerR) / 1.5;
  const batches = new Map<number, Array<{ x: number; y: number; r: number }>>();
  const numAsteroids = Math.floor(rng() * 1250) + 1250;

  for (let index = 0; index < numAsteroids; index++) {
    const u1 = Math.max(rng(), 1e-10);
    const u2 = rng();
    const radius = beltCenter + beltSigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (radius <= 0) continue;
    const theta = rng() * Math.PI * 2;
    const color = ASTEROID_COLORS[Math.floor(rng() * ASTEROID_COLORS.length)];
    const particle = { x: Math.cos(theta) * radius, y: Math.sin(theta) * radius, r: rng() * 5 + 1 };
    const batch = batches.get(color);
    if (batch) batch.push(particle);
    else batches.set(color, [particle]);
  }

  const belt = new Container();
  const beltGfx = new Graphics();
  for (const [color, particles] of batches) {
    for (const particle of particles) beltGfx.circle(particle.x, particle.y, particle.r);
    beltGfx.fill({ color, alpha: 0.55 });
  }
  belt.addChild(beltGfx);
  belt.eventMode = 'none';
  return belt;
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

function createCorona(seed: number, color: number, sunRadius: number): Container {
  const rng = createRng(seed);
  const container = new Container();
  container.blendMode = 'screen';
  const gfx = new Graphics();
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    const length = sunRadius * (2.4 + rng() * 3.0);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    gfx.moveTo(dx * sunRadius * 0.9, dy * sunRadius * 0.9)
      .lineTo(dx * length, dy * length)
      .stroke({ color, width: 1 + rng() * 2.2, alpha: 0.09 + rng() * 0.18 });
  }
  for (let index = 0; index < 22; index++) {
    const angle = index / 22 * Math.PI * 2 + Math.PI / 22;
    const length = sunRadius * (1.1 + rng() * 1.3);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    gfx.moveTo(dx * sunRadius * 0.85, dy * sunRadius * 0.85)
      .lineTo(dx * length, dy * length)
      .stroke({ color: 0xffffff, width: 0.6 + rng() * 0.9, alpha: 0.12 + rng() * 0.22 });
  }
  container.addChild(gfx);
  return container;
}

const SHADOW_STRENGTH: Record<PlanetLayout['zone'], number> = {
  hot: 0.87,
  marginal: 0.86,
  habitable: 0.82,
  gas: 0.8,
  ice: 0.8,
};

function createBodyShadow(texture: Texture, diameter: number): Sprite {
  const shadow = new Sprite(texture);
  shadow.anchor.set(0.5);
  shadow.width = diameter;
  shadow.height = diameter;
  shadow.eventMode = 'none';
  return shadow;
}

function updateBodyShadow(shadow: Sprite, strength: number, direction: Point3D) {
  shadow.rotation = Math.atan2(direction.y, direction.x);
  shadow.alpha = strength * Math.max(0.35, Math.min(1, 1 - direction.z * 0.45));
}

export function SolarSystem() {
  const { isInitialised } = useApplication();
  const worldRef = useRef<Container>(null);
  const backgroundStars = useGameStore((state) => state.galaxy.backgroundStars);
  const system = useGameStore((state) => state.system);
  const showOrbitRings = useUIStore((state) => state.showOrbitRings);
  const showOrbitRingsRef = useRef(showOrbitRings);
  const orbitGfxRef = useRef<Graphics[]>([]);
  const extractorGfxRef = useRef<Map<string, Graphics>>(new Map());
  const fabricatorGfxRef = useRef<Map<string, Graphics>>(new Map());
  const { camera, isReady } = useCamera(worldRef, CAMERA_INITIAL_SCALE - 0.3, SYSTEM_CAMERA_MIN_SCALE);

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
    const extractorGfx = extractorGfxRef.current;
    const fabricatorGfx = fabricatorGfxRef.current;
    const layout = generateSystemLayout(system.seed, system.starType);
    const systemCamera = createSystemCamera(layout);
    const targetTilt = systemCamera.tilt;
    const targetTiltCos = Math.cos(targetTilt);
    const introTilt = targetTilt - 8 * Math.PI / 180;
    const orbitCamera = { ...systemCamera };
    systemCamera.tilt = introTilt;
    const projectionBasis = updateProjectionBasis(systemCamera);
    const systemExtent = getSystemExtent(layout);
    const systemRoot = new Container();
    const nebulaLayer = new Container();
    const depthScene = new Container();
    const screenEffectLayer = new Container();
    depthScene.sortableChildren = true;
    systemRoot.addChild(nebulaLayer, depthScene, screenEffectLayer);
    const planets: PlanetState[] = [];
    const systemOrbitGfx = createSystemOrbitGraphics(layout.planets, orbitCamera);
    const allOrbitGfx = [...systemOrbitGfx];
    const bodyTextures: Texture[] = [];
    const shadowTexture = createBodyShadowTexture();
    const galaxySeed = useGameStore.getState().galaxy.seed;
    const generatedPlanets = system.planets ?? [];

    for (const orbitGfx of systemOrbitGfx) depthScene.addChild(orbitGfx);

    for (let ring = 0; ring < layout.planets.length; ring++) {
      const planetLayout = layout.planets[ring];
      const planetVisual = new Container();
      const radius = planetLayout.radius;
      const atmosphere = new Graphics();
      atmosphere.circle(0, 0, radius * 1.8).fill({ color: planetLayout.color, alpha: 0.08 });
      atmosphere.circle(0, 0, radius * 1.3).fill({ color: planetLayout.color, alpha: 0.14 });
      planetVisual.addChild(atmosphere);

      const planetSeed = (system.seed + ring * 0x9e3779b9) >>> 0;
      const orientation = ringOrientation(planetSeed);
      const rings = planetLayout.hasRings
        ? createPlanetRings(radius * 2.4, radius * orientation.flattening, orientation.rotation)
        : null;
      if (rings) planetVisual.addChild(rings.back);

      const planetTexture = planetLayout.zone === 'gas' || planetLayout.zone === 'ice'
        ? createGasGiantAlbedoTexture(planetLayout.color, planetSeed, planetLayout.zone === 'ice')
        : planetLayout.zone === 'habitable'
          ? createHabitablePlanetAlbedoTexture(planetLayout.color, planetSeed)
          : createRockyPlanetAlbedoTexture(planetLayout.color, planetSeed);
      bodyTextures.push(planetTexture);
      const planetSprite = new Sprite(planetTexture);
      planetSprite.anchor.set(0.5);
      planetSprite.width = radius * 2;
      planetSprite.height = radius * 2;
      const planetShadow = createBodyShadow(shadowTexture, radius * 2);
      planetVisual.addChild(planetSprite);
      planetVisual.addChild(planetShadow);
      if (rings) planetVisual.addChild(rings.front);

      const planet: PlanetState = {
        visual: planetVisual,
        shadow: planetShadow,
        shadowStrength: SHADOW_STRENGTH[planetLayout.zone],
        angle: planetLayout.angle,
        speed: ORBITAL_K / Math.pow(planetLayout.orbitRadius, 1.5),
        orbitRadius: planetLayout.orbitRadius,
        baseScale: 1,
        moons: [],
        systemPoint: { x: 0, y: 0, z: 0 },
        projected: { x: 0, y: 0, depth: 0, scale: 1 },
        lightDirection: { x: 0, y: 0, z: 0 },
        moonOrbitFar: null,
        moonOrbitNear: null,
        moonOrbitRadius: 0,
      };

      if (planetLayout.moons.length > 0) {
        const moonOrbits = createMoonOrbitGraphics(planetLayout.moons.map((moon) => moon.dist), orbitCamera);
        planet.moonOrbitFar = moonOrbits.far;
        planet.moonOrbitNear = moonOrbits.near;
        planet.moonOrbitRadius = Math.max(...planetLayout.moons.map((moon) => moon.dist));
        allOrbitGfx.push(moonOrbits.far, moonOrbits.near);
        depthScene.addChild(moonOrbits.far, moonOrbits.near);

        for (let moonIndex = 0; moonIndex < planetLayout.moons.length; moonIndex++) {
          const moonLayout = planetLayout.moons[moonIndex];
          const moonSeed = (system.seed + ring * 0x9e3779b9 + (moonIndex + 1) * 0x7f4a9c3b) >>> 0;
          const moonTexture = createMoonAlbedoTexture(moonLayout.color, moonSeed);
          bodyTextures.push(moonTexture);
          const moonSprite = new Sprite(moonTexture);
          moonSprite.anchor.set(0.5);
          moonSprite.width = moonLayout.radius * 2;
          moonSprite.height = moonLayout.radius * 2;
          const moonShadow = createBodyShadow(shadowTexture, moonLayout.radius * 2);
          const moonVisual = new Container();
          moonVisual.addChild(moonSprite, moonShadow);
          depthScene.addChild(moonVisual);
          planet.moons.push({
            visual: moonVisual,
            shadow: moonShadow,
            shadowStrength: 0.87,
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

      if (generatedPlanets[ring]) {
        const planetData = generatedPlanets[ring];
        const extractorKey = makeExtractorKey(galaxySeed, system.id, planetData.name);
        const fabricatorKey = makeFabricatorKey(galaxySeed, system.id, planetData.name);
        planetVisual.hitArea = new Circle(0, 0, radius * 1.5);
        planetVisual.eventMode = 'static';
        planetVisual.cursor = 'pointer';
        planetVisual.on('pointerdown', (event) => {
          event.stopPropagation();
          useUIStore.getState().setSelectedPlanet(extractorKey);
        });
        if (useExtractorStore.getState().extractors[extractorKey]) {
          const stationGfx = createExtractorGfx(radius);
          planetVisual.addChild(stationGfx);
          extractorGfx.set(extractorKey, stationGfx);
        }
        const fabricator = useFabricatorStore.getState().fabricators[fabricatorKey];
        if (planetLayout.zone === 'habitable' && fabricator) {
          const factoryGfx = createFabricatorGfx(radius, fabricator.tier ?? 1);
          planetVisual.addChild(factoryGfx);
          fabricatorGfx.set(fabricatorKey, factoryGfx);
        }
      }

      depthScene.addChild(planetVisual);
      planets.push(planet);
    }

    const unsubExtractors = useExtractorStore.subscribe(
      (state) => Object.keys(state.extractors).sort().join('\0'),
      () => {
        const { extractors } = useExtractorStore.getState();
        for (let ring = 0; ring < generatedPlanets.length; ring++) {
          const key = makeExtractorKey(galaxySeed, system.id, generatedPlanets[ring].name);
          const existing = extractorGfx.get(key);
          if (extractors[key] && !existing) {
            const stationGfx = createExtractorGfx(layout.planets[ring].radius);
            planets[ring].visual.addChild(stationGfx);
            extractorGfx.set(key, stationGfx);
          } else if (!extractors[key] && existing) {
            existing.destroy();
            extractorGfx.delete(key);
          }
        }
      },
    );

    const unsubFabricators = useFabricatorStore.subscribe(
      (state) => Object.entries(state.fabricators)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, fabricator]) => `${key}\0${fabricator.tier ?? 1}`)
        .join('\x01'),
      () => {
        const { fabricators } = useFabricatorStore.getState();
        for (let ring = 0; ring < generatedPlanets.length; ring++) {
          if (layout.planets[ring].zone !== 'habitable') continue;
          const key = makeFabricatorKey(galaxySeed, system.id, generatedPlanets[ring].name);
          const existing = fabricatorGfx.get(key);
          if (fabricators[key]) {
            existing?.destroy();
            const factoryGfx = createFabricatorGfx(layout.planets[ring].radius, fabricators[key].tier ?? 1);
            planets[ring].visual.addChild(factoryGfx);
            fabricatorGfx.set(key, factoryGfx);
          } else if (existing) {
            existing.destroy();
            fabricatorGfx.delete(key);
          }
        }
      },
    );

    for (const gfx of allOrbitGfx) gfx.visible = showOrbitRingsRef.current;
    orbitGfxRef.current = allOrbitGfx;

    const asteroidProjection = layout.asteroidGapIdx === null ? null : new Container();
    const asteroidBelt = layout.asteroidGapIdx === null
      ? null
      : createAsteroidBelt(layout.asteroidGapIdx, layout.planets, layout.asteroidSeed);
    if (asteroidProjection && asteroidBelt) {
      asteroidProjection.scale.y = projectionBasis.cosTilt;
      asteroidProjection.zIndex = -0.01;
      asteroidBelt.rotation = systemCamera.yaw;
      asteroidProjection.addChild(asteroidBelt);
      depthScene.addChild(asteroidProjection);
    }

    const isBrownDwarf = system.starType === 'L';
    const isNeutronStar = system.starType === 'N';
    const sunRadius = system.size * 120 * (isBrownDwarf ? 0.5 : isNeutronStar ? 0.8 : 1);
    const sunTexture = isBrownDwarf
      ? createBrownDwarfTexture(system.seed)
      : isNeutronStar
        ? createNeutronStarTexture(system.seed)
        : createSunTexture(system.color);
    const sunSprite = new Sprite(sunTexture);
    sunSprite.anchor.set(0.5);
    sunSprite.width = sunRadius * 4;
    sunSprite.height = sunRadius * 4;
    const sunBaseScale = sunSprite.scale.x;
    const starVisual = new Container();
    const corona = isNeutronStar ? null : createCorona(system.seed, system.color, sunRadius);
    if (corona) starVisual.addChild(corona);
    starVisual.addChild(sunSprite);
    starVisual.zIndex = 0;
    starVisual.eventMode = 'none';
    depthScene.addChild(starVisual);

    const nebulaSprite = createNebulaSprite(system.color, sunRadius);
    const nebulaTexture = nebulaSprite.texture;
    nebulaSprite.eventMode = 'none';
    nebulaLayer.addChild(nebulaSprite);
    world.addChildAt(systemRoot, 0);

    function updateProjectionPresentation() {
      const tiltScale = projectionBasis.cosTilt / targetTiltCos;
      for (const gfx of systemOrbitGfx) gfx.scale.y = tiltScale;
      if (asteroidProjection) asteroidProjection.scale.y = projectionBasis.cosTilt;
    }

    function updateBodies(dt: number) {
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
        updateBodyShadow(planet.shadow, planet.shadowStrength, planet.lightDirection);

        if (planet.moonOrbitFar && planet.moonOrbitNear) {
          planet.moonOrbitFar.position.set(planet.projected.x, planet.projected.y);
          planet.moonOrbitNear.position.set(planet.projected.x, planet.projected.y);
          const tiltScale = projectionBasis.cosTilt / targetTiltCos;
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
          updateBodyShadow(moon.shadow, moon.shadowStrength, moon.lightDirection);
        }
      }
    }

    updateProjectionPresentation();
    updateBodies(0);
    let elapsed = 0;
    const onTick = (ticker: Ticker) => {
      const dt = ticker.deltaMS / 1000;
      elapsed += dt;
      const introProgress = Math.min(1, elapsed / 0.9);
      const easedIntro = 1 - Math.pow(1 - introProgress, 3);
      systemCamera.tilt = introTilt + (targetTilt - introTilt) * easedIntro;
      updateProjectionBasis(systemCamera, projectionBasis);
      updateProjectionPresentation();
      sunSprite.scale.set(sunBaseScale * (1 + Math.sin(elapsed * 0.9) * 0.07));
      if (corona) {
        corona.rotation += 0.018 * dt;
        corona.alpha = 0.8 + 0.2 * Math.sin(elapsed * 0.55);
      }
      nebulaSprite.alpha = 0.65 + 0.15 * Math.sin(elapsed * 0.22);
      if (asteroidBelt) asteroidBelt.rotation += 0.025 * dt;
      updateBodies(dt);
      for (const gfx of extractorGfx.values()) gfx.rotation += 0.004 * dt;
    };
    Ticker.shared.add(onTick);

    return () => {
      unsubExtractors();
      unsubFabricators();
      Ticker.shared.remove(onTick);
      orbitGfxRef.current = [];
      extractorGfx.clear();
      fabricatorGfx.clear();
      world.removeChild(systemRoot);
      systemRoot.destroy({ children: true });
      sunTexture.destroy(true);
      nebulaTexture.destroy(true);
      shadowTexture.destroy(true);
      for (const texture of bodyTextures) texture.destroy(true);
    };
  }, [system, isInitialised]);

  return (
    <>
      <BackgroundStars stars={backgroundStars} camera={camera} />
      <pixiContainer ref={worldRef} />
      <ScaleBar camera={camera} unitsPerWorldPx={1 / 180} unit="Light Minutes" niceValues={SYSTEM_NICE_VALUES} />
    </>
  );
}
