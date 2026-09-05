import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { LogisticsRoute, RouteEdge } from '../game/types';

export async function saveLogisticsRoute(uid: string, route: LogisticsRoute): Promise<void> {
  const ref = doc(db, 'users', uid, 'logisticsRoutes', route.id);
  try {
    await setDoc(ref, {
      name: route.name,
      edges: route.edges,
      active: route.active ?? false,
      automation: route.automation ?? null,
      heldCargo: route.heldCargo ?? {},
    });
  } catch (err) {
    console.error('saveLogisticsRoute failed:', err);
  }
}

export async function deleteLogisticsRoute(uid: string, id: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'logisticsRoutes', id);
  try {
    await deleteDoc(ref);
  } catch (err) {
    console.error('deleteLogisticsRoute failed:', err);
  }
}

export async function deleteAllLogisticsRoutes(uid: string): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'logisticsRoutes'));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error('deleteAllLogisticsRoutes failed:', err);
  }
}

export async function loadLogisticsRoutes(uid: string): Promise<LogisticsRoute[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'logisticsRoutes'));
  const routes: LogisticsRoute[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    // Routes saved before the DAG model have no edges and cannot be interpreted
    if (!Array.isArray(data.edges)) continue;
    routes.push({
      id: d.id,
      name: data.name as string,
      edges: data.edges as RouteEdge[],
      active: data.active === true,
      automation: data.automation ?? undefined,
      heldCargo: data.heldCargo ?? {},
    });
  }
  return routes;
}
