import { describe, expect, it } from 'vitest';
import { generateGalaxy } from './galaxyGen';
import {
  anomalySeed,
  canHostAnomaly,
  CIVILIZATION_STAGE_PLANS,
  CIVILIZATION_STAGES,
  generateAnomalies,
  hasCivilization,
  highStarThreshold,
  isInCivilization,
  isRelicClass,
  isSettledPopulation,
  MEGASTRUCTURE_KINDS,
  nearestNeutronStarDistance,
  planeDistance,
  populatedWorldIds,
  relativeHeight,
  type Anomaly,
  type GalaxyAnomalies,
} from './anomalies';
import {
  ANOMALY_BEAM_RIM_MAX,
  ANOMALY_BEAM_RIM_MIN,
  ANOMALY_BLACK_HOLE_REACH,
  ANOMALY_BRAIN_MIN_DYSON_SPHERES,
  ANOMALY_DYSON_MAX,
  ANOMALY_INTEGRITY,
  ANOMALY_INTEGRITY_LIVING,
  ANOMALY_LIVING_CHANCE,
  ANOMALY_MEGASTRUCTURES_SOME_MAX,
  ANOMALY_MEGASTRUCTURES_SOME_MIN,
  ANOMALY_RUINED_MIN_STAGE,
  ANOMALY_STAGE_POPULATED,
} from './constants';
import { MILKY_WAY_NUM_ARMS, MILKY_WAY_SEED } from './hardcoded';
import { expectedStageShare, findCivilizationSeeds } from './civilizationSeeds.testutil';
import { generatePlanets, generateSystemLayout } from './planetGen';
import type { Galaxy, StarSystem } from './types';

const PLAIN_SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i * 7919);
const CIVILIZATION_SEEDS = findCivilizationSeeds(200, 1000);
const SAMPLE_SEEDS = [...PLAIN_SEEDS, ...CIVILIZATION_SEEDS];
const SAMPLE = SAMPLE_SEEDS.map((seed) => {
  const galaxy = generateGalaxy(seed);
  return { galaxy, anomalies: generateAnomalies(galaxy) };
});
const CIVILIZATIONS = SAMPLE.filter(({ anomalies }) => anomalies.civilization !== null);

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
  return digest(JSON.stringify({
    civilization: anomalies.civilization,
    byHost: [...anomalies.byHost.entries()],
    populated: [...anomalies.populated],
  }));
}

function kindCount(anomalies: GalaxyAnomalies, kind: string) {
  return [...anomalies.byHost.values()].filter((anomaly) => anomaly.kind === kind).length;
}

function megastructureCount(anomalies: GalaxyAnomalies) {
  return MEGASTRUCTURE_KINDS.reduce((sum, kind) => sum + kindCount(anomalies, kind), 0);
}

function homeTier(galaxy: Galaxy, anomalies: GalaxyAnomalies, homeId?: number): StarSystem[] {
  const civilization = anomalies.civilization!;
  const free = galaxy.systems.filter((s) => canHostAnomaly(s) && (s.id === homeId || !anomalies.byHost.has(s.id)));
  const settledHomeClass = free.filter((s) => (s.starType === 'G' || s.starType === 'K') && isSettledPopulation(s));
  return [settledHomeClass.filter((s) => isInCivilization(s, civilization)), settledHomeClass, free]
    .find((candidates) => candidates.length > 0)!;
}

function nearest(systems: readonly StarSystem[], point: { x: number; y: number }) {
  return systems.reduce((best, s) => (planeDistance(s, point) < planeDistance(best, point) ? s : best));
}

