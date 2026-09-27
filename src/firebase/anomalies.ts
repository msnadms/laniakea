import { collection, deleteDoc, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { AnomalyKind } from '../game/anomalies';
import { anomalyRecordKey, type AnomalyRecord, type WorldAnomaly } from '../game/anomalyRecord';

export { anomalyRecordKey, type AnomalyRecord };

type FirestoreTimestamp = { toMillis?: () => number };

export async function loadAnomalies(uid: string): Promise<AnomalyRecord[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'anomalies'));
  return snap.docs.map((anomalyDoc) => {
    const data = anomalyDoc.data();
    return {
      kind: data.kind as AnomalyKind,
      living: (data.living as boolean) ?? false,
      superclusterSeed: data.superclusterSeed as number,
      superclusterName: data.superclusterName as string,
      galaxySeed: data.galaxySeed as number,
      galaxyName: data.galaxyName as string,
      systemId: data.systemId as number,
      systemName: data.systemName as string,
      discoveredAt: (data.discoveredAt as FirestoreTimestamp)?.toMillis?.() ?? Date.now(),
    };
  });
}

export async function deleteAnomalyDiscoveries(uid: string, keys: string[]): Promise<void> {
  try {
    await Promise.all(keys.map((key) => deleteDoc(doc(db, 'users', uid, 'anomalies', key))));
  } catch (err) {
    console.error('deleteAnomalyDiscoveries failed:', err);
  }
}

export async function loadWorldAnomaly(key: string): Promise<WorldAnomaly | null> {
  const snap = await getDoc(doc(db, 'world', 'anomalies', 'records', key));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    firstBy: data.firstBy as string,
    firstAt: (data.firstAt as FirestoreTimestamp)?.toMillis?.() ?? Date.now(),
    count: (data.count as number) ?? 1,
  };
}
