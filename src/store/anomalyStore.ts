import { create } from 'zustand';
import { anomalyRecordKey, type AnomalyRecord } from '../firebase/anomalies';

interface AnomalyState {
  records: Record<string, AnomalyRecord>;
  latest: AnomalyRecord | null;
  add: (record: AnomalyRecord) => void;
  setAll: (records: AnomalyRecord[]) => void;
  dismissLatest: () => void;
  removeSystem: (galaxySeed: number, systemId: number) => string[];
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
    add: (record) => set((state) => ({
      records: { ...state.records, [anomalyRecordKey(record.galaxySeed, record.systemId)]: record },
      latest: record,
    })),
    setAll: (records) => set({
      records: Object.fromEntries(records.map((record) => [anomalyRecordKey(record.galaxySeed, record.systemId), record])),
      latest: null,
    }),
    dismissLatest: () => set({ latest: null }),
    removeSystem: (galaxySeed, systemId) =>
      removeWhere((record) => record.galaxySeed === galaxySeed && record.systemId === systemId),
    removeGalaxy: (superclusterSeed, galaxySeed) =>
      removeWhere((record) => record.superclusterSeed === superclusterSeed && record.galaxySeed === galaxySeed),
    removeSupercluster: (superclusterSeed) =>
      removeWhere((record) => record.superclusterSeed === superclusterSeed),
  };
});
