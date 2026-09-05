import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Fabricator, FabricatorState, FabricatorProductionSlot, FabricatorTier, FabricatorProductionItem } from '../game/types';
import { getCraftable } from '../data/upgrades';

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
    const snap = await getDocs(collection(db, 'users', uid, 'fabricators'));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error('deleteAllFabricators failed:', err);
  }
}

function isBufferedSlot(slot: FabricatorProductionSlot): boolean {
  return (
    !!slot &&
    typeof slot === 'object' &&
    !!slot.pendingResources &&
    !!slot.pendingMaterials
  );
}

export async function loadAllFabricators(uid: string): Promise<{
  fabricators: Fabricator[];
  fabricatorStates: Record<string, FabricatorState>;
  legacyProductionItems: FabricatorProductionItem[];
}> {
  const snap = await getDocs(collection(db, 'users', uid, 'fabricators'));
  const fabricators: Fabricator[] = [];
  const fabricatorStates: Record<string, FabricatorState> = {};
  const legacyProductionItems: FabricatorProductionItem[] = [];

  for (const d of snap.docs) {
    const d2 = d.data();
    fabricators.push({
      key: d.id,
      tier: d2.tier as FabricatorTier,
      galaxySeed: d2.galaxySeed as number,
      systemId: d2.systemId as number,
      systemName: d2.systemName as string,
      planetName: d2.planetName as string,
      builtAt: d2.builtAt as number,
      systemX: d2.systemX as number,
      systemY: d2.systemY as number,
      galaxyX: d2.galaxyX as number,
      galaxyY: d2.galaxyY as number,
      superclusSeed: d2.superclusSeed as number,
    } satisfies Fabricator);

    // Old timed slots are accepted here. normalizeFabricatorState strips the
    // obsolete timestamps/output queues and expands included slots on restore.
    const slots = d2.slots as Array<FabricatorProductionSlot & { startedAt?: number | null; outputCount?: number }> | undefined;
    if (Array.isArray(slots) && slots.length > 0 && slots.every(isBufferedSlot)) {
      fabricatorStates[d.id] = {
        slots: slots.map((slot, index) => {
          const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
          const legacyCount = (slot.outputCount ?? 0) + (slot.startedAt != null && recipe ? recipe.outputs : 0);
          if (recipe && legacyCount > 0) {
            legacyProductionItems.push({
              upgradeId: recipe.produces,
              category: recipe.category,
              count: legacyCount,
            });
          }
          const migratedByproducts = { ...(slot.byproducts ?? {}) };
          if (recipe && slot.startedAt != null) {
            for (const [id, amount] of Object.entries(recipe.byproducts)) {
              migratedByproducts[id] = (migratedByproducts[id] ?? 0) + amount;
            }
          }
          return {
            targetUpgradeId: slot.targetUpgradeId ?? null,
            pendingResources: { ...(slot.pendingResources ?? {}) },
            pendingMaterials: { ...(slot.pendingMaterials ?? {}) },
            byproducts: migratedByproducts,
            priority: Number.isFinite(slot.priority) ? slot.priority : index,
          };
        }),
      };
    }
  }

  return { fabricators, fabricatorStates, legacyProductionItems };
}
