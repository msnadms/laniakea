import { createRng } from "./galaxyGen";
import type { Planet, Moon, Resource, ZoneType } from "./types";

export interface MoonLayout {
  dist: number;
  angle: number;
  radius: number;
  color: number;
}

export interface PlanetLayout {
  zone: ZoneType;
  radius: number;
  color: number;
  angle: number;
  orbitRadius: number;
  hasRings: boolean;
  moons: MoonLayout[];
}

export interface SystemLayout {
  planets: PlanetLayout[];
  asteroidGapIdx: number | null;
  asteroidSeed: number;
  seed: number;
}

export type ZoneConfig = {
  radiusMin: number;
  radiusSpread: number;
  colors: readonly number[];
  moonColors: readonly number[];
  ringThreshold: number;
  moonThreshold: number;
  maxMoons: number;
};

const HOT_ZONE_COLORS = [0x8B4513, 0xA0522D, 0xD2691E, 0xC2956C, 0xB22222, 0xCC4422];
const HABITABLE_ZONE_COLORS = [0x4682B4, 0x5F9EA0, 0x6B8E23, 0x8FBC8F, 0x87CEEB, 0xC2956C];
const GAS_GIANT_COLORS = [0xDAA520, 0xCD853F, 0xF4A460, 0xE8C878, 0xC8A060, 0xDDB060];
const ICE_GIANT_COLORS = [0x4A90C4, 0x5599CC, 0x6699BB, 0x8899BB, 0x9370DB, 0x7B68EE];
const HOT_MOON_COLORS = [0x5a3a2a, 0x6b4030, 0x7a4a35, 0x4a3020, 0x3d2a1e];
const HABITABLE_MOON_COLORS = [0x8a8f96, 0xa0a8b0, 0x7a8090, 0xb0b8c0, 0x909898, 0xc8c0a8];
const GAS_MOON_COLORS = [0xc8a050, 0xd4b870, 0x8a9090, 0xe8d8a0, 0xb09060, 0xa09898];
const ICE_MOON_COLORS = [0xc0d8e8, 0xd0e4f0, 0xa8b8cc, 0xe0ecf4, 0xb0c8d8, 0x9090a8];

export function getPlanetZone(idx: number, total: number): ZoneType {
  const f = idx / total;
  if (f < 0.30) return 'hot';
  if (f < 0.50) return 'habitable';
  if (f < 0.75) return 'gas';
  return 'ice';
}

export function getZoneConfig(zone: ZoneType): ZoneConfig {
  switch (zone) {
    case 'hot': return { radiusMin: 10, radiusSpread: 13, colors: HOT_ZONE_COLORS, moonColors: HOT_MOON_COLORS, ringThreshold: 1.1, moonThreshold: 0.90, maxMoons: 1 };
    case 'habitable': return { radiusMin: 16, radiusSpread: 17, colors: HABITABLE_ZONE_COLORS, moonColors: HABITABLE_MOON_COLORS, ringThreshold: 1.1, moonThreshold: 0.60, maxMoons: 2 };
    case 'gas': return { radiusMin: 75, radiusSpread: 50, colors: GAS_GIANT_COLORS, moonColors: GAS_MOON_COLORS, ringThreshold: 0.40, moonThreshold: 0.15, maxMoons: 5 };
    case 'ice': return { radiusMin: 28, radiusSpread: 22, colors: ICE_GIANT_COLORS, moonColors: ICE_MOON_COLORS, ringThreshold: 0.62, moonThreshold: 0.28, maxMoons: 3 };
  }
}

export const ORBITAL_K = 3500;
export const MOON_K = 430;

export function generateSystemLayout(seed: number): SystemLayout {
  const rng = createRng(seed);
  const numRings = Math.floor(rng() * 5) + 3;
  let orbitRadius = 380 + rng() * 120;

  const planets: PlanetLayout[] = [];

  for (let ring = 0; ring < numRings; ring++) {
    const zone = getPlanetZone(ring, numRings);
    const cfg = getZoneConfig(zone);

    const radius = Math.floor(rng() * cfg.radiusSpread) + cfg.radiusMin;
    const color = cfg.colors[Math.floor(rng() * cfg.colors.length)];
    const angle = rng() * Math.PI * 2;
    const hasRings = rng() > cfg.ringThreshold;
    const hasMoon = rng() > cfg.moonThreshold;

    const moons: MoonLayout[] = [];
    if (hasMoon) {
      const numMoons = Math.ceil(rng() * cfg.maxMoons);
      for (let m = 0; m < numMoons; m++) {
        const dist = radius * 2.5 + Math.floor(rng() * 50) + 45 * (m + 1);
        const moonAngle = rng() * Math.PI * 2;
        const moonRadius = Math.max(4, Math.floor(radius * Math.abs(rng() - 0.5)));
        const moonColor = cfg.moonColors[Math.floor(rng() * cfg.moonColors.length)];
        moons.push({ dist, angle: moonAngle, radius: moonRadius, color: moonColor });
      }
    }

    planets.push({ zone, radius, color, angle, orbitRadius, hasRings, moons });
    orbitRadius *= 1.55 + rng() * 0.65;
  }

  let asteroidGapIdx: number | null = null;
  if (planets.length >= 2 && rng() <= 0.4) {
    asteroidGapIdx = Math.floor(rng() * (planets.length - 1));
  }

  // asteroidSeed is isolated from the planet RNG so the renderer never has to
  // derive a seed transform itself, and a second renderer always gets the same belt.
  const asteroidSeed = (seed ^ 0xdeadbeef) >>> 0;

  return { planets, asteroidGapIdx, asteroidSeed, seed };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const MOON_ALPHA = 'abcdefghijklmnop'.split('');

function resourcesForZone(rng: () => number, zone: ZoneType): Resource[] {
  switch (zone) {
    case 'hot': return [{ type: 'alloys', count: 2 + Math.floor(rng() * 4) }];
    case 'habitable': return [
      { type: 'nutrients', count: 3 + Math.floor(rng() * 5) },
      { type: 'alloys', count: 1 + Math.floor(rng() * 3) },
    ];
    case 'gas': return [{ type: 'exotic', count: 2 + Math.floor(rng() * 4) }];
    case 'ice': return [
      { type: 'exotic', count: 1 + Math.floor(rng() * 3) },
      { type: 'nutrients', count: 1 + Math.floor(rng() * 2) },
    ];
  }
}

function moonResourcesForZone(rng: () => number, zone: ZoneType): Resource[] {
  switch (zone) {
    case 'hot': return [{ type: 'alloys', count: 1 + Math.floor(rng() * 2) }];
    case 'habitable': return [{ type: 'nutrients', count: 1 + Math.floor(rng() * 2) }];
    case 'gas': return [{ type: 'alloys', count: 1 + Math.floor(rng() * 3) }];
    case 'ice': return [{ type: 'exotic', count: 1 + Math.floor(rng() * 2) }];
  }
}

export function generatePlanets(layout: SystemLayout, starName: string): Planet[] {
  const rng = createRng(layout.seed);

  return layout.planets.map((planet, ring) => {
    const moons: Moon[] = planet.moons.map((_, m) => ({
      name: `${starName} ${ROMAN[ring]}${MOON_ALPHA[m]}`,
      resources: moonResourcesForZone(rng, planet.zone),
    }));
    return {
      name: `${starName} ${ROMAN[ring]}`,
      type: planet.zone,
      resources: resourcesForZone(rng, planet.zone),
      moons,
    };
  });
}
