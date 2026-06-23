import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Settlement } from '../game/types';

export async function saveSettlement(uid: string, settlement: Settlement): Promise<void> {
  const ref = doc(db, 'users', uid, 'settlements', settlement.key);
  await setDoc(ref, {
    galaxySeed: settlement.galaxySeed,
    systemId: settlement.systemId,
    planetName: settlement.planetName,
    settledAt: settlement.settledAt,
  }, { merge: true });
}

export async function deleteSettlement(uid: string, key: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'settlements', key);
  await deleteDoc(ref);
}

export async function loadAllSettlements(uid: string): Promise<Settlement[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'settlements'));
  return snap.docs.map((d) => {
    const data = d.data() as Omit<Settlement, 'key'>;
    return { ...data, key: d.id };
  });
}
