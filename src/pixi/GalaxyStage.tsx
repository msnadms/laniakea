import { Application, extend, useApplication } from '@pixi/react';
import { Container, Graphics, Ticker, Sprite, BlurFilter } from 'pixi.js';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
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
import { HyperlaneLayer } from './HyperlaneLayer';
import { StarNode } from './StarNode';
import { useCamera } from './useCamera';
import { ScaleBar } from './ScaleBar';
import { buildAddressComponent } from '../game/types';
import { BackgroundStars } from './BackgroundStars';

extend({ Container, Graphics, Sprite });

export function GalaxyStage() {
  return (
    <Application resizeTo={window} background={0x050810}>
      <GalaxyWorld />
    </Application>
  );
}

function GalaxyWorld() {
  const { app, isInitialised } = useApplication();

  const galaxy = useGameStore((s) => s.galaxy);
  const activeSystem = useGameStore((s) => s.system);
  const setSystem = useGameStore((s) => s.setSystem);
  const pushAddress = useUIStore((s) => s.pushAddress);
  const popAddress = useUIStore((s) => s.popAddress);
  const showHyperlanes = useUIStore((s) => s.showHyperlanes);
  const setView = useUIStore((s) => s.setView);
  const config = galaxy.config;

  const handleSelectSystem = useCallback((id: number | null) => {
    if (activeSystem !== null) popAddress();
    if (id !== null) {
      const sys = galaxy.systems[id];
      pushAddress(buildAddressComponent(sys.name, sys.x, sys.y, 0, 'system'));
      setSystem(sys);
      setView('system');
    } else {
      setSystem(null);
    }
  }, [activeSystem, galaxy, pushAddress, popAddress, setSystem, setView]);

  const worldRef = useRef<Container>(null);
  const { camera, isReady } = useCamera(worldRef, CAMERA_INITIAL_SCALE, () => handleSelectSystem(null));

  const radiusLy = useMemo(() => {
    const rng = createRng(galaxy.seed);
    const sizeScale = Math.floor(rng() * 7) - 3;
    return Math.round(GALAXY_RADIUS_LY * Math.pow(2, sizeScale));
  }, [galaxy.seed]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;

    const nebulaContainer = new Container();
    const nebulaGfx = new Graphics();
    const rng = createRng((galaxy.seed ^ 0x9e3779b9) >>> 0);

    type Particle = { x: number; y: number; r: number; a: number };
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

    for (const [color, particles] of nebulaBatches) {
      const avgAlpha = particles.reduce((sum, p) => sum + p.a, 0) / particles.length;
      for (const p of particles) nebulaGfx.circle(p.x, p.y, p.r);
      nebulaGfx.fill({ color, alpha: avgAlpha });
    }

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
    for (const [color, particles] of coreBatches) {
      const avgAlpha = particles.reduce((sum, p) => sum + p.a, 0) / particles.length;
      for (const p of particles) coreGfx.circle(p.x, p.y, p.r);
      coreGfx.fill({ color, alpha: avgAlpha });
    }

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
  }, [galaxy, app, isInitialised]);

  return (
    <>
      <BackgroundStars stars={galaxy.backgroundStars} />
      <pixiContainer ref={worldRef} visible={isReady}>
        {showHyperlanes && <HyperlaneLayer galaxy={galaxy} />}
        {galaxy.systems.map((system) => (
          <StarNode key={system.id} system={system} onSelect={handleSelectSystem} />
        ))}
      </pixiContainer>
      <ScaleBar
        camera={camera}
        unitsPerWorldPx={radiusLy / GALAXY_RADIUS}
        unit="Light Years"
        niceValues={[100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000]}
      />
    </>
  );
}
