import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Settlement, ColonyState, ColonyProductionItem } from '../game/types';
import { EXTRACTOR_UPGRADES, COST_KEY_TO_RESOURCE, MAX_COLONY_SLOTS, makeEmptyColonySlot } from '../game/types';
import { useQuestStore } from './questStore';

interface FeedResult {
  consumed: Partial<Record<string, number>>;
  readyItems: ColonyProductionItem[];
}

interface SettlementState {
  settlements: Record<string, Settlement>;
  colonyStates: Record<string, ColonyState>;
  placeSettlement: (settlement: Settlement) => void;
  removeSettlement: (key: string) => void;
  restoreSettlements: (list: Settlement[]) => void;
  setSlotTarget: (key: string, slotIdx: number, upgradeId: string | null) => void;
  unlockColonySlot: (key: string) => boolean;
  feedColony: (key: string, pool: Partial<Record<string, number>>) => FeedResult;
  restoreColonyStates: (states: Record<string, ColonyState>) => void;
}

export const useSettlementStore = create<SettlementState>()(
  subscribeWithSelector((set, get) => ({
    settlements: {},
    colonyStates: {},

    placeSettlement: (settlement) => {
      set((s) => ({ settlements: { ...s.settlements, [settlement.key]: settlement } }));
      useQuestStore.getState().completeQuest('first_colony');
    },

    removeSettlement: (key) =>
      set((s) => {
        const { [key]: _s, ...restS } = s.settlements;
        const { [key]: _cs, ...restCs } = s.colonyStates;
        return { settlements: restS, colonyStates: restCs };
      }),

    restoreSettlements: (list) => {
      const map: Record<string, Settlement> = {};
      for (const s of list) map[s.key] = s;
      set({ settlements: map });
    },

    setSlotTarget: (key, slotIdx, upgradeId) => {
      set((s) => {
        const cs = s.colonyStates[key] ?? { slots: [makeEmptyColonySlot()] };
        const slots = cs.slots.map((slot, i) =>
          i === slotIdx
            ? { ...makeEmptyColonySlot(), targetUpgradeId: upgradeId }
            : slot,
        );
        return { colonyStates: { ...s.colonyStates, [key]: { ...cs, slots } } };
      });
    },

    unlockColonySlot: (key) => {
      const cs = get().colonyStates[key] ?? { slots: [makeEmptyColonySlot()] };
      if (cs.slots.length >= MAX_COLONY_SLOTS) return false;
      set((s) => ({
        colonyStates: {
          ...s.colonyStates,
          [key]: { ...cs, slots: [...cs.slots, makeEmptyColonySlot()] },
        },
      }));
      return true;
    },

    feedColony: (key, pool) => {
      const cs = get().colonyStates[key] ?? { slots: [makeEmptyColonySlot()] };
      const consumed: Partial<Record<string, number>> = {};
      const readyItems: ColonyProductionItem[] = [];
      const now = Date.now();

      // Track remaining pool across slots so two slots don't claim the same resources
      const remaining: Partial<Record<string, number>> = { ...pool };

      const updatedSlots = cs.slots.map((slot) => {
        if (!slot.targetUpgradeId) return slot;
        const recipe = EXTRACTOR_UPGRADES.find((u) => u.id === slot.targetUpgradeId);
        if (!recipe) return slot;

        let inProduction = slot.inProduction;
        const pending = { ...slot.pendingResources };

        // Deliver completed item
        if (inProduction && inProduction.availableAt <= now) {
          readyItems.push(inProduction);
          inProduction = null;
        }

        // Only absorb resources and start new production when the slot is free
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

          const canProduce = Object.entries(recipe.cost).every(([costKey, costAmt]) => {
            if (!costAmt) return true;
            const resourceType = COST_KEY_TO_RESOURCE[costKey];
            if (!resourceType) return true;
            return (pending[resourceType] ?? 0) >= costAmt;
          });

          if (canProduce) {
            for (const [costKey, costAmt] of Object.entries(recipe.cost)) {
              if (!costAmt) continue;
              const resourceType = COST_KEY_TO_RESOURCE[costKey];
              if (!resourceType) continue;
              pending[resourceType] = (pending[resourceType] ?? 0) - costAmt;
            }
            inProduction = { upgradeId: slot.targetUpgradeId, availableAt: now + 24 * 60 * 60 * 1000 };
          }
        }

        return { ...slot, pendingResources: pending, inProduction };
      });

      set((s) => ({
        colonyStates: {
          ...s.colonyStates,
          [key]: { ...cs, slots: updatedSlots },
        },
      }));

      return { consumed, readyItems };
    },

    restoreColonyStates: (states) => set({ colonyStates: states }),
  })),
);
