import { extend, useApplication } from '@pixi/react';
import { Container, Graphics, Ticker, Sprite, BlurFilter } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
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
  GALAXY_GAS_SLABS,
  GALAXY_INTRO_TILT_OFFSET,
  GALAXY_ORBIT_EASE,
  GALAXY_ORBIT_SENSITIVITY,
  GALAXY_PICK_SCREEN_PX,
  GALAXY_PICK_MAX_WORLD,
} from '../game/constants';
import { createDisplacementSetup } from './textures';
import { createRng } from '../game/galaxyGen';
import { nebulaClouds, coreGlow, rotate } from '../game/galaxyShapes';
import { StarNode } from './StarNode';
import { applyStarProjection, type StarViews } from './starView';
import {
  clampGalaxyTilt,
  createGalaxyCamera,
  galaxyGasSlab,
  galaxyGasSlabHeight,
  projectPlanePointWithBasis,
  updateProjectionBasis,
  GALAXY_DEPTH_HALF,
  type ProjectedPoint,
} from './projection';
import { DepthFadeFilter } from './depthFadeFilter';
import { useCamera } from './useCamera';
import { useOrbit, isOrbitGesture, type OrbitConfig } from './useOrbit';
import { animateZoomTo } from './zoomAnim';
import { useZoomController } from './useZoomController';
import { ScaleBar } from './ScaleBar';
import { buildAddressComponent, type StarSystem } from '../game/types';
import { BackgroundStars } from './BackgroundStars';
import { useCodexStore } from '../store/codexStore';
import { useAuthStore } from '../store/authStore';
import { saveSystemDiscovery } from '../firebase/discoveries';
import { generateGalaxyName } from '../game/superclusters';

const GALAXY_NICE_VALUES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

const GALAXY_ORBIT: OrbitConfig = {
  createCamera: createGalaxyCamera,
  clampTilt: clampGalaxyTilt,
  sensitivity: GALAXY_ORBIT_SENSITIVITY,
  ease: GALAXY_ORBIT_EASE,
};

type Particle = { x: number; y: number; r: number; a: number };
type Batches = Map<number, Particle[]>;
type ScaledBatches = Map<number, Batches>;
type StarProjection = { system: StarSystem; projected: ProjectedPoint };

interface GasBand {
  squash: Container;
  spin: Container;
  height: number;
}

interface GasLayer {
  container: Container;
  bands: GasBand[];
}

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

// Gas is baked once in plane coordinates and turned by container transforms: the
// spin container carries the yaw, its parent squashes by cos(tilt) and lifts the
// band by its height, which is the entire projection of a fixed-height point under
// an orthographic camera.
function createGasLayer(slabBatches: ScaledBatches[], halfHeight: number): GasLayer {
  const container = new Container();
  const bands = slabBatches.map((batchGroups, slab) => {
    const gfx = new Graphics();
    for (const [alphaScale, batches] of batchGroups) flushParticleBatches(gfx, batches, alphaScale);
    const spin = new Container();
    spin.addChild(gfx);
    const squash = new Container();
    squash.addChild(spin);
    container.addChild(squash);
    return { squash, spin, height: galaxyGasSlabHeight(slab, halfHeight) };
  });
  return { container, bands };
}

function orientGasLayer(layer: GasLayer, yaw: number, cosTilt: number, sinTilt: number) {
  for (const band of layer.bands) {
    band.spin.rotation = yaw;
    band.squash.scale.y = cosTilt;
    band.squash.position.y = -band.height * sinTilt;
  }
}

function spreadCoreSample(sample: number) {
  return Math.sign(sample) * Math.pow(Math.abs(sample), CORE_DISTRIBUTION_POWER);
}

extend({ Container, Graphics, Sprite });


