import {
  SCAN_GRAPH_MAX_NODES,
  SCAN_HEAT_BLOOM_SCALE,
  SCAN_HEAT_COLORS,
  SCAN_HEAT_DECOY_THRESHOLD,
  SCAN_HEAT_NOISE_AMOUNT,
  SCAN_HEAT_NOISE_DECAY,
  SCAN_HEAT_OVERLAP_SHARPEN,
  SCAN_HEAT_REACH_MAX,
  SCAN_HEAT_REACH_MIN,
} from './constants';
import { SCAN_STRENGTH_TIERS } from './scan';

export interface ScanGraphPoint {
  x: number;
  y: number;
  z: number;
}

export interface ScanGraph {
  nodes: number[];
  edges: number[];
}

export interface ScanHeatSource {
  x: number;
  y: number;
  z: number;
  radius: number;
  bloom: number;
  signals: number[];
}

export const NO_CONTACT_STRENGTH = -1;

function distanceSq(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

export function buildScanGraph(
  origin: ScanGraphPoint,
  points: readonly ScanGraphPoint[],
  maxNodes: number = SCAN_GRAPH_MAX_NODES,
): ScanGraph {
  const ordered = [...points].sort((a, b) =>
    distanceSq(a.x, a.y, a.z, origin.x, origin.y, origin.z)
    - distanceSq(b.x, b.y, b.z, origin.x, origin.y, origin.z));
  const nodes = [origin.x, origin.y, origin.z];
  const room = Math.max(1, maxNodes - 1);
  const stride = Math.max(1, ordered.length / room);
  for (let i = 0; i < room; i++) {
    const point = ordered[Math.floor(i * stride)];
    if (!point) break;
    if (distanceSq(point.x, point.y, point.z, origin.x, origin.y, origin.z) === 0) continue;
    nodes.push(point.x, point.y, point.z);
  }

  const edges: number[] = [];
  for (let i = 1; i * 3 < nodes.length; i++) {
    let nearest = 0;
    let nearestDist = Infinity;
    for (let j = 0; j < i; j++) {
      const dist = distanceSq(
        nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2],
        nodes[j * 3], nodes[j * 3 + 1], nodes[j * 3 + 2],
      );
      if (dist >= nearestDist) continue;
      nearestDist = dist;
      nearest = j;
    }
    edges.push(nearest, i);
  }
  return { nodes, edges };
}

export function heatBloom(source: ScanHeatSource): number {
  return source.bloom * SCAN_HEAT_BLOOM_SCALE;
}

// Heat is how sure the probes are that something is here, never how loud it was: a louder
// signal reaches further instead of reading hotter, so one colour means one thing.
export function signalReach(strength: number): number {
  const tier = Math.max(0, strength) / (SCAN_STRENGTH_TIERS - 1);
  return SCAN_HEAT_REACH_MIN + (SCAN_HEAT_REACH_MAX - SCAN_HEAT_REACH_MIN) * tier;
}

export function heatAt(source: ScanHeatSource, x: number, y: number, z: number): number {
  if (!(source.bloom > 0)) return 0;
  const bloom = heatBloom(source);
  let heat = 0;
  for (let i = 0; i + 3 < source.signals.length; i += 4) {
    const reach = bloom * signalReach(source.signals[i + 3]);
    const spread = distanceSq(x, y, z, source.signals[i], source.signals[i + 1], source.signals[i + 2]) / (reach * reach);
    heat = Math.max(heat, 1 / (1 + spread));
  }
  return heat;
}

export function covers(source: ScanHeatSource, x: number, y: number, z: number): boolean {
  return distanceSq(x, y, z, source.x, source.y, source.z) <= source.radius * source.radius;
}

export interface HeatReading {
  heat: number;
  coverage: number;
}

// Each sweep over a point is an independent reading of it, so overlapping sweeps multiply:
// the shared swell survives and everything either one doubts falls away, which is what makes
// re-scanning the way to narrow a contact down.
export function readHeat(sources: readonly ScanHeatSource[], x: number, y: number, z: number): HeatReading {
  let heat = 1;
  let coverage = 0;
  for (const source of sources) {
    if (!covers(source, x, y, z)) continue;
    coverage++;
    heat *= heatAt(source, x, y, z);
    if (heat <= 0) return { heat: 0, coverage };
  }
  if (coverage === 0) return { heat: 0, coverage: 0 };
  return { heat: Math.pow(heat, 1 + (coverage - 1) * SCAN_HEAT_OVERLAP_SHARPEN), coverage };
}

export function combinedHeat(sources: readonly ScanHeatSource[], x: number, y: number, z: number): number {
  return readHeat(sources, x, y, z).heat;
}

// Ambiguity is what one sweep buys; a second reading of the same volume is what spends it.
export function noiseAmount(coverage: number): number {
  return SCAN_HEAT_NOISE_AMOUNT * Math.pow(SCAN_HEAT_NOISE_DECAY, Math.max(0, coverage - 1));
}

function cellNoise(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix ^ 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ iy, 0x9e3779b1);
  h = Math.imul(h ^ iz, 0x85ebca6b);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

// The noise is smooth over a cell of the sweep's own resolution, not per node: uncorrelated
// per-node noise averages out over a long route and leaves the true gradient readable.
export function heatNoise(x: number, y: number, z: number, cell: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = fade(fx - ix);
  const ty = fade(fy - iy);
  const tz = fade(fz - iz);
  let value = 0;
  for (let cx = 0; cx < 2; cx++) {
    for (let cy = 0; cy < 2; cy++) {
      for (let cz = 0; cz < 2; cz++) {
        const weight = (cx ? tx : 1 - tx) * (cy ? ty : 1 - ty) * (cz ? tz : 1 - tz);
        value += weight * cellNoise(ix + cx, iy + cy, iz + cz);
      }
    }
  }
  return value;
}

export function heatColor(heat: number): number {
  const clamped = Math.min(1, Math.max(0, heat));
  const span = clamped * (SCAN_HEAT_COLORS.length - 1);
  const low = Math.min(SCAN_HEAT_COLORS.length - 1, Math.floor(span));
  const high = Math.min(SCAN_HEAT_COLORS.length - 1, low + 1);
  const t = span - low;
  const a = SCAN_HEAT_COLORS[low];
  const b = SCAN_HEAT_COLORS[high];
  const r = Math.round(((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t);
  const g = Math.round(((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t);
  const bl = Math.round((a & 0xff) + ((b & 0xff) - (a & 0xff)) * t);
  return (r << 16) | (g << 8) | bl;
}

// Noise only ever adds a decoy, never cools a true reading: a contact the probes actually
// heard must read hot wherever it sits, or the colour stops meaning anything.
export function decoyHeat(x: number, y: number, z: number, cell: number, coverage: number): number {
  const noise = heatNoise(x, y, z, Math.max(1, cell));
  if (noise <= SCAN_HEAT_DECOY_THRESHOLD) return 0;
  const tail = (noise - SCAN_HEAT_DECOY_THRESHOLD) / (1 - SCAN_HEAT_DECOY_THRESHOLD);
  return tail * noiseAmount(coverage);
}

export function jitteredHeat(
  sources: readonly ScanHeatSource[],
  x: number,
  y: number,
  z: number,
  cell: number,
): number {
  const { heat, coverage } = readHeat(sources, x, y, z);
  if (coverage === 0) return 0;
  const decoy = decoyHeat(x, y, z, cell, coverage);
  return 1 - (1 - heat) * (1 - decoy);
}
