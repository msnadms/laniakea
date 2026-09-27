import { describe, expect, it } from 'vitest';
import { civilizationProfile, generateAnomalies } from './anomalies';
import { generateGalaxy } from './galaxyGen';
import { sampleGalaxySeeds, testAnomalySeeds } from './civilizationSeeds.testutil';
import { generateSupercluster, superclusterDotAt, superclusterDotCount, superclusterGalaxyIndex, superclusterGalaxySeeds } from './superclusters';
import { surveySupercluster, surveyUniverse, sweepFinding } from './scanSurvey';
import { getUniverseChunk, universeChunksNear } from './universe';
import { LANIAKEA_SEED, MILKY_WAY_SEED } from './hardcoded';
import { mergeSignals, scanCost, scanPrecisionRadius, scanVolumeFraction, signalStrength, SCAN_STRENGTH_TIERS } from './scan';
import { SCAN_COST_MIN, SCAN_SUPERCLUSTER_FULL_RADIUS, SCAN_UNIVERSE_FULL_RADIUS, SCAN_UNIVERSE_MIN_RADIUS, SC_MAX_GALAXY_DOTS } from './constants';

describe('civilizationProfile', () => {
  it('matches the generated civilisation without building the galaxy', () => {
    for (const galaxySeed of sampleGalaxySeeds(24, 1)) {
      const seeds = testAnomalySeeds(galaxySeed, true);
      const profile = civilizationProfile(seeds.civilization!);
      const civilization = generateAnomalies(generateGalaxy(galaxySeed), seeds).civilization!;
      expect(profile.stage).toBe(civilization.stage);
      expect(profile.living).toBe(civilization.living);
    }
  });
});

describe('scan cost and precision', () => {
  it('charges by reach and resolves no better than a fraction of it', () => {
    expect(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS)).toBeGreaterThan(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS / 4));
    expect(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS * 4)).toBe(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS));
    expect(scanVolumeFraction('universe', SCAN_UNIVERSE_FULL_RADIUS / 2)).toBeCloseTo(0.125);
    expect(scanPrecisionRadius('universe', 4000)).toBeGreaterThan(scanPrecisionRadius('universe', 400));
    expect(scanPrecisionRadius('universe', 4000)).toBeLessThan(4000);
    expect(scanPrecisionRadius('universe', 1)).toBe(SCAN_UNIVERSE_MIN_RADIUS);
  });

  it('makes one wide sweep the cheapest way to cover a volume', () => {
    for (const scope of ['universe', 'supercluster'] as const) {
      const full = scope === 'universe' ? SCAN_UNIVERSE_FULL_RADIUS : SCAN_SUPERCLUSTER_FULL_RADIUS;
      const tiled = (fraction: number) =>
        scanCost(scope, full * fraction) / scanVolumeFraction(scope, full * fraction);
      const wide = tiled(1);
      let previous = wide;
      for (const fraction of [0.75, 0.5, 0.25, 0.1]) {
        const cost = tiled(fraction);
        expect(cost).toBeGreaterThan(previous);
        previous = cost;
      }
      expect(tiled(0.25)).toBeGreaterThan(wide * 4);
      expect(tiled(0.1)).toBeGreaterThan(wide * 20);
    }
  });

  it('leaves a narrowing re-sweep inside a contact affordable', () => {
    const narrow = scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS * 0.2);
    expect(narrow).toBeLessThanOrEqual(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS) / 4);
    expect(scanCost('universe', SCAN_UNIVERSE_MIN_RADIUS)).toBe(SCAN_COST_MIN);
  });
});

describe('signal strength', () => {
  it('rises with stage and with a living civilisation', () => {
    expect(signalStrength({ stage: 1, living: false })).toBe(0);
    expect(signalStrength({ stage: 6, living: false })).toBe(SCAN_STRENGTH_TIERS - 1);
    expect(signalStrength({ stage: 3, living: true })).toBeGreaterThan(signalStrength({ stage: 3, living: false }));
    expect(signalStrength({ stage: 6, living: true })).toBe(SCAN_STRENGTH_TIERS - 1);
  });
});

