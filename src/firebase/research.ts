import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { LegacyResearchStateData, ResearchStateData } from '../store/researchStore';

export async function loadResearch(uid: string): Promise<LegacyResearchStateData> {
  const snapshot = await getDoc(doc(db, 'users', uid, 'research', 'state'));
  return snapshot.exists() ? snapshot.data() as LegacyResearchStateData : { points: 0 };
}

export async function saveResearch(uid: string, research: ResearchStateData): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'research', 'state'), research);
}

export async function deleteResearch(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'research', 'state'));
}
