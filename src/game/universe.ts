import { createRng } from './galaxyGen';
import { LANIAKEA_SEED } from './hardcoded';
import type { Rng, UniverseChunk } from './types';
import {
  UNIVERSE_ANCHOR_RADIUS,
  UNIVERSE_ANCHOR_SAMPLES,
  UNIVERSE_CHUNK_AXIS_BITS,
  UNIVERSE_CHUNK_CACHE,
  UNIVERSE_CHUNK_SPAN,
  UNIVERSE_CHUNK_TRIAL_BITS,
  UNIVERSE_CHUNK_TRIALS,
  UNIVERSE_FILAMENT_WIDTH,
  UNIVERSE_LATTICE_RADIUS,
  UNIVERSE_SCALE,
  UNIVERSE_SEED,
  UNIVERSE_SKY_STAR_COUNT,
  UNIVERSE_VOID_CELL,
  UNIVERSE_VOID_JITTER,
  UNIVERSE_WALL_WEIGHT,
  UNIVERSE_WALL_WIDTH,
} from './constants';

export interface ChunkRef {
  ci: number;
  cj: number;
  ck: number;
  key: number;
  distSq: number;
}

export interface SuperclusterLocation {
  seed: number;
  x: number;
  y: number;
  z: number;
  brightness: number;
}

const DRAWS_PER_TRIAL = 5;
const MULBERRY_STEP = 0x6d2b79f5;
const CHUNK_SALT = 0x9b05688c;
const MIX_A = 0x7feb352d;
const MIX_B = 0x846ca68b;
const MIX_A_INVERSE = oddInverse(MIX_A);
const MIX_B_INVERSE = oddInverse(MIX_B);
const AXIS_MASK = (1 << UNIVERSE_CHUNK_AXIS_BITS) - 1;
const TRIAL_MASK = UNIVERSE_CHUNK_TRIALS - 1;
const RADIUS_SQ = UNIVERSE_LATTICE_RADIUS * UNIVERSE_LATTICE_RADIUS;

const chunkCache = new Map<number, UniverseChunk>();
let anchor: { x: number; y: number; z: number } | null = null;
let sky: Float32Array | null = null;

function oddInverse(a: number): number {
  let inverse = a;
  for (let i = 0; i < 4; i++) inverse = Math.imul(inverse, 2 - Math.imul(a, inverse));
  return inverse;
}

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, MIX_A);
  h ^= h >>> 15;
  h = Math.imul(h, MIX_B);
  h ^= h >>> 16;
  return h >>> 0;
}

function unmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, MIX_B_INVERSE);
  h ^= (h >>> 15) ^ (h >>> 30);
  h = Math.imul(h, MIX_A_INVERSE);
  h ^= h >>> 16;
  return h >>> 0;
}

function cellHash(base: number, i: number, j: number, k: number): number {
  let h = base;
  h = Math.imul(h ^ i, 0x85ebca6b);
  h = Math.imul(h ^ j, 0xc2b2ae35);
  h = Math.imul(h ^ k, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

function cellOf(v: number): number {
  return Math.floor(v / UNIVERSE_VOID_CELL);
}

function isChunkInRange(ci: number, cj: number, ck: number): boolean {
  return ci >= -UNIVERSE_CHUNK_SPAN && ci < UNIVERSE_CHUNK_SPAN
    && cj >= -UNIVERSE_CHUNK_SPAN && cj < UNIVERSE_CHUNK_SPAN
    && ck >= -UNIVERSE_CHUNK_SPAN && ck < UNIVERSE_CHUNK_SPAN;
}

export function chunkKey(ci: number, cj: number, ck: number): number {
  return ((ci + UNIVERSE_CHUNK_SPAN) << (2 * UNIVERSE_CHUNK_AXIS_BITS))
    | ((cj + UNIVERSE_CHUNK_SPAN) << UNIVERSE_CHUNK_AXIS_BITS)
    | (ck + UNIVERSE_CHUNK_SPAN);
}

function chunkSeed(ci: number, cj: number, ck: number): number {
  return cellHash(UNIVERSE_SEED ^ CHUNK_SALT, ci, cj, ck);
}

export function encodeSuperclusterSeed(ci: number, cj: number, ck: number, trial: number): number {
  return (mix(((chunkKey(ci, cj, ck) << UNIVERSE_CHUNK_TRIAL_BITS) | trial) >>> 0) ^ UNIVERSE_SEED) >>> 0;
}

const centres = new Float64Array(27 * 3);
const centreCell = { i: NaN, j: NaN, k: NaN };

function cellCentres(ci: number, cj: number, ck: number): Float64Array {
  if (centreCell.i === ci && centreCell.j === cj && centreCell.k === ck) return centres;
  let o = 0;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let k = ck - 1; k <= ck + 1; k++) {
        const rng = createRng(cellHash(UNIVERSE_SEED, i, j, k));
        centres[o++] = (i + 0.5 + (rng() - 0.5) * UNIVERSE_VOID_JITTER) * UNIVERSE_VOID_CELL;
        centres[o++] = (j + 0.5 + (rng() - 0.5) * UNIVERSE_VOID_JITTER) * UNIVERSE_VOID_CELL;
        centres[o++] = (k + 0.5 + (rng() - 0.5) * UNIVERSE_VOID_JITTER) * UNIVERSE_VOID_CELL;
      }
    }
  }
  centreCell.i = ci;
  centreCell.j = cj;
  centreCell.k = ck;
  return centres;
}

