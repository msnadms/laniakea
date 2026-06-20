import { createRng } from "./galaxyGen";
import type { Planet, Moon, Resource, StarType, ZoneType } from "./types";

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
  starType?: StarType;
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
const MARGINAL_ZONE_COLORS = [0xC1440E, 0xB8860B, 0xE8C47A, 0xA09070, 0x8B7355, 0xC0956C, 0x9E7B5A, 0xD4A96A];
const HABITABLE_ZONE_COLORS = [0x4682B4, 0x5F9EA0, 0x6B8E23, 0x8FBC8F, 0x87CEEB, 0xC2956C];
const GAS_GIANT_COLORS = [0xDAA520, 0xCD853F, 0xF4A460, 0xE8C878, 0xC8A060, 0xDDB060];
const ICE_GIANT_COLORS = [0x4A90C4, 0x5599CC, 0x6699BB, 0x8899BB, 0x9370DB, 0x7B68EE];
const HOT_MOON_COLORS = [0x5a3a2a, 0x6b4030, 0x7a4a35, 0x4a3020, 0x3d2a1e];
const MARGINAL_MOON_COLORS = [0x7a6050, 0x8a7060, 0x6a5040, 0x9a8070, 0x5a4535, 0x8a7855];
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
    case 'hot':      return { radiusMin: 10, radiusSpread: 13, colors: HOT_ZONE_COLORS,       moonColors: HOT_MOON_COLORS,       ringThreshold: 1.1,  moonThreshold: 0.90, maxMoons: 1 };
    case 'marginal': return { radiusMin: 18, radiusSpread: 16, colors: MARGINAL_ZONE_COLORS,  moonColors: MARGINAL_MOON_COLORS,  ringThreshold: 1.1,  moonThreshold: 0.70, maxMoons: 2 };
    case 'habitable':return { radiusMin: 24, radiusSpread: 17, colors: HABITABLE_ZONE_COLORS, moonColors: HABITABLE_MOON_COLORS, ringThreshold: 1.1,  moonThreshold: 0.60, maxMoons: 2 };
    case 'gas':      return { radiusMin: 75, radiusSpread: 50, colors: GAS_GIANT_COLORS,      moonColors: GAS_MOON_COLORS,       ringThreshold: 0.40, moonThreshold: 0.15, maxMoons: 5 };
    case 'ice':      return { radiusMin: 28, radiusSpread: 22, colors: ICE_GIANT_COLORS,      moonColors: ICE_MOON_COLORS,       ringThreshold: 0.62, moonThreshold: 0.28, maxMoons: 3 };
  }
}

export const ORBITAL_K = 3500;
export const MOON_K = 430;

export function generateSystemLayout(seed: number, starType?: StarType): SystemLayout {
  const rng = createRng(seed);
  const isBrownDwarf = starType === 'L';
  const numRings = isBrownDwarf ? Math.floor(rng() * 3) + 1 : Math.floor(rng() * 5) + 3;
  let orbitRadius = 380 + rng() * 120;

  const planets: PlanetLayout[] = [];

  for (let ring = 0; ring < numRings; ring++) {
    const rawZone = getPlanetZone(ring, numRings);
    const zone = isBrownDwarf ? 'ice' : (rawZone === 'habitable' && rng() > 0.12 ? 'marginal' : rawZone);
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
  if (planets.length >= 2 && rng() <= 0.7) {
    asteroidGapIdx = Math.floor(rng() * (planets.length - 1));
  }

  // asteroidSeed is isolated from the planet RNG so the renderer never has to
  // derive a seed transform itself, and a second renderer always gets the same belt.
  const asteroidSeed = (seed ^ 0xdeadbeef) >>> 0;

  return { planets, asteroidGapIdx, asteroidSeed, seed, starType };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const PLANET_PREFIXES = [
  'Aph', 'Ares', 'Bor', 'Cal', 'Cer', 'Chi', 'Dem', 'Dei', 'Dion', 'Eos',
  'Eur', 'Gal', 'Gan', 'Hel', 'Her', 'Hyp', 'Jov', 'Jun', 'Kron', 'Lun',
  'Mar', 'Mer', 'Mit', 'Nept', 'Not', 'Nym', 'Oph', 'Pal', 'Pan', 'Per',
  'Pho', 'Plu', 'Pyr', 'Rhe', 'Sat', 'Sel', 'Sty', 'Tar', 'Tek', 'Ter',
  'Tha', 'Thal', 'Tit', 'Tri', 'Ven', 'Ves', 'Vel', 'Ach', 'Ely', 'Ath',
];
const PLANET_SUFFIXES = [
  'us', 'a', 'e', 'is', 'on', 'ia', 'ara', 'eon', 'ius', 'ana',
  'erra', 'una', 'yne', 'one', 'ora', 'ina', 'alia', 'oria',
  'onia', 'enia', 'aria', 'ura', 'ide', 'ane', 'ite', 'yx',
  'oid', 'ath', 'eid', 'ella',
];

function makePlanetName(rng: () => number): string {
  const prefix = PLANET_PREFIXES[Math.floor(rng() * PLANET_PREFIXES.length)];
  const suffix = PLANET_SUFFIXES[Math.floor(rng() * PLANET_SUFFIXES.length)];
  return `${prefix}${suffix}`;
}

function resourcesForZone(rng: () => number, zone: ZoneType, isBrownDwarf = false): Resource[] {
  switch (zone) {
    case 'hot':      return [{ type: 'alloys', count: 2 + Math.floor(rng() * 4) }];
    case 'marginal': return [{ type: 'alloys', count: 1 + Math.floor(rng() * 3) }];
    case 'habitable': return [
      { type: 'nutrients', count: 3 + Math.floor(rng() * 5) },
      { type: 'alloys', count: 1 + Math.floor(rng() * 3) },
    ];
    case 'gas': return [
      { type: 'helium-3', count: 3 + Math.floor(rng() * 6) },
    ];
    case 'ice': return isBrownDwarf
      ? [{ type: 'exotic', count: 4 + Math.floor(rng() * 7) }]
      : [{ type: 'nutrients', count: 1 + Math.floor(rng() * 2) }];
  }
}

function moonResourcesForZone(rng: () => number, zone: ZoneType): Resource[] {
  switch (zone) {
    case 'hot':      return [{ type: 'alloys', count: 1 + Math.floor(rng() * 2) }];
    case 'marginal': return [{ type: 'alloys', count: 1 + Math.floor(rng() * 2) }];
    case 'habitable':return [{ type: 'nutrients', count: 1 + Math.floor(rng() * 2) }];
    case 'gas':      return [{ type: 'helium-3', count: 1 + Math.floor(rng() * 3) }];
    case 'ice':      return [{ type: 'nutrients', count: 1 + Math.floor(rng() * 2) }];
  }
}

export function generatePlanets(layout: SystemLayout): Planet[] {
  const isBrownDwarf = layout.starType === 'L';
  const rng = createRng(layout.seed);
  const nameRng = createRng((layout.seed ^ 0xb1a2c3d4) >>> 0);

  return layout.planets.map((planet) => {
    const planetName = makePlanetName(nameRng);
    const moons: Moon[] = planet.moons.map((_, m) => ({
      name: `${planetName} ${ROMAN[m]}`,
      resources: moonResourcesForZone(rng, planet.zone),
    }));
    return {
      name: planetName,
      type: planet.zone,
      resources: resourcesForZone(rng, planet.zone, isBrownDwarf),
      moons,
    };
  });
}
