import { doc, getDoc, setDoc } from 'firebase/firestore';
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
  await setDoc(questRef(uid), { [id]: true }, { merge: true });
}
