import { useApplication } from '@pixi/react';
import { Container, Graphics, Rectangle, Ticker, BlurFilter, Particle, ParticleContainer } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { superclusterTravelCost, trySpendTravelCost } from '../store/travelCosts';
import { useAuthStore } from '../store/authStore';
import { useCodexStore } from '../store/codexStore';
import { buildAddressComponent, type SuperclusterDot } from '../game/types';
import { useCamera } from './useCamera';
import {
  SC_CAMERA_INITIAL_SCALE,
  SC_DOT_TEXTURE_RADIUS,
  SC_WORLD_HALF,
  SC_WORLD_HALF_MLY,
  OBS_UNIVERSE_RADIUS,
} from '../game/constants';
import { MSG_DRIVE_REQUIRED_GALAXY } from '../ui/strings';
import { animateZoomTo } from './zoomAnim';
import { useZoomController } from './useZoomController';
import { useOrbit, isOrbitGesture } from './useOrbit';
import {
  projectPlanePointWithBasis,
  projectSuperclusterField,
  superclusterDepthAlpha,
  updateProjectionBasis,
  type ProjectedPoint,
  type ProjectionBasis,
} from './projection';
import { ScaleBar } from './ScaleBar';
import { createRng } from '../game/galaxyGen';
import { createPointerLabel } from './labels';
import { createSuperclusterDotTexture } from './textures';
import { BackgroundStars } from './BackgroundStars';
import { saveGalaxyDiscovery, saveSuperclusterDiscovery } from '../firebase/discoveries';
import { pushAttractorAddress } from '../game/superclusters';

const SC_NICE_VALUES = [5, 10, 25, 50, 100, 150, 200, 300, 500];

const N_BLINK_GROUPS = 10;
const BLINK_FREQ = 0.22;
const BLINK_MIN  = 0.25;
const BLINK_MAX  = 1.0;

const TIER_BASE = [
  { min: 0.80, radius: 3.5, alpha: 1.00 },
  { min: 0.60, radius: 2.8, alpha: 0.96 },
  { min: 0.40, radius: 2.3, alpha: 0.88 },
  { min: 0.20, radius: 1.8, alpha: 0.75 },
  { min: -Infinity, radius: 1.4, alpha: 0.55 },
];

const DOT_PALETTES = [
  [0xffee44, 0xff44dd, 0xaa00ff, 0xff0066, 0x440088], // Cosmic:   yellow → magenta → purple → hot-pink → deep-violet
  [0x44ffee, 0xff8800, 0xcc00ff, 0x0088ff, 0x110055], // Plasma:   cyan → orange → violet → electric-blue → midnight
  [0x99ff33, 0xff55aa, 0xffaa00, 0x00ff88, 0x550022], // Verdant:  lime → rose → gold → mint → deep-rose
  [0xff5544, 0x44ffee, 0xcc00ff, 0xff0044, 0x110044], // Stellar:  red → cyan → violet → crimson → midnight
  [0xffcc00, 0x00ffcc, 0xaa00ff, 0xff7700, 0x002244], // Solaris:  gold → teal → violet → amber → deep-teal
  [0xff88ff, 0x44aaff, 0xff8844, 0xff00bb, 0x001166], // Blossom:  pink → sky-blue → coral → magenta → deep-navy
  [0xbbffff, 0xffcc00, 0xff00cc, 0x88eeff, 0x440033], // Frost:    ice → gold → magenta → pale-sky → deep-magenta
  [0xffeeaa, 0xffaa22, 0xee2266, 0x7700ee, 0x220055], // Galactic: gold → amber → crimson → violet → midnight
];

function getBrightnessTiers(seed: number) {
  const colors = DOT_PALETTES[seed % DOT_PALETTES.length];
  return TIER_BASE.map((t, i) => ({ ...t, color: colors[i] }));
}

const LABEL_DEPTH_FADE = 0.4;

const SC_FIELD_EXTENT = SC_WORLD_HALF * 3;

