import { Application, extend, useApplication } from '@pixi/react';
import { Container, Graphics, FederatedPointerEvent, Ticker, Sprite, BlurFilter, DisplacementFilter } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import {
  GALAXY_RADIUS,
  NEBULA_STEPS,
  NEBULA_SKIP_CHANCE,
  NEBULA_PARTICLES_PER_STEP,
  NEBULA_SPREAD,
  CORE_PARTICLE_COUNT,
  CORE_ELLIPSE_X,
  CORE_ELLIPSE_Y,
  CAMERA_INITIAL_SCALE,
  CAMERA_MIN_SCALE,
  CAMERA_MAX_SCALE,
  CAMERA_ZOOM_FACTOR,
  DRAG_THRESHOLD_PX,
  NEBULA_RADIUS_MULTIPLIER,
  NEBULA_CLOUD_OFFSET,
  NEBULA_DISPLACEMENT_SCALE,
  CORE_COLORS,
} from '../game/constants';
import { createDisplacementTexture } from './textures';
import { HyperlaneLayer } from './HyperlaneLayer';
import { StarNode } from './StarNode';

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
  const selectSystem = useUIStore((s) => s.selectSystem);
  const showHyperlanes = useUIStore((s) => s.showHyperlanes);
  const config = galaxy.config;

  const worldRef = useRef<Container>(null);
  const camera = useRef({ x: 0, y: 0, scale: CAMERA_INITIAL_SCALE });
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const cameraStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    camera.current.x = app.screen.width / 2;
    camera.current.y = app.screen.height / 2;
    worldRef.current.position.set(camera.current.x, camera.current.y);
    worldRef.current.scale.set(camera.current.scale);
  }, [app, isInitialised]);

  useEffect(() => {
    if (!isInitialised) return;
    const stage = app.stage;

    stage.eventMode = 'static';
    stage.hitArea = app.screen;

    const onDown = (event: FederatedPointerEvent) => {
      isDragging.current = true;
      hasDragged.current = false;
      dragStart.current = { x: event.globalX, y: event.globalY };
      cameraStart.current = { x: camera.current.x, y: camera.current.y };
    };

    const onMove = (event: FederatedPointerEvent) => {
      if (!isDragging.current || !worldRef.current) return;
      const deltaX = event.globalX - dragStart.current.x;
      const deltaY = event.globalY - dragStart.current.y;
      if (!hasDragged.current && (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX))
        hasDragged.current = true;
      camera.current.x = cameraStart.current.x + deltaX;
      camera.current.y = cameraStart.current.y + deltaY;
      worldRef.current.position.set(camera.current.x, camera.current.y);
    };

    const onUp = (event: FederatedPointerEvent) => {
      if (!hasDragged.current && event.target === stage) selectSystem(null);
      isDragging.current = false;
    };

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    const onUpOutside = () => { isDragging.current = false; };
    stage.on('pointerupoutside', onUpOutside);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!worldRef.current) return;
      const zoomFactor = event.deltaY < 0 ? CAMERA_ZOOM_FACTOR : 1 / CAMERA_ZOOM_FACTOR;
      const mouseX = event.clientX;
      const mouseY = event.clientY;
      // World-space point under cursor — re-anchored after scaling to keep it fixed.
      const worldX = (mouseX - camera.current.x) / camera.current.scale;
      const worldY = (mouseY - camera.current.y) / camera.current.scale;
      camera.current.scale = Math.max(CAMERA_MIN_SCALE, Math.min(CAMERA_MAX_SCALE, camera.current.scale * zoomFactor));
      camera.current.x = mouseX - worldX * camera.current.scale;
      camera.current.y = mouseY - worldY * camera.current.scale;
      worldRef.current.position.set(camera.current.x, camera.current.y);
      worldRef.current.scale.set(camera.current.scale);
    };
    app.canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMove);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUpOutside);
      app.canvas.removeEventListener('wheel', onWheel);
    };
  }, [app, isInitialised, selectSystem]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current) return;
    const world = worldRef.current;

    const nebulaContainer = new Container();
    const nebulaGfx = new Graphics();

    for (let arm = 0; arm < config.numArms; arm++) {
      const baseAngle = (arm / config.numArms) * Math.PI * 2 + config.baseAngleOffset;

      for (let step = 0; step < NEBULA_STEPS; step++) {
        if (Math.random() < NEBULA_SKIP_CHANCE) continue;

        const stepFraction = (step + 1) / (NEBULA_STEPS + 1);
        const radius = GALAXY_RADIUS * stepFraction;
        const angle = baseAngle + stepFraction * Math.PI * config.spiralTwist;
        const cloudX = Math.cos(angle) * radius;
        const cloudY = Math.sin(angle) * radius * config.galaxyEllipse;

        let blobScale = NEBULA_RADIUS_MULTIPLIER;
        let cloudsPerStep = NEBULA_PARTICLES_PER_STEP;
        if (Math.abs(cloudX) < NEBULA_CLOUD_OFFSET && Math.abs(cloudY) < NEBULA_CLOUD_OFFSET * config.galaxyEllipse) {
          blobScale = 1.5;
          cloudsPerStep = 20;
        }

        const spread = GALAXY_RADIUS * NEBULA_SPREAD * (0.35 + stepFraction);

        for (let p = 0; p < cloudsPerStep; p++) {
          const offsetX = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * spread;
          const offsetY = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * spread * config.galaxyEllipse;
          const particleRadius = spread * (0.15 + Math.random() * 0.45) * blobScale;
          const useNebula = Math.random() < stepFraction + 0.4;
          const colorList = useNebula
            ? (Math.random() > Math.pow(stepFraction, 2) + 0.15 ? config.innerNebulaColors : config.nebulaColors)
            : CORE_COLORS;
          const nebulaColor = colorList[Math.floor(Math.random() * colorList.length)];

          nebulaGfx.circle(cloudX + offsetX, cloudY + offsetY, particleRadius);
          nebulaGfx.fill({ color: nebulaColor, alpha: (0.014 + Math.random() * 0.024) * Math.max(1 - stepFraction, 0.5) });
        }
      }
    }

    const coreGfx = new Graphics();
    for (let p = 0; p < CORE_PARTICLE_COUNT; p++) {
      const offsetX = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * CORE_ELLIPSE_X;
      const offsetY = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * CORE_ELLIPSE_Y;
      const particleRadius = 20 + Math.random() * 60;
      const coreColor = CORE_COLORS[Math.floor(Math.random() * CORE_COLORS.length)];
      coreGfx.circle(offsetX, offsetY, particleRadius);
      coreGfx.fill({ color: coreColor, alpha: 0.012 + Math.random() * 0.018 });
    }

    nebulaGfx.blendMode = 'screen';
    coreGfx.blendMode = 'screen';
    nebulaGfx.filters = [new BlurFilter({ strength: 0.75 })];
    coreGfx.filters = [new BlurFilter({ strength: 0.75, blendMode: 'add' })];

    const dispTexture = createDisplacementTexture();
    const dispSprite = new Sprite(dispTexture);
    dispSprite.anchor.set(0.5);
    dispSprite.width = GALAXY_RADIUS * 3;
    dispSprite.height = GALAXY_RADIUS * 3;
    dispSprite.renderable = false;

    const dispFilter = new DisplacementFilter({ sprite: dispSprite, scale: NEBULA_DISPLACEMENT_SCALE });
    nebulaContainer.filters = [dispFilter];

    nebulaContainer.addChild(coreGfx);
    nebulaContainer.addChild(nebulaGfx);
    nebulaContainer.addChild(dispSprite);

    const dimGfx = new Graphics();
    for (const star of galaxy.backgroundStars) {
      if (star.brightness <= 0.7) dimGfx.circle(star.x, star.y, 0.6);
    }
    dimGfx.fill({ color: 0xffffff });

    const brightGfx = new Graphics();
    for (const star of galaxy.backgroundStars) {
      if (star.brightness > 0.7) brightGfx.circle(star.x, star.y, 1.0);
    }
    brightGfx.fill({ color: 0xffffff });

    // Background stars are fixed to the screen so they don't scroll with the galaxy.
    const bgContainer = new Container();
    bgContainer.position.set(app.screen.width / 2, app.screen.height / 2);
    bgContainer.addChild(dimGfx);
    bgContainer.addChild(brightGfx);

    world.addChildAt(nebulaContainer, 0);
    app.stage.addChildAt(bgContainer, 0);

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      nebulaContainer.alpha = 1 + Math.sin(elapsedSecs * 0.6) * 0.25;
      dispSprite.x = Math.sin(elapsedSecs * 0.06) * 120;
      dispSprite.y = Math.cos(elapsedSecs * 0.045) * 120;
      dispSprite.rotation = elapsedSecs * 0.008;
      const displacement = NEBULA_DISPLACEMENT_SCALE * camera.current.scale;
      dispFilter.scale.x = displacement;
      dispFilter.scale.y = displacement;
      dimGfx.alpha = 0.25 + Math.abs(Math.sin(elapsedSecs * 1.5)) * 0.55;
      brightGfx.alpha = 0.5 + Math.abs(Math.sin(elapsedSecs * 2.0 + 1.0)) * 0.5;
    };

    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      world.removeChild(nebulaContainer);
      app.stage.removeChild(bgContainer);
      nebulaContainer.destroy({ children: true });
      bgContainer.destroy({ children: true });
    };
  }, [galaxy, app, isInitialised]);

  return (
    <pixiContainer ref={worldRef}>
      {showHyperlanes && <HyperlaneLayer galaxy={galaxy} />}
      {galaxy.systems.map((system) => (
        <StarNode key={system.id} system={system} onSelect={selectSystem} />
      ))}
    </pixiContainer>
  );
}
