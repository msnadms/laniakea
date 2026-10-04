import type { BaseAddress } from './base';
import {
  BASE_SURFACE_COLS,
  BASE_SURFACE_HOTSPOTS_MAX,
  BASE_SURFACE_LAKE_MAX_FRACTION,
  BASE_SURFACE_LAKE_MIN_DEPTH,
  BASE_SURFACE_LAKE_MIN_MOISTURE,
  BASE_SURFACE_OCEAN_MAX,
  BASE_SURFACE_OCEAN_MIN,
  BASE_SURFACE_PLATES_MAX,
  BASE_SURFACE_PLATES_MIN,
  BASE_SURFACE_RIDGE_FRACTION,
  BASE_SURFACE_ROWS,
} from './constants';
import { createRng } from './galaxyGen';
import type { Rng } from './types';

export type BlockerKind = 'ocean' | 'ridge' | 'lake';

export interface SurfaceCell {
  col: number;
  row: number;
}

export interface SurfaceBlocker extends SurfaceCell {
  kind: BlockerKind;
}

export interface SurfaceWorld {
  elevation: Float32Array;
  moisture: Float32Array;
  flow: Float32Array;
  downstream: Int32Array;
  blockers: SurfaceBlocker[];
}

interface Plate {
  x: number;
  y: number;
  vx: number;
  vy: number;
  growth: number;
  continental: boolean;
}

const COLS = BASE_SURFACE_COLS;
const ROWS = BASE_SURFACE_ROWS;
const CELLS = COLS * ROWS;
const DIAGONAL = 1.4142135623730951;
const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, DIAGONAL], [1, -1, DIAGONAL], [-1, 1, DIAGONAL], [-1, -1, DIAGONAL],
];

export function surfaceSeed({ superclusterSeed, galaxySeed, systemId, ring }: BaseAddress): number {
  let hash = Math.imul(superclusterSeed ^ 0x5f3759df, 0x9e3779b1);
  hash = Math.imul(hash ^ galaxySeed ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ systemId ^ (hash >>> 13), 0xc2b2ae35);
  hash = Math.imul(hash ^ ring ^ (hash >>> 16), 0x27d4eb2f);
  return (hash ^ (hash >>> 15)) >>> 0;
}

export function cellIndex({ col, row }: SurfaceCell): number {
  return row * COLS + col;
}

function between(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function smooth(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function kernel(distance: number, width: number): number {
  const t = distance / width;
  if (t <= -1 || t >= 1) return 0;
  const falloff = 1 - t * t;
  return falloff * falloff;
}

function valueNoise(rng: Rng, spacing: number): (col: number, row: number) => number {
  const span = Math.ceil(COLS / spacing) + 2;
  const lattice = Float64Array.from({ length: span * (Math.ceil(ROWS / spacing) + 2) }, () => rng());
  return (col, row) => {
    const x = Math.max(0, (col + 0.5) / spacing);
    const y = Math.max(0, (row + 0.5) / spacing);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const sx = smooth(x - ix);
    const sy = smooth(y - iy);
    const at = (i: number, j: number) => lattice[j * span + i];
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    const { items, keys } = this;
    let at = items.length;
    items.push(item);
    keys.push(key);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (keys[parent] <= key) break;
      items[at] = items[parent];
      keys[at] = keys[parent];
      at = parent;
    }
    items[at] = item;
    keys[at] = key;
  }

  pop(): number {
    const { items, keys } = this;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    const count = items.length;
    if (count === 0) return top;
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= count) break;
      if (child + 1 < count && keys[child + 1] < keys[child]) child++;
      if (keys[child] >= lastKey) break;
      items[at] = items[child];
      keys[at] = keys[child];
      at = child;
    }
    items[at] = lastItem;
    keys[at] = lastKey;
    return top;
  }
}

function eachNeighbour(index: number, visit: (neighbour: number, step: number) => void) {
  const col = index % COLS;
  const row = (index - col) / COLS;
  for (const [dc, dr, step] of NEIGHBOURS) {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) visit(r * COLS + c, step);
  }
}

function quantile(values: ArrayLike<number>, fraction: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)))];
}

function boxBlur(values: Float32Array, radius: number): Float32Array {
  const across = new Float32Array(CELLS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++) sum += values[row * COLS + Math.min(COLS - 1, Math.max(0, col + d))];
      across[row * COLS + col] = sum / (radius * 2 + 1);
    }
  }
  const out = new Float32Array(CELLS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++) sum += across[Math.min(ROWS - 1, Math.max(0, row + d)) * COLS + col];
      out[row * COLS + col] = sum / (radius * 2 + 1);
    }
  }
  return out;
}

