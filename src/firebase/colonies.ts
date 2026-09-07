import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Colony, LegacyColony } from '../game/types';

export async function saveColony(uid: string, colony: Colony): Promise<void> {
  const { installed: _installed, exportedLines: _exportedLines, labor: _labor, populationTier: _populationTier, selfSufficientMs: _selfSufficientMs, lastShipmentAt: _lastShipmentAt, ammo: _ammo, ...current } = colony as Colony & Partial<LegacyColony> & { ammo?: number };
  await setDoc(doc(db, 'users', uid, 'colonies', colony.key), current);
}
export async function loadAllColonies(uid: string): Promise<(Colony | LegacyColony)[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'colonies'));
  return snap.docs.map(d => ({ ...d.data(), key: d.id }) as Colony | LegacyColony);
}
export async function deleteColony(uid: string, key: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'colonies', key));
}
export async function deleteAllColonies(uid: string): Promise<void> {
  const snap = await getDocs(collection(db, 'users', uid, 'colonies'));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}
