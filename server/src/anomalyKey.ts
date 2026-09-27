import { createHmac } from 'node:crypto';
import { civilizationProfile, type AnomalySeeds } from '../../src/game/anomalies';
import { ANOMALY_SUPERCLUSTER_CIVILIZATION_CHANCE, SC_MAX_GALAXY_DOTS } from '../../src/game/constants';
import { LANIAKEA_SEED, MILKY_WAY_SEED } from '../../src/game/hardcoded';
import type { SuperclusterCivilization } from '../../src/game/scanSurvey';
import { superclusterDotCount, superclusterGalaxyIndex, superclusterGalaxySeedAt } from '../../src/game/superclusters';

export type AnomalyKey = Buffer;

export interface CivilizationRoll {
  index: number;
  civilizationSeed: number;
}

export interface SuperclusterCivilizationSite extends CivilizationRoll {
  galaxySeed: number;
}

const KEY_BYTES = 32;
const DOT_COUNT_CACHE = 100_000;

export function parseAnomalyKey(hex: string): AnomalyKey {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`ANOMALY_KEY must be ${KEY_BYTES} bytes of hex`);
  return Buffer.from(hex, 'hex');
}

function digest(key: AnomalyKey, label: string, value: number): Buffer {
  const word = Buffer.alloc(4);
  word.writeUInt32BE(value >>> 0);
  return createHmac('sha256', key).update(label).update('\0').update(word).digest();
}

export function rollSupercluster(key: AnomalyKey, superclusterSeed: number): CivilizationRoll | null {
  const bytes = digest(key, 'civilization', superclusterSeed);
  if (bytes.readUInt32BE(0) / 4294967296 >= ANOMALY_SUPERCLUSTER_CIVILIZATION_CHANCE) return null;
  return { index: bytes.readUInt32BE(4) % SC_MAX_GALAXY_DOTS, civilizationSeed: bytes.readUInt32BE(8) };
}

const dotCounts = new Map<number, number>();

export function cachedDotCount(superclusterSeed: number): number {
  const cached = dotCounts.get(superclusterSeed);
  if (cached !== undefined) return cached;
  const count = superclusterDotCount(superclusterSeed);
  if (dotCounts.size >= DOT_COUNT_CACHE) dotCounts.delete(dotCounts.keys().next().value!);
  dotCounts.set(superclusterSeed, count);
  return count;
}

export function galaxyInSupercluster(superclusterSeed: number, galaxySeed: number): boolean {
  if (galaxySeed === MILKY_WAY_SEED) return superclusterSeed === LANIAKEA_SEED;
  return superclusterGalaxyIndex(superclusterSeed, galaxySeed) < cachedDotCount(superclusterSeed);
}

export function superclusterCivilization(key: AnomalyKey, superclusterSeed: number): SuperclusterCivilizationSite | null {
  const roll = rollSupercluster(key, superclusterSeed);
  if (!roll || roll.index >= cachedDotCount(superclusterSeed)) return null;
  const galaxySeed = superclusterGalaxySeedAt(superclusterSeed, roll.index);
  if (galaxySeed === MILKY_WAY_SEED) return null;
  return { ...roll, galaxySeed };
}

export function civilizationProfileOf(key: AnomalyKey, superclusterSeed: number): SuperclusterCivilization | null {
  const site = superclusterCivilization(key, superclusterSeed);
  return site ? { index: site.index, profile: civilizationProfile(site.civilizationSeed) } : null;
}

export function deriveAnomalySeeds(key: AnomalyKey, superclusterSeed: number, galaxySeed: number): AnomalySeeds {
  const site = superclusterCivilization(key, superclusterSeed);
  const bytes = digest(key, 'galaxy', galaxySeed);
  return {
    civilization: site?.galaxySeed === galaxySeed ? site.civilizationSeed : null,
    blackHoles: bytes.readUInt32BE(0),
    populated: bytes.readUInt32BE(4),
  };
}
