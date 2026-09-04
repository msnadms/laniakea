import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Fabricator, FabricatorState, FabricatorProductionItem, MaterialCost, FabricatorTier, CraftCategory } from '../game/types';
import { COST_KEY_TO_RESOURCE, MAX_FABRICATOR_SLOTS, makeEmptyFabricatorSlot } from '../game/types';
import { getCraftable } from '../data/upgrades';
import { useQuestStore } from './questStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore } from './uiStore';

export function fabricatorCanCraft(tier: FabricatorTier | undefined, category: CraftCategory): boolean {
  return category !== 'rare' || (tier ?? 1) >= 2;
}

interface FeedResult {
  consumed: Partial<Record<string, number>>;
  consumedMaterials: MaterialCost;
  readyItems: FabricatorProductionItem[];
}

interface FabricatorStoreState {
  fabricators: Record<string, Fabricator>;
  fabricatorStates: Record<string, FabricatorState>;
  placeFabricator: (fabricator: Fabricator) => void;
  removeFabricator: (key: string) => void;
  upgradeFabricator: (key: string) => boolean;
  restoreFabricators: (list: Fabricator[]) => void;
  setSlotTarget: (key: string, slotIdx: number, upgradeId: string | null) => void;
  unlockFabricatorSlot: (key: string) => boolean;
  feedFabricator: (key: string, pool: Partial<Record<string, number>>) => FeedResult;
  restoreFabricatorStates: (states: Record<string, FabricatorState>) => void;
}

