import { useApplication } from '@pixi/react';
import { Container, Graphics, Particle, ParticleContainer, ParticleShader, Rectangle, Text, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { useCodexStore } from '../store/codexStore';
import { useFlightStore } from '../store/flightStore';
import {
  getUniverseChunk,
  getUniverseSky,
  isUniverseChunkCached,
  locateSupercluster,
  universeChunksNear,
  type ChunkRef,
  type SuperclusterLocation,
} from '../game/universe';
import { generateSuperclusterName } from '../game/superclusters';
import {
  SC_DOT_TEXTURE_RADIUS,
  UNIVERSE_CHUNK_BUDGET_MS,
  UNIVERSE_CHUNK_REFRESH,
  UNIVERSE_CHUNK_TRIALS,
  UNIVERSE_FOG_FAR,
  UNIVERSE_PICK_MIN_ALPHA,
  UNIVERSE_PICK_SCREEN_PX,
  SCAN_AIM_BACK_ALPHA,
  SCAN_AIM_FRONT_ALPHA,
  SCAN_BUDGET_MS,
  SCAN_SHELL_COLOR,
  SCAN_SHELL_LINE_PX,
  SCAN_SHELL_DENIED_COLOR,
  SCAN_UNIVERSE_MAX_TARGETS,
} from '../game/constants';
import type { FlyCamera, UniverseChunk } from '../game/types';
import { createSuperclusterDotTexture } from './textures';
import { createPointerLabel } from './labels';
import { animateZoomTo } from './zoomAnim';
import { useZoomController } from './useZoomController';
import { useFlyCamera } from './useFlyCamera';
import {
  createUniverseCamera,
  faceTarget,
  projectSkyDirection,
  projectUniverseField,
  projectUniverseMark,
  projectUniversePoint,
  universeMarkDepth,
  updateFlyBasis,
} from './flyProjection';
import type { ProjectedPoint } from './projection';
import { drawCrosshair, drawVisitedRings } from './dotOverlays';
import { createUniverseMinimap } from './universeMinimap';
import { createUniverseAnomalyDebug } from './anomalyDebug';
import { useScanStore } from '../store/scanStore';
import { createScanSelect, type ScanAim, type ScanAnchor } from './scanSelect';
import { createScanShell } from './scanShell';
import { createUniverseScanOverlay } from './scanOverlay';
import { createUniverseScanRun, recordSweep, type ScanRun } from './scanRun';
import { scanCost, scanPrecisionRadius, type ScanSphere } from '../game/scan';

const N_BLINK_GROUPS = 10;
const BLINK_FREQ = 0.22;
const BLINK_MIN = 0.45;
const BLINK_MAX = 1.0;

const TIERS = [
  { min: 0.80, size: 1.5, alpha: 1.00, color: 0xeaf4ff },
  { min: 0.60, size: 1.25, alpha: 0.95, color: 0x9fdcff },
  { min: 0.40, size: 1.05, alpha: 0.85, color: 0x6fb2ff },
  { min: 0.20, size: 0.9, alpha: 0.72, color: 0x8a7dff },
  { min: -Infinity, size: 0.75, alpha: 0.55, color: 0x6a4fd0 },
];
const TIER_BGR = TIERS.map((t) => ((t.color & 0xff) << 16) | (t.color & 0xff00) | ((t.color >> 16) & 0xff));
const TIER_SCALE = TIERS.map((t) => t.size / SC_DOT_TEXTURE_RADIUS);

const FIELD_EXTENT = 100_000;
const MLY_PER_MPC = 3.26156;
const READOUT_BOTTOM_PX = 40;
const SLOT_GROWTH = 4096;

function tierOf(brightness: number): number {
  let tier = 0;
  while (brightness <= TIERS[tier].min) tier++;
  return tier;
}

function initialPose(): FlyCamera {
  const target = locateSupercluster(useGameStore.getState().supercluster.seed);
  const saved = useUIStore.getState().universePose;
  const pose = saved ? { ...saved } : createUniverseCamera();
  if (!target) return pose;
  if (!saved) {
    pose.x += target.x;
    pose.y += target.y;
    pose.z += target.z;
  }
  faceTarget(pose, target.x, target.y, target.z);
  return pose;
}

function formatSpeed(speed: number): string {
  return (speed / MLY_PER_MPC).toLocaleString('en-US', { maximumSignificantDigits: 3 });
}

function grow<T extends Float32Array | Int32Array>(array: T, capacity: number): T {
  const next = new (array.constructor as new (length: number) => T)(capacity);
  next.set(array);
  return next;
}

export function UniverseWorld() {
  const { app, isInitialised } = useApplication();
  const superclusterSeed = useGameStore((s) => s.supercluster.seed);
  const codexSuperclusters = useCodexStore((s) => s.superclusters);

  const worldRef = useRef<Container>(null);
  const screenCamera = useRef({ x: 0, y: 0, scale: 1 });
  const [isReady, setIsReady] = useState(false);

  const getCurrentPos = useCallback(() => ({ x: 0, y: 0 }), []);
  const { isAnimatingRef, cancelZoomRef } = useZoomController(screenCamera, worldRef, isReady, { getCurrentPos });
  const isFrozen = useCallback(() => isAnimatingRef.current || useUIStore.getState().viewTransitioning, [isAnimatingRef]);
  const { flyCamera, speed, pointer, didLook } = useFlyCamera(initialPose, isFrozen);

  const visitedRef = useRef<SuperclusterLocation[]>([]);
  const currentRef = useRef<SuperclusterLocation | null>(null);

  useEffect(() => {
    visitedRef.current = Object.values(codexSuperclusters)
      .map((record) => locateSupercluster(record.superclusterSeed))
      .filter((location): location is SuperclusterLocation => location !== null);
  }, [codexSuperclusters]);

  useEffect(() => {
    currentRef.current = locateSupercluster(superclusterSeed);
  }, [superclusterSeed]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;
    const centre = () => {
      if (isAnimatingRef.current) return;
      screenCamera.current.x = app.screen.width / 2;
      screenCamera.current.y = app.screen.height / 2;
      world.position.set(screenCamera.current.x, screenCamera.current.y);
      world.scale.set(screenCamera.current.scale);
    };
    centre();
    setIsReady(true);
    app.renderer.on('resize', centre);
    return () => {
      app.renderer?.off('resize', centre);
    };
  }, [app, isInitialised, isAnimatingRef]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;
    const stage = app.stage;
    const sky = getUniverseSky();

    const texture = createSuperclusterDotTexture();
    const dotsContainer = new Container();
    dotsContainer.blendMode = 'screen';
    const particleContainer = new ParticleContainer({
      texture,
      shader: new ParticleShader(),
      dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
    });
    particleContainer.boundsArea = new Rectangle(-FIELD_EXTENT, -FIELD_EXTENT, FIELD_EXTENT * 2, FIELD_EXTENT * 2);
    dotsContainer.addChild(particleContainer);
    const drawn = particleContainer.particleChildren;

    const visitedGfx = new Graphics();
    const currentGfx = new Graphics();
    const hoverLayer = new Container();
    const scanOverlay = createUniverseScanOverlay();
    const scanShell = createScanShell();
    world.addChild(scanShell.back);
    world.addChild(scanOverlay.backNode);
    world.addChild(dotsContainer);
    world.addChild(visitedGfx);
    world.addChild(currentGfx);
    world.addChild(scanShell.front);
    world.addChild(scanOverlay.node);
    world.addChild(hoverLayer);

    const skyContainer = new Container();
    const skyDim = new Graphics();
    const skyBright = new Graphics();
    skyContainer.addChild(skyDim);
    skyContainer.addChild(skyBright);
    stage.addChildAt(skyContainer, 0);

    const speedText = new Text({
      text: '',
      style: { fontFamily: 'IBM Plex Sans', fontSize: 14, fill: 0x00bee6, align: 'center' },
    });
    speedText.anchor.set(0.5, 1);
    speedText.alpha = 0.75;
    stage.addChild(speedText);

    const minimap = createUniverseMinimap();
    stage.addChild(minimap.container);

    const projectedX = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
    const projectedY = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
    const depth = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
    const size = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
    const alpha = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);

    const pool: Particle[] = [];
    let capacity = 0;
    let slotCount = 0;
    let uploadedCount = 0;
    let slotX = new Float32Array(0);
    let slotY = new Float32Array(0);
    let slotDepth = new Float32Array(0);
    let slotRadius = new Float32Array(0);
    let slotAlpha = new Float32Array(0);
    let slotIndex = new Int32Array(0);
    const slotChunk: UniverseChunk[] = [];

    const ensureCapacity = (needed: number) => {
      if (needed <= capacity) return;
      capacity = Math.max(needed, capacity + SLOT_GROWTH);
      slotX = grow(slotX, capacity);
      slotY = grow(slotY, capacity);
      slotDepth = grow(slotDepth, capacity);
      slotRadius = grow(slotRadius, capacity);
      slotAlpha = grow(slotAlpha, capacity);
      slotIndex = grow(slotIndex, capacity);
      while (pool.length < capacity) pool.push(new Particle({ texture, anchorX: 0.5, anchorY: 0.5 }));
    };

    const active: UniverseChunk[] = [];
    const pending: ChunkRef[] = [];
    let pendingIndex = 0;
    const refreshedAt = { x: NaN, y: NaN, z: NaN };

    const refreshChunks = (camera: FlyCamera) => {
      refreshedAt.x = camera.x;
      refreshedAt.y = camera.y;
      refreshedAt.z = camera.z;
      active.length = 0;
      pending.length = 0;
      pendingIndex = 0;
      for (const ref of universeChunksNear(camera.x, camera.y, camera.z, UNIVERSE_FOG_FAR + UNIVERSE_CHUNK_REFRESH)) {
        if (isUniverseChunkCached(ref.key)) active.push(getUniverseChunk(ref.ci, ref.cj, ref.ck));
        else pending.push(ref);
      }
    };

    const loadPendingChunks = () => {
      const start = performance.now();
      while (pendingIndex < pending.length) {
        const ref = pending[pendingIndex++];
        active.push(getUniverseChunk(ref.ci, ref.cj, ref.ck));
        if (performance.now() - start > UNIVERSE_CHUNK_BUDGET_MS) break;
      }
    };

    const pick = (globalX: number, globalY: number): number => {
      const cam = screenCamera.current;
      const localX = (globalX - cam.x) / cam.scale;
      const localY = (globalY - cam.y) / cam.scale;
      const pickReach = UNIVERSE_PICK_SCREEN_PX / cam.scale;
      let inside = -1;
      let insideDepth = Infinity;
      let nearest = -1;
      let nearestDist = Infinity;
      for (let s = 0; s < slotCount; s++) {
        if (slotAlpha[s] < UNIVERSE_PICK_MIN_ALPHA) continue;
        const dx = slotX[s] - localX;
        const dy = slotY[s] - localY;
        const radius = slotRadius[s];
        const reach = Math.max(pickReach, radius);
        const distSq = dx * dx + dy * dy;
        if (distSq > reach * reach) continue;
        if (distSq <= radius * radius && slotDepth[s] < insideDepth) {
          inside = s;
          insideDepth = slotDepth[s];
        }
        if (distSq < nearestDist) {
          nearest = s;
          nearestDist = distSq;
        }
      }
      return inside >= 0 ? inside : nearest;
    };

    const basis = updateFlyBasis(flyCamera.current, app.screen.width, app.screen.height);
    const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
    const blink = new Float32Array(N_BLINK_GROUPS);
    const visitedPoints: { x: number; y: number }[] = [];
    let elapsedSecs = 0;
    let lastYaw = NaN;
    let lastPitch = NaN;
    let lastWidth = 0;
    let lastHeight = 0;
    let lastSpeed = -1;
    let hoveredSeed = -1;
    let debug: ReturnType<typeof createUniverseAnomalyDebug> | null = null;
    let scanRun: ScanRun | null = null;
    let shellSphere: ScanSphere | null = null;
    let shellColor = SCAN_SHELL_COLOR;

    const drawShell = () => {
      const sphere = shellSphere;
      if (!sphere) {
        scanShell.clear();
        return;
      }
      scanShell.draw(
        (ux, uy, uz, out) => projectUniverseMark(
          sphere.x + ux * sphere.radius,
          sphere.y + uy * sphere.radius,
          sphere.z + uz * sphere.radius,
          basis,
          out,
        ),
        {
          color: shellColor,
          width: SCAN_SHELL_LINE_PX / screenCamera.current.scale,
          backAlpha: SCAN_AIM_BACK_ALPHA,
          frontAlpha: SCAN_AIM_FRONT_ALPHA,
          centreDepth: universeMarkDepth(sphere.x, sphere.y, sphere.z, basis),
        },
      );
    };

    const aimCentre: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };

    const anchorAt = (screenX: number, screenY: number): ScanAnchor | null => {
      const slot = pick(screenX, screenY);
      if (slot < 0) return null;
      const cam = screenCamera.current;
      const chunk = slotChunk[slot];
      const i = slotIndex[slot];
      return {
        x: chunk.x[i],
        y: chunk.y[i],
        z: chunk.z[i],
        name: generateSuperclusterName(chunk.seeds[i]),
        screenX: slotX[slot] * cam.scale + cam.x,
        screenY: slotY[slot] * cam.scale + cam.y,
      };
    };

    const aimAt = (anchor: ScanAnchor, screenX: number, screenY: number): ScanAim | null => {
      if (!projectUniverseMark(anchor.x, anchor.y, anchor.z, basis, aimCentre)) return null;
      const cam = screenCamera.current;
      const centreX = aimCentre.x * cam.scale + cam.x;
      const centreY = aimCentre.y * cam.scale + cam.y;
      const screenRadius = Math.hypot(screenX - centreX, screenY - centreY);
      const radius = screenRadius / cam.scale / aimCentre.scale;
      return {
        sphere: { x: anchor.x, y: anchor.y, z: anchor.z, radius },
        cost: scanCost('universe', radius),
        screenX: centreX,
        screenY: centreY,
        screenRadius,
      };
    };

    const beginScan = ({ sphere }: ScanAim) => {
      const refs = universeChunksNear(sphere.x, sphere.y, sphere.z, sphere.radius);
      scanRun = createUniverseScanRun(
        { sphere, refs, maxTargets: SCAN_UNIVERSE_MAX_TARGETS },
        scanPrecisionRadius('universe', sphere.radius),
      );
      shellSphere = sphere;
      shellColor = SCAN_SHELL_COLOR;
      useScanStore.getState().setProgress({ scope: 'universe', done: 0, total: scanRun.total });
    };

    let scanSelect: ReturnType<typeof createScanSelect> | null = null;
    const syncScanMode = (active: boolean) => {
      if (active && !scanSelect) {
        scanSelect = createScanSelect(app, {
          targetNoun: 'supercluster',
          anchorAt,
          aimAt,
          onAim: (aim) => {
            if (scanRun) return;
            shellSphere = aim?.sphere ?? null;
            shellColor = aim && useScanStore.getState().condensate < aim.cost ? SCAN_SHELL_DENIED_COLOR : SCAN_SHELL_COLOR;
          },
          onSelect: beginScan,
        });
      }
      else if (!active && scanSelect) {
        scanSelect.destroy();
        scanSelect = null;
        if (!scanRun) shellSphere = null;
      }
    };
    syncScanMode(useScanStore.getState().active);
    const unsubScan = useScanStore.subscribe((state, prev) => {
      if (state.active !== prev.active) syncScanMode(state.active);
    });

    const advanceScan = () => {
      if (!scanRun) return;
      const deadline = performance.now() + SCAN_BUDGET_MS;
      let working = true;
      while (working && performance.now() < deadline) working = scanRun.step();
      const store = useScanStore.getState();
      if (working) {
        store.setProgress({ scope: 'universe', done: scanRun.done, total: scanRun.total });
        return;
      }
      recordSweep('universe', null, scanRun);
      scanRun = null;
      shellSphere = null;
      store.setProgress(null);
    };

    const removeDebug = () => {
      if (!debug) return;
      world.removeChild(debug.node);
      debug.node.destroy({ children: true });
      debug = null;
    };

    const drawSky = (width: number, height: number) => {
      skyDim.clear();
      skyBright.clear();
      for (let s = 0; s < sky.length; s += 4) {
        if (!projectSkyDirection(sky[s], sky[s + 1], sky[s + 2], basis, projected)) continue;
        if (sky[s + 3] > 0.7) skyBright.circle(projected.x, projected.y, 1.0);
        else skyDim.circle(projected.x, projected.y, 0.6);
      }
      skyDim.fill({ color: 0xffffff });
      skyBright.fill({ color: 0xffffff });
      skyContainer.position.set(width / 2, height / 2);
    };

    const drawField = () => {
      let visible = 0;
      for (const chunk of active) {
        projectUniverseField(chunk.x, chunk.y, chunk.z, basis, projectedX, projectedY, depth, size, alpha);
        ensureCapacity(visible + chunk.count);
        for (let i = 0; i < chunk.count; i++) {
          if (alpha[i] === 0) continue;
          const tier = tierOf(chunk.brightness[i]);
          const scale = size[i] * TIER_SCALE[tier];
          const shade = alpha[i] * TIERS[tier].alpha * blink[chunk.seeds[i] % N_BLINK_GROUPS];
          const particle = pool[visible];
          particle.x = projectedX[i];
          particle.y = projectedY[i];
          particle.scaleX = scale;
          particle.scaleY = scale;
          particle.color = TIER_BGR[tier] + ((shade * 255 | 0) << 24);
          slotX[visible] = projectedX[i];
          slotY[visible] = projectedY[i];
          slotDepth[visible] = depth[i];
          slotRadius[visible] = scale * SC_DOT_TEXTURE_RADIUS;
          slotAlpha[visible] = alpha[i];
          slotChunk[visible] = chunk;
          slotIndex[visible] = i;
          visible++;
        }
      }
      slotCount = visible;
      if (visible > drawn.length) {
        for (let s = drawn.length; s < visible; s++) drawn.push(pool[s]);
      } else {
        drawn.length = visible;
      }
      if (visible > uploadedCount) {
        uploadedCount = visible;
        particleContainer.update();
      }
    };

    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      const width = app.screen.width;
      const height = app.screen.height;
      const camera = flyCamera.current;
      updateFlyBasis(camera, width, height, basis);

      for (let g = 0; g < N_BLINK_GROUPS; g++) {
        const phase = (g / N_BLINK_GROUPS) * Math.PI * 2;
        const t = 0.5 + 0.5 * Math.sin(elapsedSecs * BLINK_FREQ * Math.PI * 2 + phase);
        blink[g] = BLINK_MIN + (BLINK_MAX - BLINK_MIN) * t;
      }

      const moveX = camera.x - refreshedAt.x;
      const moveY = camera.y - refreshedAt.y;
      const moveZ = camera.z - refreshedAt.z;
      if (!(moveX * moveX + moveY * moveY + moveZ * moveZ <= UNIVERSE_CHUNK_REFRESH * UNIVERSE_CHUNK_REFRESH)) refreshChunks(camera);
      loadPendingChunks();
      drawField();

      if (!useUIStore.getState().showAnomalyDebug) {
        removeDebug();
      } else {
        if (!debug) {
          debug = createUniverseAnomalyDebug();
          world.addChildAt(debug.node, world.getChildIndex(hoverLayer));
        }
        debug.update(active, camera, basis, screenCamera.current.scale);
      }

      if (speed.current !== lastSpeed || width !== lastWidth || height !== lastHeight) {
        lastSpeed = speed.current;
        speedText.text = `Cruise ${formatSpeed(lastSpeed)} Megaparsecs / s`;
        speedText.position.set(width / 2, height - READOUT_BOTTOM_PX);
      }

      if (camera.yaw !== lastYaw || camera.pitch !== lastPitch || width !== lastWidth || height !== lastHeight) {
        lastYaw = camera.yaw;
        lastPitch = camera.pitch;
        lastWidth = width;
        lastHeight = height;
        drawSky(width, height);
      }
      skyDim.alpha = 0.2 + Math.abs(Math.sin(elapsedSecs * 1.5)) * 0.4;
      skyBright.alpha = 0.45 + Math.abs(Math.sin(elapsedSecs * 2.0 + 1.0)) * 0.45;
      advanceScan();
      drawShell();
      scanOverlay.update(basis, screenCamera.current.scale, elapsedSecs);
      minimap.update(camera, width, elapsedSecs);
      useFlightStore.getState().setPosition(camera.x, camera.y, camera.z);

      const current = currentRef.current;
      let visitedCount = 0;
      for (const place of visitedRef.current) {
        if (place.seed === current?.seed) continue;
        if (projectUniversePoint(place.x, place.y, place.z, basis, projected) < UNIVERSE_PICK_MIN_ALPHA) continue;
        const point = visitedPoints[visitedCount] ?? (visitedPoints[visitedCount] = { x: 0, y: 0 });
        point.x = projected.x;
        point.y = projected.y;
        visitedCount++;
      }
      visitedGfx.clear();
      drawVisitedRings(visitedGfx, visitedPoints, visitedCount);
      currentGfx.clear();
      if (current && projectUniversePoint(current.x, current.y, current.z, basis, projected) > 0) {
        drawCrosshair(currentGfx, projected.x, projected.y, elapsedSecs);
      }

      const slot = isAnimatingRef.current || !pointer.current.inside || useScanStore.getState().active
        ? -1
        : pick(pointer.current.x, pointer.current.y);
      const nextSeed = slot >= 0 ? slotChunk[slot].seeds[slotIndex[slot]] : -1;
      if (nextSeed !== hoveredSeed) {
        hoveredSeed = nextSeed;
        for (const child of hoverLayer.removeChildren()) child.destroy({ children: true });
        if (slot >= 0) hoverLayer.addChild(createPointerLabel(generateSuperclusterName(nextSeed), 22, { lineLength: 70, dotRadius: 4 }));
        app.canvas.style.cursor = slot >= 0 ? 'pointer' : '';
      }
      if (slot >= 0) hoverLayer.position.set(slotX[slot], slotY[slot]);
    };
    Ticker.shared.add(tick);

    const onTap = (event: FederatedPointerEvent) => {
      if (isAnimatingRef.current || didLook.current || event.button > 0) return;
      if (useScanStore.getState().active) return;
      const slot = pick(event.global.x, event.global.y);
      if (slot < 0) return;
      const seed = slotChunk[slot].seeds[slotIndex[slot]];
      const game = useGameStore.getState();
      const ui = useUIStore.getState();
      ui.setUniversePose({ ...flyCamera.current });
      if (seed !== game.supercluster.seed) game.regenerateSupercluster(seed);
      ui.clearAddress();

      isAnimatingRef.current = true;
      cancelZoomRef.current = animateZoomTo(
        screenCamera, world,
        slotX[slot], slotY[slot],
        event.global.x, event.global.y,
        24, 500,
        () => useUIStore.getState().setViewTransitioning(true),
        () => {
          isAnimatingRef.current = false;
          cancelZoomRef.current = null;
          useUIStore.getState().setView('supercluster');
        },
      );
    };
    stage.on('pointertap', onTap);

    return () => {
      Ticker.shared.remove(tick);
      stage.off('pointertap', onTap);
      if (cancelZoomRef.current) {
        cancelZoomRef.current();
        cancelZoomRef.current = null;
        isAnimatingRef.current = false;
        useUIStore.getState().setViewTransitioning(false);
      }
      app.canvas.style.cursor = '';
      removeDebug();
      unsubScan();
      scanSelect?.destroy();
      useScanStore.getState().setProgress(null);
      world.removeChild(scanOverlay.node);
      world.removeChild(scanOverlay.backNode);
      scanOverlay.destroy();
      world.removeChild(scanShell.back);
      world.removeChild(scanShell.front);
      scanShell.destroy();
      world.removeChild(dotsContainer);
      world.removeChild(visitedGfx);
      world.removeChild(currentGfx);
      world.removeChild(hoverLayer);
      dotsContainer.destroy({ children: true });
      visitedGfx.destroy();
      currentGfx.destroy();
      hoverLayer.destroy({ children: true });
      stage.removeChild(skyContainer);
      skyContainer.destroy({ children: true });
      stage.removeChild(speedText);
      speedText.destroy();
      stage.removeChild(minimap.container);
      minimap.container.destroy({ children: true });
      useFlightStore.getState().clearPosition();
      texture.destroy(true);
    };
  }, [app, isInitialised, flyCamera, speed, pointer, didLook, isAnimatingRef, cancelZoomRef]);

  return <pixiContainer ref={worldRef} visible={isReady} />;
}
