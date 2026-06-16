import { Delaunay } from 'd3-delaunay';
import { createRng } from './galaxyGen';
import type { SuperclusterData, SuperclusterAttractor, SuperclusterFilament, SuperclusterDot, BackgroundStar, Rng } from './types';
import { BACKGROUND_STAR_COUNT, BACKGROUND_STAR_AREA_X, BACKGROUND_STAR_AREA_Y } from './constants';

const CLUSTER_ROOTS = ['Vel', 'Kor', 'Dra', 'Lyx', 'Aur', 'Per', 'Cen', 'Vir', 'Com', 'For', 'Boo', 'Sag', 'Pav', 'Hydr', 'Phe'];
const CLUSTER_ENDINGS = ['ara', 'eth', 'um', 'ius', 'is', 'ax', 'on', 'el', 'an', 'or'];
const CLUSTER_SUFFIXES = [' Cluster', ' Wall', ' Void', ' Nexus', ' Complex', ' Cloud'];
const SUPERCLUSTER_SUFFIXES = [' Supercluster', ' Filament', ' Sheet', ' Wall', ' Complex', ' Web'];

function makeClusterName(rng: Rng): string {
  const root   = CLUSTER_ROOTS[Math.floor(rng() * CLUSTER_ROOTS.length)];
  const ending = CLUSTER_ENDINGS[Math.floor(rng() * CLUSTER_ENDINGS.length)];
  const suffix = CLUSTER_SUFFIXES[Math.floor(rng() * CLUSTER_SUFFIXES.length)];
  return `${root}${ending}${suffix}`;
}

// Half-width/height of the attractor placement area in world-space units.
const WORLD_HALF = 1200;
// How many galaxy-cluster "attractors" (dense nodes) to place in the supercluster.
const ATTRACTOR_COUNT = 8;
// Base number of galaxy dots placed in the Gaussian cluster around each attractor.
// Scaled by the attractor's strength, so stronger attractors get more dots.
const CLUSTER_DOTS_PER_ATTRACTOR = 1200;
// Standard deviation of the cluster Gaussian as a fraction of WORLD_HALF.
// 0.10 × 1200 = 120 world units.
const CLUSTER_SIGMA = 0.16;
// Number of galaxy dots placed along each filament curve.
const FILAMENT_DOTS_PER_EDGE = 250;
// Base scatter width for filament dots as a fraction of WORLD_HALF.
// Controls how thin the thread is at its narrowest point.
const FILAMENT_SCATTER = 0.025;

export function generateSupercluster(seed: number = Date.now()): SuperclusterData {
  const rng = createRng(seed);

  const scRoot   = CLUSTER_ROOTS[Math.floor(rng() * CLUSTER_ROOTS.length)];
  const scEnding = CLUSTER_ENDINGS[Math.floor(rng() * CLUSTER_ENDINGS.length)];
  const scSuffix = SUPERCLUSTER_SUFFIXES[Math.floor(rng() * SUPERCLUSTER_SUFFIXES.length)];
  const name = `${scRoot}${scEnding}${scSuffix}`;

  const attractors: SuperclusterAttractor[] = [];
  for (let i = 0; i < ATTRACTOR_COUNT; i++) {
    let bestX = 0, bestY = 0, bestDist = -1;
    const candidates = i === 0 ? 1 : 12;

    for (let attempt = 0; attempt < candidates; attempt++) {
      const cx = (rng() * 2 - 1) * WORLD_HALF;
      const cy = (rng() * 2 - 1) * WORLD_HALF;
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

    attractors.push({ x: bestX, y: bestY, strength: 0.5 + rng() * 0.5, name: makeClusterName(rng) });
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
  const sigma = CLUSTER_SIGMA * WORLD_HALF;
  let dotIndex = 0;

  // Box-Muller transform for Gaussian distribution of galaxies in attractors
  for (const att of attractors) {
    const count = Math.round(CLUSTER_DOTS_PER_ATTRACTOR * att.strength);
    for (let i = 0; i < count; i++) {
      const u1 = Math.max(rng(), 1e-10);
      const u2 = rng();

      const mag = sigma * Math.sqrt(-2 * Math.log(u1));
      const dx = mag * Math.cos(2 * Math.PI * u2);
      const dy = mag * Math.sin(2 * Math.PI * u2);

      const radialFade = Math.exp(-mag / (sigma * 1.2));
      const brightness = (0.5 + rng() * 0.5) * radialFade;
      if (brightness < 0.02) { continue; }
      dots.push({ x: att.x + dx, y: att.y + dy, brightness, seed: (seed ^ (dotIndex++ * 2654435761)) >>> 0 });
    }
  }

  const filamentScatterW = FILAMENT_SCATTER * WORLD_HALF;

  for (const fil of filaments) {
    const A = attractors[fil.from];
    const B = attractors[fil.to];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy);

    const curvature = (rng() - 0.5) * 2 * len;
    const cx = (A.x + B.x) / 2 + (-dy / len) * curvature;
    const cy = (A.y + B.y) / 2 + ( dx / len) * curvature;

    for (let i = 0; i < FILAMENT_DOTS_PER_EDGE; i++) {
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
      const scatter = perpSigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

      const perpFade = Math.exp(-(scatter * scatter) / (5 * perpSigma * perpSigma));

      const brightness = (0.1 + rng() * 0.6) * perpFade;
      if (brightness < 0.02) { continue; }
      dots.push({
        x: bx + perpX * scatter,
        y: by + perpY * scatter,
        brightness,
        seed: (seed ^ (dotIndex++ * 2654435761)) >>> 0,
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
