import { create } from 'zustand';
import type { Galaxy, StarSystem, SuperclusterData } from '../game/types';
import { generateGalaxy } from '../game/galaxyGen';
import { generateSupercluster } from '../game/superclusters';
import { generateSystemLayout, generatePlanets } from '../game/planetGen';
import { useQuestStore } from './questStore';
import { MILKY_WAY_SEED, LANIAKEA_SEED } from '../game/hardcoded';

interface GameState {
  galaxy: Galaxy;
  supercluster: SuperclusterData;
  system: StarSystem | null;
  visitedSystemsByGalaxySeed: Record<number, Set<number>>;
  visitedGalaxyBySuperclusterSeed: Record<number, Set<number>>;
  regenerateGalaxy: (seed?: number) => void;
  regenerateSupercluster: (seed?: number) => void;
  setSystem: (system: StarSystem | null) => void;
  restoreGalaxyAndSystem: (galaxySeed: number, systemId: number | null) => void;
  markDotVisited: (seed: number) => void;
  markSystemVisited: (id: number) => void;
  restoreVisited: (
    visitedSystems: Record<number, number[]>,
    visitedGalaxies: Record<number, number[]>,
  ) => void;
}

function applyVisited(galaxy: Galaxy, visited: Set<number> | undefined): Galaxy {
  if (!visited || visited.size === 0) return galaxy;
  return {
    ...galaxy,
    systems: galaxy.systems.map((s) => visited.has(s.id) ? { ...s, visited: true } : s),
  };
}

function applyVisitedDots(sc: SuperclusterData, visitedSeeds: Set<number> | undefined): SuperclusterData {
  if (!visitedSeeds || visitedSeeds.size === 0) return sc;
  return {
    ...sc,
    dots: sc.dots.map((d) => visitedSeeds.has(d.seed) ? { ...d, visited: true } : d),
  };
}

const _initialGalaxy = (() => {
  const g = generateGalaxy(MILKY_WAY_SEED);
  return { ...g, systems: g.systems.map((s) => s.id === 0 ? { ...s, visited: true, current: true } : s) };
})();

const _initialSupercluster = (() => {
  const sc = generateSupercluster(LANIAKEA_SEED);
  return { ...sc, dots: sc.dots.map((d) => d.seed === MILKY_WAY_SEED ? { ...d, visited: true, current: true } : d) };
})();

const _initialSystem = (() => {
  const sol = _initialGalaxy.systems[0];
  return { ...sol, planets: generatePlanets(generateSystemLayout(sol.seed, sol.starType)) };
})();

