import { Application, useApplication } from "@pixi/react";
import { useCamera } from "./useCamera";
import { CAMERA_INITIAL_SCALE, SYSTEM_CAMERA_MIN_SCALE } from "../game/constants";
import { Container, Graphics, Sprite, Texture, Ticker } from "pixi.js";
import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore";
import { useUIStore } from "../store/uiStore";
import { BackgroundStars } from "./BackgroundStars";
import { ScaleBar } from "./ScaleBar";
import { generateSystemLayout, ORBITAL_K, MOON_K } from "../game/planetGen";
import { createRng } from "../game/galaxyGen";
import { createSunTexture, createNebulaGlowTexture, createGasGiantTexture } from "./textures";
import type { PlanetLayout } from "../game/planetGen";

type MoonState   = { gfx: Graphics; angle: number; speed: number; dist: number };
type PlanetState = { container: Container; angle: number; speed: number; orbitRadius: number; moons: MoonState[] };

function createPlanetRings(rx: number, ry: number): { back: Graphics; front: Graphics } {
  const k  = 0.5522847498;
  const s1 = { color: 0xddcc99, width: 5, alpha: 0.65 };
  const s2 = { color: 0xeeddbb, width: 2, alpha: 0.35 };

  const back = new Graphics();
  back.moveTo(rx, 0).bezierCurveTo(rx, -k*ry, k*rx, -ry, 0, -ry).bezierCurveTo(-k*rx, -ry, -rx, -k*ry, -rx, 0).stroke(s1);
  back.moveTo(rx*0.78, 0).bezierCurveTo(rx*0.78, -k*ry*0.78, k*rx*0.78, -ry*0.78, 0, -ry*0.78).bezierCurveTo(-k*rx*0.78, -ry*0.78, -rx*0.78, -k*ry*0.78, -rx*0.78, 0).stroke(s2);
  back.rotation = 0.3;

  const front = new Graphics();
  front.moveTo(-rx, 0).bezierCurveTo(-rx, k*ry, -k*rx, ry, 0, ry).bezierCurveTo(k*rx, ry, rx, k*ry, rx, 0).stroke(s1);
  front.moveTo(-rx*0.78, 0).bezierCurveTo(-rx*0.78, k*ry*0.78, -k*rx*0.78, ry*0.78, 0, ry*0.78).bezierCurveTo(k*rx*0.78, ry*0.78, rx*0.78, k*ry*0.78, rx*0.78, 0).stroke(s2);
  front.rotation = 0.3;

  return { back, front };
}

function createBodyGfx(radius: number, color: number, highlightAlpha: number): Graphics {
  const gfx = new Graphics();
  gfx.circle(0, 0, radius).fill({ color });
  gfx.circle(-radius * 0.28, -radius * 0.28, radius * 0.4).fill({ color: 0xffffff, alpha: highlightAlpha });
  return gfx;
}

const ASTEROID_COLORS = [0x888888, 0x999999, 0xaaaaaa, 0x776655, 0x887766, 0x998877];
const SYSTEM_NICE_VALUES = [1, 2, 5, 10, 20, 30, 60];

function createAsteroidBelt(gapIdx: number, planets: PlanetLayout[], seed: number): Container {
  const rng = createRng(seed);
  const beltInnerR  = planets[gapIdx].orbitRadius * 1.12;
  const beltOuterR  = beltInnerR * 1.10;
  const beltCenter  = (beltInnerR + beltOuterR) / 2;
  const beltSigma   = (beltOuterR - beltInnerR) / 1.5;

  type Particle = { x: number; y: number; r: number };
  const batches = new Map<number, Particle[]>();

  const numAsteroids = (Math.floor(rng() * 1250) + 1250) * (gapIdx + 1);
  for (let i = 0; i < numAsteroids; i++) {
    const u1     = Math.max(rng(), 1e-10);
    const u2     = rng();
    const radius = beltCenter + beltSigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (radius <= 0) continue;
    const theta = rng() * Math.PI * 2;
    const size  = rng() * 5 + 1;
    const color = ASTEROID_COLORS[Math.floor(rng() * ASTEROID_COLORS.length)];
    let batch = batches.get(color);
    if (!batch) { batch = []; batches.set(color, batch); }
    batch.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius, r: size });
  }

  const beltGfx = new Graphics();
  for (const [color, particles] of batches) {
    for (const p of particles) beltGfx.circle(p.x, p.y, p.r);
    beltGfx.fill({ color, alpha: 0.55 });
  }

  const belt = new Container();
  belt.addChild(beltGfx);
  return belt;
}

