import { hasCivilization } from './anomalies';

export function findCivilizationSeeds(count: number, start: number) {
  const seeds: number[] = [];
  for (let seed = start; seeds.length < count; seed = (seed + 7919) >>> 0) {
    if (hasCivilization(seed)) seeds.push(seed);
  }
  return seeds;
}
