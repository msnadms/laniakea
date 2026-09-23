import { Delaunay } from 'd3-delaunay';
import { createRng } from './galaxyGen';
import { LANIAKEA_SEED, LANIAKEA_NAME, MILKY_WAY_SEED, MILKY_WAY_NAME, LANIAKEA_ATTRACTOR_NAMES, MW_DOT_OFFSET } from './hardcoded';
import { pickType } from './galaxyConfig';
import type { SuperclusterData, SuperclusterAttractor, SuperclusterFilament, SuperclusterDot, BackgroundStar, Rng, AddressComponent, AddressComponentType, GalaxyType } from './types';
import { buildAddressComponent } from './types';
import {
  BACKGROUND_STAR_COUNT, BACKGROUND_STAR_AREA_X, BACKGROUND_STAR_AREA_Y,
  SC_WORLD_HALF, SC_ATTRACTOR_COUNT, SC_CLUSTER_DOTS_PER_ATTRACTOR,
  SC_CLUSTER_SIGMA, SC_FILAMENT_DOTS_PER_EDGE, SC_FILAMENT_SCATTER,
  SC_ATTRACTOR_LABEL_MAX_DIST, SC_DOT_SEED_MIX,
} from './constants';

const CLUSTER_ROOTS = [
  'Vel', 'Kor', 'Dra', 'Lyx', 'Aur', 'Per', 'Cen', 'Vir', 'Com', 'For',
  'Boo', 'Sag', 'Pav', 'Hydr', 'Phe', 'Oph', 'Tal', 'Rel', 'Nyx', 'Sar',
  'Eld', 'Vor', 'Kyth', 'Mal', 'Ren', 'Set', 'Ul', 'Wyr', 'Zan', 'Bel',
  'Cas', 'Del', 'Esh', 'Fal', 'Gyr', 'Hal', 'Ist', 'Jon', 'Kal', 'Lon',
];
const CLUSTER_ENDINGS = ['ara', 'eth', 'um', 'ius', 'is', 'ax', 'on', 'el', 'an', 'or', 'yn', 'id', 'ath', 'esh', 'ix', 'oc', 'ur', 'al'];
const CLUSTER_SUFFIXES = [
  ' Cluster', ' Wall', ' Void', ' Nexus', ' Complex', ' Cloud',
  ' Group', ' Chain', ' Reach', ' Expanse', ' Drift', ' Basin',
];
const GALAXY_SUFFIXES: Record<GalaxyType, string[]> = {
  spiral: [
    ' Galaxy', ' Spiral', ' Whirl', ' Pinwheel', ' Vortex',
    ' Arm', ' Cascade', ' Veil', ' Expanse', ' Domain',
  ],
  barred: [
    ' Galaxy', ' Barred Spiral', ' Bar', ' Spindle', ' Axis',
    ' Crossbar', ' Whirl', ' Beam', ' Expanse', ' Domain',
  ],
  elliptical: [
    ' Galaxy', ' Ellipse', ' Ellipsoid', ' Sphere', ' Halo',
    ' Ember', ' Mound', ' Bastion', ' Expanse', ' Domain',
  ],
  irregular: [
    ' Galaxy', ' Cloud', ' Wisp', ' Fragment', ' Scatter',
    ' Tangle', ' Remnant', ' Shard', ' Drift', ' Sprawl',
  ],
};

const SC_NAME_ROOTS = [
  'Virgo', 'Coma', 'Perseus', 'Pisces', 'Hydra', 'Centaurus', 'Boötes',
  'Hercules', 'Fornax', 'Sculptor', 'Leo', 'Aquarius', 'Pavo', 'Ophiuchus',
  'Eridanus', 'Phoenix', 'Libra', 'Cetus', 'Columba', 'Vela', 'Norma',
  'Ara', 'Lupus', 'Corona', 'Caelum', 'Horologium', 'Microscopium',
  'Telescopium', 'Tucana', 'Crater', 'Corvus', 'Capricornus', 'Lepus',
  'Draco', 'Ursa', 'Cygnus', 'Lyra', 'Orion', 'Taurus', 'Gemini',
  'Cancer', 'Scorpius', 'Sagittarius', 'Aquila', 'Cassiopeia', 'Andromeda',
  'Triangulum', 'Auriga', 'Puppis', 'Pictor', 'Dorado', 'Reticulum',
  'Volans', 'Musca', 'Circinus', 'Apus', 'Octans', 'Mensa', 'Chamaeleon',
];
const SC_NAME_SUFFIXES = [
  ' Supercluster', ' Supercluster', ' Supercluster Complex',
  ' Great Wall', ' Wall', ' Filament', ' Sheet', ' Attractor Region',
  ' Void', ' Basin', ' Overdensity', ' Bridge', ' Strand',
];

