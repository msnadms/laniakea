import { create } from 'zustand';
import type { Galaxy, SuperclusterData } from '../game/types';
import { generateGalaxy } from '../game/galaxyGen';
import { generateSupercluster } from '../game/superclusters';

interface GameState {
  galaxy: Galaxy;
  supercluster: SuperclusterData;
  regenerateGalaxy: (seed?: number) => void;
  regenerateSupercluster: (seed?: number) => void;
}

export const useGameStore = create<GameState>((set) => ({
  galaxy: generateGalaxy(),
  supercluster: generateSupercluster(),
  regenerateGalaxy: (seed) => set({ galaxy: generateGalaxy(seed) }),
  regenerateSupercluster: (seed) => set({ supercluster: generateSupercluster(seed) })
}));
