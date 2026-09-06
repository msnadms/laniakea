import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Extractor } from '../game/types';

export async function saveExtractor(uid: string, extractor: Extractor): Promise<void> {
  const ref = doc(db, 'users', uid, 'extractors', extractor.key);
  try {
    await setDoc(ref, {
      galaxySeed: extractor.galaxySeed,
      systemId: extractor.systemId,
      systemName: extractor.systemName,
      planetName: extractor.planetName,
      resourceType: extractor.resourceType,
      rate: extractor.rate,
      placedAt: extractor.placedAt,
      lastCollectedAt: extractor.lastCollectedAt,
      systemX: extractor.systemX,
      systemY: extractor.systemY,
      galaxyX: extractor.galaxyX,
      galaxyY: extractor.galaxyY,
      superclusSeed: extractor.superclusSeed,
      reserve: extractor.reserve ?? 0,
    }, { merge: true });
  } catch (err) {
    console.error('saveExtractor failed:', err);
  }
}

export async function updateExtractorCollected(uid: string, key: string, lastCollectedAt: number): Promise<void> {
  const ref = doc(db, 'users', uid, 'extractors', key);
  try {
    await setDoc(ref, { lastCollectedAt }, { merge: true });
  } catch (err) {
    console.error('updateExtractorCollected failed:', err);
  }
}

export async function updateExtractorReserve(uid: string, key: string, reserve: number): Promise<void> {
  const ref = doc(db, 'users', uid, 'extractors', key);
  try {
    await setDoc(ref, { reserve }, { merge: true });
  } catch (err) {
    console.error('updateExtractorReserve failed:', err);
  }
}

export async function deleteExtractor(uid: string, key: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'extractors', key);
  try {
    await deleteDoc(ref);
  } catch (err) {
    console.error('deleteExtractor failed:', err);
  }
}

export async function deleteAllExtractors(uid: string): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'extractors'));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error('deleteAllExtractors failed:', err);
  }
}

export async function loadAllExtractors(uid: string): Promise<Extractor[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'extractors'));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      rate: data.rate ?? 1,
      systemX: data.systemX ?? 0,
      systemY: data.systemY ?? 0,
      galaxyX: data.galaxyX ?? 0,
      galaxyY: data.galaxyY ?? 0,
      superclusSeed: data.superclusSeed ?? 0,
      reserve: data.reserve ?? 0,
      systemName: data.systemName ?? '',
      key: d.id,
    } as Extractor;
  });
}