function latitudeOf(row: number): number {
  return Math.abs((row + 0.5) / ROWS - 0.5) * 2;
}

function circulation(latitude: number): number {
  const band = latitude * 3;
  const cell = Math.min(2, Math.floor(band));
  const s = smooth(band - cell);
  const wave = cell === 1 ? 2 * s - 1 : 1 - 2 * s;
  return 0.55 + 0.45 * wave;
}

function prevailingWind(latitude: number): number {
  return latitude < 1 / 3 || latitude >= 2 / 3 ? -1 : 1;
}

function growPlates(rng: Rng, plates: Plate[]): Int32Array {
  const roughness = valueNoise(rng, 6);
  const owner = new Int32Array(CELLS).fill(-1);
  const cost = new Float64Array(CELLS).fill(Infinity);
  const heap = new MinHeap();
  plates.forEach((plate, id) => {
    const index = Math.floor(plate.y) * COLS + Math.floor(plate.x);
    if (owner[index] !== -1) return;
    owner[index] = id;
    cost[index] = 0;
    heap.push(index, 0);
  });
  const done = new Uint8Array(CELLS);
  while (heap.size > 0) {
    const index = heap.pop();
    if (done[index]) continue;
    done[index] = 1;
    const id = owner[index];
    eachNeighbour(index, (next, step) => {
      if (done[next]) return;
      const col = next % COLS;
      const row = (next - col) / COLS;
      const reached = cost[index] + step * (0.4 + roughness(col, row) * 1.6) / plates[id].growth;
      if (reached < cost[next]) {
        cost[next] = reached;
        owner[next] = id;
        heap.push(next, reached);
      }
    });
  }
  return owner;
}

function chooseContinents(rng: Rng, plates: Plate[], owner: Int32Array, landFraction: number) {
  const area = new Array<number>(plates.length).fill(0);
  for (const id of owner) area[id]++;
  const order = plates.map((_, id) => id);
  for (let at = order.length - 1; at > 0; at--) {
    const swap = Math.floor(rng() * (at + 1));
    [order[at], order[swap]] = [order[swap], order[at]];
  }
  let covered = 0;
  for (const id of order) {
    if (covered >= CELLS * landFraction * 1.15) break;
    if (covered > 0 && covered + area[id] > CELLS * landFraction * 1.6) continue;
    plates[id].continental = true;
    covered += area[id];
  }
}

function tectonicUplift(rng: Rng, plates: Plate[], owner: Int32Array): Float32Array {
  const convergence = new Float32Array(CELLS);
  const other = new Int32Array(CELLS).fill(-1);
  const distance = new Float64Array(CELLS).fill(Infinity);
  const heap = new MinHeap();
  for (let index = 0; index < CELLS; index++) {
    const own = owner[index];
    eachNeighbour(index, (next) => {
      const them = owner[next];
      if (them === own || other[index] !== -1) return;
      const a = plates[own];
      const b = plates[them];
      const nx = b.x - a.x;
      const ny = b.y - a.y;
      const length = Math.sqrt(nx * nx + ny * ny) || 1;
      other[index] = them;
      convergence[index] = ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny) / length;
      distance[index] = 0;
      heap.push(index, 0);
    });
  }
  while (heap.size > 0) {
    const index = heap.pop();
    const reached = distance[index];
    eachNeighbour(index, (next, step) => {
      if (owner[next] !== owner[index] || reached + step >= distance[next]) return;
      distance[next] = reached + step;
      other[next] = other[index];
      convergence[next] = convergence[index];
      heap.push(next, reached + step);
    });
  }

  const arcs = valueNoise(rng, 3);
  const uplift = new Float32Array(CELLS);
  for (let index = 0; index < CELLS; index++) {
    if (other[index] === -1) continue;
    const self = plates[owner[index]];
    const them = plates[other[index]];
    const d = distance[index];
    const push = convergence[index];
    const col = index % COLS;
    const row = (index - col) / COLS;
    if (push > 0) {
      if (self.continental && them.continental) {
        uplift[index] = push * (0.9 * kernel(d - 1, 4) + 0.3 * kernel(d, 10));
      } else if (self.continental) {
        uplift[index] = push * 0.85 * kernel(d - 2.5, 3.2);
      } else if (them.continental) {
        uplift[index] = -push * 0.35 * kernel(d, 2.5);
      } else if (owner[index] < other[index]) {
        uplift[index] = push * 0.75 * kernel(d - 2, 2) * (0.35 + arcs(col, row) * 1.1);
      } else {
        uplift[index] = -push * 0.3 * kernel(d, 2);
      }
    } else if (self.continental && them.continental) {
      uplift[index] = push * 0.4 * kernel(d, 2.2);
    } else if (!self.continental) {
      uplift[index] = -push * 0.22 * kernel(d, 3.5);
    }
  }
  return uplift;
}

