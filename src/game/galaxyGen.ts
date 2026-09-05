import type { Galaxy, StarSystem, StarType, StarPopulation, BackgroundStar, Rng } from './types';
import { MILKY_WAY_SEED, NEARBY_SYSTEMS_DATA, MILKY_WAY_NEBULA_COLOR_INDEX, MILKY_WAY_INNER_NEBULA_COLOR_INDEX } from './hardcoded';
import {
  BACKGROUND_STAR_COUNT,
  BACKGROUND_STAR_AREA_X,
  BACKGROUND_STAR_AREA_Y,
  STAR_SIZE_MULTIPLIER,
  DISK_SIZE_SCALE,
  NUM_BROWN_DWARFS,
  NEBULA_COLORS,
  INNER_NEBULA_COLORS,
  GALAXY_RADIUS,
  BULGE_RADIUS_FRACTION,
  POPULATION_SCALE_HEIGHT,
  SPHEROID_FLOOR,
} from './constants';
import { GalaxyConfig, type GalaxyOverrides } from './galaxyConfig';
import { sampleStar, edgeStar } from './galaxyShapes';

// Fast seedable PRNG (mulberry32). Returns a function that produces [0, 1) floats.
export function createRng(seed: number): Rng {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let hash = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    hash = (hash + Math.imul(hash ^ (hash >>> 7), 61 | hash)) ^ hash;
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_COLORS: Record<StarType, number> = {
  G: 0xffe27a,
  K: 0xddaa77,
  M: 0xcc9999,
  F: 0xfff5dd,
  A: 0xc8e0ff,
  L: 0x7a3018,
  N: 0xaae8ff,
};

const STAR_SIZES: Record<StarType, [number, number]> = {
  G: [2.5, 4.0],
  K: [3.0, 4.5],
  M: [2.0, 3.5],
  F: [2.8, 4.0],
  A: [3.2, 4.8],
  L: [1.0, 1.8],
  N: [0.5, 0.9],
};

// Bulge (old, K/M heavy), disk (inter-arm, old/dim), arm (young, A/F heavy), bar (older than the
// arms it feeds), halo (elliptical galaxies: no ongoing star formation, the reddest population),
// starburst (irregular clumps: violent star formation, the bluest).
// Arm weights: inner end is dominated by hot blue-white stars, outer end shifts cooler but stays
// mostly A/F throughout since arms are where active star formation happens.
function pickStarType(rng: Rng, population: StarPopulation, armFraction: number | null): StarType {
  let weights: Record<StarType, number>;
  if (population === 'disk') {
    weights = { M: 0.48, K: 0.28, G: 0.18, F: 0.05, A: 0.01, L: 0, N: 0 };
  } else if (population === 'bulge') {
    weights = { M: 0.50, K: 0.35, G: 0.12, F: 0.03, A: 0.00, L: 0, N: 0 };
  } else if (population === 'halo') {
    weights = { M: 0.58, K: 0.32, G: 0.08, F: 0.02, A: 0.00, L: 0, N: 0 };
  } else if (population === 'bar') {
    weights = { M: 0.30, K: 0.34, G: 0.24, F: 0.10, A: 0.02, L: 0, N: 0 };
  } else {
    const t = armFraction ?? 0;
    const hot = population === 'starburst' ? 0.6 : 0.45;
    weights = {
      A: lerp(hot, 0.20, t),
      F: lerp(0.30, 0.25, t),
      G: lerp(0.12, 0.22, t),
      K: lerp(0.08, 0.20, t),
      M: lerp(0.05, 0.13, t),
      L: 0,
      N: 0,
    };
  }
  const total = (Object.values(weights) as number[]).reduce((a, b) => a + b, 0);
  const roll = rng() * total;
  let cumulative = 0;
  for (const [type, weight] of Object.entries(weights) as [StarType, number][]) {
    cumulative += weight;
    if (roll < cumulative) return type;
  }
  return 'M';
}

const STAR_PREFIXES = [
  'Ker', 'Sol', 'Vel', 'Tor', 'Ax', 'Cet', 'Dra', 'El', 'For', 'Gav',
  'Hel', 'Ix', 'Jen', 'Kor', 'Lys', 'Mal', 'Nyx', 'Ora', 'Pyr', 'Que',
  'Ral', 'Set', 'Thal', 'Ul', 'Vex', 'Wyr', 'Xen', 'Yl', 'Zan', 'Bel',
  'Cas', 'Del', 'Esh', 'Fal', 'Gyr', 'Hal', 'Ist', 'Jon', 'Kal', 'Lon',
  'Mir', 'Nar', 'Oph', 'Pol', 'Ren', 'Sar', 'Tel', 'Uri', 'Val', 'Wen',
  'Aer', 'Bor', 'Cor', 'Dur', 'Eld', 'Fyr', 'Gor', 'Hyp', 'Ith', 'Jor',
  'Kael', 'Leth', 'Mor', 'Neth', 'Oss', 'Phen', 'Rael', 'Sev', 'Tryn', 'Usk',
  'Vael', 'Weth', 'Xar', 'Yel', 'Zeph', 'Arn', 'Cyth', 'Dun', 'Eth', 'Gryn',
];
const STAR_SUFFIXES = [
  'ath', 'eth', 'on', 'is', 'ara', 'iel', 'oth', 'an', 'or', 'yn',
  'ael', 'aris', 'eon', 'ora', 'ax', 'esh', 'ul', 'ith', 'urd', 'elis',
  'anis', 'onix', 'edra', 'oros', 'alin', 'ethi', 'ovan', 'idus', 'elys', 'athis',
  'aros', 'elin', 'odra', 'uxis', 'evon', 'alis', 'othi', 'uran', 'idon', 'elas',
];
const STAR_DESCRIPTORS = [
  ' Prime', ' Major', ' Minor', ' Alpha', ' Beta', ' Gamma', ' Delta',
  ' Centauri', ' Proxima', ' Ultima', ' Nova', ' Vega', ' Eridani',
  ' Cygni', ' Leonis', ' Draconis', ' Orionis', ' Tauri', ' Persei',
  ' Aquilae', ' Lyrae', ' Carinae', ' Lupi', ' Scorpii',
  '', '', '', '', '', '', '',
];

function makeName(rng: Rng): string {
  const prefix     = STAR_PREFIXES[Math.floor(rng() * STAR_PREFIXES.length)];
  const suffix     = STAR_SUFFIXES[Math.floor(rng() * STAR_SUFFIXES.length)];
  const descriptor = STAR_DESCRIPTORS[Math.floor(rng() * STAR_DESCRIPTORS.length)];
  return `${prefix}${suffix}${descriptor}`;
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function spheroidFactor(planeRadius: number, extent: number) {
  const t = Math.min(1, planeRadius / extent);
  return lerp(SPHEROID_FLOOR, 1, Math.sqrt(1 - t * t));
}

function sampleHeight(rng: Rng, population: StarPopulation, planeRadius: number): number {
  let scaleHeight = POPULATION_SCALE_HEIGHT[population] * GALAXY_RADIUS;
  if (population === 'bulge') scaleHeight *= spheroidFactor(planeRadius, GALAXY_RADIUS * BULGE_RADIUS_FRACTION);
  else if (population === 'halo') scaleHeight *= spheroidFactor(planeRadius, GALAXY_RADIUS);
  return (rng() + rng() - 1) * scaleHeight;
}



export function generateGalaxy(seed = Date.now(), overrides?: GalaxyOverrides): Galaxy {
  const rng = createRng(seed);
  const positions: [number, number][] = [];
  const armIndices: (number | null)[] = [];
  const armFractions: (number | null)[] = [];
  const populations: StarPopulation[] = [];
  const isBrownDwarf: boolean[] = [];
  const isNeutronStar: boolean[] = [];
  const config = new GalaxyConfig(rng, overrides);

  for (let i = 0; i < config.numStars; i++) {
    const star = sampleStar(rng, config);
    positions.push([star.x, star.y]);
    armIndices.push(star.arm);
    armFractions.push(star.armFraction);
    populations.push(star.population);
    isBrownDwarf.push(false);
    isNeutronStar.push(false);
  }

  // Rare brown dwarfs scattered at the galactic edge (beyond 82% of GALAXY_RADIUS).
  for (let i = 0; i < NUM_BROWN_DWARFS; i++) {
    positions.push(edgeStar(rng, config));
    armIndices.push(null);
    armFractions.push(null);
    populations.push('halo');
    isBrownDwarf.push(true);
    isNeutronStar.push(false);
  }

  // Second pass: mark very rare neutron stars using an isolated RNG so the
  // primary sequence (and all star positions) are completely unaffected.
  const nsRng = createRng((seed ^ 0x4e5a6b7c) >>> 0);
  for (let id = 0; id < positions.length; id++) {
    if (populations[id] !== 'disk' && !isBrownDwarf[id] && nsRng() < 0.005) {
      isNeutronStar[id] = true;
    }
  }

  // Heights come from their own RNG so the primary sequence, and therefore every
  // existing galaxy's stars, are untouched.
  const heightRng = createRng((seed ^ 0x1b873593) >>> 0);

  const systems: StarSystem[] = positions.map(([x, y], id) => {
    const rawType = isBrownDwarf[id] ? 'L' : pickStarType(rng, populations[id], armFractions[id]);
    const starType = isNeutronStar[id] ? 'N' : rawType;
    const [minSize, maxSize] = STAR_SIZES[starType];
    const sizeScale = populations[id] === 'disk' ? DISK_SIZE_SCALE : 1;
    return {
      id,
      x,
      y,
      z: sampleHeight(heightRng, populations[id], Math.hypot(x, y)),
      name: makeName(rng),
      starType,
      color: STAR_COLORS[starType],
      size: lerp(minSize * STAR_SIZE_MULTIPLIER, maxSize * STAR_SIZE_MULTIPLIER, rng()) * sizeScale,
      arm: armIndices[id],
      seed: (seed ^ (id * 2654435761)) >>> 0,
      visited: false,
      current: false,
    };
  });

  const backgroundStars: BackgroundStar[] = Array.from({ length: BACKGROUND_STAR_COUNT }, () => ({
    x: (rng() - 0.5) * BACKGROUND_STAR_AREA_X,
    y: (rng() - 0.5) * BACKGROUND_STAR_AREA_Y,
    brightness: rng(),
  }));

  if (seed === MILKY_WAY_SEED) {
    config.nebulaColors = NEBULA_COLORS[MILKY_WAY_NEBULA_COLOR_INDEX];
    config.innerNebulaColors = INNER_NEBULA_COLORS[MILKY_WAY_INNER_NEBULA_COLOR_INDEX];
    for (const s of NEARBY_SYSTEMS_DATA) {
      systems[s.id] = {
        ...s,
        z: systems[s.id].z,
        seed: (seed ^ (s.id * 2654435761)) >>> 0,
        visited: false,
        current: false,
      };
    }
  }

  return { systems, backgroundStars, config, seed };
}
