import { useApplication } from '@pixi/react';
import { Container, Graphics, Ticker, BlurFilter } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { superclusterTravelCost, trySpendTravelCost } from '../store/travelCosts';
import { useAuthStore } from '../store/authStore';
import { useCodexStore } from '../store/codexStore';
import { buildAddressComponent, type SuperclusterDot } from '../game/types';
import { useCamera } from './useCamera';
import { SC_CAMERA_INITIAL_SCALE, SC_WORLD_HALF, SC_WORLD_HALF_MLY, OBS_UNIVERSE_RADIUS } from '../game/constants';
import { MSG_DRIVE_REQUIRED_GALAXY } from '../ui/strings';
import { animateZoomTo } from './zoomAnim';
import { useZoomController } from './useZoomController';
import { ScaleBar } from './ScaleBar';
import { createRng } from '../game/galaxyGen';
import { createPointerLabel } from './labels';
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
  const { camera, isReady } = useCamera(worldRef, SC_CAMERA_INITIAL_SCALE);
  const showAttractorLabelsRef = useRef(showAttractorLabels);
  showAttractorLabelsRef.current = showAttractorLabels;

  const { isAnimatingRef, cancelZoomRef } = useZoomController(camera, worldRef, isReady, {
    getCurrentPos: () => useGameStore.getState().supercluster.dots.find(d => d.current),
  });

  const visitedGfxRef = useRef<Graphics | null>(null);
  const currentGfxRef = useRef<Graphics | null>(null);
  const currentDotPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;
    const rng = createRng(scSeed);
    const obsUniverseCoords = () => rng() * OBS_UNIVERSE_RADIUS * 2 - OBS_UNIVERSE_RADIUS;
    const [x, y, z] = [obsUniverseCoords(), obsUniverseCoords(), obsUniverseCoords()];
    pushAddress(buildAddressComponent(scName, x, y, z, 'supercluster'));

    const tiers = getBrightnessTiers(scSeed);
    const buckets: SuperclusterDot[][] = tiers.map(() => []);
    // Read dots directly from store — brightness/position never change, only visited flag does.
    // The visited overlay is handled by its own separate effect below.
    const initialDots = useGameStore.getState().supercluster.dots;
    for (const dot of initialDots) {
      buckets[tiers.findIndex(t => dot.brightness > t.min)].push(dot);
    }

    const scContainer = new Container();

    const dotsContainer = new Container();
    dotsContainer.blendMode = 'screen';
    const blurFilter = new BlurFilter({ strength: 0.05 });
    dotsContainer.filters = [blurFilter];

    const blinkGroups: Graphics[] = [];
    for (let g = 0; g < N_BLINK_GROUPS; g++) {
      const gfx = new Graphics();
      blinkGroups.push(gfx);
      dotsContainer.addChild(gfx);
    }

    for (let i = 0; i < tiers.length; i++) {
      for (const d of buckets[i]) {
        blinkGroups[d.seed % N_BLINK_GROUPS].circle(d.x, d.y, tiers[i].radius);
      }
      for (let g = 0; g < N_BLINK_GROUPS; g++) {
        blinkGroups[g].fill({ color: tiers[i].color, alpha: tiers[i].alpha });
      }
    }

    const visitedGfx = new Graphics();
    visitedGfxRef.current = visitedGfx;
    const currentGfx = new Graphics();
    currentGfxRef.current = currentGfx;
    scContainer.addChild(dotsContainer);
    scContainer.addChild(visitedGfx);
    scContainer.addChild(currentGfx);
    world.addChild(scContainer);

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      for (let g = 0; g < N_BLINK_GROUPS; g++) {
        const phase = (g / N_BLINK_GROUPS) * Math.PI * 2;
        const t = 0.5 + 0.5 * Math.sin(elapsedSecs * BLINK_FREQ * Math.PI * 2 + phase);
        blinkGroups[g].alpha = BLINK_MIN + (BLINK_MAX - BLINK_MIN) * t;
      }
      const pos = currentDotPosRef.current;
      const gfx = currentGfxRef.current;
      if (pos && gfx) {
        const pulse = 0.5 + 0.5 * Math.sin(elapsedSecs * Math.PI * 2 * 0.7);
        const outerR = 26 + pulse * 10;
        gfx.clear();
        gfx.circle(pos.x, pos.y, outerR);
        gfx.stroke({ color: 0x00e8ff, width: 1.2, alpha: 0.2 + pulse * 0.45 });
        gfx.circle(pos.x, pos.y, outerR + 6);
        gfx.stroke({ color: 0x00e8ff, width: 0.6, alpha: 0.08 + pulse * 0.18 });
      }
    };
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      visitedGfxRef.current = null;
      currentGfxRef.current = null;
      currentDotPosRef.current = null;
      world.removeChild(scContainer);
      scContainer.destroy({ children: true });
      blurFilter.destroy();
    };
  }, [scSeed, scName, pushAddress, app, isInitialised]);

  // Redraws only the visited-dot overlay when scDots changes, without rebuilding the scene.
  useEffect(() => {
    const gfx = visitedGfxRef.current;
    if (!gfx) return;
    gfx.clear();

    // Visited dots (white outline rings)
    for (const d of scDots) {
      if (!d.visited || d.current) continue;
      gfx.circle(d.x, d.y, 8);
    }
    gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
    for (const d of scDots) {
      if (!d.visited || d.current) continue;
      gfx.circle(d.x, d.y, 11);
    }
    gfx.stroke({ color: 0xffffff, width: 0.5, alpha: 0.25 });

    // Current galaxy — static parts: solid fill + inner rings + crosshair
    const cur = scDots.find(d => d.current);
    currentDotPosRef.current = cur ? { x: cur.x, y: cur.y } : null;
    if (cur) {
      const { x, y } = cur;
      // Bright filled core
      gfx.circle(x, y, 5);
      gfx.fill({ color: 0x00e8ff, alpha: 0.55 });
      // Inner solid ring
      gfx.circle(x, y, 12);
      gfx.stroke({ color: 0x00e8ff, width: 2, alpha: 0.95 });
      // Second solid ring
      gfx.circle(x, y, 18);
      gfx.stroke({ color: 0x00e8ff, width: 1, alpha: 0.55 });
      // Crosshair arms (gap from r=20 to r=38)
      const gap = 20, arm = 38;
      gfx.moveTo(x - arm, y).lineTo(x - gap, y);
      gfx.moveTo(x + gap, y).lineTo(x + arm, y);
      gfx.moveTo(x, y - arm).lineTo(x, y - gap);
      gfx.moveTo(x, y + gap).lineTo(x, y + arm);
      gfx.stroke({ color: 0x00e8ff, width: 1.5, alpha: 0.85 });
      // Crosshair tick marks at arm ends (small perpendicular nubs)
      const nub = 4;
      gfx.moveTo(x - arm, y - nub).lineTo(x - arm, y + nub);
      gfx.moveTo(x + arm, y - nub).lineTo(x + arm, y + nub);
      gfx.moveTo(x - nub, y - arm).lineTo(x + nub, y - arm);
      gfx.moveTo(x - nub, y + arm).lineTo(x + nub, y + arm);
      gfx.stroke({ color: 0x00e8ff, width: 1.5, alpha: 0.65 });
    }
  }, [scDots, isInitialised]);

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
    for (const att of scAttractors) {
      const group = createPointerLabel(att.name, 40, { lineLength: 120 });
      group.position.set(att.x, att.y);
      labelContainer.addChild(group);
    }
    world.addChild(labelContainer);

    const tick = () => { labelContainer.visible = showAttractorLabelsRef.current && camera.current.scale > 0.25; };
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      world.removeChild(titleGroup);
      world.removeChild(labelContainer);
      titleGroup.destroy({ children: true });
      labelContainer.destroy({ children: true });
    };
  }, [scSeed, scName, scAttractors, isInitialised]);


  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;
    const stage = app.stage;

    const onTap = (e: { global: { x: number; y: number } }) => {
      if (isAnimatingRef.current) return;
      if (camera.current.scale < 0.5) return;
      const local = world.toLocal(e.global);
      const sc = useGameStore.getState().supercluster;
      let nearest = sc.dots[0];
      let nearestDist = Infinity;
      for (const dot of sc.dots) {
        const d = Math.hypot(dot.x - local.x, dot.y - local.y);
        if (d < nearestDist) { nearestDist = d; nearest = dot; }
      }
      const maxDist = 15 / camera.current.scale;
      if (nearestDist > maxDist) return;
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
        nearest.x, nearest.y,
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
  }, [app, isInitialised, regenerateGalaxy, markDotVisited, setView, pushAddress, removeAddressType]);

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
