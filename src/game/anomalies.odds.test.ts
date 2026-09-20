import { describe, expect, it } from 'vitest';
import { generateGalaxy } from './galaxyGen';
import { CIVILIZATION_STAGES, generateAnomalies, hasCivilization, type AnomalyKind, type GalaxyAnomalies, type StagePlan } from './anomalies';
import { expectedShareWhere, expectedStageShare, findCivilizationSeeds, megastructureChance } from './civilizationSeeds.testutil';
import { ANOMALY_LIVING_CHANCE } from './constants';
import { generateSuperclusterGalaxySeeds } from './superclusters';

const GALAXY_SAMPLES = 3000;
const CIVILIZATION_SAMPLES = 400;
const SUPERCLUSTER_SAMPLES = 400;
const SUPERCLUSTER_TARGET = 1 / 50;

type Measure = (anomalies: GalaxyAnomalies) => boolean;

function has(kind: AnomalyKind): Measure {
  return (anomalies) => [...anomalies.byHost.values()].some((anomaly) => anomaly.kind === kind);
}

function where(test: (plan: StagePlan) => boolean): number {
  return expectedShareWhere((plan) => (test(plan) ? 1 : 0));
}

const CIVILIZATION_TARGETS: Array<{ label: string; target: number; measure: Measure }> = [
  ...CIVILIZATION_STAGES.map((stage) => ({
    label: `Stage ${stage}`,
    target: expectedStageShare(stage),
    measure: (anomalies: GalaxyAnomalies) => anomalies.civilization?.stage === stage,
  })),
  { label: 'Living', target: ANOMALY_LIVING_CHANCE, measure: (anomalies) => anomalies.civilization?.living === true },
  { label: 'Homeworld', target: where((plan) => plan.home === 'homeworld'), measure: has('homeworld') },
  { label: 'Alderson disk', target: where((plan) => plan.home === 'aldersonDisk'), measure: has('aldersonDisk') },
  { label: 'Home swarm', target: where((plan) => plan.homeSwarm), measure: (anomalies) => [...anomalies.byHost.values()].some((anomaly) => anomaly.swarm) },
  { label: 'Dyson sphere', target: where((plan) => plan.dysonSpheres), measure: has('dysonSphere') },
  { label: 'Caplan thruster', target: expectedShareWhere(megastructureChance), measure: has('caplanThruster') },
  { label: 'Nicoll-Dyson beam', target: expectedShareWhere(megastructureChance), measure: has('nicollDysonBeam') },
  { label: 'Matrioshka brain', target: expectedShareWhere(megastructureChance), measure: has('matrioshkaBrain') },
  { label: 'Alcubierre cannon', target: where((plan) => plan.cannon), measure: has('alcubierreCannon') },
];

function oneIn(rate: number) {
  return rate > 0 ? `1 in ${(1 / rate).toFixed(1)}` : 'never';
}

describe.skipIf(!import.meta.env.ANOMALY_ODDS)('anomaly odds', () => {
  it('reports how many civilisations each supercluster holds', { timeout: 600_000 }, () => {
    const perSupercluster: number[] = [];
    for (let i = 0; i < SUPERCLUSTER_SAMPLES; i++) {
      perSupercluster.push(generateSuperclusterGalaxySeeds(0x5c1a + i * 104729).filter(hasCivilization).length);
    }
    const total = perSupercluster.reduce((sum, n) => sum + n, 0);
    const mean = total / SUPERCLUSTER_SAMPLES;
    const share = (test: (n: number) => boolean) => `${((perSupercluster.filter(test).length / SUPERCLUSTER_SAMPLES) * 100).toFixed(0)}%`;
    console.table([{ samples: SUPERCLUSTER_SAMPLES, total, mean: mean.toFixed(3), target: SUPERCLUSTER_TARGET, none: share((n) => n === 0), one: share((n) => n === 1), twoOrMore: share((n) => n >= 2) }]);
    expect(perSupercluster).toHaveLength(SUPERCLUSTER_SAMPLES);
  });

  it('reports how often each stage and anomaly turns up against its target', { timeout: 600_000 }, () => {
    let blackHoleGalaxies = 0;
    let blackHoles = 0;
    for (let i = 0; i < GALAXY_SAMPLES; i++) {
      const count = [...generateAnomalies(generateGalaxy(0x51f15e + i * 104729)).byHost.values()].filter((anomaly) => anomaly.kind === 'blackHole').length;
      if (count > 0) blackHoleGalaxies++;
      blackHoles += count;
    }

    const hits = CIVILIZATION_TARGETS.map(() => 0);
    let dysonStructures = 0;
    for (const seed of findCivilizationSeeds(CIVILIZATION_SAMPLES, 0x51f15e)) {
      const anomalies = generateAnomalies(generateGalaxy(seed));
      CIVILIZATION_TARGETS.forEach((row, index) => {
        if (row.measure(anomalies)) hits[index]++;
      });
      dysonStructures += [...anomalies.byHost.values()].filter((anomaly) => anomaly.kind === 'dysonSphere' || anomaly.swarm).length;
    }

    console.table([
      { anomaly: 'At least one black hole (per galaxy)', measured: oneIn(blackHoleGalaxies / GALAXY_SAMPLES), target: oneIn(0.3), ratio: ((blackHoleGalaxies / GALAXY_SAMPLES) / 0.3).toFixed(2) },
      ...CIVILIZATION_TARGETS.map((row, index) => ({
        anomaly: `${row.label} (per civilisation)`,
        measured: oneIn(hits[index] / CIVILIZATION_SAMPLES),
        target: oneIn(row.target),
        ratio: ((hits[index] / CIVILIZATION_SAMPLES) / row.target).toFixed(2),
      })),
    ]);
    console.log(`Dyson swarms and spheres per civilisation: ${(dysonStructures / CIVILIZATION_SAMPLES).toFixed(2)}`);
    console.log(`Black holes per galaxy with one: ${(blackHoles / Math.max(1, blackHoleGalaxies)).toFixed(2)}`);

    expect(hits.some((hit) => hit > 0)).toBe(true);
  });
});
