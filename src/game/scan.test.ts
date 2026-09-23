import { describe, expect, it } from 'vitest';
import { civilizationProfile, generateAnomalies, hasCivilization, superclusterMayHoldCivilization } from './anomalies';
import { createRng, firstRandom, generateGalaxy } from './galaxyGen';
import { findCivilizationSeeds } from './civilizationSeeds.testutil';
import { generateSupercluster, superclusterGalaxySeeds } from './superclusters';
import { getUniverseChunk, universeChunksNear } from './universe';
import { LANIAKEA_SEED } from './hardcoded';
import { mergeSignals, scanCost, scanPrecisionRadius, scanVolumeFraction, signalStrength, SCAN_STRENGTH_TIERS } from './scan';
import { SCAN_COST_MIN, SCAN_SUPERCLUSTER_FULL_RADIUS, SCAN_UNIVERSE_FULL_RADIUS, SCAN_UNIVERSE_MIN_RADIUS, SC_MAX_GALAXY_DOTS } from './constants';

describe('civilizationProfile', () => {
  it('matches the generated civilisation without building the galaxy', () => {
    for (const seed of findCivilizationSeeds(24, 1)) {
      const profile = civilizationProfile(seed);
      const civilization = generateAnomalies(generateGalaxy(seed)).civilization;
      expect(profile).not.toBeNull();
      expect(profile!.stage).toBe(civilization!.stage);
      expect(profile!.living).toBe(civilization!.living);
    }
  });

  it('is null wherever hasCivilization is false', () => {
    let checked = 0;
    for (let seed = 1; seed < 4000 && checked < 200; seed++) {
      if (hasCivilization(seed)) continue;
      expect(civilizationProfile(seed)).toBeNull();
      checked++;
    }
    expect(checked).toBe(200);
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

  it('hashes the same roll the rng draws first', () => {
    for (let seed = -4000; seed < 4000; seed += 7) expect(firstRandom(seed)).toBe(createRng(seed)());
  });

  function holdsCivilization(seed: number): boolean {
    for (const galaxySeed of superclusterGalaxySeeds(seed)) if (civilizationProfile(galaxySeed)) return true;
    return false;
  }

  it('stays inside the dot bound every sweep hashes against', () => {
    for (const seed of [LANIAKEA_SEED, ...seeds]) {
      let dots = 0;
      for (const _ of superclusterGalaxySeeds(seed)) dots++;
      expect(dots).toBeLessThanOrEqual(SC_MAX_GALAXY_DOTS);
    }
  }, 120000);

  it('never rules out a supercluster that holds a civilisation', () => {
    let held = 0;
    for (let seed = 1; seed < 4000 && held < 3; seed++) {
      if (!superclusterMayHoldCivilization(seed)) {
        expect(holdsCivilization(seed)).toBe(false);
        continue;
      }
      if (holdsCivilization(seed)) held++;
    }
    expect(held).toBe(3);
  }, 300000);

  it('reads the seeds the full dot stream yields', () => {
    for (const seed of [LANIAKEA_SEED, ...seeds.slice(0, 4)]) {
      expect([...superclusterGalaxySeeds(seed)]).toEqual(generateSupercluster(seed).dots.map((dot) => dot.seed));
    }
  }, 120000);
});
