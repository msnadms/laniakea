import { create } from 'zustand';
import type { Galaxy, StarSystem, SuperclusterData } from '../game/types';
import { generateGalaxy } from '../game/galaxyGen';
import { generateSupercluster } from '../game/superclusters';

interface GameState {
  galaxy: Galaxy;
  supercluster: SuperclusterData;
  system: StarSystem | null;
  regenerateGalaxy: (seed?: number) => void;
  regenerateSupercluster: (seed?: number) => void;
  setSystem: (system: StarSystem | null) => void;
  markDotVisited: (seed: number) => void;
}

export const useGameStore = create<GameState>((set) => ({
  galaxy: generateGalaxy(),
  supercluster: generateSupercluster(),
  system: null,
  regenerateGalaxy: (seed) => set({ galaxy: generateGalaxy(seed), system: null }),
  regenerateSupercluster: (seed) => set({ supercluster: generateSupercluster(seed) }),
  setSystem: (system) => set({ system }),
  markDotVisited: (seed) => set((state) => ({
    supercluster: {
      ...state.supercluster,
      dots: state.supercluster.dots.map((d) => d.seed === seed ? { ...d, visited: true } : d),
    },
  })),
}));
