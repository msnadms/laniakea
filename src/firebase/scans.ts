import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { ScanScope } from '../game/scan';

export interface ScanFinding {
  id: string;
  scope: ScanScope;
  superclusterSeed: number | null;
  x: number;
  y: number;
  z: number;
  radius: number;
  markX: number;
  markY: number;
  markZ: number;
  bloom: number;
  confidence: number;
  signals: number[];
  strength: number;
  sources: number;
  nodes: number[];
  edges: number[];
  foundAt: number;
}

type FirestoreTimestamp = { toMillis?: () => number };

export async function saveScanFinding(uid: string, finding: ScanFinding): Promise<void> {
  const ref = doc(db, 'users', uid, 'scans', finding.id);
  await setDoc(ref, { ...finding, foundAt: serverTimestamp() });
}

export async function loadScanFindings(uid: string): Promise<ScanFinding[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'scans'));
  return snap.docs.filter((scanDoc) => Array.isArray(scanDoc.data().nodes)).map((scanDoc) => {
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
      signals: (data.signals as number[]) ?? [],
      strength: data.strength as number,
      sources: data.sources as number,
      nodes: (data.nodes as number[]) ?? [],
      edges: (data.edges as number[]) ?? [],
      foundAt: (data.foundAt as FirestoreTimestamp)?.toMillis?.() ?? Date.now(),
    };
  });
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
