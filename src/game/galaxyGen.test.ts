import { describe, expect, it } from 'vitest';
import { generateGalaxy } from './galaxyGen';
import { GALAXY_RADIUS, POPULATION_SCALE_HEIGHT } from './constants';

// [seed, star count, identity digest, geometry digest].
//
// The identity digest covers every field the seed-to-galaxy contract fixes — id,
// name, star type, size, per-system seed and arm — and is carried over unchanged
// from the build before the projected view, so a shift in the primary RNG
// sequence fails here. The geometry digest covers x, y and the sampled height,
// and is re-baselined whenever the tilt, the ellipticity range or the population
// scale heights are tuned; silhouettes are allowed to change, drifting without
// intent is not.
const GOLD: [number, number, number, number][] = [
  [1, 487, 3103340964, 2383409399],
  [42, 560, 25863766, 3653968658],
  [1337, 596, 2122042907, 4168689878],
  [987654321, 677, 4128621345, 2663941110],
  [20250905, 685, 935156717, 2937779712],
  [24301, 433, 1094996472, 3973934393],
];

function digest(fields: string[]) {
  let hash = 2166136261;
  for (const field of fields) {
    for (let i = 0; i < field.length; i++) {
      hash ^= field.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

describe('galaxy generation', () => {
  it('keeps star count, types, names, sizes and per-system seeds fixed per seed', () => {
    for (const [seed, count, identity] of GOLD) {
      const systems = generateGalaxy(seed).systems;
      expect(systems.length).toBe(count);
      expect(digest(systems.map((s) => `${s.id}|${s.name}|${s.starType}|${s.size.toFixed(6)}|${s.seed}|${s.arm}`))).toBe(identity);
    }
  });

  it('places every star at the same point in space for a given seed', () => {
    for (const [seed, , , geometry] of GOLD) {
      const systems = generateGalaxy(seed).systems;
      expect(digest(systems.map((s) => `${s.x.toFixed(6)}|${s.y.toFixed(6)}|${s.z.toFixed(6)}`))).toBe(geometry);
    }
  });

  it('keeps every star within the thickest population scale height', () => {
    const limit = GALAXY_RADIUS * POPULATION_SCALE_HEIGHT.halo;
    for (const [seed] of GOLD) {
      for (const s of generateGalaxy(seed).systems) {
        expect(Number.isFinite(s.z)).toBe(true);
        expect(Math.abs(s.z)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('gives the disk real thickness on both sides of the plane', () => {
    const systems = generateGalaxy(1337).systems;
    expect(systems.some((s) => s.z > 1)).toBe(true);
    expect(systems.some((s) => s.z < -1)).toBe(true);
  });

  it('samples bulge stars into a spheroid rather than a slab', () => {
    const systems = generateGalaxy(20250905).systems;
    const core = systems.filter((s) => Math.hypot(s.x, s.y) < GALAXY_RADIUS * 0.15);
    const outer = systems.filter((s) => Math.hypot(s.x, s.y) > GALAXY_RADIUS * 0.5);
    const spread = (group: typeof systems) => group.reduce((sum, s) => sum + Math.abs(s.z), 0) / group.length;
    expect(spread(core)).toBeGreaterThan(spread(outer));
  });
});
