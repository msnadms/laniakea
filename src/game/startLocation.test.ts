import { describe, expect, it } from 'vitest';
import { randomStartLocation } from './startLocation';
import { createRng } from './galaxyGen';
import { getSuperclusterCoords } from './universe';
import { superclusterDotCount, superclusterGalaxyIndex } from './superclusters';
import { LANIAKEA_SEED } from './hardcoded';
import { START_RADIUS_FRACTION, UNIVERSE_RADIUS } from './constants';

describe('randomStartLocation', () => {
  const starts = Array.from({ length: 12 }, (_, i) => randomStartLocation(createRng(1000 + i))!);

  it('starts in a galaxy the supercluster really holds', () => {
    for (const start of starts) {
      expect(start).not.toBeNull();
      expect(start.superclusterSeed).not.toBe(LANIAKEA_SEED);
      expect(superclusterGalaxyIndex(start.superclusterSeed, start.galaxySeed)).toBeLessThan(superclusterDotCount(start.superclusterSeed));
      expect(start.address.map((a) => a.type).at(-1)).toBe('galaxy');
    }
  });

  it('scatters players across the universe rather than near Laniakea', () => {
    const distances = starts.map((s) => Math.hypot(...getSuperclusterCoords(s.superclusterSeed)));
    for (const d of distances) expect(d).toBeLessThanOrEqual(START_RADIUS_FRACTION * UNIVERSE_RADIUS);
    expect(new Set(starts.map((s) => s.superclusterSeed)).size).toBe(starts.length);
    expect(Math.min(...distances)).toBeGreaterThan(2_000);
  });
});