function createNebulaSprite(color: number, sunRadius: number): Sprite {
  const texture = createNebulaGlowTexture(color);
  const sprite  = new Sprite(texture);
  sprite.anchor.set(0.5);
  const size    = Math.max(sunRadius * 30, 3000);
  sprite.width  = size;
  sprite.height = size;
  sprite.blendMode = 'screen';
  return sprite;
}

function createCorona(seed: number, color: number, sunRadius: number): Container {
  const rng = createRng(seed);

  const container = new Container();
  container.blendMode = 'screen';
  const gfx = new Graphics();

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const len   = sunRadius * (2.4 + rng() * 3.0);
    const alpha = 0.09 + rng() * 0.18;
    const width = 1.0 + rng() * 2.2;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    gfx.moveTo(dx * sunRadius * 0.9, dy * sunRadius * 0.9)
       .lineTo(dx * len, dy * len)
       .stroke({ color, width, alpha });
  }
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2 + Math.PI / 22;
    const len   = sunRadius * (1.1 + rng() * 1.3);
    const alpha = 0.12 + rng() * 0.22;
    const width = 0.6 + rng() * 0.9;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    gfx.moveTo(dx * sunRadius * 0.85, dy * sunRadius * 0.85)
       .lineTo(dx * len, dy * len)
       .stroke({ color: 0xffffff, width, alpha });
  }

  container.addChild(gfx);
  return container;
}

export function SolarSystemStage() {
  return (
    <Application resizeTo={window} background={0x050810}>
        <SolarSystem />
    </Application>
  )
}