export const useFabricatorStore = create<FabricatorStoreState>()(
  subscribeWithSelector((set, get) => ({
    fabricators: {},
    fabricatorStates: {},

    placeFabricator: (fabricator) => {
      if (useUIStore.getState().checkDetectionLethal()) return;
      set((s) => ({ fabricators: { ...s.fabricators, [fabricator.key]: fabricator } }));
      useQuestStore.getState().completeQuest('first_fabricator');
    },

    upgradeFabricator: (key) => {
      const fabricator = get().fabricators[key];
      if (!fabricator || (fabricator.tier ?? 1) >= 2) return false;
      set((s) => ({ fabricators: { ...s.fabricators, [key]: { ...fabricator, tier: 2 } } }));
      return true;
    },

    removeFabricator: (key) =>
      set((s) => {
        const { [key]: _s, ...restS } = s.fabricators;
        const { [key]: _cs, ...restCs } = s.fabricatorStates;
        return { fabricators: restS, fabricatorStates: restCs };
      }),

    restoreFabricators: (list) => {
      const map: Record<string, Fabricator> = {};
      for (const s of list) map[s.key] = s;
      set({ fabricators: map });
    },

    setSlotTarget: (key, slotIdx, upgradeId) => {
      const recipe = upgradeId ? getCraftable(upgradeId) : null;
      if (recipe && !fabricatorCanCraft(get().fabricators[key]?.tier, recipe.category)) return;
      const existing = get().fabricatorStates[key]?.slots[slotIdx];
      if (existing && !existing.inProduction) {
        const stockpile = useStockpileStore.getState();
        for (const [id, amt] of Object.entries(existing.pendingMaterials ?? {})) {
          if (amt > 0) stockpile.addMaterial(id, amt);
        }
      }
      set((s) => {
        const cs = s.fabricatorStates[key] ?? { slots: [makeEmptyFabricatorSlot()] };
        const slots = cs.slots.map((slot, i) =>
          i === slotIdx
            ? { ...makeEmptyFabricatorSlot(), targetUpgradeId: upgradeId }
            : slot,
        );
        return { fabricatorStates: { ...s.fabricatorStates, [key]: { ...cs, slots } } };
      });
    },

    unlockFabricatorSlot: (key) => {
      let unlocked = false;
      set((s) => {
        const cs = s.fabricatorStates[key] ?? { slots: [makeEmptyFabricatorSlot()] };
        if (cs.slots.length >= MAX_FABRICATOR_SLOTS) return s;
        unlocked = true;
        return {
          fabricatorStates: {
            ...s.fabricatorStates,
            [key]: { ...cs, slots: [...cs.slots, makeEmptyFabricatorSlot()] },
          },
        };
      });
      return unlocked;
    },

    feedFabricator: (key, pool) => {
      const cs = get().fabricatorStates[key] ?? { slots: [makeEmptyFabricatorSlot()] };
      const consumed: Partial<Record<string, number>> = {};
      const consumedMaterials: MaterialCost = {};
      const readyItems: FabricatorProductionItem[] = [];
      const now = Date.now();

      const remaining: Partial<Record<string, number>> = { ...pool };
      const remainingMaterials: Record<string, number> = { ...useStockpileStore.getState().materials };

      const tier = get().fabricators[key]?.tier;

      const updatedSlots = cs.slots.map((slot) => {
        if (!slot.targetUpgradeId) return slot;
        const recipe = getCraftable(slot.targetUpgradeId);
        if (!recipe || !fabricatorCanCraft(tier, recipe.category)) return slot;

        let inProduction = slot.inProduction;
        const pending = { ...slot.pendingResources };
        const pendingMats = { ...slot.pendingMaterials };

        if (inProduction && inProduction.availableAt <= now) {
          readyItems.push(inProduction);
          inProduction = null;
        }

        if (!inProduction) {
          for (const [costKey, costAmt] of Object.entries(recipe.cost)) {
            if (!costAmt) continue;
            const resourceType = COST_KEY_TO_RESOURCE[costKey];
            if (!resourceType) continue;
            const have = pending[resourceType] ?? 0;
            const need = costAmt - have;
            if (need <= 0) continue;
            const available = (remaining[resourceType] ?? 0) as number;
            const take = Math.min(available, need);
            if (take > 0) {
              pending[resourceType] = have + take;
              consumed[resourceType] = (consumed[resourceType] ?? 0) + take;
              remaining[resourceType] = available - take;
            }
          }

          for (const [matId, costAmt] of Object.entries(recipe.materials)) {
            if (!costAmt) continue;
            const have = pendingMats[matId] ?? 0;
            const need = costAmt - have;
            if (need <= 0) continue;
            const take = Math.min(remainingMaterials[matId] ?? 0, need);
            if (take > 0) {
              pendingMats[matId] = have + take;
              consumedMaterials[matId] = (consumedMaterials[matId] ?? 0) + take;
              remainingMaterials[matId] = (remainingMaterials[matId] ?? 0) - take;
            }
          }

          const resourcesMet = Object.entries(recipe.cost).every(([costKey, costAmt]) => {
            if (!costAmt) return true;
            const resourceType = COST_KEY_TO_RESOURCE[costKey];
            if (!resourceType) return true;
            return (pending[resourceType] ?? 0) >= costAmt;
          });
          const materialsMet = Object.entries(recipe.materials).every(
            ([matId, costAmt]) => !costAmt || (pendingMats[matId] ?? 0) >= costAmt,
          );

          if (resourcesMet && materialsMet) {
            for (const [costKey, costAmt] of Object.entries(recipe.cost)) {
              if (!costAmt) continue;
              const resourceType = COST_KEY_TO_RESOURCE[costKey];
              if (!resourceType) continue;
              pending[resourceType] = (pending[resourceType] ?? 0) - costAmt;
            }
            for (const [matId, costAmt] of Object.entries(recipe.materials)) {
              if (!costAmt) continue;
              pendingMats[matId] = (pendingMats[matId] ?? 0) - costAmt;
            }
            inProduction = {
              upgradeId: slot.targetUpgradeId,
              availableAt: now + recipe.craftHours * 60 * 60 * 1000,
              category: recipe.category,
            };
          }
        }

        return { ...slot, pendingResources: pending, pendingMaterials: pendingMats, inProduction };
      });

      if (Object.keys(consumedMaterials).length > 0) {
        useStockpileStore.getState().consumeMaterials(consumedMaterials);
      }

      set((s) => ({
        fabricatorStates: {
          ...s.fabricatorStates,
          [key]: { ...cs, slots: updatedSlots },
        },
      }));

      return { consumed, consumedMaterials, readyItems };
    },

    restoreFabricatorStates: (states) => set({ fabricatorStates: states }),
  })),
);