export function SuperclusterWorld() {
  const { app, isInitialised } = useApplication();

  const scSeed = useGameStore((s) => s.supercluster.seed);
  const scName = useGameStore((s) => s.supercluster.name);
  const scDots = useGameStore((s) => s.supercluster.dots);
  const scAttractors = useGameStore((s) => s.supercluster.attractors);
  const scBackgroundStars = useGameStore((s) => s.supercluster.backgroundStars);
  const regenerateGalaxy = useGameStore((s) => s.regenerateGalaxy);
  const markDotVisited = useGameStore((s) => s.markDotVisited);
  const setView = useUIStore((s) => s.setView);
  const pushAddress = useUIStore((s) => s.pushAddress);
  const removeAddressType = useUIStore((s) => s.removeAddressType);
  const showAttractorLabels = useUIStore((s) => s.showAttractorLabels);

  const worldRef = useRef<Container>(null);
  const { orbitCamera, didOrbit } = useOrbit();
  const shouldPan = useCallback((event: FederatedPointerEvent) => !isOrbitGesture(event), []);
  const { camera, isReady } = useCamera(worldRef, SC_CAMERA_INITIAL_SCALE, undefined, undefined, shouldPan);
  const showAttractorLabelsRef = useRef(showAttractorLabels);
  useEffect(() => {
    showAttractorLabelsRef.current = showAttractorLabels;
  }, [showAttractorLabels]);

  const getCurrentPos = useCallback(() => {
    const current = useGameStore.getState().supercluster.dots.find((d) => d.current);
    if (!current) return undefined;
    const basis = updateProjectionBasis(orbitCamera.current);
    return projectPlanePointWithBasis(current.x, current.y, current.z, basis);
  }, [orbitCamera]);

  const { isAnimatingRef, cancelZoomRef } = useZoomController(camera, worldRef, isReady, { getCurrentPos });

  const visitedDotsRef = useRef<SuperclusterDot[]>([]);
  const currentDotRef = useRef<SuperclusterDot | null>(null);

  useEffect(() => {
    visitedDotsRef.current = scDots.filter((d) => d.visited && !d.current);
    currentDotRef.current = scDots.find((d) => d.current) ?? null;
  }, [scDots]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;
    const rng = createRng(scSeed);
    const obsUniverseCoords = () => rng() * OBS_UNIVERSE_RADIUS * 2 - OBS_UNIVERSE_RADIUS;
    const [x, y, z] = [obsUniverseCoords(), obsUniverseCoords(), obsUniverseCoords()];
    pushAddress(buildAddressComponent(scName, x, y, z, 'supercluster'));

    const tiers = getBrightnessTiers(scSeed);
    // Read dots directly from store — position/brightness never change, only the
    // visited flag does, and the overlay below redraws that from its own ref.
    const initialDots = useGameStore.getState().supercluster.dots;
    const count = initialDots.length;

    const planeX = new Float32Array(count);
    const planeY = new Float32Array(count);
    const height = new Float32Array(count);
    const baseScale = new Float32Array(count);
    const baseAlpha = new Float32Array(count);
    const blinkGroup = new Uint8Array(count);
    const projectedX = new Float32Array(count);
    const projectedY = new Float32Array(count);
    const depthAlpha = new Float32Array(count);
    const depthScale = new Float32Array(count);
    const particles: Particle[] = new Array(count);

    const dotTexture = createSuperclusterDotTexture();
    for (let i = 0; i < count; i++) {
      const dot = initialDots[i];
      const tier = tiers[tiers.findIndex((t) => dot.brightness > t.min)];
      planeX[i] = dot.x;
      planeY[i] = dot.y;
      height[i] = dot.z;
      baseScale[i] = tier.radius / SC_DOT_TEXTURE_RADIUS;
      baseAlpha[i] = tier.alpha;
      blinkGroup[i] = dot.seed % N_BLINK_GROUPS;
      particles[i] = new Particle({
        texture: dotTexture,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: tier.color,
      });
    }

    const scContainer = new Container();

    const dotsContainer = new Container();
    dotsContainer.blendMode = 'screen';
    const blurFilter = new BlurFilter({ strength: 0.05 });
    dotsContainer.filters = [blurFilter];

    const particleContainer = new ParticleContainer({
      texture: dotTexture,
      particles,
      dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
    });
    // A ParticleContainer reports empty bounds, which would collapse the blur
    // filter's render region, and it only uploads static attributes once its
    // children are marked dirty.
    particleContainer.boundsArea = new Rectangle(-SC_FIELD_EXTENT, -SC_FIELD_EXTENT, SC_FIELD_EXTENT * 2, SC_FIELD_EXTENT * 2);
    particleContainer.update();
    dotsContainer.addChild(particleContainer);

    const visitedGfx = new Graphics();
    const currentGfx = new Graphics();
    scContainer.addChild(dotsContainer);
    scContainer.addChild(visitedGfx);
    scContainer.addChild(currentGfx);
    world.addChild(scContainer);

    const basis = updateProjectionBasis(orbitCamera.current);
    const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
    const blink = new Float32Array(N_BLINK_GROUPS);

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      updateProjectionBasis(orbitCamera.current, basis);

      for (let g = 0; g < N_BLINK_GROUPS; g++) {
        const phase = (g / N_BLINK_GROUPS) * Math.PI * 2;
        const t = 0.5 + 0.5 * Math.sin(elapsedSecs * BLINK_FREQ * Math.PI * 2 + phase);
        blink[g] = BLINK_MIN + (BLINK_MAX - BLINK_MIN) * t;
      }

      projectSuperclusterField(planeX, planeY, height, basis, projectedX, projectedY, depthAlpha, depthScale);
      for (let i = 0; i < count; i++) {
        const particle = particles[i];
        particle.x = projectedX[i];
        particle.y = projectedY[i];
        particle.scaleX = baseScale[i] * depthScale[i];
        particle.scaleY = particle.scaleX;
        particle.alpha = baseAlpha[i] * blink[blinkGroup[i]] * depthAlpha[i];
      }

      drawVisited(visitedGfx, visitedDotsRef.current, basis, projected);
      drawCurrent(currentGfx, currentDotRef.current, basis, projected, elapsedSecs);
    };
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      world.removeChild(scContainer);
      scContainer.destroy({ children: true });
      blurFilter.destroy();
      dotTexture.destroy(true);
    };
  }, [scSeed, scName, pushAddress, app, isInitialised, orbitCamera]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;

    const titleGroup = createPointerLabel(scName, 90, {
      lineLength: 1600,
      dotRadius: 8,
      alpha: 0.8,
    });
    titleGroup.position.set(0, 0);
    world.addChild(titleGroup);

    const labelContainer = new Container();
    const labelGroups: Container[] = [];
    for (const att of scAttractors) {
      const group = createPointerLabel(att.name, 40, { lineLength: 120 });
      group.position.set(att.x, att.y);
      labelContainer.addChild(group);
      labelGroups.push(group);
    }
    world.addChild(labelContainer);

    const basis = updateProjectionBasis(orbitCamera.current);
    const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };

    const tick = () => {
      labelContainer.visible = showAttractorLabelsRef.current && camera.current.scale > 0.25;
      if (!labelContainer.visible) return;
      updateProjectionBasis(orbitCamera.current, basis);
      for (let i = 0; i < scAttractors.length; i++) {
        const att = scAttractors[i];
        projectPlanePointWithBasis(att.x, att.y, att.z, basis, projected);
        labelGroups[i].position.set(projected.x, projected.y);
        labelGroups[i].alpha = 1 - LABEL_DEPTH_FADE * (1 - superclusterDepthAlpha(projected.depth));
      }
    };
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      world.removeChild(titleGroup);
      world.removeChild(labelContainer);
      titleGroup.destroy({ children: true });
      labelContainer.destroy({ children: true });
    };
  }, [scSeed, scName, scAttractors, isInitialised, camera, orbitCamera]);


  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;
    const stage = app.stage;

    const onTap = (e: FederatedPointerEvent) => {
      if (isAnimatingRef.current) return;
      if (didOrbit.current || isOrbitGesture(e)) return;
      if (camera.current.scale < 0.5) return;
      const local = world.toLocal(e.global);
      const sc = useGameStore.getState().supercluster;
      const basis = updateProjectionBasis(orbitCamera.current);
      const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
      const maxDist = 15 / camera.current.scale;
      let nearest: SuperclusterDot | null = null;
      let nearestDepth = -Infinity;
      let nearestX = 0;
      let nearestY = 0;
      // Overlapping dots resolve to the front one, so a click never selects a
      // galaxy hidden behind the one under the cursor.
      for (const dot of sc.dots) {
        projectPlanePointWithBasis(dot.x, dot.y, dot.z, basis, projected);
        if (Math.hypot(projected.x - local.x, projected.y - local.y) > maxDist) continue;
        if (projected.depth <= nearestDepth) continue;
        nearestDepth = projected.depth;
        nearest = dot;
        nearestX = projected.x;
        nearestY = projected.y;
      }
      if (!nearest) return;
      if (useUIStore.getState().checkDetectionLethal()) return;
      const currentGalaxySeed = useGameStore.getState().galaxy.seed;
      const isCurrent = nearest.seed === currentGalaxySeed;
      const currentDot = sc.dots.find(d => d.seed === currentGalaxySeed);
      const travelDist = Math.hypot(nearest.x - (currentDot?.x ?? 0), nearest.y - (currentDot?.y ?? 0));
      if (!isCurrent) {
        const { driveA, triggerHudNotify } = useUIStore.getState();
        if (driveA < 1) {
          triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY);
          return;
        }
        if (!trySpendTravelCost(superclusterTravelCost(travelDist))) return;
      }

      markDotVisited(nearest.seed);
      useCodexStore.getState().addGalaxyRecord(sc.seed, sc.name, nearest.seed, nearest.name);
      const user = useAuthStore.getState().user;
      if (user) {
        saveSuperclusterDiscovery(user.uid, sc.seed, sc.name);
        saveGalaxyDiscovery(user.uid, sc.seed, nearest.seed, nearest.name);
      }
      if (!isCurrent) regenerateGalaxy(nearest.seed);

      pushAttractorAddress(sc.attractors, nearest.x, nearest.y, pushAddress, removeAddressType);
      pushAddress(buildAddressComponent(nearest.name, nearest.x, nearest.y, nearest.z, 'galaxy'));

      isAnimatingRef.current = true;
      cancelZoomRef.current = animateZoomTo(
        camera, world,
        nearestX, nearestY,
        e.global.x, e.global.y,
        24, 500,
        () => useUIStore.getState().setViewTransitioning(true),
        () => {
          isAnimatingRef.current = false;
          cancelZoomRef.current = null;
          useUIStore.getState().setView('galaxy');
        },
      );
    };

    stage.on('pointertap', onTap);
    return () => {
      stage.off('pointertap', onTap);
      if (cancelZoomRef.current) {
        cancelZoomRef.current();
        cancelZoomRef.current = null;
        isAnimatingRef.current = false;
        useUIStore.getState().setViewTransitioning(false);
      }
    };
  }, [app, isInitialised, regenerateGalaxy, markDotVisited, setView, pushAddress, removeAddressType, camera, cancelZoomRef, isAnimatingRef, orbitCamera, didOrbit]);

  return (
    <>
      <BackgroundStars stars={scBackgroundStars} />
      <pixiContainer ref={worldRef} visible={isReady} />
      <ScaleBar
        camera={camera}
        unitsPerWorldPx={SC_WORLD_HALF_MLY / SC_WORLD_HALF}
        unit="Million Light Years"
        niceValues={SC_NICE_VALUES}
      />
    </>
  );
}

