import { describe, expect, it } from 'vitest';
import { generateGalaxy } from './galaxyGen';
import {
  anomalySeed,
  canHostAnomaly,
  generateAnomalies,
  hasCivilization,
  highStarThreshold,
  isInCivilization,
  isRelicClass,
  isSettledPopulation,
  nearestNeutronStarDistance,
  planeDistance,
  relativeHeight,
  type GalaxyAnomalies,
} from './anomalies';
import {
  ANOMALY_BEAM_RIM_MAX,
  ANOMALY_BEAM_RIM_MIN,
  ANOMALY_BLACK_HOLE_REACH,
  ANOMALY_BRAIN_MIN_DYSON_SPHERES,
  ANOMALY_DYSON_MAX,
  ANOMALY_INTEGRITY,
} from './constants';
import { MILKY_WAY_NUM_ARMS, MILKY_WAY_SEED } from './hardcoded';
import { generateSystemLayout } from './planetGen';
import type { Galaxy } from './types';

const SAMPLE_SEEDS = Array.from({ length: 500 }, (_, i) => 1000 + i * 7919);
const SAMPLE = SAMPLE_SEEDS.map((seed) => {
  const galaxy = generateGalaxy(seed);
  return { galaxy, anomalies: generateAnomalies(galaxy) };
});

