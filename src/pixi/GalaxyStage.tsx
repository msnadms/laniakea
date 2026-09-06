import { extend, useApplication } from '@pixi/react';
import { Container, Graphics, Ticker, Sprite, BlurFilter } from 'pixi.js';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { galaxyTravelCost, trySpendTravelCost } from '../store/travelCosts';
import {
  GALAXY_RADIUS,
  GALAXY_RADIUS_LY,
  NEBULA_SKIP_CHANCE,
  CORE_ELLIPSE_X,
  CORE_ELLIPSE_Y,
  CORE_DISTRIBUTION_POWER,
  CORE_ALPHA_SCALE,
  BARRED_CORE_CENTER_ALPHA_SCALE,
  CAMERA_INITIAL_SCALE,
  NEBULA_DISPLACEMENT_SCALE,
  CORE_COLORS,
  NEBULA_SCALE_HEIGHT,
  CORE_HEIGHT_SCALE,
  GALAXY_DEPTH_SLABS,
  GALAXY_TILT,
  GALAXY_INTRO_TILT_OFFSET,
  GALAXY_INTRO_TILT_MS,
} from '../game/constants';
import { createDisplacementSetup } from './textures';
import { createRng } from '../game/galaxyGen';
import { nebulaClouds, coreGlow, rotate } from '../game/galaxyShapes';
import { StarNode } from './StarNode';
import {
  createGalaxyCamera,
  galaxyDepthSlab,
  galaxySlabTint,
  projectPlanePointWithBasis,
  updateProjectionBasis,
  GALAXY_LAYER_Z,
  type ProjectedPoint,
} from './projection';
import { useCamera } from './useCamera';
import { animateTiltSettle, animateZoomTo } from './zoomAnim';
import { useZoomController } from './useZoomController';
import { ScaleBar } from './ScaleBar';
import { buildAddressComponent } from '../game/types';
import { BackgroundStars } from './BackgroundStars';
import { useCodexStore } from '../store/codexStore';
import { useAuthStore } from '../store/authStore';
import { saveSystemDiscovery } from '../firebase/discoveries';
import { generateGalaxyName } from '../game/superclusters';

const GALAXY_NICE_VALUES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

type Particle = { x: number; y: number; r: number; a: number };
type Batches = Map<number, Particle[]>;
type ScaledBatches = Map<number, Batches>;
type CachedStarProjection = { x: number; y: number; z: number; projected: ProjectedPoint };

function batchFor(batches: Batches, color: number): Particle[] {
  let batch = batches.get(color);
  if (!batch) {
    batch = [];
    batches.set(color, batch);
  }
  return batch;
}

function batchesForScale(groups: ScaledBatches, alphaScale: number): Batches {
  let batches = groups.get(alphaScale);
  if (!batches) {
    batches = new Map();
    groups.set(alphaScale, batches);
  }
  return batches;
}

function flushParticleBatches(gfx: Graphics, batches: Batches, alphaScale = 1) {
  for (const [color, particles] of batches) {
    const avgAlpha = particles.reduce((sum, p) => sum + p.a, 0) / particles.length;
    for (const p of particles) gfx.circle(p.x, p.y, p.r);
    gfx.fill({ color, alpha: avgAlpha * alphaScale });
  }
}

function spreadCoreSample(sample: number) {
  return Math.sign(sample) * Math.pow(Math.abs(sample), CORE_DISTRIBUTION_POWER);
}

extend({ Container, Graphics, Sprite });


