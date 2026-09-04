import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function saveStockpile(
  uid: string,
  materials: Record<string, number>,
  rares: Record<string, number> = {},
): Promise<void> {
  const ref = doc(db, 'users', uid, 'stockpile', 'state');
  try {
    await setDoc(ref, { materials, rares });
  } catch (err) {
    console.error('saveStockpile failed:', err);
  }
}

export interface StoredStockpile {
  materials: Record<string, number>;
  rares: Record<string, number>;
}

export async function loadStockpile(uid: string): Promise<StoredStockpile> {
  const ref = doc(db, 'users', uid, 'stockpile', 'state');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return { materials: {}, rares: {} };
    return {
      materials: (snap.data().materials as Record<string, number>) ?? {},
      rares: (snap.data().rares as Record<string, number>) ?? {},
    };
  } catch (err) {
    console.error('loadStockpile failed:', err);
    return { materials: {}, rares: {} };
  }
}
