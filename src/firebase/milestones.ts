import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { MilestoneId } from '../game/milestones';
import type { CompletedMilestones } from '../store/milestoneStore';

const milestoneRef = (uid: string) => doc(db, 'users', uid, 'milestones', 'progress');

export async function loadMilestones(uid: string): Promise<CompletedMilestones> {
  const snap = await getDoc(milestoneRef(uid));
  if (!snap.exists()) return {};
  return snap.data() as CompletedMilestones;
}

export async function markMilestoneComplete(uid: string, id: MilestoneId): Promise<void> {
  try {
    await setDoc(milestoneRef(uid), { [id]: true }, { merge: true });
  } catch (err) {
    console.error('markMilestoneComplete failed:', err);
  }
}

export async function deleteMilestones(uid: string): Promise<void> {
  try {
    await deleteDoc(milestoneRef(uid));
  } catch (err) {
    console.error('deleteMilestones failed:', err);
  }
}
