import { Application, useApplication } from "@pixi/react";
import { useCamera } from "./useCamera";
import { CAMERA_INITIAL_SCALE } from "../game/constants";
import { Container, Graphics, Sprite } from "pixi.js";
import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore";
import { BackgroundStars } from "./BackgroundStars";
import { createRng } from "../game/galaxyGen";
import { createSunTexture } from "./textures";

type MoonState = { gfx: Graphics; angle: number; speed: number; dist: number };
type PlanetState = { container: Container; angle: number; speed: number; orbitRadius: number; moon?: MoonState };

function createBodyGfx(radius: number, color: number, highlightAlpha: number): Graphics {
  const gfx = new Graphics();
  gfx.circle(0, 0, radius).fill({ color });
  gfx.circle(-radius * 0.28, -radius * 0.28, radius * 0.4).fill({ color: 0xffffff, alpha: highlightAlpha });
  return gfx;
}

const PLANET_COLORS = [
  0x8B4513, 0xA0522D, 0xD2691E, 0xC2956C, // rocky / desert browns
  0x708090, 0x778899, 0xA9A9A9,            // gray rock
  0x4682B4, 0x5F9EA0, 0x87CEEB,            // ocean / ice blue
  0xDAA520, 0xCD853F, 0xF4A460,            // gas giant tan / gold
  0x6B8E23, 0x8FBC8F,                      // lush green
  0x9370DB, 0x7B68EE,                      // exotic violet
];

export function SolarSystemStage() {
  return (
    <Application resizeTo={window} background={0x050810}>
        <SolarSystem />
    </Application>
  )
}

function SolarSystem() {
  const { app, isInitialised } = useApplication();
  const worldRef = useRef<Container>(null);
  const backgroundStars = useGameStore((s) => s.galaxy.backgroundStars);
  const system = useGameStore((s) => s.system);
  useCamera(worldRef, CAMERA_INITIAL_SCALE - 0.3);

  useEffect(() => {
    if (!isInitialised || !worldRef.current || !system) return;
    const world = worldRef.current;
    const rng = createRng(system.seed);
    const systemContainer = new Container();
    const systemGfx = new Graphics();
    const planets: PlanetState[] = [];

    const numRings = Math.floor(rng() * 3) + 3;
    for (let ring = 0; ring < numRings; ring++) {
      const orbitRadius = 400 + (Math.floor(rng() * 300) + 100) * ring;
      systemGfx.circle(0, 0, orbitRadius);

      const angle = rng() * Math.PI * 2;
      const color = PLANET_COLORS[Math.floor(rng() * PLANET_COLORS.length)];
      const planetRadius = Math.floor(rng() * 50) + 15;
      const speed = 4 / Math.sqrt(orbitRadius);

      const planetContainer = new Container();
      planetContainer.x = Math.cos(angle) * orbitRadius;
      planetContainer.y = Math.sin(angle) * orbitRadius;

      const planet: PlanetState = { container: planetContainer, angle, speed, orbitRadius };

      const atmosphereGfx = new Graphics();
      atmosphereGfx.circle(0, 0, planetRadius * 1.8).fill({ color, alpha: 0.08 });
      atmosphereGfx.circle(0, 0, planetRadius * 1.3).fill({ color, alpha: 0.14 });
      planetContainer.addChild(atmosphereGfx);

      const hasRings = rng() > 0.75;
      if (hasRings) {
        const rx = planetRadius * 2.4;
        const ry = planetRadius * 0.5;
        const ringGfx = new Graphics();
        ringGfx.ellipse(0, 0, rx, ry).stroke({ color: 0xddcc99, width: 5, alpha: 0.65 });
        ringGfx.ellipse(0, 0, rx * 0.78, ry * 0.78).stroke({ color: 0xeeddbb, width: 2, alpha: 0.35 });
        ringGfx.rotation = 0.3;
        planetContainer.addChild(ringGfx);
      }

      const hasMoon = rng() > 0.75;
      if (hasMoon) {
        const moonDist = planetRadius + Math.floor(rng() * 75) + 50;
        const moonAngle = rng() * Math.PI * 2;
        const moonRadius = Math.max(6, Math.floor(planetRadius * 0.28));
        const moonSpeed = 8 / Math.sqrt(moonDist);

        const moonOrbitGfx = new Graphics();
        moonOrbitGfx.circle(0, 0, moonDist).stroke({ color: 0xffffff, width: 2, alpha: 0.25 });
        planetContainer.addChild(moonOrbitGfx);

        const moonGfx = createBodyGfx(moonRadius, 0x99a0aa, 0.18);
        moonGfx.x = Math.cos(moonAngle) * moonDist;
        moonGfx.y = Math.sin(moonAngle) * moonDist;
        planetContainer.addChild(moonGfx);

        planet.moon = { gfx: moonGfx, angle: moonAngle, speed: moonSpeed, dist: moonDist };
      }

      const planetGfx = createBodyGfx(planetRadius, color, 0.22);
      planetContainer.addChild(planetGfx);
      systemContainer.addChild(planetContainer);
      planets.push(planet);
    }
    systemGfx.stroke({ color: 0xffffff, width: 5, alpha: 0.25 });

    const sunRadius = system.size * 50;
    const sunTexture = createSunTexture(system.color);
    const sunSprite = new Sprite(sunTexture);
    sunSprite.anchor.set(0.5);
    sunSprite.width = sunRadius * 4;
    sunSprite.height = sunRadius * 4;
    const sunBaseScale = sunSprite.scale.x;

    systemContainer.addChildAt(systemGfx, 0);
    systemContainer.addChild(sunSprite);
    world.addChildAt(systemContainer, 0);

    let elapsed = 0;
    function onTick() {
      const dt = app.ticker.deltaMS / 1000;
      elapsed += dt;
      sunSprite.scale.set(sunBaseScale * (1 + Math.sin(elapsed * 0.9) * 0.07));
      for (const p of planets) {
        p.angle += p.speed * dt;
        p.container.x = Math.cos(p.angle) * p.orbitRadius;
        p.container.y = Math.sin(p.angle) * p.orbitRadius;
        if (p.moon) {
          p.moon.angle += p.moon.speed * dt;
          p.moon.gfx.x = Math.cos(p.moon.angle) * p.moon.dist;
          p.moon.gfx.y = Math.sin(p.moon.angle) * p.moon.dist;
        }
      }
    }
    app.ticker.add(onTick);

    return () => {
      app.ticker.remove(onTick);
      world.removeChild(systemContainer);
      systemContainer.destroy({ children: true });
      sunTexture.destroy(true);
    }
  }, [system, app, isInitialised])
  return (
    <>
      <BackgroundStars stars={backgroundStars} />
      <pixiContainer ref={worldRef} />
    </>
  )
}