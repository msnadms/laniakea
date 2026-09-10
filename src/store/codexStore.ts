import { create } from 'zustand';
import type { StarSystem } from '../game/types';
import type { GalaxyRecord, SuperclusterRecord, SystemRecord } from '../firebase/discoveries';
import { LANIAKEA_SEED, LANIAKEA_NAME, MILKY_WAY_SEED, MILKY_WAY_NAME, SOL_SEED } from '../game/hardcoded';
import { generateGalaxyName } from '../game/superclusters';

interface CodexState {
  superclusters: Record<string, SuperclusterRecord>;
  addGalaxyRecord: (superclusterSeed: number, superclusterName: string, galaxySeed: number, galaxyName: string) => void;
  addSystemRecord: (superclusterSeed: number, superclusterName: string, galaxySeed: number, galaxyName: string, system: StarSystem) => void;
  setAll: (records: SuperclusterRecord[]) => void;
  deleteSystem: (superclusterSeed: number, galaxySeed: number, systemId: string) => void;
  deleteGalaxy: (superclusterSeed: number, galaxySeed: number) => void;
  deleteSupercluster: (superclusterSeed: number) => void;
}

function upsertSupercluster(
  superclusters: Record<string, SuperclusterRecord>,
  superclusterSeed: number,
  superclusterName: string,
  gKey: string,
  galaxy: GalaxyRecord,
): Record<string, SuperclusterRecord> {
  const scKey = String(superclusterSeed);
  const existing = superclusters[scKey];
  const updated: SuperclusterRecord = existing
    ? { ...existing, galaxies: { ...existing.galaxies, [gKey]: galaxy } }
    : { superclusterSeed, superclusterName, discoveredAt: Date.now(), galaxies: { [gKey]: galaxy } };
  return { ...superclusters, [scKey]: updated };
}

const _solRecord: SystemRecord = { name: 'Sol', starType: 'G', seed: SOL_SEED, discoveredAt: 0 };
const _mwGalaxy: GalaxyRecord = { galaxySeed: MILKY_WAY_SEED, galaxyName: MILKY_WAY_NAME, discoveredAt: 0, systems: { '0': _solRecord } };
const _laniakea: SuperclusterRecord = { superclusterSeed: LANIAKEA_SEED, superclusterName: LANIAKEA_NAME, discoveredAt: 0, galaxies: { [String(MILKY_WAY_SEED)]: _mwGalaxy } };
const _initialSuperclusters: Record<string, SuperclusterRecord> = { [String(LANIAKEA_SEED)]: _laniakea };

export const useCodexStore = create<CodexState>((set) => ({
  superclusters: _initialSuperclusters,

  addGalaxyRecord: (superclusterSeed, superclusterName, galaxySeed, galaxyName) =>
    set((state) => {
      const scKey = String(superclusterSeed);
      const gKey = String(galaxySeed);
      if (state.superclusters[scKey]?.galaxies[gKey]) return state;
      const galaxy: GalaxyRecord = { galaxySeed, galaxyName, discoveredAt: Date.now(), systems: {} };
      return { superclusters: upsertSupercluster(state.superclusters, superclusterSeed, superclusterName, gKey, galaxy) };
    }),

  addSystemRecord: (superclusterSeed, superclusterName, galaxySeed, galaxyName, system) =>
    set((state) => {
      const scKey = String(superclusterSeed);
      const gKey = String(galaxySeed);
      const sKey = String(system.id);
      const existingGalaxy = state.superclusters[scKey]?.galaxies[gKey];
      if (existingGalaxy?.systems[sKey]) return state;
      const record: SystemRecord = {
        name: system.name,
        starType: system.starType,
        seed: system.seed,
        discoveredAt: Date.now(),
      };
      const galaxy: GalaxyRecord = existingGalaxy
        ? { ...existingGalaxy, systems: { ...existingGalaxy.systems, [sKey]: record } }
        : { galaxySeed, galaxyName, discoveredAt: Date.now(), systems: { [sKey]: record } };
      return { superclusters: upsertSupercluster(state.superclusters, superclusterSeed, superclusterName, gKey, galaxy) };
    }),

  setAll: (records) => {
    const superclusters: Record<string, SuperclusterRecord> = { ..._initialSuperclusters };
    for (const sc of records) {
      const key = String(sc.superclusterSeed);
      const initial = superclusters[key];
      // Patch galaxy records that are missing metadata due to old saves where
      // saveSystemDiscovery was called without a prior saveGalaxyDiscovery.
      const patchedGalaxies: Record<string, GalaxyRecord> = {};
      for (const [gKey, g] of Object.entries(sc.galaxies)) {
        const galaxySeed = g.galaxySeed ?? initial?.galaxies[gKey]?.galaxySeed ?? Number(gKey);
        const galaxyName = g.galaxyName ?? initial?.galaxies[gKey]?.galaxyName ?? generateGalaxyName(galaxySeed);
        patchedGalaxies[gKey] = { ...g, galaxySeed, galaxyName };
      }
      superclusters[key] = { ...sc, galaxies: patchedGalaxies };
    }
    set({ superclusters });
  },

  deleteSystem: (superclusterSeed, galaxySeed, systemId) =>
    set((state) => {
      const scKey = String(superclusterSeed);
      const gKey = String(galaxySeed);
      const sc = state.superclusters[scKey];
      if (!sc) return state;
      const galaxy = sc.galaxies[gKey];
      if (!galaxy) return state;
      const { [systemId]: _removed, ...remainingSystems } = galaxy.systems;
      const updatedGalaxy = { ...galaxy, systems: remainingSystems };
      const updatedSc = { ...sc, galaxies: { ...sc.galaxies, [gKey]: updatedGalaxy } };
      return { superclusters: { ...state.superclusters, [scKey]: updatedSc } };
    }),

  deleteGalaxy: (superclusterSeed, galaxySeed) =>
    set((state) => {
      const scKey = String(superclusterSeed);
      const gKey = String(galaxySeed);
      const sc = state.superclusters[scKey];
      if (!sc) return state;
      const { [gKey]: _removed, ...remainingGalaxies } = sc.galaxies;
      const updatedSc = { ...sc, galaxies: remainingGalaxies };
      return { superclusters: { ...state.superclusters, [scKey]: updatedSc } };
    }),

  deleteSupercluster: (superclusterSeed) =>
    set((state) => {
      const scKey = String(superclusterSeed);
      const { [scKey]: _removed, ...rest } = state.superclusters;
      return { superclusters: rest };
    }),
}));
