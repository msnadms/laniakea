import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { PendingUpgrade } from '../store/extractorStore';

interface ExtractorUpgradesData {
  ownedUpgrades: string[];
  nodeEquipped: Record<string, [string | null, string | null]>;
  pendingUpgrades?: PendingUpgrade[];
}

export async function saveExtractorUpgrades(uid: string, data: ExtractorUpgradesData): Promise<void> {
  const ref = doc(db, 'users', uid, 'extractorUpgrades', 'state');
  await setDoc(ref, {
    ownedUpgrades: data.ownedUpgrades,
    nodeEquipped: data.nodeEquipped,
    pendingUpgrades: data.pendingUpgrades ?? [],
  });
}

export async function loadExtractorUpgrades(uid: string): Promise<ExtractorUpgradesData> {
  const ref = doc(db, 'users', uid, 'extractorUpgrades', 'state');
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ownedUpgrades: [], nodeEquipped: {}, pendingUpgrades: [] };
  const data = snap.data();
  return {
    ownedUpgrades: (data.ownedUpgrades as string[]) ?? [],
    nodeEquipped: (data.nodeEquipped as Record<string, [string | null, string | null]>) ?? {},
    pendingUpgrades: (data.pendingUpgrades as PendingUpgrade[]) ?? [],
  };
}
