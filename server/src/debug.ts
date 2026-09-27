import { generateAnomalies, type AnomalyKind } from '../../src/game/anomalies';
import { generateGalaxy } from '../../src/game/galaxyGen';
import { deriveAnomalySeeds, superclusterCivilization, type AnomalyKey } from './anomalyKey';

export interface SuperclusterMark {
  galaxySeed: number;
  kind: AnomalyKind | null;
  living: boolean;
}

const KIND_RANK: readonly AnomalyKind[] = [
  'alcubierreCannon',
  'aldersonDisk',
  'matrioshkaBrain',
  'nicollDysonBeam',
  'caplanThruster',
  'dysonSphere',
  'homeworld',
  'blackHole',
];

export function superclusterMark(key: AnomalyKey, superclusterSeed: number): SuperclusterMark | null {
  const site = superclusterCivilization(key, superclusterSeed);
  if (!site) return null;
  const anomalies = generateAnomalies(generateGalaxy(site.galaxySeed), deriveAnomalySeeds(key, superclusterSeed, site.galaxySeed));
  const kinds = new Set([...anomalies.byHost.values()].map((anomaly) => anomaly.kind));
  return {
    galaxySeed: site.galaxySeed,
    kind: KIND_RANK.find((kind) => kinds.has(kind)) ?? null,
    living: anomalies.civilization?.living ?? false,
  };
}
