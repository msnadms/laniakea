import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Extractor } from '../game/types';
import { useUIStore, EXTRACTOR_HOLD_CAPS, LOGISTICS_B_RATE, computeLogisticsCap, computeStorageCap } from './uiStore';

export const ACCUMULATION_RATE_PER_MS = 1 / 1_200_000; // 1 unit per 20 minutes
export const AUTO_DELIVERY_COST_PER_STATION = 200;

export function peekAccumulated(extractor: Extractor): number {
  const { storageB, logisticsB } = useUIStore.getState();
  return Math.min(
    EXTRACTOR_HOLD_CAPS[storageB],
    Math.floor((Date.now() - extractor.lastCollectedAt) * ACCUMULATION_RATE_PER_MS * extractor.rate * LOGISTICS_B_RATE[logisticsB]),
  );
}

interface ExtractorState {
  extractors: Record<string, Extractor>;
  placeExtractor: (extractor: Extractor) => void;
  collectExtractor: (key: string, maxAmount?: number) => number;
  remoteCollectExtractor: (key: string) => boolean;
  removeExtractor: (key: string) => void;
  restoreExtractors: (list: Extractor[]) => void;
}

export const useExtractorStore = create<ExtractorState>()(subscribeWithSelector((set, get) => ({
  extractors: {},

  placeExtractor: (extractor) => {
    const maxStations = computeLogisticsCap(useUIStore.getState().logisticsA);
    if (Object.keys(get().extractors).length >= maxStations) return;
    set((s) => ({ extractors: { ...s.extractors, [extractor.key]: extractor } }));
  },

  collectExtractor: (key, maxAmount?) => {
    const extractor = get().extractors[key];
    if (!extractor) return 0;
    const now = Date.now();
    const { storageB, logisticsB } = useUIStore.getState();
    const extractorMax = EXTRACTOR_HOLD_CAPS[storageB];
    const unitsPerMs = ACCUMULATION_RATE_PER_MS * extractor.rate * LOGISTICS_B_RATE[logisticsB];
    const rawAmount = Math.min(Math.floor((now - extractor.lastCollectedAt) * unitsPerMs), extractorMax);
    const amount = maxAmount !== undefined ? Math.min(rawAmount, maxAmount) : rawAmount;
    if (amount <= 0) return 0;
    const newLastCollectedAt = rawAmount > amount ? now - (rawAmount - amount) / unitsPerMs : now;
    set((s) => ({
      extractors: {
        ...s.extractors,
        [key]: { ...s.extractors[key], lastCollectedAt: newLastCollectedAt },
      },
    }));
    return amount;
  },

  remoteCollectExtractor: (key) => {
    const extractor = get().extractors[key];
    if (!extractor) return false;
    const potential = peekAccumulated(extractor);
    if (potential <= 0) return false;
    const ui = useUIStore.getState();
    if (ui.exoticMatter < AUTO_DELIVERY_COST_PER_STATION) return false;
    const storageCap = computeStorageCap(ui.storageA);
    const currentCargo = ({ exotic: ui.exoticMatter, 'helium-3': ui.helium3Reserves, alloys: ui.alloys, nutrients: ui.nutrients } as Record<string, number>)[extractor.resourceType];
    if (storageCap <= currentCargo) return false;
    ui.consumeExoticMatter(AUTO_DELIVERY_COST_PER_STATION);
    // Re-read state after deduction so exotic-type extractors get correct available space
    const ui2 = useUIStore.getState();
    const cargo2 = ({ exotic: ui2.exoticMatter, 'helium-3': ui2.helium3Reserves, alloys: ui2.alloys, nutrients: ui2.nutrients } as Record<string, number>)[extractor.resourceType];
    const space = Math.max(0, storageCap - cargo2);
    const amount = get().collectExtractor(key, space);
    if (amount > 0) ui2.addCargo(extractor.resourceType, amount);
    return true;
  },

  removeExtractor: (key) =>
    set((s) => {
      const { [key]: _, ...rest } = s.extractors;
      return { extractors: rest };
    }),

  restoreExtractors: (list) => {
    const map: Record<string, Extractor> = {};
    for (const e of list) map[e.key] = e;
    set({ extractors: map });
  },
})));