function drawVisited(
  gfx: Graphics,
  dots: SuperclusterDot[],
  basis: ProjectionBasis,
  projected: ProjectedPoint,
) {
  gfx.clear();
  if (dots.length === 0) return;
  for (const dot of dots) {
    projectPlanePointWithBasis(dot.x, dot.y, dot.z, basis, projected);
    gfx.circle(projected.x, projected.y, 8);
  }
  gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
  for (const dot of dots) {
    projectPlanePointWithBasis(dot.x, dot.y, dot.z, basis, projected);
    gfx.circle(projected.x, projected.y, 11);
  }
  gfx.stroke({ color: 0xffffff, width: 0.5, alpha: 0.25 });
}

function drawCurrent(
  gfx: Graphics,
  dot: SuperclusterDot | null,
  basis: ProjectionBasis,
  projected: ProjectedPoint,
  elapsedSecs: number,
) {
  gfx.clear();
  if (!dot) return;
  projectPlanePointWithBasis(dot.x, dot.y, dot.z, basis, projected);
  const { x, y } = projected;

  gfx.circle(x, y, 5);
  gfx.fill({ color: 0x00e8ff, alpha: 0.55 });
  gfx.circle(x, y, 12);
  gfx.stroke({ color: 0x00e8ff, width: 2, alpha: 0.95 });
  gfx.circle(x, y, 18);
  gfx.stroke({ color: 0x00e8ff, width: 1, alpha: 0.55 });

  const gap = 20, arm = 38;
  gfx.moveTo(x - arm, y).lineTo(x - gap, y);
  gfx.moveTo(x + gap, y).lineTo(x + arm, y);
  gfx.moveTo(x, y - arm).lineTo(x, y - gap);
  gfx.moveTo(x, y + gap).lineTo(x, y + arm);
  gfx.stroke({ color: 0x00e8ff, width: 1.5, alpha: 0.85 });

  const nub = 4;
  gfx.moveTo(x - arm, y - nub).lineTo(x - arm, y + nub);
  gfx.moveTo(x + arm, y - nub).lineTo(x + arm, y + nub);
  gfx.moveTo(x - nub, y - arm).lineTo(x + nub, y - arm);
  gfx.moveTo(x - nub, y + arm).lineTo(x + nub, y + arm);
  gfx.stroke({ color: 0x00e8ff, width: 1.5, alpha: 0.65 });

  const pulse = 0.5 + 0.5 * Math.sin(elapsedSecs * Math.PI * 2 * 0.7);
  const outerR = 26 + pulse * 10;
  gfx.circle(x, y, outerR);
  gfx.stroke({ color: 0x00e8ff, width: 1.2, alpha: 0.2 + pulse * 0.45 });
  gfx.circle(x, y, outerR + 6);
  gfx.stroke({ color: 0x00e8ff, width: 0.6, alpha: 0.08 + pulse * 0.18 });
}
