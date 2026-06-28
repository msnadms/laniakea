import { collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Settlement, ColonyState, ColonyProductionSlot } from '../game/types';
import { makeEmptyColonySlot } from '../game/types';

export async function saveSettlement(uid: string, settlement: Settlement): Promise<void> {
  const ref = doc(db, 'users', uid, 'settlements', settlement.key);
  await setDoc(ref, {
    galaxySeed: settlement.galaxySeed,
    systemId: settlement.systemId,
    systemName: settlement.systemName,
    planetName: settlement.planetName,
    settledAt: settlement.settledAt,
    systemX: settlement.systemX,
    systemY: settlement.systemY,
    galaxyX: settlement.galaxyX,
    galaxyY: settlement.galaxyY,
    superclusSeed: settlement.superclusSeed,
  }, { merge: true });
}

export async function saveColonyState(uid: string, settlementKey: string, state: ColonyState): Promise<void> {
  const ref = doc(db, 'users', uid, 'settlements', settlementKey);
  await setDoc(ref, { slots: state.slots }, { merge: true });
}

export async function deleteSettlement(uid: string, key: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'settlements', key);
  await deleteDoc(ref);
}

export async function loadAllSettlements(uid: string): Promise<{
  settlements: Settlement[];
  colonyStates: Record<string, ColonyState>;
}> {
  const snap = await getDocs(collection(db, 'users', uid, 'settlements'));
  const settlements: Settlement[] = [];
  const colonyStates: Record<string, ColonyState> = {};

  for (const d of snap.docs) {
    const d2 = d.data();
    settlements.push({
      key: d.id,
      galaxySeed: (d2.galaxySeed as number) ?? 0,
      systemId: (d2.systemId as number) ?? 0,
      systemName: (d2.systemName as string) ?? '',
      planetName: (d2.planetName as string) ?? '',
      settledAt: (d2.settledAt as number) ?? 0,
      systemX: (d2.systemX as number) ?? 0,
      systemY: (d2.systemY as number) ?? 0,
      galaxyX: (d2.galaxyX as number) ?? 0,
      galaxyY: (d2.galaxyY as number) ?? 0,
      superclusSeed: (d2.superclusSeed as number) ?? 0,
    } satisfies Settlement);

    // New slot-based format
    if (Array.isArray(d2.slots) && d2.slots.length > 0) {
      const slots: ColonyProductionSlot[] = (d2.slots as ColonyProductionSlot[]).map((s) => ({
        targetUpgradeId: s.targetUpgradeId ?? null,
        pendingResources: s.pendingResources ?? {},
        inProduction: s.inProduction ?? null,
      }));
      colonyStates[d.id] = { slots };
    } else if (d2.targetUpgradeId || (d2.productionQueue as unknown[])?.length) {
      // Migrate old single-target format
      const slot: ColonyProductionSlot = {
        targetUpgradeId: (d2.targetUpgradeId as string | null) ?? null,
        pendingResources: (d2.pendingResources as ColonyProductionSlot['pendingResources']) ?? {},
        inProduction: null,
      };
      colonyStates[d.id] = { slots: [slot] };
    }
  }

  return { settlements, colonyStates };
}
