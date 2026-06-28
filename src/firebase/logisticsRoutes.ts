import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { LogisticsRoute } from '../game/types';

export async function saveLogisticsRoute(uid: string, route: LogisticsRoute): Promise<void> {
  const ref = doc(db, 'users', uid, 'logisticsRoutes', route.id);
  await setDoc(ref, {
    name: route.name,
    nodeKeys: route.nodeKeys,
  });
}

export async function deleteLogisticsRoute(uid: string, id: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'logisticsRoutes', id);
  await deleteDoc(ref);
}

export async function loadLogisticsRoutes(uid: string): Promise<LogisticsRoute[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'logisticsRoutes'));
  return snap.docs.map((d) => {
    const data = d.data();
    // Migrate old format: stationKeys + colonyKeys → nodeKeys
    const nodeKeys: string[] = (data.nodeKeys as string[] | undefined)
      ?? [...((data.stationKeys as string[]) ?? []), ...((data.colonyKeys as string[]) ?? [])];
    return { id: d.id, name: (data.name as string) ?? 'Route', nodeKeys };
  });
}