describe('mergeSignals', () => {
  const faint = { stage: 1, living: false } as const;
  const loud = { stage: 6, living: false } as const;

  it('returns nothing when the sweep found nothing', () => {
    expect(mergeSignals([], 100)).toBeNull();
  });

  it('keeps the precision radius when a lone signal is inside it', () => {
    const contact = mergeSignals([{ x: 10, y: 0, z: 0, profile: faint }], 100)!;
    expect(contact.radius).toBe(100);
    expect(contact.sources).toBe(1);
    expect(contact.x).toBe(10);
  });

  it('covers every merged signal and reports the strongest', () => {
    const contact = mergeSignals([
      { x: -300, y: 0, z: 0, profile: faint },
      { x: 300, y: 0, z: 0, profile: loud },
    ], 100)!;
    expect(contact.x).toBe(0);
    expect(contact.radius).toBe(300);
    expect(contact.sources).toBe(2);
    expect(contact.strength).toBe(signalStrength(loud));
  });
});

describe('surveying a supercluster', () => {
  const seeds: number[] = [];
  for (const ref of universeChunksNear(0, 0, 0, 700)) {
    const chunk = getUniverseChunk(ref.ci, ref.cj, ref.ck);
    for (let i = 0; i < chunk.count && seeds.length < 60; i++) seeds.push(chunk.seeds[i]);
    if (seeds.length >= 60) break;
  }

  it('stays inside the dot bound a civilisation roll draws its index from', () => {
    for (const seed of [LANIAKEA_SEED, ...seeds]) expect(superclusterDotCount(seed)).toBeLessThanOrEqual(SC_MAX_GALAXY_DOTS);
  }, 120000);

  it('reads the seeds the full dot stream yields', () => {
    for (const seed of [LANIAKEA_SEED, ...seeds.slice(0, 4)]) {
      expect([...superclusterGalaxySeeds(seed)]).toEqual(generateSupercluster(seed).dots.map((dot) => dot.seed));
    }
  }, 120000);

  it('finds each dot by its index, and each index by its seed', () => {
    for (const seed of [LANIAKEA_SEED, ...seeds.slice(0, 3)]) {
      const dots = generateSupercluster(seed).dots.filter((dot) => dot.seed !== MILKY_WAY_SEED);
      expect(superclusterDotCount(seed)).toBe(dots.length);
      for (const index of [0, 1, Math.floor(dots.length / 2), dots.length - 1]) {
        const dot = superclusterDotAt(seed, index)!;
        expect([dot.x, dot.y, dot.z, dot.seed]).toEqual([dots[index].x, dots[index].y, dots[index].z, dots[index].seed]);
        expect(superclusterGalaxyIndex(seed, dots[index].seed)).toBe(index);
      }
      expect(superclusterDotAt(seed, dots.length)).toBeNull();
    }
  }, 120000);

  it('hears a civilisation only when the sweep covers its galaxy', () => {
    const seed = seeds[0];
    const dot = superclusterDotAt(seed, 5)!;
    const profileOf = () => ({ index: 5, profile: { stage: 3, living: true } as const });
    const covering = surveySupercluster(seed, { x: dot.x + 10, y: dot.y, z: dot.z, radius: 20 }, profileOf);
    const missing = surveySupercluster(seed, { x: dot.x + 30, y: dot.y, z: dot.z, radius: 20 }, profileOf);
    expect(covering.signals).toHaveLength(1);
    expect(missing.signals).toHaveLength(0);
    expect(sweepFinding('supercluster', seed, missing, 'a', 0)).toBeNull();
    expect(sweepFinding('supercluster', seed, covering, 'b', 0)!.sources).toBe(1);
  }, 120000);

  it('surveys every supercluster the universe sphere holds', () => {
    const sphere = { x: 0, y: 0, z: 0, radius: 400 };
    const heard: number[] = [];
    const survey = surveyUniverse(sphere, (seed) => {
      heard.push(seed);
      return null;
    });
    expect(heard.length).toBeGreaterThan(0);
    expect(new Set(heard).size).toBe(heard.length);
    expect(survey.confidence).toBe(1);
    expect(survey.graph.nodes.length / 3).toBeGreaterThan(1);
    expect(sweepFinding('universe', null, survey, 'c', 0)!.sources).toBe(0);
  });
});
