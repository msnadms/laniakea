import { describe, expect, it } from 'vitest';
import { blockerGrid, cellIndex, decodeBlockers, depositGrid, encodeBlockers, surfaceBlockers, surfaceWorld } from './baseSurface';
import {
  BASE_DEPOSIT_CELLS_MAX,
  BASE_DEPOSIT_COUNTS,
  BASE_SURFACE_COLS,
  BASE_SURFACE_ROWS,
  BASE_SURFACE_OCEAN_MAX,
  BASE_SURFACE_OCEAN_MIN,
} from './constants';
import { DEPOSIT_GRADES, DEPOSIT_RATE_PER_HOUR, gradeForScore, RESOURCE_KINDS } from './resources';

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

  it('round-trips the blocker grid through its encoding', () => {
    const blockers = surfaceBlockers(WORLD);
    expect(decodeBlockers(encodeBlockers(blockers))).toEqual(blockerGrid(blockers));
  });

  it('drains every land cell to the sea or the edge of the map', () => {
    for (let systemId = 0; systemId < 10; systemId++) {
      const { elevation, downstream } = surfaceWorld({ ...WORLD, systemId });
      for (let start = 0; start < CELLS; start++) {
        let at = start;
        for (let steps = 0; downstream[at] >= 0; steps++) {
          expect(steps).toBeLessThan(CELLS);
          at = downstream[at];
        }
        const col = at % BASE_SURFACE_COLS;
        const row = Math.floor(at / BASE_SURFACE_COLS);
        const outlet = elevation[at] < 0 || col === 0 || row === 0 || col === BASE_SURFACE_COLS - 1 || row === BASE_SURFACE_ROWS - 1;
        expect(outlet).toBe(true);
      }
    }
  });

  it('gathers land into continents rather than scattering it', () => {
    for (let systemId = 0; systemId < 20; systemId++) {
      const { elevation, moisture } = surfaceWorld({ ...WORLD, systemId });
      expect(moisture.every((value) => value >= 0 && value <= 1)).toBe(true);
      const seen = new Uint8Array(CELLS);
      let land = 0;
      let largest = 0;
      for (let start = 0; start < CELLS; start++) {
        if (elevation[start] < 0) continue;
        land++;
        if (seen[start]) continue;
        seen[start] = 1;
        const stack = [start];
        let size = 0;
        while (stack.length > 0) {
          const at = stack.pop()!;
          size++;
          const col = at % BASE_SURFACE_COLS;
          for (const next of [col > 0 ? at - 1 : -1, col < BASE_SURFACE_COLS - 1 ? at + 1 : -1, at - BASE_SURFACE_COLS, at + BASE_SURFACE_COLS]) {
            if (next < 0 || next >= CELLS || seen[next] || elevation[next] < 0) continue;
            seen[next] = 1;
            stack.push(next);
          }
        }
        largest = Math.max(largest, size);
      }
      expect(largest / land).toBeGreaterThan(0.25);
    }
  });

  it('places the same deposits for the same world', () => {
    expect(surfaceWorld(WORLD).deposits).toEqual(surfaceWorld({ ...WORLD }).deposits);
  });

  it('keeps every deposit on open ground, one deposit per cell', () => {
    for (let systemId = 0; systemId < 30; systemId++) {
      const { blockers, deposits } = surfaceWorld({ ...WORLD, systemId });
      const blocked = blockerGrid(blockers);
      const seen = new Set<number>();
      for (const deposit of deposits) {
        expect(deposit.cells.length).toBeGreaterThan(0);
        expect(deposit.cells.length).toBeLessThanOrEqual(BASE_DEPOSIT_CELLS_MAX);
        for (const cell of deposit.cells) {
          const index = cellIndex(cell);
          expect(blocked[index]).toBeNull();
          expect(seen.has(index)).toBe(false);
          seen.add(index);
        }
      }
      const grid = depositGrid(deposits);
      expect(Array.from(grid).filter((id) => id >= 0).length).toBe(seen.size);
    }
  });

  it('gives every world each resource, within its count', () => {
    for (let systemId = 0; systemId < 30; systemId++) {
      const { deposits } = surfaceWorld({ ...WORLD, systemId });
      for (const resource of RESOURCE_KINDS) {
        const count = deposits.filter((deposit) => deposit.resource === resource).length;
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(BASE_DEPOSIT_COUNTS[resource][1]);
      }
    }
  });

  it('makes high grades rarer than low ones', () => {
    const tally = Object.fromEntries(DEPOSIT_GRADES.map((grade) => [grade, 0]));
    for (let systemId = 0; systemId < 60; systemId++) {
      for (const { grade } of surfaceWorld({ ...WORLD, systemId }).deposits) tally[grade]++;
    }
    expect(tally.S).toBeGreaterThan(0);
    expect(tally.S).toBeLessThan(tally.A);
    expect(tally.A).toBeLessThan(tally.C);
    expect(tally.C).toBeLessThan(tally.F);
  });

  it('pays more per hour the higher the grade', () => {
    for (let at = 1; at < DEPOSIT_GRADES.length; at++) {
      expect(DEPOSIT_RATE_PER_HOUR[DEPOSIT_GRADES[at - 1]]).toBeGreaterThan(DEPOSIT_RATE_PER_HOUR[DEPOSIT_GRADES[at]]);
    }
    expect(gradeForScore(1)).toBe('S');
    expect(gradeForScore(0)).toBe('F');
  });
});
