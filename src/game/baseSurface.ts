import type { BaseAddress } from './base';
import {
  BASE_SURFACE_BLOCKER_CLUSTER_CELLS_MAX,
  BASE_SURFACE_BLOCKER_CLUSTER_CELLS_MIN,
  BASE_SURFACE_BLOCKER_CLUSTERS_MAX,
  BASE_SURFACE_BLOCKER_CLUSTERS_MIN,
  BASE_SURFACE_CONTINENT_SCALE,
  BASE_SURFACE_COLS,
  BASE_SURFACE_ROWS,
  BASE_SURFACE_OCEAN_MAX,
  BASE_SURFACE_OCEAN_MIN,
} from './constants';
import { createRng } from './galaxyGen';

export type BlockerKind = 'ocean' | 'ridge' | 'lake';

const SCATTERED_KINDS: readonly BlockerKind[] = ['ridge', 'ridge', 'lake'];

export interface SurfaceCell {
  col: number;
  row: number;
}

export interface SurfaceBlocker extends SurfaceCell {
  kind: BlockerKind;
}

const STEPS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function surfaceSeed({ superclusterSeed, galaxySeed, systemId, ring }: BaseAddress): number {
  let hash = Math.imul(superclusterSeed ^ 0x5f3759df, 0x9e3779b1);
  hash = Math.imul(hash ^ galaxySeed ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ systemId ^ (hash >>> 13), 0xc2b2ae35);
  hash = Math.imul(hash ^ ring ^ (hash >>> 16), 0x27d4eb2f);
  return (hash ^ (hash >>> 15)) >>> 0;
}

export function cellIndex({ col, row }: SurfaceCell): number {
  return row * BASE_SURFACE_COLS + col;
}

function between(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function valueNoise(rng: () => number, spacing: number): (col: number, row: number) => number {
  const span = Math.ceil(BASE_SURFACE_COLS / spacing) + 2;
  const lattice = Float64Array.from({ length: span * (Math.ceil(BASE_SURFACE_ROWS / spacing) + 2) }, () => rng());
  return (col, row) => {
    const x = (col + 0.5) / spacing;
    const y = (row + 0.5) / spacing;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => lattice[j * span + i];
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

export function oceanCells(rng: () => number): boolean[] {
  const octaves = [1, 0.5, 0.25].map((amplitude, octave) => ({ amplitude, noise: valueNoise(rng, BASE_SURFACE_CONTINENT_SCALE / 2 ** octave) }));
  const fraction = BASE_SURFACE_OCEAN_MIN + rng() * (BASE_SURFACE_OCEAN_MAX - BASE_SURFACE_OCEAN_MIN);
  const cells = BASE_SURFACE_COLS * BASE_SURFACE_ROWS;
  const heights = Array.from({ length: cells }, (_, index) => {
    const col = index % BASE_SURFACE_COLS;
    const row = Math.floor(index / BASE_SURFACE_COLS);
    return octaves.reduce((sum, { amplitude, noise }) => sum + noise(col, row) * amplitude, 0);
  });
  const seaLevel = [...heights].sort((a, b) => a - b)[Math.floor(cells * fraction)];
  return heights.map((height) => height < seaLevel);
}

export function surfaceBlockers(address: BaseAddress): SurfaceBlocker[] {
  const rng = createRng(surfaceSeed(address));
  const ocean = oceanCells(rng);
  const taken = new Map<number, SurfaceBlocker>();
  ocean.forEach((wet, index) => {
    if (wet) taken.set(index, { col: index % BASE_SURFACE_COLS, row: Math.floor(index / BASE_SURFACE_COLS), kind: 'ocean' });
  });
  const land = ocean.flatMap((wet, index) => wet ? [] : [index]);
  const clusters = between(rng, BASE_SURFACE_BLOCKER_CLUSTERS_MIN, BASE_SURFACE_BLOCKER_CLUSTERS_MAX);
  for (let cluster = 0; cluster < clusters && land.length > 0; cluster++) {
    const kind = SCATTERED_KINDS[Math.floor(rng() * SCATTERED_KINDS.length)];
    const size = between(rng, BASE_SURFACE_BLOCKER_CLUSTER_CELLS_MIN, BASE_SURFACE_BLOCKER_CLUSTER_CELLS_MAX);
    const start = land[Math.floor(rng() * land.length)];
    let col = start % BASE_SURFACE_COLS;
    let row = Math.floor(start / BASE_SURFACE_COLS);
    for (let cell = 0; cell < size; cell++) {
      const index = cellIndex({ col, row });
      if (!taken.has(index)) taken.set(index, { col, row, kind });
      const [dc, dr] = STEPS[Math.floor(rng() * STEPS.length)];
      col = Math.min(BASE_SURFACE_COLS - 1, Math.max(0, col + dc));
      row = Math.min(BASE_SURFACE_ROWS - 1, Math.max(0, row + dr));
    }
  }
  return [...taken.values()].sort((a, b) => cellIndex(a) - cellIndex(b));
}

export function blockerGrid(blockers: readonly SurfaceBlocker[]): (BlockerKind | null)[] {
  const grid: (BlockerKind | null)[] = new Array(BASE_SURFACE_COLS * BASE_SURFACE_ROWS).fill(null);
  for (const blocker of blockers) grid[cellIndex(blocker)] = blocker.kind;
  return grid;
}
