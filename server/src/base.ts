import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { baseKey, baseOf, foundBase, isSettleableWorld, type Base, type BaseAddress, type Outcome } from '../../src/game/base';
import { depositAt, surfaceWorld, type SurfaceCell, type SurfaceDeposit } from '../../src/game/baseSurface';
import { isChartedHome } from '../../src/game/discovery';
import { generatePlanets, generateSystemLayout } from '../../src/game/planetGen';
import { generateGalaxyName, generateSuperclusterName } from '../../src/game/superclusters';
import type { AnomalyKey } from './anomalyKey';
import { surveyGalaxy } from './catalogue';
import { db } from './firebase';
import { HttpError } from './httpError';
import { logEntry } from './ledger';
import { paths } from './paths';
import { readPosition } from './position';

export interface BaseReply {
  base: Base;
}

async function readBase(tx: Transaction, uid: string): Promise<Base> {
  const snap = await tx.get(paths.base(uid));
  const data = snap.data();
  if (!data) throw new HttpError(409, 'You have no base');
  return baseOf(data);
}

function writeBase(tx: Transaction, uid: string, base: Base) {
  tx.set(paths.base(uid), { ...base, updatedAt: FieldValue.serverTimestamp() });
}

export async function found(key: AnomalyKey, uid: string, address: BaseAddress): Promise<BaseReply> {
  const { superclusterSeed, galaxySeed, systemId, ring } = address;
  if (isChartedHome(superclusterSeed, galaxySeed)) throw new HttpError(409, 'The Milky Way cannot be settled');
  const position = await readPosition(uid);
  if (position?.superclusterSeed !== superclusterSeed || position.galaxySeed !== galaxySeed) {
    throw new HttpError(409, 'Only a world in the galaxy you are in can be settled');
  }
  const { galaxy, anomalies } = surveyGalaxy(key, superclusterSeed, galaxySeed);
  const system = galaxy.systems[systemId];
  if (!system) throw new HttpError(404, 'No such system in that galaxy');
  const anomaly = anomalies.byHost.get(systemId);
  const layout = generateSystemLayout(system.seed, system.starType, anomaly?.kind, anomalies.populated.has(systemId), anomaly?.living);
  const planet = layout.planets[ring];
  if (!isSettleableWorld(planet)) throw new HttpError(409, 'That world cannot be settled');
  const now = Date.now();
  const base = foundBase({
    ...address,
    planetName: generatePlanets(layout)[ring].name,
    systemName: system.name,
    galaxyName: generateGalaxyName(galaxySeed),
    superclusterName: generateSuperclusterName(superclusterSeed),
  }, now);

  return db.runTransaction(async (tx) => {
    const [existing, claim] = await Promise.all([tx.get(paths.base(uid)), tx.get(paths.baseClaim(baseKey(address)))]);
    if (existing.exists) throw new HttpError(409, 'You already have a base');
    if (claim.exists) throw new HttpError(409, 'Someone has already settled that world');
    tx.create(paths.baseClaim(baseKey(address)), { uid, superclusterSeed, galaxySeed, systemId, ring, at: FieldValue.serverTimestamp() });
    writeBase(tx, uid, base);
    logEntry(tx, uid, { type: 'found', key: baseKey(address) });
    return { base };
  });
}

const DEPOSIT_CACHE_SIZE = 32;
const depositCache = new Map<string, SurfaceDeposit[]>();

function surfaceDeposits(address: BaseAddress): SurfaceDeposit[] {
  const key = baseKey(address);
  const cached = depositCache.get(key);
  if (cached) {
    depositCache.delete(key);
    depositCache.set(key, cached);
    return cached;
  }
  const { deposits } = surfaceWorld(address);
  depositCache.set(key, deposits);
  if (depositCache.size > DEPOSIT_CACHE_SIZE) depositCache.delete(depositCache.keys().next().value!);
  return deposits;
}

export function surfaceDepositAt(base: Base, cell: SurfaceCell): SurfaceDeposit | null {
  return depositAt(surfaceDeposits(base), cell);
}

export async function act(uid: string, apply: (base: Base) => Outcome): Promise<BaseReply> {
  return db.runTransaction(async (tx) => {
    const outcome = apply(await readBase(tx, uid));
    if (!outcome.ok) throw new HttpError(outcome.refusal.status, outcome.refusal.message);
    writeBase(tx, uid, outcome.base);
    return { base: outcome.base };
  });
}

export async function claimedRings(uid: string, superclusterSeed: number, galaxySeed: number, systemId: number): Promise<number[]> {
  const position = await readPosition(uid);
  if (position?.superclusterSeed !== superclusterSeed || position.galaxySeed !== galaxySeed) {
    throw new HttpError(409, 'Only the galaxy you are in can be surveyed');
  }
  const snap = await paths.baseClaims()
    .where('superclusterSeed', '==', superclusterSeed)
    .where('galaxySeed', '==', galaxySeed)
    .where('systemId', '==', systemId)
    .get();
  return snap.docs.map((doc) => doc.get('ring') as number);
}
