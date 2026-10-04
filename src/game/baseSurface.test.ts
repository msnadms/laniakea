import { describe, expect, it } from 'vitest';
import { blockerGrid, cellIndex, surfaceBlockers } from './baseSurface';
import { BASE_SURFACE_COLS, BASE_SURFACE_ROWS, BASE_SURFACE_OCEAN_MAX, BASE_SURFACE_OCEAN_MIN } from './constants';

const CELLS = BASE_SURFACE_COLS * BASE_SURFACE_ROWS;
const WORLD = { superclusterSeed: 123456, galaxySeed: 98765, systemId: 42, ring: 2 };

describe('base surface', () => {
  it('places the same blockers for the same world', () => {
    expect(surfaceBlockers(WORLD)).toEqual(surfaceBlockers({ ...WORLD }));
  });

  it('places different blockers on a different world', () => {
    expect(surfaceBlockers(WORLD)).not.toEqual(surfaceBlockers({ ...WORLD, ring: 3 }));
  });

  it('keeps every blocker on the grid, one per cell', () => {
    for (let systemId = 0; systemId < 50; systemId++) {
      const blockers = surfaceBlockers({ ...WORLD, systemId });
      const cells = new Set(blockers.map(cellIndex));
      expect(cells.size).toBe(blockers.length);
      const offGrid = blockers.filter(({ col, row }) => col < 0 || col >= BASE_SURFACE_COLS || row < 0 || row >= BASE_SURFACE_ROWS);
      expect(offGrid).toEqual([]);
      const ocean = blockers.filter(({ kind }) => kind === 'ocean').length;
      expect(ocean).toBeGreaterThanOrEqual(Math.floor(CELLS * BASE_SURFACE_OCEAN_MIN));
      expect(ocean).toBeLessThanOrEqual(Math.ceil(CELLS * BASE_SURFACE_OCEAN_MAX));
      expect(blockers.length).toBeGreaterThan(ocean);
      expect(blockers.length).toBeLessThan(CELLS * 0.85);
    }
  });

  it('indexes the blocker grid by cell', () => {
    const blockers = surfaceBlockers(WORLD);
    const grid = blockerGrid(blockers);
    expect(grid.filter((kind) => kind !== null).length).toBe(blockers.length);
    for (const blocker of blockers) expect(grid[cellIndex(blocker)]).toBe(blocker.kind);
  });
});
