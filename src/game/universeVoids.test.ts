import { describe, expect, it } from 'vitest';
import { createRng } from './galaxyGen';
import { UNIVERSE_FILAMENT_WIDTH, UNIVERSE_VOID_CELL, UNIVERSE_WALL_WEIGHT, UNIVERSE_WALL_WIDTH } from './constants';
import { universeCellPosition, universeVoidOffset, universeWebWeight } from './universe';

function kernel(t: number): number {
  const falloff = 1 - t * t / 4;
  return falloff <= 0 ? 0 : falloff ** 4;
}

function weightFromOffsets(q: { x: number; y: number; z: number }, quantise: boolean): number {
  const offset = { x: 0, y: 0, z: 0 };
  const found: { d: number; x: number; y: number; z: number }[] = [];
  const bx = Math.floor(q.x);
  const by = Math.floor(q.y);
  const bz = Math.floor(q.z);
  for (let i = bx - 1; i <= bx + 1; i++) {
    for (let j = by - 1; j <= by + 1; j++) {
      for (let k = bz - 1; k <= bz + 1; k++) {
        universeVoidOffset(i, j, k, offset);
        const step = (v: number) => (quantise ? Math.round((0.5 + v) * 255) / 255 : 0.5 + v);
        const x = i + step(offset.x);
        const y = j + step(offset.y);
        const z = k + step(offset.z);
        found.push({ d: (q.x - x) ** 2 + (q.y - y) ** 2 + (q.z - z) ** 2, x, y, z });
      }
    }
  }
  found.sort((a, b) => a.d - b.d);
  const [c1, c2, c3] = found;
  const gap = (c: typeof c1) => (c.d - c1.d) / (2 * Math.hypot(c1.x - c.x, c1.y - c.y, c1.z - c.z)) * UNIVERSE_VOID_CELL;
  return UNIVERSE_WALL_WEIGHT * kernel(gap(c2) / UNIVERSE_WALL_WIDTH) + kernel(gap(c3) / UNIVERSE_FILAMENT_WIDTH);
}

describe('universe void offsets', () => {
  const rng = createRng(0x51f0);
  const points = Array.from({ length: 400 }, () => [(rng() - 0.5) * 60_000, (rng() - 0.5) * 60_000, (rng() - 0.5) * 60_000]);

  it('rebuild the generator web weight in cell space', () => {
    const q = { x: 0, y: 0, z: 0 };
    for (const [x, y, z] of points) {
      universeCellPosition(x, y, z, q);
      expect(weightFromOffsets(q, false)).toBeCloseTo(universeWebWeight(x, y, z), 6);
    }
  });

  it('survive byte quantisation closely enough to draw', () => {
    const q = { x: 0, y: 0, z: 0 };
    let error = 0;
    for (const [x, y, z] of points) {
      universeCellPosition(x, y, z, q);
      error += Math.abs(weightFromOffsets(q, true) - universeWebWeight(x, y, z));
    }
    expect(error / points.length).toBeLessThan(0.05);
  });
});
