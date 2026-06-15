import { Application, extend, useApplication } from '@pixi/react';
import { Container, Graphics, FederatedPointerEvent, Ticker, Sprite, Texture } from 'pixi.js';
import { useCallback, useEffect, useRef, memo, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import type { Galaxy, StarSystem } from '../game/types';
import {
  N_ARMS,
  GALAXY_RADIUS,
  GALAXY_ELLIPSE,
  SPIRAL_TWIST,
  NEBULA_COLORS,
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
  CORE_COLORS,
} from '../game/constants';

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

      if (!hasDragged.current && (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX)) hasDragged.current = true;

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

      // World-space coordinates under the mouse before zoom — used to re-anchor
      // the view after scaling so the point under the cursor stays fixed.
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

    for (let arm = 0; arm < N_ARMS; arm++) {
      const baseAngle = (arm / N_ARMS) * Math.PI * 2;

      for (let step = 0; step < NEBULA_STEPS; step++) {
        if (Math.random() < NEBULA_SKIP_CHANCE) continue;

        const stepFraction = (step + 1) / (NEBULA_STEPS + 1);
        const radius = GALAXY_RADIUS * stepFraction;
        const angle = baseAngle + stepFraction * Math.PI * SPIRAL_TWIST;
        const cloudX = Math.cos(angle) * radius;
        const cloudY = Math.sin(angle) * radius * GALAXY_ELLIPSE;

        let blobScale = NEBULA_RADIUS_MULTIPLIER;
        let cloudsPerStep = NEBULA_PARTICLES_PER_STEP;
        if (Math.abs(cloudX) < NEBULA_CLOUD_OFFSET && Math.abs(cloudY) < NEBULA_CLOUD_OFFSET * GALAXY_ELLIPSE) {
          blobScale = 1.5;
          cloudsPerStep = 20;
        }

        const spread = GALAXY_RADIUS * NEBULA_SPREAD * (0.35 + stepFraction);

        for (let p = 0; p < cloudsPerStep; p++) {
          const offsetX = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * spread;
          const offsetY = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * spread * GALAXY_ELLIPSE;
          const particleRadius = spread * (0.15 + Math.random() * 0.45) * blobScale;
          const colorList = Math.random() < stepFraction + 0.15 ? NEBULA_COLORS : CORE_COLORS;
          const nebulaColor = colorList[Math.floor(Math.random() * colorList.length)];

          nebulaGfx.circle(cloudX + offsetX, cloudY + offsetY, particleRadius);
          const alpha = 0.014 + Math.random() * 0.024;
          nebulaGfx.fill({ color: nebulaColor, alpha: alpha });
        }
      }
    }

    const coreGfx = new Graphics();
    for (let p = 0; p < CORE_PARTICLE_COUNT; p++) {
      const offsetX = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * CORE_ELLIPSE_X;
      const offsetY = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * CORE_ELLIPSE_Y;
      const particleRadius = 20 + Math.random() * 60;
      const coreColor = CORE_COLORS[Math.floor(Math.random() * CORE_COLORS.length)]

      coreGfx.circle(offsetX, offsetY, particleRadius);
      coreGfx.fill({ color: coreColor, alpha: 0.012 + Math.random() * 0.018 });
    }

    nebulaContainer.addChild(coreGfx);
    nebulaContainer.addChild(nebulaGfx);

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

    // Background stars are fixed to the screen (not the world) so they don't
    // scroll with the galaxy when the user pans.
    const bgContainer = new Container();
    bgContainer.position.set(app.screen.width / 2, app.screen.height / 2);
    bgContainer.addChild(dimGfx);
    bgContainer.addChild(brightGfx);

    world.addChildAt(nebulaContainer, 0);
    app.stage.addChildAt(bgContainer, 0);

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;

      // Nebula slowly "breathes" — alpha oscillates between 0.5 and 1.0 over ~25 seconds.
      // Math.sin returns -1 to 1, so 0.75 + sin * 0.25 gives 0.5 to 1.0.
      nebulaContainer.alpha = 0.75 + Math.sin(elapsedSecs * 0.6) * 0.25;

      // Dim stars pulse between alpha 0.25 and 0.80 at 1.5 Hz (1.5 cycles per second).
      // Math.abs(Math.sin()) keeps alpha positive — it bounces 0→1→0→1 instead of going negative.
      dimGfx.alpha = 0.25 + Math.abs(Math.sin(elapsedSecs * 1.5)) * 0.55;

      // Bright stars pulse faster (2.0 Hz) and between a higher range (0.5 to 1.0),
      // so they twinkle more noticeably than the dim stars.
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

const HyperlaneLayer = memo(function HyperlaneLayer({ galaxy }: { galaxy: Galaxy }) {
  const draw = useCallback(
    (gfx: Graphics) => {
      gfx.clear();

      for (const lane of galaxy.hyperlanes) {
        const fromSystem = galaxy.systems[lane.from];
        const toSystem = galaxy.systems[lane.to];
        gfx.moveTo(fromSystem.x, fromSystem.y);
        gfx.lineTo(toSystem.x, toSystem.y);
      }

      gfx.stroke({ color: 0xFFFFFF, width: 1.2, alpha: 0.1 });
    },
    [galaxy],
  );

  return <pixiGraphics draw={draw} eventMode="none" />;
});

const StarNode = memo(function StarNode({
  system,
  onSelect,
}: {
  system: StarSystem;
  onSelect: (id: number | null) => void;
}) {
  const isSelected = useUIStore((s) => s.selectedSystemId === system.id);

  const glowTexture = useMemo(() => {
    const outerRadius = system.size * 2.2;
    const diameter = Math.ceil(outerRadius * 2);
    const canvas = document.createElement('canvas');
    canvas.width = diameter;
    canvas.height = diameter;
    const ctx = canvas.getContext('2d')!;
    const center = diameter / 2;

    // Decompose the star's hex colour into r, g, b channels for the gradient rgba() strings.
    const red   = (system.color >> 16) & 0xff;
    const green = (system.color >> 8)  & 0xff;
    const blue  =  system.color        & 0xff;

    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0,    'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, `rgba(${red},${green},${blue},1)`);
    gradient.addColorStop(0.82, `rgba(${red},${green},${blue},0.2)`);
    gradient.addColorStop(1,    `rgba(${red},${green},${blue},0)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, diameter, diameter);

    return Texture.from(canvas);
  }, [system.color, system.size]);

  useEffect(() => () => { glowTexture.destroy(true); }, [glowTexture]);

  const drawRing = useCallback(
    (gfx: Graphics) => {
      gfx.clear();
      if (isSelected) {
        gfx.circle(0, 0, system.size + 7);
        gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
        gfx.circle(0, 0, system.size + 11);
        gfx.stroke({ color: 0xffffff, width: 0.5, alpha: 0.25 });
      }
    },
    [system.size, isSelected],
  );

  return (
    <pixiContainer
      x={system.x}
      y={system.y}
      eventMode="static"
      cursor="pointer"
      onClick={() => onSelect(system.id)}
    >
      <pixiSprite texture={glowTexture} anchor={0.5} />
      <pixiGraphics draw={drawRing} eventMode="none" />
    </pixiContainer>
  );
});
