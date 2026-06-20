import { useApplication } from "@pixi/react";
import { useCamera } from "./useCamera";
import { CAMERA_INITIAL_SCALE, SYSTEM_CAMERA_MIN_SCALE } from "../game/constants";
import { Circle, Container, Graphics, Sprite, Texture, Ticker } from "pixi.js";
import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore";
import { useUIStore } from "../store/uiStore";
import { useExtractorStore } from "../store/extractorStore";
import { makeExtractorKey } from "../game/types";
import { BackgroundStars } from "./BackgroundStars";
import { ScaleBar } from "./ScaleBar";
import { generateSystemLayout, ORBITAL_K, MOON_K } from "../game/planetGen";
import { createRng } from "../game/galaxyGen";
import { createSunTexture, createBrownDwarfTexture, createNebulaGlowTexture, createGasGiantTexture, createRockyPlanetTexture, createHabitablePlanetTexture, createMoonTexture } from "./textures";
import { createExtractorGfx } from "./extractorGfx";
import type { PlanetLayout } from "../game/planetGen";

type MoonState   = { gfx: Sprite; angle: number; speed: number; dist: number };
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

export function SolarSystem() {
  const { isInitialised } = useApplication();
  const worldRef = useRef<Container>(null);
  const backgroundStars = useGameStore((s) => s.galaxy.backgroundStars);
  const system = useGameStore((s) => s.system);
  const showOrbitRings = useUIStore((s) => s.showOrbitRings);
  const showOrbitRingsRef = useRef(showOrbitRings);
  showOrbitRingsRef.current = showOrbitRings;
  const orbitGfxRef = useRef<Graphics[]>([]);
  const { camera } = useCamera(worldRef, CAMERA_INITIAL_SCALE - 0.3, undefined, SYSTEM_CAMERA_MIN_SCALE);
  const extractorGfxRef = useRef<Map<string, Graphics>>(new Map());

  useEffect(() => {
    for (const gfx of orbitGfxRef.current) gfx.visible = showOrbitRings;
  }, [showOrbitRings]);

  useEffect(() => {
    if (!isInitialised || !worldRef.current || !system) return;
    const world   = worldRef.current;
    const layout  = generateSystemLayout(system.seed, system.starType);
    const systemContainer = new Container();
    const systemGfx       = new Graphics();
    const planets: PlanetState[] = [];

    const allOrbitGfx: Graphics[]  = [systemGfx];
    const planetTextures: Texture[] = [];
    const galaxySeed = useGameStore.getState().galaxy.seed;
    const generatedPlanets = system.planets ?? [];

    for (let ring = 0; ring < layout.planets.length; ring++) {
      const pl    = layout.planets[ring];
      const speed = ORBITAL_K / Math.pow(pl.orbitRadius, 1.5);

      const planetContainer = new Container();
      planetContainer.x = Math.cos(pl.angle) * pl.orbitRadius;
      planetContainer.y = Math.sin(pl.angle) * pl.orbitRadius;

      const planet: PlanetState = { container: planetContainer, angle: pl.angle, speed, orbitRadius: pl.orbitRadius, moons: [] };

      systemGfx.circle(0, 0, pl.orbitRadius);

      const pr = pl.radius;
      const atmosphereGfx = new Graphics();
      atmosphereGfx.circle(0, 0, pr * 1.8).fill({ color: pl.color, alpha: 0.08 });
      atmosphereGfx.circle(0, 0, pr * 1.3).fill({ color: pl.color, alpha: 0.14 });
      planetContainer.addChild(atmosphereGfx);

      const rings = pl.hasRings ? createPlanetRings(pr * 2.4, pr * 0.5) : null;
      if (rings) planetContainer.addChild(rings.back);

      if (pl.moons.length > 0) {
        // One Graphics per planet for all its moon orbit rings (vs one per moon)
        const moonOrbitGfx = new Graphics();
        allOrbitGfx.push(moonOrbitGfx);
        planetContainer.addChild(moonOrbitGfx);

        for (let m = 0; m < pl.moons.length; m++) {
          const moon = pl.moons[m];
          const moonSpeed = MOON_K / Math.pow(moon.dist, 1.5);

          moonOrbitGfx.circle(0, 0, moon.dist).stroke({ color: 0xffffff, width: 2, alpha: 0.25 });

          const mr = moon.radius;
          const moonSeed = (system.seed + ring * 0x9e3779b9 + (m + 1) * 0x7f4a9c3b) >>> 0;
          const moonTex = createMoonTexture(moon.color, moonSeed);
          planetTextures.push(moonTex);
          const moonSprite = new Sprite(moonTex);
          moonSprite.anchor.set(0.5);
          moonSprite.width  = mr * 2;
          moonSprite.height = mr * 2;
          moonSprite.x = Math.cos(moon.angle) * moon.dist;
          moonSprite.y = Math.sin(moon.angle) * moon.dist;
          planetContainer.addChild(moonSprite);

          planet.moons.push({ gfx: moonSprite, angle: moon.angle, speed: moonSpeed, dist: moon.dist });
        }
      }

      const planetSeed = (system.seed + ring * 0x9e3779b9) >>> 0;
      const planetTex = (pl.zone === 'gas' || pl.zone === 'ice')
        ? createGasGiantTexture(pl.color, planetSeed, pl.zone === 'ice')
        : pl.zone === 'habitable'
          ? createHabitablePlanetTexture(pl.color, planetSeed)
          : createRockyPlanetTexture(pl.color, planetSeed);
      planetTextures.push(planetTex);
      const planetSprite = new Sprite(planetTex);
      planetSprite.anchor.set(0.5);
      planetSprite.width  = pr * 2;
      planetSprite.height = pr * 2;
      planetContainer.addChild(planetSprite);

      if (rings) planetContainer.addChild(rings.front);

      // make planet clickable
      if (generatedPlanets[ring]) {
        const planetData = generatedPlanets[ring];
        const key = makeExtractorKey(galaxySeed, system.id, planetData.name);

        planetContainer.hitArea = new Circle(0, 0, pr * 1.5);
        planetContainer.eventMode = 'static';
        planetContainer.cursor = 'pointer';
        planetContainer.on('pointerdown', (e) => {
          e.stopPropagation();
          useUIStore.getState().setSelectedPlanet(key);
        });

        // render existing extractor station if already placed
        if (useExtractorStore.getState().extractors[key]) {
          const stationGfx = createExtractorGfx(pr);
          planetContainer.addChild(stationGfx);
          extractorGfxRef.current.set(key, stationGfx);
        }
      }

      systemContainer.addChild(planetContainer);
      planets.push(planet);
    }

    // subscribe to extractor store — only fires when the set of keys changes, not on lastCollectedAt updates
    const unsubExtractors = useExtractorStore.subscribe(
      (state) => Object.keys(state.extractors).sort().join('\0'),
      () => {
        const { extractors } = useExtractorStore.getState();
        for (let ring = 0; ring < generatedPlanets.length; ring++) {
          const planetData = generatedPlanets[ring];
          const key = makeExtractorKey(galaxySeed, system.id, planetData.name);
          const hasExtractor = !!extractors[key];
          const existing = extractorGfxRef.current.get(key);
          if (hasExtractor && !existing) {
            const pr = layout.planets[ring].radius;
            const stationGfx = createExtractorGfx(pr);
            planets[ring].container.addChild(stationGfx);
            extractorGfxRef.current.set(key, stationGfx);
          } else if (!hasExtractor && existing) {
            existing.destroy();
            extractorGfxRef.current.delete(key);
          }
        }
      },
    );

    systemGfx.stroke({ color: 0xffffff, width: 2, alpha: 0.25 });
    for (const gfx of allOrbitGfx) gfx.visible = showOrbitRingsRef.current;
    orbitGfxRef.current = allOrbitGfx;

    const asteroidBelt = layout.asteroidGapIdx !== null
      ? createAsteroidBelt(layout.asteroidGapIdx, layout.planets, layout.asteroidSeed)
      : null;

    const isBrownDwarf = system.starType === 'L';
    const sunRadius  = system.size * 120 * (isBrownDwarf ? 0.5 : 1);
    const sunTexture = isBrownDwarf
      ? createBrownDwarfTexture(system.seed)
      : createSunTexture(system.color);
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
      for (const gfx of extractorGfxRef.current.values()) {
        gfx.rotation += 0.004 * dt;
      }
    }
    Ticker.shared.add(onTick);

    return () => {
      unsubExtractors();
      extractorGfxRef.current.clear();
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
