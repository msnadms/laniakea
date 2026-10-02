import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import {
  baseKey,
  baseOf,
  foundBase,
  isSettleableWorld,
  settleBase,
  worldQuality,
  type Base,
  type BaseAddress,
  type Outcome,
} from '../../src/game/base';
import { isChartedHome } from '../../src/game/discovery';
import { creditable, isDocked } from '../../src/game/fuel';
import { generatePlanets, generateSystemLayout } from '../../src/game/planetGen';
import { generateGalaxyName, generateSuperclusterName } from '../../src/game/superclusters';
import { locateSupercluster } from '../../src/game/universe';
import type { AnomalyKey } from './anomalyKey';
import { surveyGalaxy } from './catalogue';
import { db } from './firebase';
import { HttpError } from './httpError';
import { logEntry, readLedger, writeBalance, writeTechnology, type Ledger } from './ledger';
import { paths } from './paths';
import { readPosition } from './position';
import { readFuel, settleHarvest } from './ship';

export interface BaseReply {
  base: Base;
  technology: number;
}

export interface CollectReply {
  base: Base;
  condensate: number;
  collected: number;
}

export type BaseAction = 'build' | 'defence' | 'defenceUpgrade' | 'defenceMove' | 'ship';

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
    quality: worldQuality(planet, system.starType),
  }, now);

  return db.runTransaction(async (tx) => {
    const [existing, claim, ledger] = await Promise.all([
      tx.get(paths.base(uid)),
      tx.get(paths.baseClaim(baseKey(address))),
      readLedger(tx, uid),
    ]);
    if (existing.exists) throw new HttpError(409, 'You already have a base');
    if (claim.exists) throw new HttpError(409, 'Someone has already settled that world');
    tx.create(paths.baseClaim(baseKey(address)), { uid, superclusterSeed, galaxySeed, systemId, ring, at: FieldValue.serverTimestamp() });
    writeBase(tx, uid, base);
    logEntry(tx, uid, { type: 'found', key: baseKey(address) });
    return { base, technology: ledger.technology };
  });
}

export async function act(uid: string, action: BaseAction, apply: (base: Base, technology: number, now: number) => Outcome): Promise<BaseReply> {
  return db.runTransaction(async (tx) => {
    const [stored, ledger] = await Promise.all([readBase(tx, uid), readLedger(tx, uid)]);
    const now = Date.now();
    const outcome = apply(settleBase(stored, now), ledger.technology, now);
    if (!outcome.ok) throw new HttpError(outcome.refusal.status, outcome.refusal.message);
    writeBase(tx, uid, outcome.base);
    const technology = spendTechnology(tx, uid, ledger, outcome.technology, action);
    return { base: outcome.base, technology };
  });
}

function spendTechnology(tx: Transaction, uid: string, ledger: Ledger, cost: number, action: BaseAction): number {
  if (cost === 0) return ledger.technology;
  return writeTechnology(tx, uid, ledger, -cost, ledger.tech, { type: 'base', action });
}

export async function collect(uid: string): Promise<CollectReply> {
  return db.runTransaction(async (tx) => {
    const [stored, fuel] = await Promise.all([readBase(tx, uid), readFuel(tx, uid)]);
    const home = locateSupercluster(stored.superclusterSeed);
    if (!home || !isDocked(fuel.ship, home)) throw new HttpError(409, 'Your ship must be docked at your base\'s supercluster');
    const now = Date.now();
    const base = settleBase(stored, now);
    const balance = settleHarvest(tx, uid, fuel, now);
    const collected = creditable(balance, base.condensate, fuel.ledger.capacity);
    if (collected <= 0) {
      writeBase(tx, uid, base);
      return { base, condensate: balance, collected: 0 };
    }
    const next = { ...base, condensate: base.condensate - collected };
    writeBase(tx, uid, next);
    const condensate = writeBalance(tx, uid, balance, collected, fuel.ledger.capacity, { type: 'collect', key: baseKey(base) });
    return { base: next, condensate, collected };
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

export async function grantAlloys(uid: string, amount: number): Promise<Base> {
  return db.runTransaction(async (tx) => {
    const base = settleBase(await readBase(tx, uid), Date.now());
    const next = { ...base, alloys: base.alloys + amount };
    writeBase(tx, uid, next);
    return next;
  });
}
