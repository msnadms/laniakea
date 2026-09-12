import { describe, expect, it } from 'vitest';
import { generateGalaxy } from './galaxyGen';
import { generateAnomalies, hasCivilization, type AnomalyKind } from './anomalies';
import { findCivilizationSeeds } from './civilizationSeeds.testutil';
import { generateSupercluster } from './superclusters';

const GALAXY_SAMPLES = 3000;
const CIVILIZATION_SAMPLES = 400;
const SUPERCLUSTER_SAMPLES = 100;
const SUPERCLUSTER_TARGET = 1.5;

type Counts = Record<AnomalyKind, number>;

const CIVILIZATION_TARGETS: Array<{ label: string; target: number; measure: (counts: Counts) => boolean }> = [
  { label: 'Ruined Dyson sphere', target: 1, measure: (counts) => counts.dysonSphere > 0 },
  { label: 'Homeworld', target: 1, measure: (counts) => counts.homeworld > 0 },
  { label: 'Shkadov thruster', target: 0.4, measure: (counts) => counts.shkadovThruster > 0 },
  { label: 'Nicoll-Dyson beam', target: 0.4, measure: (counts) => counts.nicollDysonBeam > 0 },
  { label: 'Matrioshka brain', target: 0.08, measure: (counts) => counts.matrioshkaBrain > 0 },
];

function oneIn(rate: number) {
  return rate > 0 ? `1 in ${(1 / rate).toFixed(1)}` : 'never';
}

function countKinds(seed: number): Counts {
  const counts: Counts = { blackHole: 0, dysonSphere: 0, homeworld: 0, matrioshkaBrain: 0, nicollDysonBeam: 0, shkadovThruster: 0 };
  for (const anomaly of generateAnomalies(generateGalaxy(seed)).byHost.values()) counts[anomaly.kind]++;
  return counts;
}

describe.skipIf(!import.meta.env.ANOMALY_ODDS)('anomaly odds', () => {
  it('reports how many civilisations each supercluster holds', { timeout: 600_000 }, () => {
    const perSupercluster: number[] = [];
    for (let i = 0; i < SUPERCLUSTER_SAMPLES; i++) {
      perSupercluster.push(generateSupercluster(0x5c1a + i * 104729).dots.filter((dot) => hasCivilization(dot.seed)).length);
    }
    const mean = perSupercluster.reduce((sum, n) => sum + n, 0) / SUPERCLUSTER_SAMPLES;
    const share = (test: (n: number) => boolean) => `${((perSupercluster.filter(test).length / SUPERCLUSTER_SAMPLES) * 100).toFixed(0)}%`;
    console.table([{ mean: mean.toFixed(2), target: SUPERCLUSTER_TARGET, none: share((n) => n === 0), one: share((n) => n === 1), two: share((n) => n === 2), threeOrMore: share((n) => n >= 3) }]);
    expect(mean).toBeGreaterThan(0);
  });

  it('reports how often each anomaly turns up against its target', { timeout: 600_000 }, () => {
    let blackHoleGalaxies = 0;
    let blackHoles = 0;
    for (let i = 0; i < GALAXY_SAMPLES; i++) {
      const counts = countKinds(0x51f15e + i * 104729);
      if (counts.blackHole > 0) blackHoleGalaxies++;
      blackHoles += counts.blackHole;
    }

    const hits = CIVILIZATION_TARGETS.map(() => 0);
    let dysonSpheres = 0;
    for (const seed of findCivilizationSeeds(CIVILIZATION_SAMPLES, 0x51f15e)) {
      const counts = countKinds(seed);
      CIVILIZATION_TARGETS.forEach((row, index) => {
        if (row.measure(counts)) hits[index]++;
      });
      dysonSpheres += counts.dysonSphere;
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
    console.log(`Dyson spheres per civilisation: ${(dysonSpheres / CIVILIZATION_SAMPLES).toFixed(2)}`);
    console.log(`Black holes per galaxy with one: ${(blackHoles / Math.max(1, blackHoleGalaxies)).toFixed(2)}`);

    expect(hits[0]).toBeGreaterThan(0);
  });
});
