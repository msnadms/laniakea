import { FieldValue } from 'firebase-admin/firestore';
import { generateAnomalies, type GalaxyAnomalies } from '../../src/game/anomalies';
import { anomalyRecordKey, type AnomalyRecord, type WorldAnomaly } from '../../src/game/anomalyRecord';
import { CONDENSATE_PER_HOMEWORLD } from '../../src/game/constants';
import { creditable } from '../../src/game/fuel';
import { generateGalaxy } from '../../src/game/galaxyGen';
import { generateGalaxyName, generateSuperclusterName } from '../../src/game/superclusters';
import type { Galaxy } from '../../src/game/types';
import { deriveAnomalySeeds, type AnomalyKey } from './anomalyKey';
import { db } from './firebase';
import { HttpError } from './httpError';
import { writeBalance } from './ledger';
import { settledBalance } from './ship';
import { paths } from './paths';
import { readPosition } from './position';
import { explorerNameOf } from './profile';

export interface CatalogueRequest {
  superclusterSeed: number;
  galaxySeed: number;
  systemId: number;
}

export interface CatalogueResult {
  record: AnomalyRecord;
  awarded: number;
  world: WorldAnomaly;
}

interface SurveyedGalaxy {
  galaxy: Galaxy;
  anomalies: GalaxyAnomalies;
}

const SURVEY_CACHE = 64;
const surveys = new Map<string, SurveyedGalaxy>();

export function surveyGalaxy(key: AnomalyKey, superclusterSeed: number, galaxySeed: number): SurveyedGalaxy {
  const cacheKey = `${superclusterSeed}:${galaxySeed}`;
  const cached = surveys.get(cacheKey);
  if (cached) {
    surveys.delete(cacheKey);
    surveys.set(cacheKey, cached);
    return cached;
  }
  const galaxy = generateGalaxy(galaxySeed);
  const survey = { galaxy, anomalies: generateAnomalies(galaxy, deriveAnomalySeeds(key, superclusterSeed, galaxySeed)) };
  if (surveys.size >= SURVEY_CACHE) surveys.delete(surveys.keys().next().value!);
  surveys.set(cacheKey, survey);
  return survey;
}

function timestampMillis(value: unknown): number {
  return (value as { toMillis?: () => number } | undefined)?.toMillis?.() ?? Date.now();
}

export async function catalogue(key: AnomalyKey, uid: string, request: CatalogueRequest): Promise<CatalogueResult> {
  const { superclusterSeed, galaxySeed, systemId } = request;
  const position = await readPosition(uid);
  if (position?.superclusterSeed !== superclusterSeed || position.galaxySeed !== galaxySeed) {
    throw new HttpError(409, 'Only the galaxy you are in can be catalogued');
  }
  const { galaxy, anomalies } = surveyGalaxy(key, superclusterSeed, galaxySeed);
  const system = galaxy.systems[systemId];
  const anomaly = system ? anomalies.byHost.get(systemId) : undefined;
  if (!system || !anomaly) throw new HttpError(404, 'No anomaly at that system');

  const recordKey = anomalyRecordKey(superclusterSeed, galaxySeed, systemId);
  const record: AnomalyRecord = {
    kind: anomaly.kind,
    living: anomaly.living,
    superclusterSeed,
    superclusterName: generateSuperclusterName(superclusterSeed),
    galaxySeed,
    galaxyName: generateGalaxyName(galaxySeed),
    systemId,
    systemName: system.name,
    discoveredAt: Date.now(),
  };

  return db.runTransaction(async (tx) => {
    const [recordSnap, markerSnap, worldSnap, userSnap] = await Promise.all([
      tx.get(paths.anomaly(uid, recordKey)),
      tx.get(paths.catalogued(uid, recordKey)),
      tx.get(paths.world(recordKey)),
      tx.get(paths.user(uid)),
    ]);
    const explorerName = explorerNameOf(userSnap);
    if (!explorerName) throw new HttpError(403, 'Choose an explorer name first');
    const firstForPlayer = !markerSnap.exists;
    const award = firstForPlayer && anomaly.kind === 'homeworld' ? CONDENSATE_PER_HOMEWORLD : 0;
    const balance = award > 0 ? await settledBalance(tx, uid) : 0;

    const world: WorldAnomaly = worldSnap.exists
      ? {
        firstBy: worldSnap.get('firstBy') as string,
        firstAt: timestampMillis(worldSnap.get('firstAt')),
        count: (worldSnap.get('count') as number) + (firstForPlayer ? 1 : 0),
      }
      : { firstBy: explorerName, firstAt: Date.now(), count: 1 };

    if (!recordSnap.exists) tx.set(paths.anomaly(uid, recordKey), { ...record, discoveredAt: FieldValue.serverTimestamp() });
    if (firstForPlayer) {
      tx.set(paths.catalogued(uid, recordKey), { kind: anomaly.kind, at: FieldValue.serverTimestamp() });
      if (worldSnap.exists) tx.update(paths.world(recordKey), { count: FieldValue.increment(1) });
      else tx.set(paths.world(recordKey), { kind: anomaly.kind, firstBy: world.firstBy, firstAt: FieldValue.serverTimestamp(), count: 1 });
    }
    const awarded = award > 0 ? creditable(balance, award) : 0;
    if (awarded > 0) writeBalance(tx, uid, balance, awarded, { type: 'award', key: recordKey, kind: anomaly.kind });

    const stored = recordSnap.exists ? { ...record, discoveredAt: timestampMillis(recordSnap.get('discoveredAt')) } : record;
    return { record: stored, awarded, world };
  });
}
