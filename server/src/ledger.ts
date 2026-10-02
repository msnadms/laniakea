import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { CONDENSATE_START } from '../../src/game/constants';
import { creditable } from '../../src/game/fuel';
import { NO_TECH, tankCapacity, techLevelsOf, type TechLevels, type TechPath } from '../../src/game/tech';
import { db } from './firebase';
import { paths } from './paths';

export type LedgerEntry =
  | { type: 'sweep'; scope: string; radius: number; findingId: string | null }
  | { type: 'award'; key: string; kind: string }
  | { type: 'grant' }
  | { type: 'harvest'; x: number; y: number; z: number }
  | { type: 'travel'; distance: number; harvested: number; superclusterSeed: number | null }
  | { type: 'collect'; key: string }
  | { type: 'found'; key: string };

export type TechEntry =
  | { type: 'technology'; key: string; stage: number; living: boolean }
  | { type: 'research'; path: TechPath; level: number }
  | { type: 'technologyGrant' }
  | { type: 'base'; action: string };

export interface Ledger {
  condensate: number;
  technology: number;
  tech: TechLevels;
  capacity: number;
}

export function ledgerOf(snap: DocumentSnapshot): Ledger {
  if (!snap.exists) return { condensate: CONDENSATE_START, technology: 0, tech: { ...NO_TECH }, capacity: tankCapacity(0) };
  const tech = techLevelsOf(snap.get('tech'));
  return {
    condensate: snap.get('condensate') as number,
    technology: (snap.get('technology') as number | undefined) ?? 0,
    tech,
    capacity: tankCapacity(tech.capacity),
  };
}

export async function readLedger(tx: Transaction, uid: string): Promise<Ledger> {
  return ledgerOf(await tx.get(paths.ledger(uid)));
}

export function writeBalance(tx: Transaction, uid: string, balance: number, requested: number, capacity: number, entry: LedgerEntry): number {
  const amount = creditable(balance, requested, capacity);
  const next = balance + amount;
  tx.set(paths.ledger(uid), { condensate: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  tx.create(paths.entries(uid).doc(), { ...entry, amount, balance: next, at: FieldValue.serverTimestamp() });
  return next;
}

export function logEntry(tx: Transaction, uid: string, entry: LedgerEntry) {
  tx.create(paths.entries(uid).doc(), { ...entry, at: FieldValue.serverTimestamp() });
}

export function writeTechnology(tx: Transaction, uid: string, ledger: Ledger, amount: number, tech: TechLevels, entry: TechEntry): number {
  const next = ledger.technology + amount;
  tx.set(paths.ledger(uid), { technology: next, tech, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  tx.create(paths.entries(uid).doc(), { ...entry, technologyAmount: amount, technology: next, at: FieldValue.serverTimestamp() });
  return next;
}

export async function ensureLedger(uid: string): Promise<Ledger> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(paths.ledger(uid));
    const ledger = ledgerOf(snap);
    if (!snap.exists) tx.set(paths.ledger(uid), { condensate: CONDENSATE_START, updatedAt: FieldValue.serverTimestamp() });
    return ledger;
  });
}