const weight = { wall: 0, filament: 0 };

function foamWeight(c: Float64Array, px: number, py: number, pz: number): typeof weight {
  let d1 = Infinity, d2 = Infinity, d3 = Infinity;
  let o1 = 0, o2 = 0, o3 = 0;
  for (let o = 0; o < c.length; o += 3) {
    const dx = px - c[o];
    const dy = py - c[o + 1];
    const dz = pz - c[o + 2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < d1) {
      d3 = d2; o3 = o2;
      d2 = d1; o2 = o1;
      d1 = d; o1 = o;
    } else if (d < d2) {
      d3 = d2; o3 = o2;
      d2 = d; o2 = o;
    } else if (d < d3) {
      d3 = d; o3 = o;
    }
  }
  const wallGap = (d2 - d1) / (2 * centreDistance(c, o1, o2));
  const filamentGap = (d3 - d1) / (2 * centreDistance(c, o1, o3));
  weight.wall = kernel(wallGap / UNIVERSE_WALL_WIDTH);
  weight.filament = kernel(filamentGap / UNIVERSE_FILAMENT_WIDTH);
  return weight;
}

function centreDistance(c: Float64Array, a: number, b: number): number {
  const dx = c[a] - c[b];
  const dy = c[a + 1] - c[b + 1];
  const dz = c[a + 2] - c[b + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function kernel(t: number): number {
  const falloff = 1 - t * t / 4;
  if (falloff <= 0) return 0;
  const squared = falloff * falloff;
  return squared * squared;
}

function combinedWeight(w: typeof weight): number {
  return UNIVERSE_WALL_WEIGHT * w.wall + w.filament;
}

const ball = { x: 0, y: 0, z: 0 };

function sampleBall(rng: Rng, radius: number): typeof ball {
  let ux: number, uy: number, uz: number;
  do {
    ux = rng() * 2 - 1;
    uy = rng() * 2 - 1;
    uz = rng() * 2 - 1;
  } while (ux * ux + uy * uy + uz * uz > 1);
  ball.x = ux * radius;
  ball.y = uy * radius;
  ball.z = uz * radius;
  return ball;
}

function getAnchor(): { x: number; y: number; z: number } {
  if (anchor) return anchor;
  const rng = createRng(UNIVERSE_SEED);
  const found = { x: 0, y: 0, z: 0 };
  let best = -1;
  for (let s = 0; s < UNIVERSE_ANCHOR_SAMPLES; s++) {
    const p = sampleBall(rng, UNIVERSE_ANCHOR_RADIUS);
    const w = combinedWeight(foamWeight(cellCentres(cellOf(p.x), cellOf(p.y), cellOf(p.z)), p.x, p.y, p.z));
    if (w <= best) continue;
    best = w;
    found.x = p.x;
    found.y = p.y;
    found.z = p.z;
  }
  anchor = found;
  return found;
}

const located: SuperclusterLocation = { seed: 0, x: 0, y: 0, z: 0, brightness: 0 };

function runTrial(rng: Rng, ci: number, cj: number, ck: number, trial: number): boolean {
  const fx = (ci + rng()) * UNIVERSE_VOID_CELL;
  const fy = (cj + rng()) * UNIVERSE_VOID_CELL;
  const fz = (ck + rng()) * UNIVERSE_VOID_CELL;
  const accept = rng();
  const shade = rng();
  const origin = getAnchor();
  const ux = fx - origin.x;
  const uy = fy - origin.y;
  const uz = fz - origin.z;
  if (ux * ux + uy * uy + uz * uz > RADIUS_SQ) return false;
  const w = foamWeight(cellCentres(ci, cj, ck), fx, fy, fz);
  if (accept >= combinedWeight(w)) return false;
  const seed = encodeSuperclusterSeed(ci, cj, ck, trial);
  if (seed === LANIAKEA_SEED) return false;
  located.seed = seed;
  located.x = Math.fround(ux * UNIVERSE_SCALE);
  located.y = Math.fround(uy * UNIVERSE_SCALE);
  located.z = Math.fround(uz * UNIVERSE_SCALE);
  located.brightness = Math.fround((0.35 + 0.65 * w.filament) * (0.55 + 0.45 * shade));
  return true;
}

const EMPTY_CHUNK: UniverseChunk = {
  key: -1,
  count: 0,
  x: new Float32Array(0),
  y: new Float32Array(0),
  z: new Float32Array(0),
  brightness: new Float32Array(0),
  seeds: new Uint32Array(0),
};

const scratchX = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
const scratchY = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
const scratchZ = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
const scratchBrightness = new Float32Array(UNIVERSE_CHUNK_TRIALS + 1);
const scratchSeeds = new Uint32Array(UNIVERSE_CHUNK_TRIALS + 1);

function generateChunk(ci: number, cj: number, ck: number): UniverseChunk {
  const origin = getAnchor();
  let count = 0;
  if (cellOf(origin.x) === ci && cellOf(origin.y) === cj && cellOf(origin.z) === ck) {
    scratchX[0] = 0;
    scratchY[0] = 0;
    scratchZ[0] = 0;
    scratchBrightness[0] = 1;
    scratchSeeds[0] = LANIAKEA_SEED;
    count = 1;
  }
  const rng = createRng(chunkSeed(ci, cj, ck));
  for (let trial = 0; trial < UNIVERSE_CHUNK_TRIALS; trial++) {
    if (!runTrial(rng, ci, cj, ck, trial)) continue;
    scratchX[count] = located.x;
    scratchY[count] = located.y;
    scratchZ[count] = located.z;
    scratchBrightness[count] = located.brightness;
    scratchSeeds[count] = located.seed;
    count++;
  }
  return {
    key: chunkKey(ci, cj, ck),
    count,
    x: scratchX.slice(0, count),
    y: scratchY.slice(0, count),
    z: scratchZ.slice(0, count),
    brightness: scratchBrightness.slice(0, count),
    seeds: scratchSeeds.slice(0, count),
  };
}

export function getUniverseChunk(ci: number, cj: number, ck: number): UniverseChunk {
  if (!isChunkInRange(ci, cj, ck)) return EMPTY_CHUNK;
  const key = chunkKey(ci, cj, ck);
  const cached = chunkCache.get(key);
  if (cached) {
    chunkCache.delete(key);
    chunkCache.set(key, cached);
    return cached;
  }
  const chunk = generateChunk(ci, cj, ck);
  chunkCache.set(key, chunk);
  if (chunkCache.size > UNIVERSE_CHUNK_CACHE) chunkCache.delete(chunkCache.keys().next().value!);
  return chunk;
}

export function isUniverseChunkCached(key: number): boolean {
  return chunkCache.has(key);
}

function axisGap(v: number, cell: number): number {
  const low = cell * UNIVERSE_VOID_CELL;
  if (v < low) return low - v;
  return Math.max(0, v - low - UNIVERSE_VOID_CELL);
}

function chunkDistSq(px: number, py: number, pz: number, ci: number, cj: number, ck: number): number {
  const dx = axisGap(px, ci);
  const dy = axisGap(py, cj);
  const dz = axisGap(pz, ck);
  return dx * dx + dy * dy + dz * dz;
}

export function universeChunksNear(x: number, y: number, z: number, radius: number): ChunkRef[] {
  const origin = getAnchor();
  const fx = x / UNIVERSE_SCALE + origin.x;
  const fy = y / UNIVERSE_SCALE + origin.y;
  const fz = z / UNIVERSE_SCALE + origin.z;
  const reach = radius / UNIVERSE_SCALE;
  const reachSq = reach * reach;
  const low = (v: number) => Math.max(-UNIVERSE_CHUNK_SPAN, cellOf(v - reach));
  const high = (v: number) => Math.min(UNIVERSE_CHUNK_SPAN - 1, cellOf(v + reach));
  const refs: ChunkRef[] = [];
  for (let ci = low(fx); ci <= high(fx); ci++) {
    for (let cj = low(fy); cj <= high(fy); cj++) {
      for (let ck = low(fz); ck <= high(fz); ck++) {
        const distSq = chunkDistSq(fx, fy, fz, ci, cj, ck);
        if (distSq > reachSq) continue;
        if (chunkDistSq(origin.x, origin.y, origin.z, ci, cj, ck) > RADIUS_SQ) continue;
        refs.push({ ci, cj, ck, key: chunkKey(ci, cj, ck), distSq: distSq * UNIVERSE_SCALE * UNIVERSE_SCALE });
      }
    }
  }
  refs.sort((a, b) => a.distSq - b.distSq);
  return refs;
}

export function locateSupercluster(seed: number): SuperclusterLocation | null {
  if (seed === LANIAKEA_SEED) return { seed, x: 0, y: 0, z: 0, brightness: 1 };
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  const packed = unmix((seed ^ UNIVERSE_SEED) >>> 0);
  const trial = packed & TRIAL_MASK;
  const key = packed >>> UNIVERSE_CHUNK_TRIAL_BITS;
  const ci = (key >>> (2 * UNIVERSE_CHUNK_AXIS_BITS)) - UNIVERSE_CHUNK_SPAN;
  const cj = ((key >>> UNIVERSE_CHUNK_AXIS_BITS) & AXIS_MASK) - UNIVERSE_CHUNK_SPAN;
  const ck = (key & AXIS_MASK) - UNIVERSE_CHUNK_SPAN;
  getAnchor();
  const rng = createRng((chunkSeed(ci, cj, ck) + Math.imul(trial * DRAWS_PER_TRIAL, MULBERRY_STEP)) | 0);
  if (!runTrial(rng, ci, cj, ck, trial)) return null;
  return { ...located };
}

export function getSuperclusterCoords(seed: number): [number, number, number] {
  const location = locateSupercluster(seed);
  return location ? [location.x, location.y, location.z] : [0, 0, 0];
}

export function universeWebWeight(ux: number, uy: number, uz: number): number {
  const origin = getAnchor();
  const fx = origin.x + ux / UNIVERSE_SCALE;
  const fy = origin.y + uy / UNIVERSE_SCALE;
  const fz = origin.z + uz / UNIVERSE_SCALE;
  return combinedWeight(foamWeight(cellCentres(cellOf(fx), cellOf(fy), cellOf(fz)), fx, fy, fz));
}

export function getUniverseSky(): Float32Array {
  if (sky) return sky;
  const skyRng = createRng((UNIVERSE_SEED ^ 0xdeadbeef) >>> 0);
  const stars = new Float32Array(UNIVERSE_SKY_STAR_COUNT * 4);
  for (let i = 0; i < UNIVERSE_SKY_STAR_COUNT; i++) {
    const p = sampleBall(skyRng, 1);
    const length = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1;
    stars[i * 4] = p.x / length;
    stars[i * 4 + 1] = p.y / length;
    stars[i * 4 + 2] = p.z / length;
    stars[i * 4 + 3] = skyRng();
  }
  sky = stars;
  return stars;
}