function SolarSystem() {
  const { isInitialised } = useApplication();
  const worldRef = useRef<Container>(null);
  const backgroundStars = useGameStore((s) => s.galaxy.backgroundStars);
  const system = useGameStore((s) => s.system);
  const showOrbitRings = useUIStore((s) => s.showOrbitRings);
  const showOrbitRingsRef = useRef(showOrbitRings);
  showOrbitRingsRef.current = showOrbitRings;
  const orbitGfxRef = useRef<Graphics[]>([]);
  const { camera } = useCamera(worldRef, CAMERA_INITIAL_SCALE - 0.3, undefined, SYSTEM_CAMERA_MIN_SCALE);

  useEffect(() => {
    for (const gfx of orbitGfxRef.current) gfx.visible = showOrbitRings;
  }, [showOrbitRings]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current || !system) return;
    const world   = worldRef.current;
    const layout  = generateSystemLayout(system.seed);
    const systemContainer = new Container();
    const systemGfx       = new Graphics();
    const planets: PlanetState[] = [];

    const allOrbitGfx: Graphics[]  = [systemGfx];
    const planetTextures: Texture[] = [];

    for (let ring = 0; ring < layout.planets.length; ring++) {
      const pl    = layout.planets[ring];
      const speed = ORBITAL_K / Math.pow(pl.orbitRadius, 1.5);

      const planetContainer = new Container();
      planetContainer.x = Math.cos(pl.angle) * pl.orbitRadius;
      planetContainer.y = Math.sin(pl.angle) * pl.orbitRadius;

      const planet: PlanetState = { container: planetContainer, angle: pl.angle, speed, orbitRadius: pl.orbitRadius, moons: [] };

      systemGfx.circle(0, 0, pl.orbitRadius);

      const atmosphereGfx = new Graphics();
      atmosphereGfx.circle(0, 0, pl.radius * 1.8).fill({ color: pl.color, alpha: 0.08 });
      atmosphereGfx.circle(0, 0, pl.radius * 1.3).fill({ color: pl.color, alpha: 0.14 });
      planetContainer.addChild(atmosphereGfx);

      const rings = pl.hasRings ? createPlanetRings(pl.radius * 2.4, pl.radius * 0.5) : null;
      if (rings) planetContainer.addChild(rings.back);

      for (const moon of pl.moons) {
        const moonSpeed = MOON_K / Math.pow(moon.dist, 1.5);

        const moonOrbitGfx = new Graphics();
        moonOrbitGfx.circle(0, 0, moon.dist).stroke({ color: 0xffffff, width: 2, alpha: 0.25 });
        allOrbitGfx.push(moonOrbitGfx);
        planetContainer.addChild(moonOrbitGfx);

        const moonGfx = createBodyGfx(moon.radius, moon.color, 0.18);
        moonGfx.x = Math.cos(moon.angle) * moon.dist;
        moonGfx.y = Math.sin(moon.angle) * moon.dist;
        planetContainer.addChild(moonGfx);

        planet.moons.push({ gfx: moonGfx, angle: moon.angle, speed: moonSpeed, dist: moon.dist });
      }

      if (pl.zone === 'gas' || pl.zone === 'ice') {
        const tex    = createGasGiantTexture(pl.color, system.seed + ring * 0x9e3779b9, pl.zone === 'ice');
        planetTextures.push(tex);
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.width  = pl.radius * 2;
        sprite.height = pl.radius * 2;
        planetContainer.addChild(sprite);
      } else {
        planetContainer.addChild(createBodyGfx(pl.radius, pl.color, 0.22));
      }

      if (rings) planetContainer.addChild(rings.front);
      systemContainer.addChild(planetContainer);
      planets.push(planet);
    }

    systemGfx.stroke({ color: 0xffffff, width: 5, alpha: 0.25 });
    for (const gfx of allOrbitGfx) gfx.visible = showOrbitRingsRef.current;
    orbitGfxRef.current = allOrbitGfx;

    const asteroidBelt = layout.asteroidGapIdx !== null
      ? createAsteroidBelt(layout.asteroidGapIdx, layout.planets, layout.asteroidSeed)
      : null;

    const sunRadius  = system.size * 120;
    const sunTexture = createSunTexture(system.color);
    const sunSprite  = new Sprite(sunTexture);
    sunSprite.anchor.set(0.5);
    sunSprite.width  = sunRadius * 4;
    sunSprite.height = sunRadius * 4;
    const sunBaseScale = sunSprite.scale.x;

    const nebulaSprite  = createNebulaSprite(system.color, sunRadius);
    const nebulaTexture = nebulaSprite.texture;
    const coronaContainer = createCorona(system.seed, system.color, sunRadius);

    systemContainer.addChildAt(nebulaSprite, 0);
    systemContainer.addChildAt(systemGfx, 1);
    if (asteroidBelt) systemContainer.addChildAt(asteroidBelt, 2);
    systemContainer.addChild(coronaContainer);
    systemContainer.addChild(sunSprite);
    world.addChildAt(systemContainer, 0);

    let elapsed = 0;
    function onTick(ticker: Ticker) {
      const dt = ticker.deltaMS / 1000;
      elapsed += dt;
      sunSprite.scale.set(sunBaseScale * (1 + Math.sin(elapsed * 0.9) * 0.07));
      coronaContainer.rotation += 0.018 * dt;
      coronaContainer.alpha = 0.8 + 0.2 * Math.sin(elapsed * 0.55);
      nebulaSprite.alpha    = 0.65 + 0.15 * Math.sin(elapsed * 0.22);
      if (asteroidBelt) asteroidBelt.rotation += 0.025 * dt;
      for (const p of planets) {
        p.angle += p.speed * dt;
        p.container.x = Math.cos(p.angle) * p.orbitRadius;
        p.container.y = Math.sin(p.angle) * p.orbitRadius;
        for (const moon of p.moons) {
          moon.angle += moon.speed * dt;
          moon.gfx.x = Math.cos(moon.angle) * moon.dist;
          moon.gfx.y = Math.sin(moon.angle) * moon.dist;
        }
      }
    }
    Ticker.shared.add(onTick);

    return () => {
      orbitGfxRef.current = [];
      Ticker.shared.remove(onTick);
      world.removeChild(systemContainer);
      systemContainer.destroy({ children: true });
      sunTexture.destroy(true);
      nebulaTexture.destroy(true);
      for (const tex of planetTextures) tex.destroy(true);
    };
  }, [system, isInitialised]);

  return (
    <>
      <BackgroundStars stars={backgroundStars} />
      <pixiContainer ref={worldRef} />
      <ScaleBar
        camera={camera}
        unitsPerWorldPx={1 / 180}
        unit="Light Minutes"
        niceValues={SYSTEM_NICE_VALUES}
      />
    </>
  );
}
