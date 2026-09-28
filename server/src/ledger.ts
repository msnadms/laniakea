import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { CONDENSATE_START } from '../../src/game/constants';
import { creditable } from '../../src/game/fuel';
import { db } from './firebase';
import { paths } from './paths';

export type LedgerEntry =
  | { type: 'sweep'; scope: string; radius: number; findingId: string | null }
  | { type: 'award'; key: string; kind: string }
  | { type: 'grant' }
  | { type: 'harvest'; x: number; y: number; z: number }
  | { type: 'travel'; distance: number; harvested: number; superclusterSeed: number | null };

export async function readBalance(tx: Transaction, uid: string): Promise<number> {
  const snap = await tx.get(paths.ledger(uid));
  return snap.exists ? (snap.get('condensate') as number) : CONDENSATE_START;
}

export function writeBalance(tx: Transaction, uid: string, balance: number, requested: number, entry: LedgerEntry): number {
  const amount = creditable(balance, requested);
  const next = balance + amount;
  tx.set(paths.ledger(uid), { condensate: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  tx.create(paths.entries(uid).doc(), { ...entry, amount, balance: next, at: FieldValue.serverTimestamp() });
  return next;
}

export async function ensureLedger(uid: string): Promise<number> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(paths.ledger(uid));
    if (snap.exists) return snap.get('condensate') as number;
    tx.set(paths.ledger(uid), { condensate: CONDENSATE_START, updatedAt: FieldValue.serverTimestamp() });
    return CONDENSATE_START;
  });
}

export async function grant(uid: string, amount: number): Promise<number> {
  return db.runTransaction(async (tx) => writeBalance(tx, uid, await readBalance(tx, uid), amount, { type: 'grant' }));
}
