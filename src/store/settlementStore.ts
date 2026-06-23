import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Settlement } from '../game/types';
import { useQuestStore } from './questStore';

interface SettlementState {
  settlements: Record<string, Settlement>;
  placeSettlement: (settlement: Settlement) => void;
  removeSettlement: (key: string) => void;
  restoreSettlements: (list: Settlement[]) => void;
}

export const useSettlementStore = create<SettlementState>()(
  subscribeWithSelector((set) => ({
    settlements: {},

    placeSettlement: (settlement) => {
      set((s) => ({ settlements: { ...s.settlements, [settlement.key]: settlement } }));
      useQuestStore.getState().completeQuest('first_colony');
    },

    removeSettlement: (key) =>
      set((s) => {
        const { [key]: _, ...rest } = s.settlements;
        return { settlements: rest };
      }),

    restoreSettlements: (list) => {
      const map: Record<string, Settlement> = {};
      for (const s of list) map[s.key] = s;
      set({ settlements: map });
    },
  })),
);
