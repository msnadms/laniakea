import { create } from 'zustand';
import { anomalyRecordKey, type AnomalyRecord, type WorldAnomaly } from '../game/anomalyRecord';

interface AnomalyState {
  records: Record<string, AnomalyRecord>;
  latest: AnomalyRecord | null;
  latestAwarded: number;
  latestTechnology: number;
  worlds: Record<string, WorldAnomaly>;
  add: (record: AnomalyRecord, awarded?: number, technology?: number) => void;
  setWorld: (key: string, world: WorldAnomaly) => void;
  setAll: (records: AnomalyRecord[]) => void;
  dismissLatest: () => void;
  removeSystem: (superclusterSeed: number, galaxySeed: number, systemId: number) => string[];
  removeGalaxy: (superclusterSeed: number, galaxySeed: number) => string[];
  removeSupercluster: (superclusterSeed: number) => string[];
}

export const useAnomalyStore = create<AnomalyState>((set, get) => {
  const removeWhere = (matches: (record: AnomalyRecord) => boolean): string[] => {
    const { records, latest } = get();
    const removed = Object.keys(records).filter((key) => matches(records[key]));
    if (removed.length === 0) return removed;
    const remaining = { ...records };
    for (const key of removed) delete remaining[key];
    set({ records: remaining, latest: latest && matches(latest) ? null : latest });
    return removed;
  };

  return {
    records: {},
    latest: null,
    latestAwarded: 0,
    latestTechnology: 0,
    worlds: {},
    add: (record, awarded = 0, technology = 0) => set((state) => ({
      records: { ...state.records, [anomalyRecordKey(record.superclusterSeed, record.galaxySeed, record.systemId)]: record },
      latest: record,
      latestAwarded: awarded,
      latestTechnology: technology,
    })),
    setWorld: (key, world) => set((state) => ({ worlds: { ...state.worlds, [key]: world } })),
    setAll: (records) => set({
      records: Object.fromEntries(records.map((record) => [anomalyRecordKey(record.superclusterSeed, record.galaxySeed, record.systemId), record])),
      latest: null,
    }),
    dismissLatest: () => set({ latest: null }),
    removeSystem: (superclusterSeed, galaxySeed, systemId) =>
      removeWhere((record) => record.superclusterSeed === superclusterSeed && record.galaxySeed === galaxySeed && record.systemId === systemId),
    removeGalaxy: (superclusterSeed, galaxySeed) =>
      removeWhere((record) => record.superclusterSeed === superclusterSeed && record.galaxySeed === galaxySeed),
    removeSupercluster: (superclusterSeed) =>
      removeWhere((record) => record.superclusterSeed === superclusterSeed),
  };
});
