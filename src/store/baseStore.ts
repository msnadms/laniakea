import { create } from 'zustand';
import type { Base } from '../game/base';

export type BaseTab = 'overview' | 'buildings' | 'shipyard' | 'defences';

interface BaseState {
  base: Base | null;
  loaded: boolean;
  open: boolean;
  tab: BaseTab;
  claimed: Record<string, readonly number[]>;
  setBase: (base: Base | null) => void;
  setOpen: (open: boolean) => void;
  setTab: (tab: BaseTab) => void;
  setClaimed: (systemKey: string, rings: readonly number[]) => void;
  reset: () => void;
}

export const useBaseStore = create<BaseState>((set) => ({
  base: null,
  loaded: false,
  open: false,
  tab: 'overview',
  claimed: {},
  setBase: (base) => set({ base, loaded: true }),
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
  setClaimed: (systemKey, rings) => set((s) => ({ claimed: { ...s.claimed, [systemKey]: rings } })),
  reset: () => set({ base: null, loaded: false, open: false, tab: 'overview', claimed: {} }),
}));

export function systemKey(superclusterSeed: number, galaxySeed: number, systemId: number): string {
  return `${superclusterSeed}:${galaxySeed}:${systemId}`;
}
