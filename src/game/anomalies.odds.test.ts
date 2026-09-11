import { describe, expect, it } from 'vitest';
import { generateGalaxy } from './galaxyGen';
import { generateAnomalies, type AnomalyKind } from './anomalies';

const SAMPLES = 3000;

const TARGETS: Array<{ label: string; target: number; measure: (counts: Record<AnomalyKind, number>, hasCivilization: boolean) => boolean }> = [
  { label: 'Civilisation galaxies', target: 1 / 20, measure: (_, hasCivilization) => hasCivilization },
  { label: 'At least one black hole', target: 0.3, measure: (counts) => counts.blackHole > 0 },
  { label: 'Ruined Dyson sphere', target: 1 / 20, measure: (counts) => counts.dysonSphere > 0 },
  { label: 'Shkadov thruster', target: 1 / 50, measure: (counts) => counts.shkadovThruster > 0 },
  { label: 'Nicoll-Dyson beam', target: 1 / 65, measure: (counts) => counts.nicollDysonBeam > 0 },
  { label: 'Matrioshka brain', target: 1 / 250, measure: (counts) => counts.matrioshkaBrain > 0 },
];

function oneIn(rate: number) {
  return rate > 0 ? `1 in ${(1 / rate).toFixed(1)}` : 'never';
}

describe.skipIf(!import.meta.env.ANOMALY_ODDS)('anomaly odds', () => {
  it('reports how often each anomaly turns up against its target', { timeout: 600_000 }, () => {
    const hits = TARGETS.map(() => 0);
    let dysonSpheres = 0;
    let dysonGalaxies = 0;
    let blackHoles = 0;

    for (let i = 0; i < SAMPLES; i++) {
      const galaxy = generateGalaxy(0x51f15e + i * 104729);
      const anomalies = generateAnomalies(galaxy);
      const counts: Record<AnomalyKind, number> = { blackHole: 0, dysonSphere: 0, matrioshkaBrain: 0, nicollDysonBeam: 0, shkadovThruster: 0 };
      for (const anomaly of anomalies.byHost.values()) counts[anomaly.kind]++;
      TARGETS.forEach((row, index) => {
        if (row.measure(counts, anomalies.civilization !== null)) hits[index]++;
      });
      dysonSpheres += counts.dysonSphere;
      if (counts.dysonSphere > 0) dysonGalaxies++;
      blackHoles += counts.blackHole;
    }

    console.table(TARGETS.map((row, index) => ({
      anomaly: row.label,
      measured: oneIn(hits[index] / SAMPLES),
      target: oneIn(row.target),
      ratio: ((hits[index] / SAMPLES) / row.target).toFixed(2),
    })));
    console.log(`Dyson spheres per Dyson galaxy: ${(dysonSpheres / Math.max(1, dysonGalaxies)).toFixed(2)}`);
    console.log(`Black holes per galaxy with one: ${(blackHoles / Math.max(1, hits[1])).toFixed(2)}`);

    expect(hits[0]).toBeGreaterThan(0);
  });
});
