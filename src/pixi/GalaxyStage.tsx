import { extend, useApplication } from '@pixi/react';
import { Container, Graphics, Ticker, Sprite, BlurFilter } from 'pixi.js';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { galaxyTravelCost, trySpendTravelCost } from '../store/travelCosts';
import {
  GALAXY_RADIUS,
  GALAXY_RADIUS_LY,
  NEBULA_STEPS,
  NEBULA_SKIP_CHANCE,
  NEBULA_PARTICLES_PER_STEP,
  NEBULA_SPREAD,
  CORE_PARTICLE_COUNT,
  CORE_ELLIPSE_X,
  CORE_ELLIPSE_Y,
  CAMERA_INITIAL_SCALE,
  NEBULA_RADIUS_MULTIPLIER,
  NEBULA_CLOUD_OFFSET,
  NEBULA_DISPLACEMENT_SCALE,
  CORE_COLORS,
} from '../game/constants';
import { createDisplacementSetup } from './textures';
import { createRng } from '../game/galaxyGen';
import { StarNode } from './StarNode';
import { useCamera } from './useCamera';
import { ScaleBar } from './ScaleBar';
import { buildAddressComponent } from '../game/types';
import { BackgroundStars } from './BackgroundStars';
import { useCodexStore } from '../store/codexStore';
import { useAuthStore } from '../store/authStore';
import { saveSystemDiscovery } from '../firebase/discoveries';
import { generateGalaxyName } from '../game/superclusters';

const GALAXY_NICE_VALUES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

type Particle = { x: number; y: number; r: number; a: number };

