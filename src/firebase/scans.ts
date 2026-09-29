import { collection, deleteDoc, doc, onSnapshot, type DocumentData, type QueryDocumentSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { ScanFinding, ScanScope } from '../game/scan';

export type { ScanFinding };

type FirestoreTimestamp = { toMillis?: () => number };

function toFinding(scanDoc: QueryDocumentSnapshot<DocumentData>): ScanFinding {
  const data = scanDoc.data();
  return {
    id: scanDoc.id,
    scope: data.scope as ScanScope,
    superclusterSeed: (data.superclusterSeed as number | null) ?? null,
    x: data.x as number,
    y: data.y as number,
    z: data.z as number,
    radius: data.radius as number,
    markX: data.markX as number,
    markY: data.markY as number,
    markZ: data.markZ as number,
    bloom: data.bloom as number,
    confidence: (data.confidence as number | undefined) ?? 1,
    noise: (data.noise as number | undefined) ?? 1,
    signals: (data.signals as number[]) ?? [],
    strength: data.strength as number,
    sources: data.sources as number,
    nodes: (data.nodes as number[]) ?? [],
    edges: (data.edges as number[]) ?? [],
    foundAt: (data.foundAt as FirestoreTimestamp)?.toMillis?.() ?? Date.now(),
  };
}

export function subscribeScanFindings(uid: string, onFindings: (findings: ScanFinding[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'users', uid, 'scans'),
    (snap) => onFindings(snap.docs.filter((scanDoc) => Array.isArray(scanDoc.data().nodes)).map(toFinding)),
    (err) => console.error('subscribeScanFindings failed:', err),
  );
}

export async function deleteScanFindings(uid: string, ids: readonly string[]): Promise<void> {
  await Promise.all(ids.map((id) => deleteScanFinding(uid, id)));
}

export async function deleteScanFinding(uid: string, id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', uid, 'scans', id));
  } catch (err) {
    console.error('deleteScanFinding failed:', err);
  }
}