function expectCannonRule(galaxy: Galaxy, anomalies: GalaxyAnomalies, anomaly: Anomaly) {
  const civilization = anomalies.civilization!;
  const host = galaxy.systems[anomaly.hostId];
  expect(CIVILIZATION_STAGE_PLANS[civilization.stage].cannon).toBe(true);
  expect(anomaly.living).toBe(civilization.living);
  expect(anomalies.populated.has(host.id)).toBe(false);
  const free = galaxy.systems.filter((s) =>
    canHostAnomaly(s) && (s.id === host.id || !anomalies.byHost.has(s.id)) && !anomalies.populated.has(s.id)
    && isRelicClass(s) && isSettledPopulation(s));
  const inside = free.filter((s) => isInCivilization(s, civilization));
  const hostDistance = planeDistance(host, civilization);
  if (inside.length > 0) {
    expect(inside).toContain(host);
    expect(inside.filter((s) => planeDistance(s, civilization) > hostDistance)).toEqual([]);
  } else {
    expect(free).toContain(host);
    expect(free.filter((s) => planeDistance(s, civilization) < hostDistance)).toEqual([]);
  }
  expect(anomaly.direction!.z).toBe(0);
  expect(Math.hypot(anomaly.direction!.x, anomaly.direction!.y)).toBeCloseTo(1, 6);
  if (hostDistance > 0) {
    expect((anomaly.direction!.x * (host.x - civilization.x) + anomaly.direction!.y * (host.y - civilization.y)) / hostDistance).toBeGreaterThan(0.9999);
  }
}

