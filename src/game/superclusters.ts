import { Delaunay } from 'd3-delaunay';
import { createRng } from './galaxyGen';
import type { SuperclusterData, SuperclusterAttractor, SuperclusterFilament, SuperclusterDot, BackgroundStar, Rng } from './types';
import {
  BACKGROUND_STAR_COUNT, BACKGROUND_STAR_AREA_X, BACKGROUND_STAR_AREA_Y,
  SC_WORLD_HALF, SC_ATTRACTOR_COUNT, SC_CLUSTER_DOTS_PER_ATTRACTOR,
  SC_CLUSTER_SIGMA, SC_FILAMENT_DOTS_PER_EDGE, SC_FILAMENT_SCATTER,
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
const GALAXY_SUFFIXES = [
  ' Galaxy', ' Spiral', ' System', ' Expanse', ' Domain',
  ' Arm', ' Drift', ' Halo', ' Nebula', ' Veil',
];

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

function makeSupercusterName(rng: Rng): string {
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

export function generateGalaxyName(seed: number): string {
  const rng = createRng(seed);
  const root   = CLUSTER_ROOTS[Math.floor(rng() * CLUSTER_ROOTS.length)];
  const ending = CLUSTER_ENDINGS[Math.floor(rng() * CLUSTER_ENDINGS.length)];
  const suffix = GALAXY_SUFFIXES[Math.floor(rng() * GALAXY_SUFFIXES.length)];
  return `${root}${ending}${suffix}`;
}

function makeClusterName(rng: Rng): string {
  const root   = CLUSTER_ROOTS[Math.floor(rng() * CLUSTER_ROOTS.length)];
  const ending = CLUSTER_ENDINGS[Math.floor(rng() * CLUSTER_ENDINGS.length)];
  const suffix = CLUSTER_SUFFIXES[Math.floor(rng() * CLUSTER_SUFFIXES.length)];
  return `${root}${ending}${suffix}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function todaySeed(): number {
  const d = new Date();
  return d.getDate() * 1_000_000 + (d.getMonth() + 1) * 10_000 + d.getFullYear();
}

export function generateSupercluster(seed: number = Date.now()): SuperclusterData {
  const rng = createRng(seed);

  const name = makeSupercusterName(rng);

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

  const dots: SuperclusterDot[] = [];
  const sigma = SC_CLUSTER_SIGMA * SC_WORLD_HALF;
  let dotIndex = 0;

  // Box-Muller transform for Gaussian distribution of galaxies in attractors
  for (const att of attractors) {
    const count = Math.round(SC_CLUSTER_DOTS_PER_ATTRACTOR * att.strength);
    for (let i = 0; i < count; i++) {
      const u1 = Math.max(rng(), 1e-10);
      const u2 = rng();

      const mag = sigma * Math.sqrt(-2 * Math.log(u1));
      const dx = mag * Math.cos(2 * Math.PI * u2);
      const dy = mag * Math.sin(2 * Math.PI * u2);

      const u3 = Math.max(rng(), 1e-10);
      const u4 = rng();
      const dz = sigma * Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);

      const radialFade = Math.exp(-mag / (sigma * 1.2));
      const brightness = (0.5 + rng() * 0.5) * radialFade;
      if (brightness < 0.02) { continue; }
      const dotSeed = (seed ^ (dotIndex++ * 2654435761)) >>> 0;
      dots.push({ x: att.x + dx, y: att.y + dy, z: att.z + dz, brightness, seed: dotSeed, name: generateGalaxyName(dotSeed), visited: false });
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

      // Quadratic Bézier position for curved filaments
      const bx = (1-t)*(1-t)*A.x + 2*(1-t)*t*cx + t*t*B.x;
      const by = (1-t)*(1-t)*A.y + 2*(1-t)*t*cy + t*t*B.y;

      // Tangent to curve (derivative) for gaussian distribution along width
      const tanX = 2*(1-t)*(cx - A.x) + 2*t*(B.x - cx);
      const tanY = 2*(1-t)*(cy - A.y) + 2*t*(B.y - cy);
      const tanLen = Math.hypot(tanX, tanY);
      const perpX = -tanY / tanLen;
      const perpY =  tanX / tanLen;
      // Box-Muller again
      const perpSigma = filamentScatterW / (centerFrac * centerFrac + 0.1);
      const u1 = Math.max(rng(), 1e-10);
      const u2 = rng();
      const rawMag = Math.sqrt(-2 * Math.log(u1));
      const scatter = perpSigma * rawMag * Math.cos(2 * Math.PI * u2);
      const zScatter = filamentScatterW * 0.5 * rawMag * Math.sin(2 * Math.PI * u2);

      const perpFade = Math.exp(-(scatter * scatter) / (5 * perpSigma * perpSigma));

      const brightness = (0.1 + rng() * 0.6) * perpFade;
      if (brightness < 0.02) { continue; }
      const dotSeed = (seed ^ (dotIndex++ * 2654435761)) >>> 0;
      dots.push({
        x: bx + perpX * scatter,
        y: by + perpY * scatter,
        z: A.z + t * (B.z - A.z) + zScatter,
        brightness,
        seed: dotSeed,
        name: generateGalaxyName(dotSeed),
        visited: false,
      });
    }
  }

  const bgRng = createRng((seed ^ 0xdeadbeef) >>> 0);
  const backgroundStars: BackgroundStar[] = [];
  for (let i = 0; i < BACKGROUND_STAR_COUNT; i++) {
    backgroundStars.push({
      x: (bgRng() - 0.5) * BACKGROUND_STAR_AREA_X,
      y: (bgRng() - 0.5) * BACKGROUND_STAR_AREA_Y,
      brightness: bgRng(),
    });
  }

  return { name, attractors, filaments, dots, backgroundStars, seed };
}
