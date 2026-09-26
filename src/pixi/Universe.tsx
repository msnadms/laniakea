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
  isUniverseChunkCached,
  locateSupercluster,
  universeChunksNear,
  type ChunkRef,
  type SuperclusterLocation,
} from '../game/universe';
import { generateSuperclusterName } from '../game/superclusters';
import {
  SC_DOT_TEXTURE_RADIUS,
  UNIVERSE_CLUSTER_MAX_STARS,
  UNIVERSE_CLUSTER_PICK_FRACTION,
  UNIVERSE_CLUSTER_REVEAL_FULL_STARS,
  UNIVERSE_CLUSTER_REVEAL_MIN_STARS,
  UNIVERSE_CLUSTER_STARS_PER_PX,
  UNIVERSE_DOT_MIN_PX,
  UNIVERSE_DOT_SIZE,
  UNIVERSE_NEAR,
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
  SCAN_UNIVERSE_MAX_RADIUS,
  SCAN_UNIVERSE_MAX_TARGETS,
  UNIVERSE_SEED,
  WEB_GLOW_CROSSFADE_SECS,
  WEB_GLOW_REBAKE,
} from '../game/constants';
import type { FlyCamera, UniverseChunk } from '../game/types';
import { createUniverseStarTexture } from './textures';
import { createPointerLabel } from './labels';
import { animateZoomTo } from './zoomAnim';
import { useZoomController } from './useZoomController';
import { useFlyCamera } from './useFlyCamera';
import {
  createUniverseCamera,
  faceTarget,
  projectClusterStars,
  projectUniverseClusters,
  projectUniverseMark,
  projectUniversePoint,
  universeDotPx,
  universeMarkDepth,
  universeNearFade,
  updateFlyBasis,
} from './flyProjection';
import { CLUSTER_TINT, clusterRadius, clusterStarCount, clusterTemplate } from './clusterStars';
import type { ProjectedPoint } from './projection';
import { drawCrosshair, drawVisitedRings } from './dotOverlays';
import { createUniverseMinimap } from './universeMinimap';
import { createCmbShell } from './cmbShell';
import { createWebGlow } from './webGlow';
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

