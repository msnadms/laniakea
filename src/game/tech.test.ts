import { describe, expect, it } from 'vitest';
import { FUEL_TANK_CAPACITY, MLY_PER_MPC, TECH_NODE_COSTS, UNIVERSE_SPEED_MAX } from './constants';
import { decoyHeat, heatNoise } from './scanGraph';
import {
  canResearch,
  maxFlightSpeed,
  NO_TECH,
  researchCost,
  scanDecoyFactor,
  scanPrecisionFactor,
  tankCapacity,
  TECH_MAX_LEVEL,
  TECH_PATHS,
  TECH_TREE,
  technologyAward,
  techLevelsOf,
} from './tech';
import type { CivilizationStage } from './anomalies';

const LEVELS = Array.from({ length: TECH_MAX_LEVEL + 1 }, (_, i) => i);

describe('tech', () => {
  it('gives every path one node per cost, each dearer than the last', () => {
    for (const path of TECH_PATHS) expect(TECH_TREE[path].nodes).toHaveLength(TECH_NODE_COSTS.length);
    for (let i = 1; i < TECH_NODE_COSTS.length; i++) expect(TECH_NODE_COSTS[i]).toBeGreaterThan(TECH_NODE_COSTS[i - 1]);
    expect(researchCost(TECH_MAX_LEVEL)).toBeNull();
  });

  it('starts at today\'s ship and only ever improves it', () => {
    expect(tankCapacity(0)).toBe(FUEL_TANK_CAPACITY);
    expect(maxFlightSpeed(0)).toBe(UNIVERSE_SPEED_MAX);
    expect(scanPrecisionFactor(0)).toBe(1);
    expect(scanDecoyFactor(0)).toBe(1);
    for (const level of LEVELS.slice(1)) {
      expect(tankCapacity(level)).toBeGreaterThan(tankCapacity(level - 1));
      expect(maxFlightSpeed(level)).toBeGreaterThan(maxFlightSpeed(level - 1));
      expect(scanPrecisionFactor(level)).toBeLessThan(scanPrecisionFactor(level - 1));
      expect(scanDecoyFactor(level)).toBeLessThan(scanDecoyFactor(level - 1));
    }
    expect(maxFlightSpeed(TECH_MAX_LEVEL) / MLY_PER_MPC).toBeCloseTo(30);
    expect(maxFlightSpeed(2) / maxFlightSpeed(1)).toBeCloseTo(maxFlightSpeed(1) / maxFlightSpeed(0));
    expect(scanPrecisionFactor(TECH_MAX_LEVEL)).toBeGreaterThan(0);
    expect(scanDecoyFactor(TECH_MAX_LEVEL)).toBeGreaterThan(0);
  });

  it('researches in order, within the balance, up to the last node', () => {
    expect(canResearch(NO_TECH, TECH_NODE_COSTS[0], 'speed')).toBe(true);
    expect(canResearch(NO_TECH, TECH_NODE_COSTS[0] - 1, 'speed')).toBe(false);
    expect(canResearch({ ...NO_TECH, speed: 1 }, TECH_NODE_COSTS[0], 'speed')).toBe(TECH_NODE_COSTS[1] <= TECH_NODE_COSTS[0]);
    expect(canResearch({ ...NO_TECH, scanning: TECH_MAX_LEVEL }, 1000, 'scanning')).toBe(false);
  });

  it('pays more for older civilisations and more again while they live', () => {
    const stages: CivilizationStage[] = [1, 2, 3, 4, 5, 6];
    for (let i = 1; i < stages.length; i++) {
      expect(technologyAward({ stage: stages[i], living: false })).toBeGreaterThanOrEqual(technologyAward({ stage: stages[i - 1], living: false }));
    }
    expect(technologyAward({ stage: 6, living: false })).toBeGreaterThan(technologyAward({ stage: 1, living: false }));
    for (const stage of stages) {
      expect(technologyAward({ stage, living: true })).toBeGreaterThan(technologyAward({ stage, living: false }));
    }
  });

  it('reads stored levels defensively', () => {
    expect(techLevelsOf(undefined)).toEqual(NO_TECH);
    expect(techLevelsOf({ capacity: 2, speed: 99, scanning: -1 })).toEqual({ capacity: 2, speed: TECH_MAX_LEVEL, scanning: 0 });
  });

  it('quiets decoys without touching where they fall', () => {
    let hottest = { x: 0, noise: 0 };
    for (let x = 0; x < 5000; x += 13) {
      const noise = heatNoise(x, 0, 0, 100);
      if (noise > hottest.noise) hottest = { x, noise };
    }
    const full = decoyHeat(hottest.x, 0, 0, 100, 1);
    expect(full).toBeGreaterThan(0);
    expect(decoyHeat(hottest.x, 0, 0, 100, 1, scanDecoyFactor(TECH_MAX_LEVEL))).toBeCloseTo(full * scanDecoyFactor(TECH_MAX_LEVEL));
  });
});