describe('anomaly generation', () => {
  it('gives the same result for the same seed and never mutates the galaxy', () => {
    for (const seed of [...PLAIN_SEEDS.slice(0, 30), ...CIVILIZATION_SEEDS.slice(0, 30)]) {
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

  it('finds civilisations, home swarms, Dyson spheres and black holes in the sample', () => {
    expect(CIVILIZATIONS.length).toBeGreaterThan(0);
    expect(SAMPLE.some(({ anomalies }) => [...anomalies.byHost.values()].some((anomaly) => anomaly.swarm))).toBe(true);
    expect(SAMPLE.some(({ anomalies }) => kindCount(anomalies, 'dysonSphere') > 0)).toBe(true);
    expect(SAMPLE.some(({ anomalies }) => kindCount(anomalies, 'blackHole') > 0)).toBe(true);
  });

  it('rolls every stage near its weight, and never a ruined first stage', () => {
    for (const stage of CIVILIZATION_STAGES) {
      const share = CIVILIZATIONS.filter(({ anomalies }) => anomalies.civilization!.stage === stage).length / CIVILIZATIONS.length;
      expect(share).toBeGreaterThan(0);
      expect(Math.abs(share - expectedStageShare(stage))).toBeLessThan(0.1);
    }
    for (const { anomalies } of CIVILIZATIONS) {
      const { living, stage } = anomalies.civilization!;
      if (!living) expect(stage).toBeGreaterThanOrEqual(ANOMALY_RUINED_MIN_STAGE);
    }
  });

  it('rolls living civilisations near the target rate', () => {
    const livingRate = CIVILIZATIONS.filter(({ anomalies }) => anomalies.civilization!.living).length / CIVILIZATIONS.length;
    expect(livingRate).toBeGreaterThan(0);
    expect(livingRate).toBeLessThan(1);
    expect(Math.abs(livingRate - ANOMALY_LIVING_CHANCE)).toBeLessThan(0.15);
  });

  it('builds each stage out of exactly the structures its plan names', () => {
    for (const { anomalies } of SAMPLE) {
      const { civilization } = anomalies;
      if (!civilization) {
        expect([...anomalies.byHost.values()].every((anomaly) => anomaly.kind === 'blackHole')).toBe(true);
        continue;
      }
      const plan = CIVILIZATION_STAGE_PLANS[civilization.stage];
      expect(kindCount(anomalies, 'homeworld')).toBe(plan.home === 'homeworld' ? 1 : 0);
      expect(kindCount(anomalies, 'aldersonDisk')).toBe(plan.home === 'aldersonDisk' ? 1 : 0);
      expect(kindCount(anomalies, 'dysonSphere') > 0).toBe(plan.dysonSpheres);
      expect([...anomalies.byHost.values()].filter((anomaly) => anomaly.swarm).map((anomaly) => anomaly.kind)).toEqual(plan.homeSwarm ? ['homeworld'] : []);
      expect(kindCount(anomalies, 'alcubierreCannon')).toBe(plan.cannon ? 1 : 0);
      const megastructures = megastructureCount(anomalies);
      if (plan.megastructures === 'none') expect(megastructures).toBe(0);
      if (plan.megastructures === 'all') expect(megastructures).toBe(MEGASTRUCTURE_KINDS.length);
      if (plan.megastructures === 'some') {
        expect(megastructures).toBeGreaterThanOrEqual(ANOMALY_MEGASTRUCTURES_SOME_MIN);
        expect(megastructures).toBeLessThanOrEqual(ANOMALY_MEGASTRUCTURES_SOME_MAX);
      }
    }
  });

  it('places every anomaly on a host its rule allows', () => {
    for (const { galaxy, anomalies } of SAMPLE) {
      const { civilization } = anomalies;
      const threshold = highStarThreshold(galaxy.systems);
      const dysonCount = kindCount(anomalies, 'dysonSphere');
      expect(dysonCount).toBeLessThanOrEqual(ANOMALY_DYSON_MAX);
      for (const kind of MEGASTRUCTURE_KINDS) expect(kindCount(anomalies, kind)).toBeLessThanOrEqual(1);

      for (const [hostId, anomaly] of anomalies.byHost) {
        const host = galaxy.systems[hostId];
        expect(anomaly.hostId).toBe(hostId);
        expect(host.id).toBe(hostId);
        expect(canHostAnomaly(host)).toBe(true);
        expect(anomaly.seed).toBe(anomalySeed(galaxy.seed, hostId));
        const [min, max] = (anomaly.living ? ANOMALY_INTEGRITY_LIVING[anomaly.kind] : undefined) ?? ANOMALY_INTEGRITY[anomaly.kind];
        expect(anomaly.integrity).toBeGreaterThanOrEqual(min);
        expect(anomaly.integrity).toBeLessThanOrEqual(max);
        if (anomaly.kind !== 'blackHole') {
          expect(civilization).not.toBeNull();
          expect(anomaly.active).toBe(false);
          expect(anomaly.living).toBe(civilization!.living);
        } else {
          expect(anomaly.living).toBe(false);
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
          case 'caplanThruster':
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
          case 'homeworld':
          case 'aldersonDisk': {
            expect(anomaly.kind).toBe(CIVILIZATION_STAGE_PLANS[civilization!.stage].home);
            const tier = homeTier(galaxy, anomalies, host.id);
            expect(tier).toContain(host);
            const hostDistance = planeDistance(host, civilization!);
            expect(tier.filter((s) => planeDistance(s, civilization!) < hostDistance)).toEqual([]);
            break;
          }
          case 'alcubierreCannon':
            expectCannonRule(galaxy, anomalies, anomaly);
            break;
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

  it('arms every stage 6 civilisation with a cannon at the edge of its region, aimed outward', () => {
    const topStage = CIVILIZATIONS.filter(({ anomalies }) => CIVILIZATION_STAGE_PLANS[anomalies.civilization!.stage].cannon);
    expect(topStage.length).toBeGreaterThan(0);
    for (const { galaxy, anomalies } of topStage) {
      const cannon = [...anomalies.byHost.values()].find((anomaly) => anomaly.kind === 'alcubierreCannon');
      expect(cannon).toBeDefined();
      expectCannonRule(galaxy, anomalies, cannon!);
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

  it('harvests the home star and settles another world before building at any other star', () => {
    for (const stage of CIVILIZATION_STAGES) {
      if (!CIVILIZATION_STAGE_PLANS[stage].dysonSpheres) continue;
      const earlier = CIVILIZATION_STAGES.filter((s) => s < stage);
      expect(earlier.some((s) => CIVILIZATION_STAGE_PLANS[s].homeSwarm && ANOMALY_STAGE_POPULATED[s][0] > 0)).toBe(true);
    }
  });

  it('builds every homeworld over into an ecumenopolis without renaming its planets', () => {
    let checked = 0;
    for (const { galaxy, anomalies } of SAMPLE) {
      for (const anomaly of anomalies.byHost.values()) {
        if (anomaly.kind !== 'homeworld') continue;
        const host = galaxy.systems[anomaly.hostId];
        const layout = generateSystemLayout(host.seed, host.starType, 'homeworld');
        const zones = layout.planets.map((p) => p.zone);
        expect(zones).toContain('ecumenopolis');
        expect(zones).not.toContain('habitable');
        const plainNames = generatePlanets(generateSystemLayout(host.seed, host.starType)).map((p) => p.name);
        expect(generatePlanets(layout).map((p) => p.name)).toEqual(plainNames);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('turns every rocky world around a living Dyson sphere into a foundry without changing the system', () => {
    for (const seed of PLAIN_SEEDS) {
      for (const starType of ['F', 'G', 'K'] as const) {
        const ruined = generateSystemLayout(seed, starType, 'dysonSphere');
        const living = generateSystemLayout(seed, starType, 'dysonSphere', false, true);
        expect(living.planets.map((p) => p.zone)).toContain('foundry');
        expect(living.planets.map((p) => p.zone)).toEqual(ruined.planets.map((p) => (p.zone === 'gas' || p.zone === 'ice' ? p.zone : 'foundry')));
        expect(living.planets.map((p) => ({ ...p, zone: null }))).toEqual(ruined.planets.map((p) => ({ ...p, zone: null })));
        expect(living.asteroidGapIdx).toBe(ruined.asteroidGapIdx);
        expect(generatePlanets(living).map((p) => p.name)).toEqual(generatePlanets(ruined).map((p) => p.name));
      }
    }
  });

  it('builds Alderson disks out of the inner worlds without renaming the outer ones', () => {
    for (const seed of PLAIN_SEEDS) {
      for (const starType of ['F', 'G', 'K', 'M', 'A'] as const) {
        const plain = generateSystemLayout(seed, starType);
        const layout = generateSystemLayout(seed, starType, 'aldersonDisk');
        const dismantled = layout.dismantledRings ?? 0;
        expect(dismantled).toBeGreaterThan(0);
        expect(layout.planets).toEqual(plain.planets.slice(dismantled));
        expect(layout.planets.map((p) => p.zone).every((zone) => zone === 'ice')).toBe(true);
        expect(layout.diskRim).toEqual(plain.planets.find((p) => p.zone === 'gas' || p.zone === 'ice'));
        expect(generatePlanets(layout).map((p) => p.name)).toEqual(generatePlanets(plain).map((p) => p.name).slice(dismantled));
        const plainGap = plain.asteroidGapIdx;
        expect(layout.asteroidGapIdx).toBe(plainGap !== null && plainGap >= dismantled ? plainGap - dismantled : null);
      }
    }
  });

  it('populates worlds inside living civilisations by stage, and none elsewhere', () => {
    let checked = 0;
    let firstStageHomes = 0;
    for (const { galaxy, anomalies } of SAMPLE) {
      const { civilization, populated } = anomalies;
      if (!civilization?.living) {
        expect(populated.size).toBe(0);
        continue;
      }
      expect([...populatedWorldIds(galaxy.seed)]).toEqual([...populated]);
      const plan = CIVILIZATION_STAGE_PLANS[civilization.stage];
      const home = plan.home ? null : nearest(homeTier(galaxy, anomalies), civilization);
      if (home) {
        expect(populated.has(home.id)).toBe(true);
        firstStageHomes++;
      }
      const extras = [...populated].filter((id) => id !== home?.id);
      const candidates = galaxy.systems.filter((s) =>
        canHostAnomaly(s) && !anomalies.byHost.has(s.id) && s.id !== home?.id
        && isRelicClass(s) && isSettledPopulation(s) && isInCivilization(s, civilization));
      const [min, max] = ANOMALY_STAGE_POPULATED[civilization.stage];
      expect(extras.length).toBeGreaterThanOrEqual(Math.min(min, candidates.length));
      expect(extras.length).toBeLessThanOrEqual(max);
      for (const hostId of extras) expect(candidates).toContain(galaxy.systems[hostId]);

      for (const hostId of populated) {
        const host = galaxy.systems[hostId];
        const layout = generateSystemLayout(host.seed, host.starType, null, true);
        const zones = layout.planets.map((p) => p.zone);
        expect(zones).toContain('populated');
        expect(zones).not.toContain('habitable');
        const plainNames = generatePlanets(generateSystemLayout(host.seed, host.starType)).map((p) => p.name);
        expect(generatePlanets(layout).map((p) => p.name)).toEqual(plainNames);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(firstStageHomes).toBeGreaterThan(0);
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
