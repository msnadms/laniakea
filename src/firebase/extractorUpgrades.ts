import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { CraftCategory, FabricatorProductionItem } from '../game/types';

interface LegacyPendingUpgrade {
  upgradeId: string;
  category?: CraftCategory;
}

interface ExtractorUpgradesData {
  ownedUpgrades: string[];
  nodeEquipped: Record<string, [string | null, string | null]>;
  legacyProductionItems?: FabricatorProductionItem[];
}

export function migratePendingUpgrades(value: unknown): FabricatorProductionItem[] {
  if (!Array.isArray(value)) return [];
  return (value as LegacyPendingUpgrade[])
    .filter((item) => typeof item?.upgradeId === 'string')
    .map((item) => ({
      upgradeId: item.upgradeId,
      category: item.category ?? 'extractor',
      count: 1,
    }));
}

export async function saveExtractorUpgrades(uid: string, data: ExtractorUpgradesData): Promise<void> {
  const ref = doc(db, 'users', uid, 'extractorUpgrades', 'state');
  await setDoc(ref, {
    ownedUpgrades: data.ownedUpgrades,
    nodeEquipped: data.nodeEquipped,
  });
}

export async function loadExtractorUpgrades(uid: string): Promise<ExtractorUpgradesData> {
  const ref = doc(db, 'users', uid, 'extractorUpgrades', 'state');
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ownedUpgrades: [], nodeEquipped: {}, legacyProductionItems: [] };
  const data = snap.data();
  return {
    ownedUpgrades: (data.ownedUpgrades as string[]) ?? [],
    nodeEquipped: (data.nodeEquipped as Record<string, [string | null, string | null]>) ?? {},
    legacyProductionItems: migratePendingUpgrades(data.pendingUpgrades),
  };
}