export function GalaxyWorld() {
  const { isInitialised } = useApplication();

  const galaxySeed = useGameStore((s) => s.galaxy.seed);
  const galaxyConfig = useGameStore((s) => s.galaxy.config);
  const galaxySystems = useGameStore((s) => s.galaxy.systems);
  const galaxyBackgroundStars = useGameStore((s) => s.galaxy.backgroundStars);
  const setSystem = useGameStore((s) => s.setSystem);
  const pushAddress = useUIStore((s) => s.pushAddress);
  const popAddress = useUIStore((s) => s.popAddress);
  const setView = useUIStore((s) => s.setView);
  const config = galaxyConfig;

  const galaxyCamera = useMemo(() => createGalaxyCamera(), []);
  const galaxyProjection = useMemo(() => updateProjectionBasis(galaxyCamera), [galaxyCamera]);

  const worldRef = useRef<Container>(null);
  const galaxyRootRef = useRef<Container>(null);
  const starProjectionCacheRef = useRef<Map<number, CachedStarProjection>>(new Map());
  const handleSelectSystemRef = useRef<(id: number | null) => void>(() => {});
  const stableStageTap = useCallback(() => handleSelectSystemRef.current(null), []);

  const { camera, isReady } = useCamera(worldRef, CAMERA_INITIAL_SCALE, stableStageTap);

  const { isAnimatingRef, cancelZoomRef } = useZoomController(camera, worldRef, isReady, {
    onNavigateBack: () => {
      useUIStore.getState().popAddress();
      useUIStore.getState().removeAddressType('attractor');
      useUIStore.getState().setView('supercluster');
    },
    getCurrentPos: () => {
      const current = useGameStore.getState().galaxy.systems.find(s => s.current);
      return current && projectPlanePointWithBasis(current.x, current.y, current.z, galaxyProjection);
    },
  });

  const handleSelectSystem = useCallback((id: number | null) => {
    if (isAnimatingRef.current) return;
    if (id !== null) {
      if (useUIStore.getState().checkDetectionLethal()) return;
      const gameState = useGameStore.getState();
      const sys = gameState.galaxy.systems[id];
      const activeSystem = gameState.system;
      const fromX = activeSystem?.x ?? 0;
      const fromY = activeSystem?.y ?? 0;
      const isCurrent = sys.current === true;
      const travelDist = Math.hypot(sys.x - fromX, sys.y - fromY);
      if (!isCurrent && !trySpendTravelCost(galaxyTravelCost(travelDist))) return;
      if (activeSystem !== null) popAddress();
      gameState.markSystemVisited(sys.id);
      const galaxyName = generateGalaxyName(gameState.galaxy.seed);
      useCodexStore.getState().addSystemRecord(gameState.supercluster.seed, gameState.supercluster.name, gameState.galaxy.seed, galaxyName, sys);
      const user = useAuthStore.getState().user;
      if (user) saveSystemDiscovery(user.uid, gameState.supercluster.seed, gameState.supercluster.name, gameState.galaxy.seed, galaxyName, sys);
      pushAddress(buildAddressComponent(sys.name, sys.x, sys.y, sys.z, 'system'));
      setSystem(sys);

      if (worldRef.current) {
        isAnimatingRef.current = true;
        const target = projectPlanePointWithBasis(sys.x, sys.y, sys.z, galaxyProjection);
        const anchorX = camera.current.x + target.x * camera.current.scale;
        const anchorY = camera.current.y + target.y * camera.current.scale;
        cancelZoomRef.current = animateZoomTo(
          camera, worldRef.current,
          target.x, target.y,
          anchorX, anchorY,
          24, 700,
          () => useUIStore.getState().setViewTransitioning(true),
          () => {
            isAnimatingRef.current = false;
            cancelZoomRef.current = null;
            useUIStore.getState().setView('system');
          }
        );
      } else {
        setView('system');
      }
    } else {
      const activeSystem = useGameStore.getState().system;
      if (activeSystem !== null) popAddress();
      setSystem(null);
    }
  }, [pushAddress, popAddress, setSystem, setView, camera, cancelZoomRef, isAnimatingRef, galaxyProjection]);

  handleSelectSystemRef.current = handleSelectSystem;

  useEffect(() => {
    if (!isReady || !galaxyRootRef.current) return;
    const openingSquash = Math.cos(GALAXY_TILT - GALAXY_INTRO_TILT_OFFSET) / Math.cos(GALAXY_TILT);
    return animateTiltSettle(galaxyRootRef.current, openingSquash, GALAXY_INTRO_TILT_MS);
  }, [isReady, galaxySeed]);

  const starBands = useMemo(() => {
    const bands: Array<Array<{ system: typeof galaxySystems[number]; projected: ProjectedPoint }>> =
      Array.from({ length: GALAXY_DEPTH_SLABS }, () => []);
    const previousCache = starProjectionCacheRef.current;
    const nextCache = new Map<number, CachedStarProjection>();
    for (const system of galaxySystems) {
      const cached = previousCache.get(system.id);
      const projected = cached && cached.x === system.x && cached.y === system.y && cached.z === system.z
        ? cached.projected
        : projectPlanePointWithBasis(system.x, system.y, system.z, galaxyProjection);
      nextCache.set(system.id, { x: system.x, y: system.y, z: system.z, projected });
      bands[galaxyDepthSlab(projected.depth)].push({ system, projected });
    }
    starProjectionCacheRef.current = nextCache;
    return bands;
  }, [galaxySystems, galaxyProjection]);

  const radiusLy = useMemo(() => {
    const rng = createRng(galaxySeed);
    const sizeScale = Math.floor(rng() * 7) - 3;
    return Math.round(GALAXY_RADIUS_LY * Math.pow(2, sizeScale));
  }, [galaxySeed]);

  useEffect(() => {
    if (!isInitialised || !galaxyRootRef.current) return;
    const galaxyRoot = galaxyRootRef.current;

    const rng = createRng((galaxySeed ^ 0x9e3779b9) >>> 0);

    const slabBatches: ScaledBatches[] = Array.from({ length: GALAXY_DEPTH_SLABS }, () => new Map());
    const nebulaHeight = GALAXY_RADIUS * NEBULA_SCALE_HEIGHT;
    const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };

    const layoutRng = createRng((galaxySeed ^ 0x51ed270b) >>> 0);
    for (const cloud of nebulaClouds(layoutRng, config)) {
      if (rng() < NEBULA_SKIP_CHANCE) continue;

      const stepFraction = cloud.t;
      const taper = Math.pow(1 - Math.max(0, (stepFraction - 0.90) / 0.10), 1.5);

      for (let p = 0; p < cloud.count; p++) {
        const offsetX = ((rng() + rng()) / 2 - 0.5) * 2 * cloud.spread;
        const offsetY = ((rng() + rng()) / 2 - 0.5) * 2 * cloud.spread * config.galaxyEllipse;
        const offsetHeight = (rng() + rng() - 1) * nebulaHeight;
        const particleRadius = cloud.spread * (0.15 + rng() * 0.45) * cloud.blobScale;
        const useNebula = rng() < cloud.nebulaChance;
        const colorList = useNebula
          ? (rng() > Math.pow(stepFraction, 2) + 0.15 ? config.innerNebulaColors : config.nebulaColors)
          : CORE_COLORS;
        const nebulaColor = colorList[Math.floor(rng() * colorList.length)];
        const alpha = (0.014 + rng() * 0.024) * Math.max(1 - stepFraction, 0.5) * taper;

        projectPlanePointWithBasis(cloud.x + offsetX, cloud.y + offsetY, offsetHeight, galaxyProjection, projected);
        const batches = batchesForScale(
          slabBatches[galaxyDepthSlab(projected.depth)],
          cloud.opacityScale ?? 1,
        );
        batchFor(batches, nebulaColor)
          .push({ x: projected.x, y: projected.y, r: particleRadius * projected.scale, a: alpha });
      }
    }

    const coreGfx = new Graphics();
    const coreBatches: Batches = new Map();
    const coreCenterBatches: Batches = new Map();
    const glow = coreGlow(config);
    const coreHeight = CORE_ELLIPSE_Y * CORE_HEIGHT_SCALE * glow.flattening;
    for (let p = 0; p < glow.count; p++) {
      const unitX = spreadCoreSample(((rng() + rng()) / 2 - 0.5) * 2);
      const unitY = spreadCoreSample(((rng() + rng()) / 2 - 0.5) * 2);
      const unitHeight = ((rng() + rng()) / 2 - 0.5) * 2;
      const halfWidth = glow.lens > 0
        ? glow.lensFloor + (1 - glow.lensFloor) * Math.pow(Math.max(0, 1 - unitX * unitX), glow.lens)
        : 1;
      const [offsetX, offsetY] = rotate(
        unitX * CORE_ELLIPSE_X * glow.scaleX,
        unitY * halfWidth * CORE_ELLIPSE_Y * glow.scaleY,
        config.orientation + glow.angle,
      );
      const offsetHeight = unitHeight * halfWidth * coreHeight;
      const particleRadius = 20 + rng() * 60;
      const coreColor = CORE_COLORS[Math.floor(rng() * CORE_COLORS.length)];
      const reach = Math.hypot(unitX, unitY);
      const fade = Math.pow(Math.min(1, Math.max(0, (1 - reach) / (1 - glow.plateau))), glow.falloff);
      const alpha = (0.012 + rng() * 0.018) * fade * glow.alphaScale * CORE_ALPHA_SCALE;
      projectPlanePointWithBasis(offsetX, offsetY, offsetHeight, galaxyProjection, projected);
      const isBarredCenter = config.type === 'barred' && reach <= glow.plateau;
      batchFor(isBarredCenter ? coreCenterBatches : coreBatches, coreColor).push({
        x: projected.x,
        y: projected.y,
        r: particleRadius * projected.scale,
        a: alpha,
      });
    }
    flushParticleBatches(coreGfx, coreBatches);
    flushParticleBatches(coreGfx, coreCenterBatches, BARRED_CORE_CENTER_ALPHA_SCALE);

    // The gas has to be a sibling of the star bands, not their parent: a filtered
    // container renders as one unit, so nothing outside it can sort into it. One
    // displacement filter instance is shared by every slab so the whole gas layer
    // keeps drifting as one field rather than shearing at the slab seams.
    const disp = createDisplacementSetup(galaxyRoot, NEBULA_DISPLACEMENT_SCALE);
    const blurs: BlurFilter[] = [];

    const gasLayers = slabBatches.map((batchGroups, slab) => {
      const gfx = new Graphics();
      for (const [alphaScale, batches] of batchGroups) {
        flushParticleBatches(gfx, batches, galaxySlabTint(slab) * alphaScale);
      }
      gfx.zIndex = GALAXY_LAYER_Z.slab(slab);
      const blur = new BlurFilter({ strength: 0.75, quality: 1 });
      blurs.push(blur);
      gfx.filters = [blur, disp.filter];
      return gfx;
    });

    coreGfx.zIndex = GALAXY_LAYER_Z.core;
    const coreBlur = new BlurFilter({ strength: 0.75, quality: 1, blendMode: 'add' });
    blurs.push(coreBlur);
    coreGfx.filters = [coreBlur, disp.filter];
    gasLayers.push(coreGfx);

    for (const layer of gasLayers) {
      layer.blendMode = 'screen';
      galaxyRoot.addChild(layer);
    }

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      disp.update(elapsedSecs, NEBULA_DISPLACEMENT_SCALE * camera.current.scale);
    };

    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      for (const layer of gasLayers) {
        galaxyRoot.removeChild(layer);
        layer.destroy();
      }
      for (const blur of blurs) blur.destroy();
      disp.destroy();
    };
  }, [galaxySeed, config, isInitialised, camera, galaxyProjection]);

  return (
    <>
      <BackgroundStars stars={galaxyBackgroundStars} />
      <pixiContainer ref={worldRef} visible={isReady}>
        <pixiContainer ref={galaxyRootRef} sortableChildren>
          {starBands.map((band, slab) => (
            <pixiContainer key={slab} sortableChildren zIndex={GALAXY_LAYER_Z.stars(slab)}>
              {band.map(({ system, projected }) => (
                <StarNode key={system.id} system={system} projected={projected} onSelect={handleSelectSystem} />
              ))}
            </pixiContainer>
          ))}
        </pixiContainer>
      </pixiContainer>
      <ScaleBar
        camera={camera}
        unitsPerWorldPx={radiusLy / GALAXY_RADIUS}
        unit="Light Years"
        niceValues={GALAXY_NICE_VALUES}
      />
    </>
  );
}