function makeSuperclusterName(rng: Rng): string {
  const primaryIdx = Math.floor(rng() * SC_NAME_ROOTS.length);
  const primary = SC_NAME_ROOTS[primaryIdx];
  const isCompound = rng() < 0.35;
  let base = primary;
  if (isCompound) {
    const secondaryRaw = Math.floor(rng() * (SC_NAME_ROOTS.length - 1));
    const secondary = SC_NAME_ROOTS[secondaryRaw >= primaryIdx ? secondaryRaw + 1 : secondaryRaw];
    base = `${primary}-${secondary}`;
  }
  const suffix = SC_NAME_SUFFIXES[Math.floor(rng() * SC_NAME_SUFFIXES.length)];
  return `${base}${suffix}`;
}

export function pushAttractorAddress(
  attractors: SuperclusterAttractor[],
  dotX: number,
  dotY: number,
  pushAddress: (a: AddressComponent) => void,
  removeAddressType: (t: AddressComponentType) => void,
): void {
  let nearest = attractors[0];
  let nearestDist = Infinity;
  for (const att of attractors) {
    const d = Math.hypot(dotX - att.x, dotY - att.y);
    if (d < nearestDist) { nearestDist = d; nearest = att; }
  }
  if (nearest && nearestDist <= SC_ATTRACTOR_LABEL_MAX_DIST) {
    pushAddress(buildAddressComponent(nearest.name, nearest.x, nearest.y, nearest.z, 'attractor'));
  } else {
    removeAddressType('attractor');
  }
}

export function generateSuperclusterName(seed: number): string {
  if (seed === LANIAKEA_SEED) return LANIAKEA_NAME;
  return makeSuperclusterName(createRng(seed));
}

export function getGalaxyType(seed: number): GalaxyType {
  return pickType(createRng(seed));
}

export function generateGalaxyName(seed: number): string {
  if (seed === MILKY_WAY_SEED) return MILKY_WAY_NAME;
  const suffixes = GALAXY_SUFFIXES[getGalaxyType(seed)];
  const rng = createRng((seed ^ 0x27d4eb2f) >>> 0);
  const root   = CLUSTER_ROOTS[Math.floor(rng() * CLUSTER_ROOTS.length)];
  const ending = CLUSTER_ENDINGS[Math.floor(rng() * CLUSTER_ENDINGS.length)];
  const suffix = suffixes[Math.floor(rng() * suffixes.length)];
  return `${root}${ending}${suffix}`;
}

function makeClusterName(rng: Rng): string {
  const root   = CLUSTER_ROOTS[Math.floor(rng() * CLUSTER_ROOTS.length)];
  const ending = CLUSTER_ENDINGS[Math.floor(rng() * CLUSTER_ENDINGS.length)];
  const suffix = CLUSTER_SUFFIXES[Math.floor(rng() * CLUSTER_SUFFIXES.length)];
  return `${root}${ending}${suffix}`;
}

// function todaySeed(): number {
//   const d = new Date();
//   return d.getDate() * 1_000_000 + (d.getMonth() + 1) * 10_000 + d.getFullYear();
// }

export function generateSupercluster(seed: number): SuperclusterData {
  return buildSupercluster(seed, true);
}

export function generateSuperclusterGalaxySeeds(seed: number): number[] {
  return [...superclusterGalaxySeeds(seed)];
}

