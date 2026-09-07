import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Colony } from '../game/types';

export async function saveColony(uid: string, colony: Colony): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'colonies', colony.key), colony);
}
export async function loadAllColonies(uid: string): Promise<Colony[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'colonies'));
  return snap.docs.map(d => ({ ...d.data(), key: d.id }) as Colony);
}
export async function deleteColony(uid: string, key: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'colonies', key));
}
export async function deleteAllColonies(uid: string): Promise<void> {
  const snap = await getDocs(collection(db, 'users', uid, 'colonies'));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}
