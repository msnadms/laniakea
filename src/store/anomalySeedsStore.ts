import { create } from 'zustand';
import type { AnomalySeeds } from '../game/anomalies';

interface AnomalySeedsState {
  seeds: Record<string, AnomalySeeds>;
  put: (superclusterSeed: number, galaxySeed: number, seeds: AnomalySeeds) => void;
}

export function anomalySeedsKey(superclusterSeed: number, galaxySeed: number): string {
  return `${superclusterSeed}:${galaxySeed}`;
}

export const useAnomalySeedsStore = create<AnomalySeedsState>((set) => ({
  seeds: {},
  put: (superclusterSeed, galaxySeed, seeds) => set((state) => ({
    seeds: { ...state.seeds, [anomalySeedsKey(superclusterSeed, galaxySeed)]: seeds },
  })),
}));

export function cachedAnomalySeeds(superclusterSeed: number, galaxySeed: number): AnomalySeeds | undefined {
  return useAnomalySeedsStore.getState().seeds[anomalySeedsKey(superclusterSeed, galaxySeed)];
}