function flushParticleBatches(gfx: Graphics, batches: Map<number, Particle[]>) {
  for (const [color, particles] of batches) {
    const avgAlpha = particles.reduce((sum, p) => sum + p.a, 0) / particles.length;
    for (const p of particles) gfx.circle(p.x, p.y, p.r);
    gfx.fill({ color, alpha: avgAlpha });
  }
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

  const handleSelectSystem = useCallback((id: number | null) => {
    if (id !== null) {
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
      if (user) saveSystemDiscovery(user.uid, gameState.supercluster.seed, gameState.galaxy.seed, sys);
      pushAddress(buildAddressComponent(sys.name, sys.x, sys.y, 0, 'system'));
      setSystem(sys);
      setView('system');
    } else {
      const activeSystem = useGameStore.getState().system;
      if (activeSystem !== null) popAddress();
      setSystem(null);
    }
  }, [pushAddress, popAddress, setSystem, setView]);

  const handleStageTap = useCallback(() => handleSelectSystem(null), [handleSelectSystem]);

  const worldRef = useRef<Container>(null);
  const { camera, isReady } = useCamera(worldRef, CAMERA_INITIAL_SCALE, handleStageTap);

  const radiusLy = useMemo(() => {
    const rng = createRng(galaxySeed);
    const sizeScale = Math.floor(rng() * 7) - 3;
    return Math.round(GALAXY_RADIUS_LY * Math.pow(2, sizeScale));
  }, [galaxySeed]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;

    const nebulaContainer = new Container();
    const nebulaGfx = new Graphics();
    const rng = createRng((galaxySeed ^ 0x9e3779b9) >>> 0);

    const nebulaBatches = new Map<number, Particle[]>();

    for (let arm = 0; arm < config.numArms; arm++) {
      const baseAngle = (arm / config.numArms) * Math.PI * 2 + config.baseAngleOffset;

      for (let step = 0; step < NEBULA_STEPS; step++) {
        if (rng() < NEBULA_SKIP_CHANCE) continue;

        const stepFraction = (step + 1) / (NEBULA_STEPS + 1);
        const radius = GALAXY_RADIUS * stepFraction;
        const angle = baseAngle + stepFraction * Math.PI * config.spiralTwist;
        const cloudX = Math.cos(angle) * radius;
        const cloudY = Math.sin(angle) * radius * config.galaxyEllipse;

        const taperT = Math.max(0, (stepFraction - 0.90) / 0.10);
        const taper = Math.pow(1 - taperT, 1.5);

        let blobScale = NEBULA_RADIUS_MULTIPLIER;
        let cloudsPerStep = Math.max(1, Math.round(NEBULA_PARTICLES_PER_STEP * taper));
        if (Math.abs(cloudX) < NEBULA_CLOUD_OFFSET && Math.abs(cloudY) < NEBULA_CLOUD_OFFSET * config.galaxyEllipse) {
          blobScale = 1.5;
          cloudsPerStep = 20;
        }

        const spread = GALAXY_RADIUS * NEBULA_SPREAD * (0.35 + stepFraction) * (0.5 + 0.5 * taper);

        for (let p = 0; p < cloudsPerStep; p++) {
          const offsetX = ((rng() + rng()) / 2 - 0.5) * 2 * spread;
          const offsetY = ((rng() + rng()) / 2 - 0.5) * 2 * spread * config.galaxyEllipse;
          const particleRadius = spread * (0.15 + rng() * 0.45) * blobScale;
          const useNebula = rng() < stepFraction + 0.4;
          const colorList = useNebula
            ? (rng() > Math.pow(stepFraction, 2) + 0.15 ? config.innerNebulaColors : config.nebulaColors)
            : CORE_COLORS;
          const nebulaColor = colorList[Math.floor(rng() * colorList.length)];
          const alpha = (0.014 + rng() * 0.024) * Math.max(1 - stepFraction, 0.5) * taper;

          let batch = nebulaBatches.get(nebulaColor);
          if (!batch) { 
            batch = []; 
            nebulaBatches.set(nebulaColor, batch); 
          }
          batch.push({ x: cloudX + offsetX, y: cloudY + offsetY, r: particleRadius, a: alpha });
        }
      }
    }

    flushParticleBatches(nebulaGfx, nebulaBatches);

    const coreGfx = new Graphics();
    const coreBatches = new Map<number, Particle[]>();
    for (let p = 0; p < CORE_PARTICLE_COUNT; p++) {
      const offsetX = ((rng() + rng()) / 2 - 0.5) * 2 * CORE_ELLIPSE_X;
      const offsetY = ((rng() + rng()) / 2 - 0.5) * 2 * CORE_ELLIPSE_Y;
      const particleRadius = 20 + rng() * 60;
      const coreColor = CORE_COLORS[Math.floor(rng() * CORE_COLORS.length)];
      const alpha = 0.012 + rng() * 0.018;
      let batch = coreBatches.get(coreColor);
      if (!batch) { batch = []; coreBatches.set(coreColor, batch); }
      batch.push({ x: offsetX, y: offsetY, r: particleRadius, a: alpha });
    }
    flushParticleBatches(coreGfx, coreBatches);

    nebulaGfx.blendMode = 'screen';
    coreGfx.blendMode = 'screen';
    const nebulaBlur = new BlurFilter({ strength: 0.75 });
    const coreBlur = new BlurFilter({ strength: 0.75, blendMode: 'add' });
    nebulaGfx.filters = [nebulaBlur];
    coreGfx.filters = [coreBlur];

    const disp = createDisplacementSetup(nebulaContainer, NEBULA_DISPLACEMENT_SCALE);

    nebulaContainer.addChild(coreGfx);
    nebulaContainer.addChild(nebulaGfx);

    world.addChildAt(nebulaContainer, 0);

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      disp.update(elapsedSecs, NEBULA_DISPLACEMENT_SCALE * camera.current.scale);
    };

    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      world.removeChild(nebulaContainer);
      nebulaBlur.destroy();
      coreBlur.destroy();
      nebulaContainer.destroy({ children: true });
      disp.destroy();
    };
  }, [galaxySeed, config, app, isInitialised]);

  return (
    <>
      <BackgroundStars stars={galaxyBackgroundStars} />
      <pixiContainer ref={worldRef} visible={isReady}>
        {galaxySystems.map((system) => (
          <StarNode key={system.id} system={system} onSelect={handleSelectSystem} />
        ))}
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
