import { Delaunay } from 'd3-delaunay';
import type { Galaxy, StarSystem, Hyperlane, StarType, BackgroundStar, Rng } from './types';
import {
  GALAXY_RADIUS,
  BULGE_FRACTION,
  BULGE_RADIUS_FRACTION,
  BULGE_ELLIPSE,
  ARM_T_POWER,
  ARM_INNER_FRACTION,
  ARM_SPREAD,
  ARM_SPREAD_BASE,
  MAX_LANE_DIST,
  MAX_LANE_DIST_ARM,
  BACKGROUND_STAR_COUNT,
  BACKGROUND_STAR_AREA_X,
  BACKGROUND_STAR_AREA_Y,
  STAR_SIZE_MULTIPLIER,
  DISK_FRACTION,
  DISK_SIZE_SCALE,
  DISK_GAP_SCATTER,
} from './constants';
import { GalaxyConfig } from './galaxyConfig';

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
};

const STAR_SIZES: Record<StarType, [number, number]> = {
  G: [2.5, 4.0],
  K: [3.0, 4.5],
  M: [2.0, 3.5],
  F: [2.8, 4.0],
  A: [3.2, 4.8],
};

// Three populations: bulge (old, K/M heavy), disk (inter-arm, old/dim), arm (young, A/F heavy).
// Arm weights: inner end is dominated by hot blue-white stars, outer end shifts cooler but stays
// mostly A/F throughout since arms are where active star formation happens.
function pickStarType(rng: Rng, armFraction: number | null, isDisk: boolean): StarType {
  let weights: Record<StarType, number>;
  if (isDisk) {
    weights = { M: 0.48, K: 0.28, G: 0.18, F: 0.05, A: 0.01 };
  } else if (armFraction === null) {
    weights = { M: 0.50, K: 0.35, G: 0.12, F: 0.03, A: 0.00 };
  } else {
    const t = armFraction;
    weights = {
      A: lerp(0.45, 0.20, t),
      F: lerp(0.30, 0.25, t),
      G: lerp(0.12, 0.22, t),
      K: lerp(0.08, 0.20, t),
      M: lerp(0.05, 0.13, t),
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

const PREFIXES = ['Ker', 'Sol', 'Vel', 'Tor', 'Ax', 'Cet', 'Dra', 'El', 'For', 'Gav', 'Hel', 'Ix', 'Jen', 'Kor', 'Lys', 'Mal', 'Nyx', 'Ora'];
const SUFFIXES = [' Prime', ' Major', ' Minor', ' Alpha', ' Beta', ' Centauri', '', '', ''];

function makeName(rng: Rng): string {
  const prefix1 = PREFIXES[Math.floor(rng() * PREFIXES.length)];
  const prefix2 = PREFIXES[Math.floor(rng() * PREFIXES.length)];
  const suffix  = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  return `${prefix1}${prefix2.toLowerCase()}${suffix}`;
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}



export function generateGalaxy(seed = Date.now()): Galaxy {
  const rng = createRng(seed);
  const positions: [number, number][] = [];
  const armIndices: (number | null)[] = [];
  const armFractions: (number | null)[] = [];
  const isDiskStar: boolean[] = [];
  const config = new GalaxyConfig(rng);

  for (let i = 0; i < config.numStars; i++) {
    let x: number, y: number;

    if (rng() < BULGE_FRACTION) {
      const radius = Math.pow(rng(), 0.5) * GALAXY_RADIUS * BULGE_RADIUS_FRACTION;
      const angle = rng() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * BULGE_ELLIPSE;
      armIndices.push(null);
      armFractions.push(null);
      isDiskStar.push(false);
    } else if (rng() < DISK_FRACTION) {
      const t = Math.pow(rng(), ARM_T_POWER);
      const radius = lerp(GALAXY_RADIUS * ARM_INNER_FRACTION, GALAXY_RADIUS, t);
      const gap = Math.floor(rng() * config.numArms);
      const gapCenterAngle = config.baseAngleOffset + ((gap + 0.5) / config.numArms) * Math.PI * 2 + t * Math.PI * config.spiralTwist;
      const angularScatter = (DISK_GAP_SCATTER * Math.PI / config.numArms) * (rng() - 0.5) * 2;
      const angle = gapCenterAngle + angularScatter;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * config.galaxyEllipse;
      armIndices.push(null);
      armFractions.push(null);
      isDiskStar.push(true);
    } else {
      const arm = Math.floor(rng() * config.numArms);
      const armFraction = Math.pow(rng(), ARM_T_POWER);
      const radius = lerp(GALAXY_RADIUS * ARM_INNER_FRACTION, GALAXY_RADIUS, armFraction);
      const baseAngle = (arm / config.numArms) * Math.PI * 2 + config.baseAngleOffset;
      const spiralAngle = baseAngle + armFraction * Math.PI * config.spiralTwist;
      const spread = GALAXY_RADIUS * ARM_SPREAD * (ARM_SPREAD_BASE + armFraction);

      x = Math.cos(spiralAngle) * radius + (rng() - 0.5) * 2 * spread;
      y = Math.sin(spiralAngle) * radius * config.galaxyEllipse + (rng() - 0.5) * 2 * spread * config.galaxyEllipse;

      armIndices.push(arm);
      armFractions.push(armFraction);
      isDiskStar.push(false);
    }

    positions.push([x, y]);
  }

  const systems: StarSystem[] = positions.map(([x, y], id) => {
    const disk = isDiskStar[id];
    const starType = pickStarType(rng, armFractions[id], disk);
    const [minSize, maxSize] = STAR_SIZES[starType];
    const sizeScale = disk ? DISK_SIZE_SCALE : 1;
    return {
      id,
      x,
      y,
      name: makeName(rng),
      starType,
      color: STAR_COLORS[starType],
      size: lerp(minSize * STAR_SIZE_MULTIPLIER, maxSize * STAR_SIZE_MULTIPLIER, rng()) * sizeScale,
      arm: armIndices[id],
      seed: (seed ^ (id * 2654435761)) >>> 0,
    };
  });

  const delaunay = Delaunay.from(positions);
  const hyperlanes: Hyperlane[] = [];
  const visitedEdges = new Set<string>();
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const triangle = [delaunay.triangles[i], delaunay.triangles[i + 1], delaunay.triangles[i + 2]];
    const edges: [number, number][] = [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[0], triangle[2]]];

    for (const [nodeA, nodeB] of edges) {
      const edgeKey = `${Math.min(nodeA, nodeB)}-${Math.max(nodeA, nodeB)}`;
      if (visitedEdges.has(edgeKey)) continue;
      visitedEdges.add(edgeKey);

      const deltaX = positions[nodeA][0] - positions[nodeB][0];
      const deltaY = positions[nodeA][1] - positions[nodeB][1];
      const sameArm = armIndices[nodeA] !== null && armIndices[nodeA] === armIndices[nodeB];

      if (Math.hypot(deltaX, deltaY) < (sameArm ? MAX_LANE_DIST_ARM : MAX_LANE_DIST)) {
        hyperlanes.push({ from: nodeA, to: nodeB });
      }
    }
  }

  const backgroundStars: BackgroundStar[] = Array.from({ length: BACKGROUND_STAR_COUNT }, () => ({
    x: (rng() - 0.5) * BACKGROUND_STAR_AREA_X,
    y: (rng() - 0.5) * BACKGROUND_STAR_AREA_Y,
    brightness: rng(),
  }));

  return { systems, hyperlanes, backgroundStars, config, seed };
}
