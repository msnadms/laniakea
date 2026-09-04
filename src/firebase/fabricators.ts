import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Fabricator, FabricatorState, FabricatorProductionSlot, FabricatorTier } from '../game/types';

export async function saveFabricator(uid: string, fabricator: Fabricator): Promise<void> {
  const ref = doc(db, 'users', uid, 'fabricators', fabricator.key);
  try {
    await setDoc(ref, {
      tier: fabricator.tier,
      galaxySeed: fabricator.galaxySeed,
      systemId: fabricator.systemId,
      systemName: fabricator.systemName,
      planetName: fabricator.planetName,
      builtAt: fabricator.builtAt,
      systemX: fabricator.systemX,
      systemY: fabricator.systemY,
      galaxyX: fabricator.galaxyX,
      galaxyY: fabricator.galaxyY,
      superclusSeed: fabricator.superclusSeed,
    }, { merge: true });
  } catch (err) {
    console.error('saveFabricator failed:', err);
  }
}

export async function saveFabricatorState(uid: string, fabricatorKey: string, state: FabricatorState): Promise<void> {
  const ref = doc(db, 'users', uid, 'fabricators', fabricatorKey);
  try {
    await setDoc(ref, { slots: state.slots }, { merge: true });
  } catch (err) {
    console.error('saveFabricatorState failed:', err);
  }
}

export async function deleteFabricator(uid: string, key: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'fabricators', key);
  try {
    await deleteDoc(ref);
  } catch (err) {
    console.error('deleteFabricator failed:', err);
  }
}

export async function deleteAllFabricators(uid: string): Promise<void> {
  try {
    const [snap, legacy] = await Promise.all([
      getDocs(collection(db, 'users', uid, 'fabricators')),
      getDocs(collection(db, 'users', uid, 'settlements')),
    ]);
    await Promise.all([...snap.docs, ...legacy.docs].map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error('deleteAllFabricators failed:', err);
  }
}

// One-time move off the old 'settlements' collection; safe to delete once it has run.
async function migrateLegacySettlements(uid: string): Promise<void> {
  try {
    const legacy = await getDocs(collection(db, 'users', uid, 'settlements'));
    if (legacy.empty) return;
    await Promise.all(legacy.docs.map((d) => {
      const { settledAt, ...rest } = d.data();
      return setDoc(doc(db, 'users', uid, 'fabricators', d.id), { ...rest, builtAt: settledAt ?? 0 });
    }));
    await Promise.all(legacy.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error('migrateLegacySettlements failed:', err);
  }
}

export async function loadAllFabricators(uid: string): Promise<{
  fabricators: Fabricator[];
  fabricatorStates: Record<string, FabricatorState>;
}> {
  let snap = await getDocs(collection(db, 'users', uid, 'fabricators'));
  if (snap.empty) {
    await migrateLegacySettlements(uid);
    snap = await getDocs(collection(db, 'users', uid, 'fabricators'));
  }
  const fabricators: Fabricator[] = [];
  const fabricatorStates: Record<string, FabricatorState> = {};

  for (const d of snap.docs) {
    const d2 = d.data();
    fabricators.push({
      key: d.id,
      tier: ((d2.tier as FabricatorTier) ?? 1),
      galaxySeed: (d2.galaxySeed as number) ?? 0,
      systemId: (d2.systemId as number) ?? 0,
      systemName: (d2.systemName as string) ?? '',
      planetName: (d2.planetName as string) ?? '',
      builtAt: (d2.builtAt as number) ?? (d2.settledAt as number) ?? 0,
      systemX: (d2.systemX as number) ?? 0,
      systemY: (d2.systemY as number) ?? 0,
      galaxyX: (d2.galaxyX as number) ?? 0,
      galaxyY: (d2.galaxyY as number) ?? 0,
      superclusSeed: (d2.superclusSeed as number) ?? 0,
    } satisfies Fabricator);

    // New slot-based format
    if (Array.isArray(d2.slots) && d2.slots.length > 0) {
      const slots: FabricatorProductionSlot[] = (d2.slots as FabricatorProductionSlot[]).map((s) => ({
        targetUpgradeId: s.targetUpgradeId ?? null,
        pendingResources: s.pendingResources ?? {},
        pendingMaterials: s.pendingMaterials ?? {},
        inProduction: s.inProduction ?? null,
      }));
      fabricatorStates[d.id] = { slots };
    } else if (d2.targetUpgradeId || (d2.productionQueue as unknown[])?.length) {
      // Migrate old single-target format
      const slot: FabricatorProductionSlot = {
        targetUpgradeId: (d2.targetUpgradeId as string | null) ?? null,
        pendingResources: (d2.pendingResources as FabricatorProductionSlot['pendingResources']) ?? {},
        pendingMaterials: {},
        inProduction: null,
      };
      fabricatorStates[d.id] = { slots: [slot] };
    }
  }

  return { fabricators, fabricatorStates };
}
