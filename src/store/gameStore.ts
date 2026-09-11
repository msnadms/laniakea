import { create } from 'zustand';
import type { Galaxy, StarSystem, SuperclusterData } from '../game/types';
import { generateGalaxy } from '../game/galaxyGen';
import { generateSupercluster } from '../game/superclusters';
import { generateSystemLayout, generatePlanets } from '../game/planetGen';
import { MILKY_WAY_SEED, MILKY_WAY_NUM_ARMS, LANIAKEA_SEED } from '../game/hardcoded';
import { generateAnomalies, type GalaxyAnomalies } from '../game/anomalies';

interface GameState {
  galaxy: Galaxy;
  galaxyAnomalies: GalaxyAnomalies;
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

function makeGalaxy(seed?: number): Galaxy {
  const s = seed ?? Date.now();
  return generateGalaxy(s, s === MILKY_WAY_SEED ? { numArms: MILKY_WAY_NUM_ARMS, type: 'barred' } : undefined);
}

function withPlanets(system: StarSystem, anomalies: GalaxyAnomalies): StarSystem {
  const layout = generateSystemLayout(system.seed, system.starType, anomalies.byHost.get(system.id)?.kind);
  return { ...system, planets: generatePlanets(layout) };
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
  const g = makeGalaxy(MILKY_WAY_SEED);
  return { ...g, systems: g.systems.map((s) => s.id === 0 ? { ...s, visited: true, current: true } : s) };
})();

const _initialSupercluster = (() => {
  const sc = generateSupercluster(LANIAKEA_SEED);
  return { ...sc, dots: sc.dots.map((d) => d.seed === MILKY_WAY_SEED ? { ...d, visited: true, current: true } : d) };
})();

const _initialAnomalies = generateAnomalies(_initialGalaxy);

export const useGameStore = create<GameState>((set) => ({
  galaxy: _initialGalaxy,
  galaxyAnomalies: _initialAnomalies,
  supercluster: _initialSupercluster,
  system: withPlanets(_initialGalaxy.systems[0], _initialAnomalies),
  visitedSystemsByGalaxySeed: { [MILKY_WAY_SEED]: new Set([0]) },
  visitedGalaxyBySuperclusterSeed: { [LANIAKEA_SEED]: new Set([MILKY_WAY_SEED]) },
  regenerateGalaxy: (seed) => set((state) => {
    const galaxy = makeGalaxy(seed);
    return {
      galaxy: applyVisited(galaxy, state.visitedSystemsByGalaxySeed[galaxy.seed]),
      galaxyAnomalies: generateAnomalies(galaxy),
      system: null,
    };
  }),
  regenerateSupercluster: (seed) => set((state) => {
    const sc = seed === state.supercluster.seed ? state.supercluster : generateSupercluster(seed);
    return { supercluster: applyVisitedDots(sc, state.visitedGalaxyBySuperclusterSeed[sc.seed]) };
  }),
  setSystem: (system) => set((state) => ({ system: system ? withPlanets(system, state.galaxyAnomalies) : null })),
  restoreGalaxyAndSystem: (galaxySeed, systemId) => set((state) => {
    const isSameGalaxy = state.galaxy.seed === galaxySeed;
    const baseGalaxy = isSameGalaxy ? state.galaxy : makeGalaxy(galaxySeed);
    const visitedIds = state.visitedSystemsByGalaxySeed[baseGalaxy.seed];
    const galaxy = {
      ...baseGalaxy,
      systems: baseGalaxy.systems.map((s) => {
        const isVisited = visitedIds?.has(s.id) ?? s.visited;
        const isCurrent = systemId !== null ? s.id === systemId : false;
        const wasCurrent = s.current && !isCurrent;
        if (isVisited === s.visited && isCurrent === s.current && !wasCurrent) return s;
        return { ...s, visited: isVisited, current: isCurrent };
      }),
    };
    const found = systemId !== null ? galaxy.systems.find((s) => s.id === systemId) : undefined;
    const galaxyAnomalies = isSameGalaxy ? state.galaxyAnomalies : generateAnomalies(baseGalaxy);
    return {
      galaxy,
      galaxyAnomalies,
      system: found ? withPlanets(found, galaxyAnomalies) : null,
    };
  }),
  markDotVisited: (seed) => {
    set((state) => {
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
    });
  },
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