export function superclusterGalaxySeedAt(seed: number, index: number): number {
  return (seed ^ Math.imul(index, SC_DOT_SEED_MIX)) >>> 0;
}

export function* superclusterGalaxySeeds(seed: number): Generator<number> {
  for (const dot of streamDots(seed, buildSkeleton(seed), false, true)) yield dot.seed;
}

interface SuperclusterSkeleton {
  rng: Rng;
  name: string;
  attractors: SuperclusterAttractor[];
  filaments: SuperclusterFilament[];
}

function buildSkeleton(seed: number): SuperclusterSkeleton {
  const rng = createRng(seed);

  const name = makeSuperclusterName(rng);

  const attractors: SuperclusterAttractor[] = [];
  for (let i = 0; i < SC_ATTRACTOR_COUNT; i++) {
    let bestX = 0, bestY = 0, bestDist = -1;
    const candidates = i === 0 ? 1 : 12;

    for (let attempt = 0; attempt < candidates; attempt++) {
      const cx = (rng() * 2 - 1) * SC_WORLD_HALF;
      const cy = (rng() * 2 - 1) * SC_WORLD_HALF;
      let minDist = Infinity;
      for (const a of attractors) {
        const d = Math.hypot(cx - a.x, cy - a.y);
        if (d < minDist) minDist = d;
      }
      if (attractors.length === 0) minDist = Infinity;
      if (minDist > bestDist) {
        bestDist = minDist;
        bestX = cx;
        bestY = cy;
      }
    }

    const z = (rng() * 2 - 1) * SC_WORLD_HALF;
    attractors.push({ x: bestX, y: bestY, z, strength: 0.5 + rng() * 0.5, name: makeClusterName(rng) });
  }

  const positions: [number, number][] = attractors.map(a => [a.x, a.y]);
  const delaunay = Delaunay.from(positions);

  const filaments: SuperclusterFilament[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const a = delaunay.triangles[i];
    const b = delaunay.triangles[i + 1];
    const c = delaunay.triangles[i + 2];
    for (const [u, v] of [[a, b], [b, c], [a, c]] as [number, number][]) {
      const key = `${Math.min(u, v)}-${Math.max(u, v)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filaments.push({ from: u, to: v });
    }
  }

  return { rng, name, attractors, filaments };
}

// A scan walks tens of thousands of dots per supercluster only to read their seeds, so it skips
// the position maths and reuses one dot; the draws it makes stay identical either way.
function* streamDots(seed: number, skeleton: SuperclusterSkeleton, named: boolean, seedsOnly = false): Generator<SuperclusterDot> {
  const { rng, attractors, filaments } = skeleton;

  const sigma = SC_CLUSTER_SIGMA * SC_WORLD_HALF;
  let dotIndex = 0;
  const scratch: SuperclusterDot = { x: 0, y: 0, z: 0, brightness: 0, seed: 0, name: '', visited: false, current: false };
  const emit = (x: number, y: number, z: number, brightness: number, dotSeed: number): SuperclusterDot => {
    if (seedsOnly) {
      scratch.seed = dotSeed;
      return scratch;
    }
    return { x, y, z, brightness, seed: dotSeed, name: named ? generateGalaxyName(dotSeed) : '', visited: false, current: false };
  };

  // Box-Muller transform for Gaussian distribution of galaxies in attractors
  for (const att of attractors) {
    const count = Math.round(SC_CLUSTER_DOTS_PER_ATTRACTOR * att.strength);
    for (let i = 0; i < count; i++) {
      const u1 = Math.max(rng(), 1e-10);
      const u2 = rng();

      const mag = sigma * Math.sqrt(-2 * Math.log(u1));

      const u3 = Math.max(rng(), 1e-10);
      const u4 = rng();

      const radialFade = Math.exp(-mag / (sigma * 1.2));
      const brightness = (0.5 + rng() * 0.5) * radialFade;
      if (brightness < 0.02) { continue; }
      const dotSeed = superclusterGalaxySeedAt(seed, dotIndex++);
      if (seedsOnly) { yield emit(0, 0, 0, brightness, dotSeed); continue; }
      const dx = mag * Math.cos(2 * Math.PI * u2);
      const dy = mag * Math.sin(2 * Math.PI * u2);
      const dz = sigma * Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);
      yield emit(att.x + dx, att.y + dy, att.z + dz, brightness, dotSeed);
    }
  }

  const filamentScatterW = SC_FILAMENT_SCATTER * SC_WORLD_HALF;

  for (const fil of filaments) {
    const A = attractors[fil.from];
    const B = attractors[fil.to];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy);

    const curvature = (rng() - 0.5) * 1.2 * len;
    const cx = (A.x + B.x) / 2 + (-dy / len) * curvature;
    const cy = (A.y + B.y) / 2 + ( dx / len) * curvature;

    for (let i = 0; i < SC_FILAMENT_DOTS_PER_EDGE; i++) {
      const t = rng();
      const centerFrac = Math.sin(t * Math.PI) - 0.25;

      // Box-Muller again
      const perpSigma = filamentScatterW / (centerFrac * centerFrac + 0.1);
      const u1 = Math.max(rng(), 1e-10);
      const u2 = rng();
      const rawMag = Math.sqrt(-2 * Math.log(u1));
      const scatter = perpSigma * rawMag * Math.cos(2 * Math.PI * u2);

      const perpFade = Math.exp(-(scatter * scatter) / (5 * perpSigma * perpSigma));

      const brightness = (0.1 + rng() * 0.6) * perpFade;
      if (brightness < 0.02) { continue; }
      const dotSeed = superclusterGalaxySeedAt(seed, dotIndex++);
      if (seedsOnly) { yield emit(0, 0, 0, brightness, dotSeed); continue; }

      // Quadratic Bézier position for curved filaments
      const bx = (1-t)*(1-t)*A.x + 2*(1-t)*t*cx + t*t*B.x;
      const by = (1-t)*(1-t)*A.y + 2*(1-t)*t*cy + t*t*B.y;

      // Tangent to curve (derivative) for gaussian distribution along width
      const tanX = 2*(1-t)*(cx - A.x) + 2*t*(B.x - cx);
      const tanY = 2*(1-t)*(cy - A.y) + 2*t*(B.y - cy);
      const tanLen = Math.hypot(tanX, tanY);
      const perpX = -tanY / tanLen;
      const perpY =  tanX / tanLen;
      const zScatter = filamentScatterW * 0.5 * rawMag * Math.sin(2 * Math.PI * u2);

      yield emit(
        bx + perpX * scatter,
        by + perpY * scatter,
        A.z + t * (B.z - A.z) + zScatter,
        brightness,
        dotSeed,
      );
    }
  }

  if (seed === LANIAKEA_SEED) {
    const milkyWay = emit(
      attractors[0].x + MW_DOT_OFFSET[0],
      attractors[0].y + MW_DOT_OFFSET[1],
      attractors[0].z,
      0.9,
      MILKY_WAY_SEED,
    );
    milkyWay.name = MILKY_WAY_NAME;
    yield milkyWay;
  }
}

function buildSupercluster(seed: number, named: boolean): SuperclusterData {
  const skeleton = buildSkeleton(seed);
  const { attractors, filaments } = skeleton;
  let name = skeleton.name;
  const dots = [...streamDots(seed, skeleton, named)];

  const bgRng = createRng((seed ^ 0xdeadbeef) >>> 0);
  const backgroundStars: BackgroundStar[] = [];
  for (let i = 0; i < BACKGROUND_STAR_COUNT; i++) {
    backgroundStars.push({
      x: (bgRng() - 0.5) * BACKGROUND_STAR_AREA_X,
      y: (bgRng() - 0.5) * BACKGROUND_STAR_AREA_Y,
      brightness: bgRng(),
    });
  }

  if (seed === LANIAKEA_SEED) {
    name = LANIAKEA_NAME;
    for (let i = 0; i < Math.min(attractors.length, LANIAKEA_ATTRACTOR_NAMES.length); i++) {
      attractors[i].name = LANIAKEA_ATTRACTOR_NAMES[i];
    }
  }

  return { name, attractors, filaments, dots, backgroundStars, seed };
}