function hotspots(rng: Rng, plates: Plate[], owner: Int32Array, elevation: Float32Array) {
  const count = between(rng, 0, BASE_SURFACE_HOTSPOTS_MAX);
  for (let spot = 0; spot < count; spot++) {
    const x = rng() * COLS;
    const y = ROWS * (0.15 + rng() * 0.7);
    const plate = plates[owner[Math.floor(y) * COLS + Math.floor(x)]];
    const speed = Math.sqrt(plate.vx * plate.vx + plate.vy * plate.vy) || 1;
    const length = between(rng, 3, 7);
    const strength = 0.55 + rng() * 0.35;
    for (let link = 0; link < length; link++) {
      const cx = x + (plate.vx / speed) * link * 2.6;
      const cy = y + (plate.vy / speed) * link * 2.6;
      const peak = strength * (1 - link / (length + 1)) * (0.7 + rng() * 0.3);
      for (let row = Math.max(0, Math.floor(cy - 3)); row < Math.min(ROWS, cy + 3); row++) {
        for (let col = Math.max(0, Math.floor(cx - 3)); col < Math.min(COLS, cx + 3); col++) {
          const dx = col + 0.5 - cx;
          const dy = row + 0.5 - cy;
          elevation[row * COLS + col] += peak * kernel(Math.sqrt(dx * dx + dy * dy), 1.6);
        }
      }
    }
  }
}

function rainfall(elevation: Float32Array): Float32Array {
  const rain = new Float32Array(CELLS);
  for (let row = 0; row < ROWS; row++) {
    const latitude = latitudeOf(row);
    const wind = prevailingWind(latitude);
    const lift = circulation(latitude);
    const warmth = 1 - latitude * 0.7;
    let carried = 0.8;
    let previous = 0;
    for (let step = 0; step < COLS * 2; step++) {
      const col = wind > 0 ? step % COLS : COLS - 1 - (step % COLS);
      const index = row * COLS + col;
      const height = elevation[index];
      let fell: number;
      if (height < 0) {
        carried += (1 - carried) * 0.2 * warmth;
        fell = carried * 0.04 * lift;
        previous = 0;
      } else {
        const rise = Math.max(0, height - previous);
        const fall = Math.max(0, previous - height);
        fell = Math.min(carried, carried * (0.05 * lift + rise * 2.4) * (1 - Math.min(0.6, fall * 3)));
        carried += fell * 0.55 * warmth;
        previous = height;
      }
      carried -= fell;
      if (step >= COLS) rain[index] = fell;
    }
  }
  const spread = boxBlur(boxBlur(rain, 1), 1);
  let landRain = 0;
  let landCells = 0;
  for (let index = 0; index < CELLS; index++) {
    if (elevation[index] < 0) continue;
    landRain += spread[index];
    landCells++;
  }
  const typical = landCells > 0 ? landRain / landCells : 1;
  return spread.map((value) => value / (value + typical));
}

function drainage(elevation: Float32Array, moisture: Float32Array) {
  const filled = Float32Array.from(elevation);
  const downstream = new Int32Array(CELLS).fill(-1);
  const closed = new Uint8Array(CELLS);
  const order: number[] = [];
  const heap = new MinHeap();
  for (let index = 0; index < CELLS; index++) {
    const col = index % COLS;
    const row = (index - col) / COLS;
    if (elevation[index] < 0 || col === 0 || row === 0 || col === COLS - 1 || row === ROWS - 1) {
      closed[index] = 1;
      heap.push(index, elevation[index]);
    }
  }
  while (heap.size > 0) {
    const index = heap.pop();
    order.push(index);
    eachNeighbour(index, (next) => {
      if (closed[next]) return;
      closed[next] = 1;
      filled[next] = Math.max(elevation[next], filled[index] + 1e-5);
      downstream[next] = index;
      heap.push(next, filled[next]);
    });
  }
  const flow = new Float32Array(CELLS);
  for (let index = 0; index < CELLS; index++) if (elevation[index] >= 0) flow[index] = moisture[index];
  for (let at = order.length - 1; at >= 0; at--) {
    const index = order[at];
    if (downstream[index] >= 0) flow[downstream[index]] += flow[index];
  }
  return { filled, downstream, flow };
}

