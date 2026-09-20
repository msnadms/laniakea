import { describe, expect, it } from 'vitest';
import { civilizationProfile, generateAnomalies, hasCivilization } from './anomalies';
import { generateGalaxy } from './galaxyGen';
import { findCivilizationSeeds } from './civilizationSeeds.testutil';
import { mergeSignals, scanCost, scanPrecisionRadius, scanVolumeFraction, signalStrength, SCAN_STRENGTH_TIERS } from './scan';
import { SCAN_UNIVERSE_FULL_RADIUS, SCAN_UNIVERSE_MIN_RADIUS } from './constants';

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
  it('charges by swept volume and resolves no better than a fraction of it', () => {
    expect(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS)).toBeGreaterThan(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS / 4));
    expect(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS * 4)).toBe(scanCost('universe', SCAN_UNIVERSE_FULL_RADIUS));
    expect(scanVolumeFraction('universe', SCAN_UNIVERSE_FULL_RADIUS / 2)).toBeCloseTo(0.125);
    expect(scanPrecisionRadius('universe', 4000)).toBeGreaterThan(scanPrecisionRadius('universe', 400));
    expect(scanPrecisionRadius('universe', 4000)).toBeLessThan(4000);
    expect(scanPrecisionRadius('universe', 1)).toBe(SCAN_UNIVERSE_MIN_RADIUS);
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