export const useGameStore = create<GameState>((set) => ({
  galaxy: _initialGalaxy,
  supercluster: _initialSupercluster,
  system: _initialSystem,
  visitedSystemsByGalaxySeed: { [MILKY_WAY_SEED]: new Set([0]) },
  visitedGalaxyBySuperclusterSeed: { [LANIAKEA_SEED]: new Set([MILKY_WAY_SEED]) },
  regenerateGalaxy: (seed) => set((state) => {
    const galaxy = generateGalaxy(seed);
    return {
      galaxy: applyVisited(galaxy, state.visitedSystemsByGalaxySeed[galaxy.seed]),
      system: null,
    };
  }),
  regenerateSupercluster: (seed) => set((state) => {
    if (seed !== undefined && seed !== state.supercluster.seed) {
      useQuestStore.getState().completeQuest('new_supercluster');
    }
    if (seed === state.supercluster.seed) {
      return { supercluster: applyVisitedDots(state.supercluster, state.visitedGalaxyBySuperclusterSeed[state.supercluster.seed]) };
    }
    const sc = generateSupercluster(seed);
    return {
      supercluster: applyVisitedDots(sc, state.visitedGalaxyBySuperclusterSeed[sc.seed]),
    };
  }),
  setSystem: (system) => {
    if (system) {
      const layout = generateSystemLayout(system.seed, system.starType);
      const planets = generatePlanets(layout);
      const q = useQuestStore.getState();
      q.completeQuest('first_system');
      if (layout.planets.some((p) => p.zone === 'habitable')) q.completeQuest('first_habitable');
      set({ system: { ...system, planets } });
    } else {
      set({ system: null });
    }
  },
  restoreGalaxyAndSystem: (galaxySeed, systemId) => set((state) => {
    const baseGalaxy = state.galaxy.seed === galaxySeed ? state.galaxy : generateGalaxy(galaxySeed);
    const visitedIds = state.visitedSystemsByGalaxySeed[baseGalaxy.seed];
    const updatedGalaxy = {
      ...baseGalaxy,
      systems: baseGalaxy.systems.map((s) => {
        const isVisited = visitedIds?.has(s.id) ?? s.visited;
        const isCurrent = systemId !== null ? s.id === systemId : false;
        const wasCurrent = s.current && !isCurrent;
        if (isVisited === s.visited && isCurrent === s.current && !wasCurrent) return s;
        return { ...s, visited: isVisited, current: isCurrent };
      }),
    };

    let system: StarSystem | null = null;
    if (systemId !== null) {
      const found = updatedGalaxy.systems.find((s) => s.id === systemId);
      if (found) {
        const layout = generateSystemLayout(found.seed, found.starType);
        const planets = generatePlanets(layout);
        system = { ...found, planets };
        const q = useQuestStore.getState();
        q.completeQuest('first_system');
        if (layout.planets.some((p) => p.zone === 'habitable')) q.completeQuest('first_habitable');
      }
    }

    return { galaxy: updatedGalaxy, system };
  }),
  markDotVisited: (seed) => set((state) => {
    useQuestStore.getState().completeQuest('first_galaxy');
    const scSeed = state.supercluster.seed;
    const existing = state.visitedGalaxyBySuperclusterSeed[scSeed];
    const alreadyVisited = existing?.has(seed);
    const updated = alreadyVisited ? existing : new Set(existing);
    if (!alreadyVisited) updated.add(seed);
    return {
      supercluster: {
        ...state.supercluster,
        dots: state.supercluster.dots.map((d) => {
          if (d.seed === seed) return { ...d, visited: true, current: true };
          if (d.current) return { ...d, current: false };
          return d;
        }),
      },
      visitedGalaxyBySuperclusterSeed: alreadyVisited 
        ? state.visitedGalaxyBySuperclusterSeed 
        : { ...state.visitedGalaxyBySuperclusterSeed, [scSeed]: updated },
    };
  }),
  markSystemVisited: (id) => set((state) => {
    const galaxySeed = state.galaxy.seed;
    const existing = state.visitedSystemsByGalaxySeed[galaxySeed];
    const alreadyVisited = existing?.has(id);
    const updated = alreadyVisited ? existing : new Set(existing);
    if (!alreadyVisited) updated.add(id);
    return {
      galaxy: {
        ...state.galaxy,
        systems: state.galaxy.systems.map((s) => {
          if (s.id === id) return { ...s, visited: true, current: true };
          if (s.current) return { ...s, current: false };
          return s;
        }),
      },
      visitedSystemsByGalaxySeed: alreadyVisited
        ? state.visitedSystemsByGalaxySeed
        : { ...state.visitedSystemsByGalaxySeed, [galaxySeed]: updated },
    };
  }),
  restoreVisited: (visitedSystems, visitedGalaxies) => set((state) => {
    const systemSets: Record<number, Set<number>> = { ...state.visitedSystemsByGalaxySeed };
    for (const [k, v] of Object.entries(visitedSystems)) {
      const seed = Number(k);
      const existing = systemSets[seed];
      systemSets[seed] = existing ? new Set([...existing, ...v]) : new Set(v);
    }
    const galaxySets: Record<number, Set<number>> = { ...state.visitedGalaxyBySuperclusterSeed };
    for (const [k, v] of Object.entries(visitedGalaxies)) {
      const seed = Number(k);
      const existing = galaxySets[seed];
      galaxySets[seed] = existing ? new Set([...existing, ...v]) : new Set(v);
    }
    return {
      visitedSystemsByGalaxySeed: systemSets,
      visitedGalaxyBySuperclusterSeed: galaxySets,
      galaxy: applyVisited(state.galaxy, systemSets[state.galaxy.seed]),
      supercluster: applyVisitedDots(state.supercluster, galaxySets[state.supercluster.seed]),
    };
  }),
}));
