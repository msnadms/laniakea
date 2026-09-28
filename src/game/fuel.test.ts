import { describe, expect, it } from 'vitest';
import { FUEL_DOCK_RADIUS, FUEL_HARVEST_CAP, FUEL_HARVEST_FLOOR, FUEL_HARVEST_PER_HOUR, UNIVERSE_START_BACKOFF } from './constants';
import { approachPoint, distance, harvestPerHour, harvested, isDocked, startingBerth, towards, travelCost, travelReach } from './fuel';
import { getUniverseChunk, universeVoidDepth } from './universe';

const HOUR = 3_600_000;

describe('fuel', () => {
  it('reach and cost are inverse', () => {
    expect(travelCost(travelReach(7))).toBeCloseTo(7);
    expect(travelReach(-1)).toBe(0);
  });

  it('never carries a ship past what it can afford', () => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 1000, y: 0, z: 0 };
    expect(distance(from, towards(from, to, 250))).toBeCloseTo(250);
    expect(towards(from, to, 5000)).toEqual(to);
  });

  it('harvests only up to the cap', () => {
    const ship = { x: 0, y: 0, z: 0, at: 0 };
    expect(harvested(ship, FUEL_HARVEST_CAP, 100 * HOUR)).toBe(0);
    expect(harvested(ship, FUEL_HARVEST_CAP - 2, 100 * HOUR)).toBeCloseTo(2);
    expect(harvested(ship, 0, 0)).toBe(0);
    expect(harvested(ship, 0, HOUR)).toBeCloseTo(harvestPerHour(ship));
  });

  it('harvests far more deep in a void than on the web', () => {
    const chunk = getUniverseChunk(0, 0, 0);
    let wall = { x: chunk.x[0], y: chunk.y[0], z: chunk.z[0] };
    let deepest = wall;
    let deepestDepth = -1;
    for (let i = 0; i < 400; i++) {
      const point = { x: (i % 20) * 40 - 400, y: Math.floor(i / 20) * 40 - 400, z: 300 };
      const depth = universeVoidDepth(point.x, point.y, point.z);
      if (depth > deepestDepth) {
        deepestDepth = depth;
        deepest = point;
      }
    }
    for (let i = 1; i < chunk.count; i++) {
      const point = { x: chunk.x[i], y: chunk.y[i], z: chunk.z[i] };
      if (universeVoidDepth(point.x, point.y, point.z) < universeVoidDepth(wall.x, wall.y, wall.z)) wall = point;
    }
    expect(universeVoidDepth(wall.x, wall.y, wall.z)).toBe(0);
    expect(harvestPerHour(wall)).toBeCloseTo(FUEL_HARVEST_PER_HOUR * FUEL_HARVEST_FLOOR);
    expect(deepestDepth).toBeGreaterThan(0.5);
    expect(harvestPerHour(deepest)).toBeGreaterThan(5 * harvestPerHour(wall));
  });

  it('berths a crossing short of the supercluster, and stays put when already docked', () => {
    const supercluster = { x: 5000, y: 0, z: 0 };
    const berth = approachPoint({ x: 0, y: 0, z: 0 }, supercluster);
    expect(distance(berth, supercluster)).toBeCloseTo(UNIVERSE_START_BACKOFF);
    expect(isDocked(berth, supercluster)).toBe(true);
    const near = { x: supercluster.x - FUEL_DOCK_RADIUS / 2, y: 0, z: 0 };
    expect(approachPoint(near, supercluster)).toEqual(near);
  });

  it('starts every ship docked at its supercluster', () => {
    expect(isDocked(startingBerth({ x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 })).toBe(true);
    expect(isDocked(startingBerth({ x: 12_000, y: -3_000, z: 800 }), { x: 12_000, y: -3_000, z: 800 })).toBe(true);
  });
});