function clusterReveal(shown: number): number {
  const t = Math.min(1, Math.max(0, (shown - UNIVERSE_CLUSTER_REVEAL_MIN_STARS) / (UNIVERSE_CLUSTER_REVEAL_FULL_STARS - UNIVERSE_CLUSTER_REVEAL_MIN_STARS)));
  return t * t * (3 - 2 * t);
}

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

    const texture = createUniverseStarTexture();
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

    const webGlow = createWebGlow(app.renderer);
    const cmb = createCmbShell(app.renderer, UNIVERSE_SEED, [webGlow.panoramas[0].source, webGlow.panoramas[1].source]);
    stage.addChildAt(cmb.node, 0);

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
    const radiusPx = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
    const fog = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
    const starX = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);
    const starY = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);
    const starSize = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);
    const starAlpha = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);

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

    const ensureSlots = (needed: number) => {
      if (needed <= capacity) return;
      capacity = Math.max(needed, capacity + SLOT_GROWTH);
      slotX = grow(slotX, capacity);
      slotY = grow(slotY, capacity);
      slotDepth = grow(slotDepth, capacity);
      slotRadius = grow(slotRadius, capacity);
      slotAlpha = grow(slotAlpha, capacity);
      slotIndex = grow(slotIndex, capacity);
    };

    const ensureParticles = (needed: number) => {
      if (needed <= pool.length) return;
      const target = Math.max(needed, pool.length + SLOT_GROWTH);
      while (pool.length < target) pool.push(new Particle({ texture, anchorX: 0.5, anchorY: 0.5 }));
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
      let best = -1;
      let bestScore = Infinity;
      let bestDepth = Infinity;
      for (let s = 0; s < slotCount; s++) {
        if (slotAlpha[s] < UNIVERSE_PICK_MIN_ALPHA) continue;
        const dx = slotX[s] - localX;
        const dy = slotY[s] - localY;
        const reach = Math.max(pickReach, slotRadius[s]);
        const distSq = dx * dx + dy * dy;
        if (distSq > reach * reach) continue;
        const score = distSq / (reach * reach);
        if (score < bestScore || (score === bestScore && slotDepth[s] < bestDepth)) {
          best = s;
          bestScore = score;
          bestDepth = slotDepth[s];
        }
      }
      return best;
    };

    const basis = updateFlyBasis(flyCamera.current, app.screen.width, app.screen.height);
    const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
    const blink = new Float32Array(N_BLINK_GROUPS);
    const visitedPoints: { x: number; y: number }[] = [];
    let elapsedSecs = 0;
    const drawnFrom = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, glowMix: NaN };
    const bakedAt = { x: NaN, y: NaN, z: NaN };
    const glowFade = { from: 0, to: 0, start: -Infinity };
    let glowMix = 0;
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
      const radius = Math.min(SCAN_UNIVERSE_MAX_RADIUS, screenRadius / cam.scale / aimCentre.scale);
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

    const drawField = () => {
      let visible = 0;
      let slots = 0;
      const place = (x: number, y: number, scale: number, tier: number, shade: number) => {
        const particle = pool[visible++];
        particle.x = x;
        particle.y = y;
        particle.scaleX = scale;
        particle.scaleY = scale;
        particle.color = TIER_BGR[tier] + ((Math.min(1, shade) * 255 | 0) << 24);
      };
      for (const chunk of active) {
        projectUniverseClusters(chunk.x, chunk.y, chunk.z, chunk.brightness, basis, projectedX, projectedY, depth, radiusPx, fog);
        for (let i = 0; i < chunk.count; i++) {
          if (fog[i] === 0) continue;
          ensureSlots(slots + 1);
          ensureParticles(visible + UNIVERSE_CLUSTER_MAX_STARS + 1);
          const seed = chunk.seeds[i];
          const brightness = chunk.brightness[i];
          const tier = tierOf(brightness);
          const shown = Math.min(clusterStarCount(brightness), radiusPx[i] * UNIVERSE_CLUSTER_STARS_PER_PX * fog[i]);
          const reveal = clusterReveal(shown);
          if (depth[i] >= UNIVERSE_NEAR) {
            const rawPx = UNIVERSE_DOT_SIZE * basis.focal / depth[i];
            const presence = fog[i] * universeNearFade(depth[i]) * Math.min(1, rawPx / UNIVERSE_DOT_MIN_PX);
            const scale = universeDotPx(rawPx) * TIER_SCALE[tier];
            if (reveal < 1) {
              place(projectedX[i], projectedY[i], scale, tier, presence * TIERS[tier].alpha * blink[seed % N_BLINK_GROUPS] * (1 - reveal));
            }
            slotX[slots] = projectedX[i];
            slotY[slots] = projectedY[i];
            slotDepth[slots] = depth[i];
            slotRadius[slots] = Math.max(scale * SC_DOT_TEXTURE_RADIUS, radiusPx[i] * UNIVERSE_CLUSTER_PICK_FRACTION);
            slotAlpha[slots] = presence;
            slotChunk[slots] = chunk;
            slotIndex[slots] = i;
            slots++;
          }
          if (reveal <= 0) continue;
          const template = clusterTemplate(seed);
          const count = projectClusterStars(
            chunk.x[i], chunk.y[i], chunk.z[i], clusterRadius(brightness), template, shown, basis,
            starX, starY, starSize, starAlpha,
          );
          const tintBase = template * UNIVERSE_CLUSTER_MAX_STARS;
          for (let k = 0; k < count; k++) {
            if (starAlpha[k] <= 0) continue;
            const starTier = Math.min(TIERS.length - 1, Math.max(0, tier + CLUSTER_TINT[tintBase + k]));
            const shade = starAlpha[k] * fog[i] * reveal * TIERS[starTier].alpha * blink[(seed + k) % N_BLINK_GROUPS];
            place(starX[k], starY[k], starSize[k] / SC_DOT_TEXTURE_RADIUS, starTier, shade);
          }
        }
      }
      slotCount = slots;
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

      const bakeX = camera.x - bakedAt.x;
      const bakeY = camera.y - bakedAt.y;
      const bakeZ = camera.z - bakedAt.z;
      if (glowMix === glowFade.to && !(bakeX * bakeX + bakeY * bakeY + bakeZ * bakeZ <= WEB_GLOW_REBAKE * WEB_GLOW_REBAKE)) {
        const first = Number.isNaN(bakedAt.x);
        bakedAt.x = camera.x;
        bakedAt.y = camera.y;
        bakedAt.z = camera.z;
        glowFade.from = glowMix;
        glowFade.to = webGlow.bake(camera.x, camera.y, camera.z);
        glowFade.start = first ? -Infinity : elapsedSecs;
      }
      const fadeT = Math.min(1, (elapsedSecs - glowFade.start) / WEB_GLOW_CROSSFADE_SECS);
      glowMix = fadeT >= 1 ? glowFade.to : glowFade.from + (glowFade.to - glowFade.from) * fadeT;

      if (
        glowMix !== drawnFrom.glowMix
        || camera.x !== drawnFrom.x || camera.y !== drawnFrom.y || camera.z !== drawnFrom.z
        || camera.yaw !== drawnFrom.yaw || camera.pitch !== drawnFrom.pitch
        || width !== lastWidth || height !== lastHeight
      ) {
        drawnFrom.x = camera.x;
        drawnFrom.y = camera.y;
        drawnFrom.z = camera.z;
        drawnFrom.yaw = camera.yaw;
        drawnFrom.pitch = camera.pitch;
        drawnFrom.glowMix = glowMix;
        lastWidth = width;
        lastHeight = height;
        cmb.render(width, height, basis, glowMix);
      }
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
      stage.removeChild(cmb.node);
      cmb.destroy();
      webGlow.destroy();
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
