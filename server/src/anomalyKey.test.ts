import { describe, expect, it } from 'vitest';
import { generateAnomalies } from '../../src/game/anomalies';
import { SC_MAX_GALAXY_DOTS } from '../../src/game/constants';
import { generateGalaxy } from '../../src/game/galaxyGen';
import { LANIAKEA_SEED, MILKY_WAY_SEED } from '../../src/game/hardcoded';
import { superclusterGalaxySeedAt, superclusterGalaxySeeds } from '../../src/game/superclusters';
import {
  cachedDotCount,
  civilizationProfileOf,
  deriveAnomalySeeds,
  galaxyInSupercluster,
  parseAnomalyKey,
  rollSupercluster,
  superclusterCivilization,
} from './anomalyKey';

const TEST_KEY = parseAnomalyKey('5eed'.repeat(16));
const OTHER_KEY = parseAnomalyKey('0bad'.repeat(16));

function superclusterSeeds(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (0x5c1a + i * 104729) >>> 0);
}

export function findCivilizationSites(key = TEST_KEY, count = 8) {
  const sites = [];
  for (const superclusterSeed of superclusterSeeds(4000)) {
    const site = superclusterCivilization(key, superclusterSeed);
    if (site) sites.push({ superclusterSeed, ...site });
    if (sites.length >= count) break;
  }
  return sites;
}

describe('anomaly key', () => {
  it('rejects anything but 32 bytes of hex', () => {
    expect(() => parseAnomalyKey('')).toThrow();
    expect(() => parseAnomalyKey('ab'.repeat(31))).toThrow();
    expect(() => parseAnomalyKey('zz'.repeat(32))).toThrow();
  });

  it('rolls the same supercluster the same way under one key and differently under another', () => {
    const seeds = superclusterSeeds(3000);
    const rolls = seeds.map((seed) => rollSupercluster(TEST_KEY, seed));
    expect(seeds.map((seed) => rollSupercluster(TEST_KEY, seed))).toEqual(rolls);
    expect(seeds.map((seed) => rollSupercluster(OTHER_KEY, seed))).not.toEqual(rolls);
    for (const roll of rolls) if (roll) expect(roll.index).toBeLessThan(SC_MAX_GALAXY_DOTS);
    expect(rolls.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('places a civilisation only on a galaxy the supercluster really holds', () => {
    const sites = findCivilizationSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const { superclusterSeed, index, galaxySeed } of sites) {
      expect(rollSupercluster(TEST_KEY, superclusterSeed)).not.toBeNull();
      expect(index).toBeLessThan(cachedDotCount(superclusterSeed));
      expect(galaxySeed).toBe(superclusterGalaxySeedAt(superclusterSeed, index));
      expect(galaxySeed).not.toBe(MILKY_WAY_SEED);
      expect([...superclusterGalaxySeeds(superclusterSeed)][index]).toBe(galaxySeed);
      expect(superclusterCivilization(TEST_KEY, superclusterSeed)?.galaxySeed).toBe(galaxySeed);
    }
  }, 120000);

  it('hands out a civilisation seed for the civilisation galaxy alone', () => {
    for (const { superclusterSeed, index, galaxySeed, civilizationSeed } of findCivilizationSites(TEST_KEY, 4)) {
      expect(deriveAnomalySeeds(TEST_KEY, superclusterSeed, galaxySeed).civilization).toBe(civilizationSeed);
      const neighbour = superclusterGalaxySeedAt(superclusterSeed, index === 0 ? 1 : index - 1);
      expect(deriveAnomalySeeds(TEST_KEY, superclusterSeed, neighbour).civilization).toBeNull();
    }
  }, 120000);

  it('reports the profile the placed civilisation really has', () => {
    for (const { superclusterSeed, index, galaxySeed } of findCivilizationSites(TEST_KEY, 6)) {
      const civilization = generateAnomalies(generateGalaxy(galaxySeed), deriveAnomalySeeds(TEST_KEY, superclusterSeed, galaxySeed)).civilization!;
      const found = civilizationProfileOf(TEST_KEY, superclusterSeed)!;
      expect(found.index).toBe(index);
      expect(found.profile).toEqual({ living: civilization.living, stage: civilization.stage });
    }
  }, 120000);

  it('finds nothing in a supercluster whose roll failed', () => {
    let checked = 0;
    for (const seed of superclusterSeeds(400)) {
      if (rollSupercluster(TEST_KEY, seed)) continue;
      expect(superclusterCivilization(TEST_KEY, seed)).toBeNull();
      expect(civilizationProfileOf(TEST_KEY, seed)).toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('knows which galaxies a supercluster holds', () => {
    const seed = superclusterSeeds(1)[0];
    const count = cachedDotCount(seed);
    expect(galaxyInSupercluster(seed, superclusterGalaxySeedAt(seed, 0))).toBe(true);
    expect(galaxyInSupercluster(seed, superclusterGalaxySeedAt(seed, count - 1))).toBe(true);
    expect(galaxyInSupercluster(seed, superclusterGalaxySeedAt(seed, count))).toBe(false);
    expect(galaxyInSupercluster(LANIAKEA_SEED, MILKY_WAY_SEED)).toBe(true);
    expect(galaxyInSupercluster(seed, MILKY_WAY_SEED)).toBe(false);
  }, 120000);
});

describe.skipIf(!process.env.ANOMALY_ODDS)('civilisation odds per supercluster', () => {
  it('holds about one civilisation in fifty superclusters', { timeout: 600_000 }, () => {
    const samples = 3000;
    const held = superclusterSeeds(samples).filter((seed) => superclusterCivilization(TEST_KEY, seed) !== null).length;
    console.table([{ samples, held, measured: `1 in ${(samples / Math.max(1, held)).toFixed(1)}`, target: '1 in 50' }]);
    expect(held).toBeGreaterThan(0);
  });
});
