import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { QuestId } from '../game/quests';
import type { CompletedQuests } from '../store/questStore';

const questRef = (uid: string) => doc(db, 'users', uid, 'quests', 'progress');

export async function loadQuests(uid: string): Promise<CompletedQuests> {
  const snap = await getDoc(questRef(uid));
  if (!snap.exists()) return {};
  return snap.data() as CompletedQuests;
}

export async function markQuestComplete(uid: string, id: QuestId): Promise<void> {
  try {
    await setDoc(questRef(uid), { [id]: true }, { merge: true });
  } catch (err) {
    console.error('markQuestComplete failed:', err);
  }
}

export async function deleteQuests(uid: string): Promise<void> {
  try {
    await deleteDoc(questRef(uid));
  } catch (err) {
    console.error('deleteQuests failed:', err);
  }
}
