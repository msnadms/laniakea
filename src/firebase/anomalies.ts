import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { AnomalyKind } from '../game/anomalies';

export interface AnomalyRecord {
  kind: AnomalyKind;
  superclusterSeed: number;
  superclusterName: string;
  galaxySeed: number;
  galaxyName: string;
  systemId: number;
  systemName: string;
  discoveredAt: number;
}

type FirestoreTimestamp = { toMillis?: () => number };

export function anomalyRecordKey(galaxySeed: number, systemId: number | string): string {
  return `${galaxySeed}-${systemId}`;
}

export async function saveAnomalyDiscovery(uid: string, record: AnomalyRecord): Promise<void> {
  const ref = doc(db, 'users', uid, 'anomalies', anomalyRecordKey(record.galaxySeed, record.systemId));
  await setDoc(ref, { ...record, discoveredAt: serverTimestamp() });
}

export async function loadAnomalies(uid: string): Promise<AnomalyRecord[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'anomalies'));
  return snap.docs.map((anomalyDoc) => {
    const data = anomalyDoc.data();
    return {
      kind: data.kind as AnomalyKind,
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
