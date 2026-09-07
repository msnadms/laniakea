import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { MaterialCost } from '../game/types';

const REMOVED_MATERIAL_IDS = new Set(['viable_line']);

function withoutRemovedMaterials(materials: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(materials).filter(([id]) => !REMOVED_MATERIAL_IDS.has(id)));
}

interface StockpileState {
  materials: Record<string, number>;
  rares: Record<string, number>;
  addMaterial: (id: string, count: number) => void;
  addRare: (id: string, count: number) => void;
  hasMaterials: (cost: MaterialCost) => boolean;
  consumeMaterials: (cost: MaterialCost) => boolean;
  restoreStockpile: (materials: Record<string, number>, rares?: Record<string, number>) => void;
}

export function materialCount(materials: Record<string, number>, id: string): number {
  return materials[id] ?? 0;
}

export const useStockpileStore = create<StockpileState>()(
  subscribeWithSelector((set, get) => ({
    materials: {},
    rares: {},

    addMaterial: (id, count) => {
      if (REMOVED_MATERIAL_IDS.has(id)) return;
      set((s) => ({ materials: { ...s.materials, [id]: (s.materials[id] ?? 0) + count } }));
    },

    addRare: (id, count) =>
      set((s) => ({ rares: { ...s.rares, [id]: (s.rares[id] ?? 0) + count } })),

    hasMaterials: (cost) => {
      const held = get().materials;
      return Object.entries(cost).every(([id, amt]) => (held[id] ?? 0) >= amt);
    },

    consumeMaterials: (cost) => {
      if (!get().hasMaterials(cost)) return false;
      set((s) => {
        const next = { ...s.materials };
        for (const [id, amt] of Object.entries(cost)) next[id] = (next[id] ?? 0) - amt;
        return { materials: next };
      });
      return true;
    },

    restoreStockpile: (materials, rares = {}) => set({ materials: withoutRemovedMaterials(materials), rares }),
  })),
);