function digest(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function galaxyDigest(galaxy: Galaxy) {
  return digest(JSON.stringify({ systems: galaxy.systems, config: galaxy.config, backgroundStars: galaxy.backgroundStars }));
}

function anomaliesDigest(anomalies: GalaxyAnomalies) {
  return digest(JSON.stringify({ civilization: anomalies.civilization, byHost: [...anomalies.byHost.entries()] }));
}

function kindCount(anomalies: GalaxyAnomalies, kind: string) {
  return [...anomalies.byHost.values()].filter((anomaly) => anomaly.kind === kind).length;
}

describe('anomaly generation', () => {
  it('gives the same result for the same seed and never mutates the galaxy', () => {
    for (const seed of SAMPLE_SEEDS.slice(0, 60)) {
      const galaxy = generateGalaxy(seed);
      const before = galaxyDigest(galaxy);
      const first = anomaliesDigest(generateAnomalies(galaxy));
      const second = anomaliesDigest(generateAnomalies(galaxy));
      expect(second).toBe(first);
      expect(galaxyDigest(galaxy)).toBe(before);
      expect(anomaliesDigest(generateAnomalies(generateGalaxy(seed)))).toBe(first);
    }
  });

  it('answers hasCivilization from the seed alone', () => {
    for (const { galaxy, anomalies } of SAMPLE) {
      expect(hasCivilization(galaxy.seed)).toBe(anomalies.civilization !== null);
    }
  });

  it('finds civilisations, Dyson spheres and black holes in the sample', () => {
    expect(SAMPLE.some(({ anomalies }) => anomalies.civilization !== null)).toBe(true);
    expect(SAMPLE.some(({ anomalies }) => kindCount(anomalies, 'dysonSphere') > 0)).toBe(true);
    expect(SAMPLE.some(({ anomalies }) => kindCount(anomalies, 'blackHole') > 0)).toBe(true);
  });

  it('places every anomaly on a host its rule allows', () => {
    for (const { galaxy, anomalies } of SAMPLE) {
      const { civilization } = anomalies;
      const threshold = highStarThreshold(galaxy.systems);
      const dysonCount = kindCount(anomalies, 'dysonSphere');
      expect(dysonCount).toBeLessThanOrEqual(ANOMALY_DYSON_MAX);
      expect(kindCount(anomalies, 'matrioshkaBrain')).toBeLessThanOrEqual(1);
      expect(kindCount(anomalies, 'shkadovThruster')).toBeLessThanOrEqual(1);
      expect(kindCount(anomalies, 'nicollDysonBeam')).toBeLessThanOrEqual(1);

      for (const [hostId, anomaly] of anomalies.byHost) {
        const host = galaxy.systems[hostId];
        expect(anomaly.hostId).toBe(hostId);
        expect(host.id).toBe(hostId);
        expect(canHostAnomaly(host)).toBe(true);
        expect(anomaly.seed).toBe(anomalySeed(galaxy.seed, hostId));
        const [min, max] = ANOMALY_INTEGRITY[anomaly.kind];
        expect(anomaly.integrity).toBeGreaterThanOrEqual(min);
        expect(anomaly.integrity).toBeLessThanOrEqual(max);
        if (anomaly.kind !== 'blackHole') {
          expect(civilization).not.toBeNull();
          expect(anomaly.active).toBe(false);
        }

        switch (anomaly.kind) {
          case 'dysonSphere':
            expect(isRelicClass(host)).toBe(true);
            expect(isSettledPopulation(host)).toBe(true);
            expect(isInCivilization(host, civilization!)).toBe(true);
            break;
          case 'matrioshkaBrain': {
            expect(host.starType).toBe('K');
            expect(isSettledPopulation(host)).toBe(true);
            expect(isInCivilization(host, civilization!)).toBe(true);
            expect(dysonCount).toBeGreaterThanOrEqual(ANOMALY_BRAIN_MIN_DYSON_SPHERES);
            const hostDistance = planeDistance(host, civilization!);
            const nearer = galaxy.systems.filter((s) =>
              s.id !== host.id && s.starType === 'K' && isSettledPopulation(s) && planeDistance(s, civilization!) < hostDistance);
            expect(nearer).toEqual([]);
            break;
          }
          case 'shkadovThruster':
            expect(isRelicClass(host)).toBe(true);
            expect(isInCivilization(host, civilization!)).toBe(false);
            expect(relativeHeight(host)).toBeGreaterThanOrEqual(threshold);
            expect(anomaly.direction).not.toBeNull();
            expect(Math.hypot(anomaly.direction!.x, anomaly.direction!.y, anomaly.direction!.z)).toBeCloseTo(1, 6);
            break;
          case 'nicollDysonBeam': {
            expect(isRelicClass(host)).toBe(true);
            const reach = planeDistance(host, civilization!) / civilization!.radius;
            expect(reach).toBeGreaterThanOrEqual(ANOMALY_BEAM_RIM_MIN);
            expect(reach).toBeLessThanOrEqual(ANOMALY_BEAM_RIM_MAX);
            break;
          }
          case 'blackHole':
            expect(nearestNeutronStarDistance(host, galaxy.systems)).toBeLessThanOrEqual(ANOMALY_BLACK_HOLE_REACH);
            expect(anomaly.direction).toBeNull();
            break;
        }
      }
    }
  });

  it('aims every beam at the brain, or at the region centre when there is none', () => {
    for (const { galaxy, anomalies } of SAMPLE) {
      const all = [...anomalies.byHost.values()];
      const beam = all.find((anomaly) => anomaly.kind === 'nicollDysonBeam');
      if (!beam) continue;
      const brain = all.find((anomaly) => anomaly.kind === 'matrioshkaBrain');
      const host = galaxy.systems[beam.hostId];
      const target = brain ? galaxy.systems[brain.hostId] : anomalies.civilization!;
      const dx = target.x - host.x;
      const dy = target.y - host.y;
      const length = Math.hypot(dx, dy);
      expect(beam.direction!.z).toBe(0);
      expect((beam.direction!.x * dx + beam.direction!.y * dy) / length).toBeGreaterThan(0.9999);
    }
  });

  it('leaves no hot or habitable worlds around Dyson spheres and Matrioshka brains', () => {
    let checked = 0;
    for (const { galaxy, anomalies } of SAMPLE) {
      for (const anomaly of anomalies.byHost.values()) {
        if (anomaly.kind !== 'dysonSphere' && anomaly.kind !== 'matrioshkaBrain') continue;
        const host = galaxy.systems[anomaly.hostId];
        const zones = generateSystemLayout(host.seed, host.starType, anomaly.kind).planets.map((p) => p.zone);
        expect(zones).not.toContain('hot');
        expect(zones).not.toContain('habitable');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('hosts nothing in the Milky Way', () => {
    const milkyWay = generateGalaxy(MILKY_WAY_SEED, { numArms: MILKY_WAY_NUM_ARMS, type: 'barred' });
    const anomalies = generateAnomalies(milkyWay);
    expect(hasCivilization(MILKY_WAY_SEED)).toBe(false);
    expect(anomalies.civilization).toBeNull();
    expect(anomalies.byHost.size).toBe(0);
  });

  it('records every star population, including the hand-authored Milky Way systems', () => {
    const milkyWay = generateGalaxy(MILKY_WAY_SEED, { numArms: MILKY_WAY_NUM_ARMS, type: 'barred' });
    for (const system of [...milkyWay.systems, ...SAMPLE[0].galaxy.systems]) {
      expect(system.population).toMatch(/^(bulge|disk|arm|bar|halo|starburst)$/);
    }
  });
});
