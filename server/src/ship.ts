import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import {
  approachPoint,
  clampToUniverse,
  distance,
  harvested,
  isDocked,
  startingBerth,
  towards,
  travelCost,
  travelReach,
  type Point3,
  type ShipState,
} from '../../src/game/fuel';
import { locateSupercluster, type SuperclusterLocation } from '../../src/game/universe';
import { db } from './firebase';
import { HttpError } from './httpError';
import { ledgerOf, readLedger, writeBalance, type Ledger } from './ledger';
import { paths } from './paths';

export interface Fuel {
  ship: ShipState;
  condensate: number;
}

export interface TravelResult extends Fuel {
  arrived: boolean;
}

interface LedgerFuel {
  ship: ShipState;
  ledger: Ledger;
}

function shipOf(data: FirebaseFirestore.DocumentData | undefined): ShipState | null {
  if (!data) return null;
  return { x: data.x as number, y: data.y as number, z: data.z as number, at: data.at as number };
}

function locate(superclusterSeed: number): SuperclusterLocation {
  const location = locateSupercluster(superclusterSeed);
  if (!location) throw new HttpError(404, 'No such supercluster');
  return location;
}

export async function readFuel(tx: Transaction, uid: string): Promise<LedgerFuel> {
  const [ledger, snap] = await Promise.all([readLedger(tx, uid), tx.get(paths.ship(uid))]);
  const ship = shipOf(snap.data());
  if (!ship) throw new HttpError(409, 'No ship');
  return { ship, ledger };
}

export function settleHarvest(tx: Transaction, uid: string, { ship, ledger }: LedgerFuel, now: number): number {
  tx.set(paths.ship(uid), { ...ship, at: now });
  const gained = harvested(ship, ledger.condensate, now, ledger.capacity);
  if (gained <= 0) return ledger.condensate;
  return writeBalance(tx, uid, ledger.condensate, gained, ledger.capacity, { type: 'harvest', x: ship.x, y: ship.y, z: ship.z });
}

export async function settledLedger(tx: Transaction, uid: string): Promise<Ledger> {
  const [ledger, snap] = await Promise.all([readLedger(tx, uid), tx.get(paths.ship(uid))]);
  const ship = shipOf(snap.data());
  return ship ? { ...ledger, condensate: settleHarvest(tx, uid, { ship, ledger }, Date.now()) } : ledger;
}

export async function grant(uid: string, amount: number): Promise<number> {
  return db.runTransaction(async (tx) => {
    const ledger = await settledLedger(tx, uid);
    return writeBalance(tx, uid, ledger.condensate, amount, ledger.capacity, { type: 'grant' });
  });
}

export async function availableFuel(uid: string): Promise<{ fuel: number; ledger: Ledger }> {
  const [snap, shipSnap] = await Promise.all([paths.ledger(uid).get(), paths.ship(uid).get()]);
  const ledger = ledgerOf(snap);
  const ship = shipOf(shipSnap.data());
  const fuel = ship ? ledger.condensate + harvested(ship, ledger.condensate, Date.now(), ledger.capacity) : ledger.condensate;
  return { fuel, ledger };
}

export async function shipIsAt(uid: string, superclusterSeed: number): Promise<boolean> {
  const location = locateSupercluster(superclusterSeed);
  if (!location) return false;
  const ship = shipOf((await paths.ship(uid).get()).data());
  return ship !== null && isDocked(ship, location);
}

export async function ensureShip(uid: string, superclusterSeed: number): Promise<Fuel> {
  const location = locate(superclusterSeed);
  return db.runTransaction(async (tx) => {
    const [ledgerSnap, snap] = await Promise.all([tx.get(paths.ledger(uid)), tx.get(paths.ship(uid))]);
    const ledger = ledgerOf(ledgerSnap);
    if (!ledgerSnap.exists) tx.set(paths.ledger(uid), { condensate: ledger.condensate, updatedAt: FieldValue.serverTimestamp() });
    const existing = shipOf(snap.data());
    if (existing) {
      const now = Date.now();
      return { ship: { ...existing, at: now }, condensate: settleHarvest(tx, uid, { ship: existing, ledger }, now) };
    }
    const ship = { ...startingBerth(location), at: Date.now() };
    tx.set(paths.ship(uid), ship);
    return { ship, condensate: ledger.condensate };
  });
}

export async function travel(uid: string, to: Point3, superclusterSeed: number | null): Promise<TravelResult> {
  const location = superclusterSeed === null ? null : locate(superclusterSeed);
  return db.runTransaction(async (tx) => {
    const { ship, ledger } = await readFuel(tx, uid);
    const { condensate, capacity } = ledger;
    const now = Date.now();
    const gained = harvested(ship, condensate, now, capacity);
    const fuel = condensate + gained;
    const flight = towards(ship, clampToUniverse(to), travelReach(fuel));
    let spent = travelCost(distance(ship, flight));
    let end = flight;
    let arrived = location === null;
    if (location) {
      const berth = approachPoint(flight, location);
      const jump = travelCost(distance(flight, berth));
      if (spent + jump <= fuel) {
        end = berth;
        spent += jump;
        arrived = true;
      }
    }
    const next = { x: end.x, y: end.y, z: end.z, at: now };
    tx.set(paths.ship(uid), next);
    const amount = Math.max(-condensate, gained - spent);
    const balance = amount === 0 ? condensate : writeBalance(tx, uid, condensate, amount, capacity, {
      type: 'travel',
      distance: distance(ship, end),
      harvested: gained,
      superclusterSeed: arrived ? superclusterSeed : null,
    });
    return { ship: next, condensate: balance, arrived };
  });
}