export function GalaxyWorld() {
  const { app, isInitialised } = useApplication();

  const galaxySeed = useGameStore((s) => s.galaxy.seed);
  const galaxyConfig = useGameStore((s) => s.galaxy.config);
  const galaxySystems = useGameStore((s) => s.galaxy.systems);
  const galaxyBackgroundStars = useGameStore((s) => s.galaxy.backgroundStars);
  const setSystem = useGameStore((s) => s.setSystem);
  const pushAddress = useUIStore((s) => s.pushAddress);
  const popAddress = useUIStore((s) => s.popAddress);
  const setView = useUIStore((s) => s.setView);
  const config = galaxyConfig;

  const { orbitCamera, orbitTarget, didOrbit } = useOrbit(GALAXY_ORBIT);
  const galaxyProjection = useMemo(() => updateProjectionBasis(orbitCamera.current), [orbitCamera]);

  const worldRef = useRef<Container>(null);
  const galaxyRootRef = useRef<Container>(null);
  const handleSelectSystemRef = useRef<(id: number | null) => void>(() => {});
  const starProjectionsRef = useRef<StarProjection[]>([]);
  const starViews = useMemo<StarViews>(() => new Map(), []);

  const shouldPan = useCallback((event: FederatedPointerEvent) => !isOrbitGesture(event), []);
  const { camera, isReady, hasDragged } = useCamera(worldRef, CAMERA_INITIAL_SCALE, undefined, shouldPan);

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
      const gameState = useGameStore.getState();
      const sys = gameState.galaxy.systems[id];
      const activeSystem = gameState.system;
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

  // The disk opens a little flatter than it settles; the orbit ease carries it home.
  useEffect(() => {
    if (!isReady) return;
    orbitCamera.current.tilt = clampGalaxyTilt(orbitTarget.current.tilt - GALAXY_INTRO_TILT_OFFSET);
  }, [isReady, galaxySeed, orbitCamera, orbitTarget]);

  const starProjections = useMemo(
    () => galaxySystems.map((system) => ({
      system,
      projected: projectPlanePointWithBasis(system.x, system.y, system.z, galaxyProjection),
    })),
    [galaxySystems, galaxyProjection],
  );
  useLayoutEffect(() => {
    starProjectionsRef.current = starProjections;
  }, [starProjections]);

  useEffect(() => {
    if (!isInitialised || !isReady) return;
    const stage = app.stage;

    // Picked here rather than per star because a pixi click needs press and release on the same object.
    const pickStar = (global: { x: number; y: number }): StarSystem | null => {
      const root = galaxyRootRef.current;
      if (!root) return null;
      const local = root.toLocal(global);
      const maxDist = Math.min(GALAXY_PICK_SCREEN_PX / camera.current.scale, GALAXY_PICK_MAX_WORLD);
      let nearest: StarSystem | null = null;
      let nearestDist = Infinity;
      let nearestDepth = -Infinity;
      for (const { system, projected } of starProjectionsRef.current) {
        const dist = Math.hypot(projected.x - local.x, projected.y - local.y);
        if (dist > maxDist) continue;
        if (dist > nearestDist || (dist === nearestDist && projected.depth <= nearestDepth)) continue;
        nearestDist = dist;
        nearestDepth = projected.depth;
        nearest = system;
      }
      return nearest;
    };

    const onTap = (event: FederatedPointerEvent) => {
      if (hasDragged.current || didOrbit.current || event.button > 0) return;
      const nearest = pickStar(event.global);
      handleSelectSystemRef.current(nearest ? nearest.id : null);
    };

    const onMove = (event: FederatedPointerEvent) => {
      app.canvas.style.cursor = pickStar(event.global) ? 'pointer' : '';
    };

    stage.on('pointertap', onTap);
    stage.on('pointermove', onMove);
    return () => {
      stage.off('pointertap', onTap);
      stage.off('pointermove', onMove);
      app.canvas.style.cursor = '';
    };
  }, [app, isInitialised, isReady, camera, hasDragged, didOrbit]);

  const radiusLy = useMemo(() => {
    const rng = createRng(galaxySeed);
    const sizeScale = Math.floor(rng() * 7) - 3;
    return Math.round(GALAXY_RADIUS_LY * Math.pow(2, sizeScale));
  }, [galaxySeed]);

  useEffect(() => {
    if (!isInitialised || !galaxyRootRef.current) return;
    const galaxyRoot = galaxyRootRef.current;

    const rng = createRng((galaxySeed ^ 0x9e3779b9) >>> 0);

    const nebulaHalfHeight = GALAXY_RADIUS * NEBULA_SCALE_HEIGHT;
    const nebulaSlabs: ScaledBatches[] = Array.from({ length: GALAXY_GAS_SLABS }, () => new Map());

    const layoutRng = createRng((galaxySeed ^ 0x51ed270b) >>> 0);
    for (const cloud of nebulaClouds(layoutRng, config)) {
      if (rng() < NEBULA_SKIP_CHANCE) continue;

      const stepFraction = cloud.t;
      const taper = Math.pow(1 - Math.max(0, (stepFraction - 0.90) / 0.10), 1.5);

      for (let p = 0; p < cloud.count; p++) {
        const offsetX = ((rng() + rng()) / 2 - 0.5) * 2 * cloud.spread;
        const offsetY = ((rng() + rng()) / 2 - 0.5) * 2 * cloud.spread * config.galaxyEllipse;
        const offsetHeight = (rng() + rng() - 1) * nebulaHalfHeight;
        const particleRadius = cloud.spread * (0.15 + rng() * 0.45) * cloud.blobScale;
        const useNebula = rng() < cloud.nebulaChance;
        const colorList = useNebula
          ? (rng() > Math.pow(stepFraction, 2) + 0.15 ? config.innerNebulaColors : config.nebulaColors)
          : CORE_COLORS;
        const nebulaColor = colorList[Math.floor(rng() * colorList.length)];
        const alpha = (0.014 + rng() * 0.024) * Math.max(1 - stepFraction, 0.5) * taper;

        const batches = batchesForScale(
          nebulaSlabs[galaxyGasSlab(offsetHeight, nebulaHalfHeight)],
          cloud.opacityScale ?? 1,
        );
        batchFor(batches, nebulaColor)
          .push({ x: cloud.x + offsetX, y: cloud.y + offsetY, r: particleRadius, a: alpha });
      }
    }

    const glow = coreGlow(config);
    const coreHalfHeight = CORE_ELLIPSE_Y * CORE_HEIGHT_SCALE * glow.flattening;
    const coreSlabs: ScaledBatches[] = Array.from({ length: GALAXY_GAS_SLABS }, () => new Map());
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
      const offsetHeight = unitHeight * halfWidth * coreHalfHeight;
      const particleRadius = 20 + rng() * 60;
      const coreColor = CORE_COLORS[Math.floor(rng() * CORE_COLORS.length)];
      const reach = Math.hypot(unitX, unitY);
      const fade = Math.pow(Math.min(1, Math.max(0, (1 - reach) / (1 - glow.plateau))), glow.falloff);
      const alpha = (0.012 + rng() * 0.018) * fade * glow.alphaScale * CORE_ALPHA_SCALE;
      const isBarredCenter = config.type === 'barred' && reach <= glow.plateau;
      const batches = batchesForScale(
        coreSlabs[galaxyGasSlab(offsetHeight, coreHalfHeight)],
        isBarredCenter ? BARRED_CORE_CENTER_ALPHA_SCALE : 1,
      );
      batchFor(batches, coreColor).push({ x: offsetX, y: offsetY, r: particleRadius, a: alpha });
    }

    // The gas has to be a sibling of the stars, not their parent: a filtered
    // container renders as one unit, so nothing outside it can sort into it. Its
    // height bands do share that one container, and so one filter pass, because no
    // star ever falls between two of them.
    const disp = createDisplacementSetup(galaxyRoot, NEBULA_DISPLACEMENT_SCALE);
    const nebulaBlur = new BlurFilter({ strength: 0.75, quality: 1 });
    const coreBlur = new BlurFilter({ strength: 0.75, quality: 1, blendMode: 'add' });

    const depthFade = new DepthFadeFilter();

    const nebulaLayer = createGasLayer(nebulaSlabs, nebulaHalfHeight);
    nebulaLayer.container.filters = [nebulaBlur, disp.filter, depthFade];
    nebulaLayer.container.blendMode = 'screen';
    nebulaLayer.container.zIndex = 0;

    const coreLayer = createGasLayer(coreSlabs, coreHalfHeight);
    coreLayer.container.filters = [coreBlur, disp.filter];
    coreLayer.container.blendMode = 'screen';
    coreLayer.container.zIndex = 1;

    galaxyRoot.addChild(nebulaLayer.container);
    galaxyRoot.addChild(coreLayer.container);

    // World distance from the galactic centre to where the depth fade clamps, which
    // is where the disk's own depth reaches GALAXY_DEPTH_HALF.
    let fadeHalfSpan = GALAXY_DEPTH_HALF;

    const orient = () => {
      const { yaw } = orbitCamera.current;
      const basis = updateProjectionBasis(orbitCamera.current, galaxyProjection);
      orientGasLayer(nebulaLayer, yaw, basis.cosTilt, basis.sinTilt);
      orientGasLayer(coreLayer, yaw, basis.cosTilt, basis.sinTilt);
      fadeHalfSpan = GALAXY_DEPTH_HALF * basis.cosTilt / basis.sinTilt;

      for (const { system, projected } of starProjectionsRef.current) {
        projectPlanePointWithBasis(system.x, system.y, system.z, basis, projected);
        const view = starViews.get(system.id);
        if (view) applyStarProjection(view, projected);
      }
    };

    orient();

    let elapsedSecs = 0;
    let lastYaw = orbitCamera.current.yaw;
    let lastTilt = orbitCamera.current.tilt;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      disp.update(elapsedSecs, NEBULA_DISPLACEMENT_SCALE * camera.current.scale);

      const { yaw, tilt } = orbitCamera.current;
      if (yaw !== lastYaw || tilt !== lastTilt) {
        lastYaw = yaw;
        lastTilt = tilt;
        orient();
      }

      depthFade.setRamp(camera.current.y, fadeHalfSpan * camera.current.scale);
    };

    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      galaxyRoot.removeChild(nebulaLayer.container);
      galaxyRoot.removeChild(coreLayer.container);
      nebulaLayer.container.destroy({ children: true });
      coreLayer.container.destroy({ children: true });
      nebulaBlur.destroy();
      coreBlur.destroy();
      depthFade.destroy();
      disp.destroy();
    };
  }, [galaxySeed, config, isInitialised, camera, orbitCamera, galaxyProjection, starViews]);

  return (
    <>
      <BackgroundStars stars={galaxyBackgroundStars} />
      <pixiContainer ref={worldRef} visible={isReady}>
        <pixiContainer ref={galaxyRootRef} sortableChildren>
          {starProjections.map(({ system, projected }) => (
            <StarNode key={system.id} system={system} projected={projected} views={starViews} />
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