export function surfaceWorld(address: BaseAddress): SurfaceWorld {
  const rng = createRng(surfaceSeed(address));
  const fraction = BASE_SURFACE_OCEAN_MIN + rng() * (BASE_SURFACE_OCEAN_MAX - BASE_SURFACE_OCEAN_MIN);
  const plates: Plate[] = Array.from({ length: between(rng, BASE_SURFACE_PLATES_MIN, BASE_SURFACE_PLATES_MAX) }, () => {
    return {
      x: rng() * COLS,
      y: rng() * ROWS,
      vx: rng() * 2 - 1,
      vy: rng() * 2 - 1,
      growth: 0.6 + rng() * 1.0,
      continental: false,
    };
  });
  const owner = growPlates(rng, plates);
  chooseContinents(rng, plates, owner, 1 - fraction);
  const crust = boxBlur(boxBlur(Float32Array.from(owner, (id) => (plates[id].continental ? 1 : 0)), 3), 3);
  const uplift = tectonicUplift(rng, plates, owner);
  const octaves = [
    { amplitude: 0.55, noise: valueNoise(rng, 20) },
    { amplitude: 0.3, noise: valueNoise(rng, 10) },
    { amplitude: 0.18, noise: valueNoise(rng, 5) },
    { amplitude: 0.09, noise: valueNoise(rng, 2.5) },
  ];
  const elevation = new Float32Array(CELLS);
  for (let index = 0; index < CELLS; index++) {
    const col = index % COLS;
    const row = (index - col) / COLS;
    let height = -0.55 + crust[index] * 0.85 + uplift[index];
    for (const { amplitude, noise } of octaves) height += (noise(col, row) - 0.5) * amplitude;
    elevation[index] = height;
  }
  hotspots(rng, plates, owner, elevation);

  const seaLevel = quantile(elevation, fraction);
  let highest = 1e-6;
  let deepest = 1e-6;
  for (let index = 0; index < CELLS; index++) {
    const height = elevation[index] - seaLevel;
    elevation[index] = height;
    if (height > highest) highest = height;
    if (-height > deepest) deepest = -height;
  }
  for (let index = 0; index < CELLS; index++) elevation[index] /= elevation[index] >= 0 ? highest : deepest;

  const moisture = rainfall(elevation);
  const { filled, downstream, flow } = drainage(elevation, moisture);

  const land: number[] = [];
  for (let index = 0; index < CELLS; index++) if (elevation[index] >= 0) land.push(index);
  const depressions = land.filter((index) => filled[index] - elevation[index] > BASE_SURFACE_LAKE_MIN_DEPTH && moisture[index] > BASE_SURFACE_LAKE_MIN_MOISTURE);
  const lakeFloor = depressions.length > land.length * BASE_SURFACE_LAKE_MAX_FRACTION
    ? quantile(depressions.map((index) => filled[index] - elevation[index]), 1 - (land.length * BASE_SURFACE_LAKE_MAX_FRACTION) / depressions.length)
    : -Infinity;
  const lakes = new Set(depressions.filter((index) => filled[index] - elevation[index] >= lakeFloor));
  const dry = land.filter((index) => !lakes.has(index));
  const ridgeLevel = quantile(dry.map((index) => elevation[index]), 1 - BASE_SURFACE_RIDGE_FRACTION);

  const blockers: SurfaceBlocker[] = [];
  for (let index = 0; index < CELLS; index++) {
    const col = index % COLS;
    const row = (index - col) / COLS;
    const kind: BlockerKind | null = elevation[index] < 0 ? 'ocean' : lakes.has(index) ? 'lake' : elevation[index] >= ridgeLevel ? 'ridge' : null;
    if (kind) blockers.push({ col, row, kind });
  }
  return { elevation, moisture, flow, downstream, blockers };
}

export function surfaceBlockers(address: BaseAddress): SurfaceBlocker[] {
  return surfaceWorld(address).blockers;
}

export function blockerGrid(blockers: readonly SurfaceBlocker[]): (BlockerKind | null)[] {
  const grid: (BlockerKind | null)[] = new Array(CELLS).fill(null);
  for (const blocker of blockers) grid[cellIndex(blocker)] = blocker.kind;
  return grid;
}

const BLOCKER_CODES: readonly (BlockerKind | null)[] = [null, 'ocean', 'ridge', 'lake'];

export function encodeBlockers(blockers: readonly SurfaceBlocker[]): Uint8Array<ArrayBuffer> {
  const codes = new Uint8Array(CELLS);
  for (const blocker of blockers) codes[cellIndex(blocker)] = BLOCKER_CODES.indexOf(blocker.kind);
  return codes;
}

export function decodeBlockers(codes: Uint8Array): (BlockerKind | null)[] {
  return Array.from(codes, (code) => BLOCKER_CODES[code]);
}
