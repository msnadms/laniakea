import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Extractor } from '../game/types';

export const ACCUMULATION_RATE_PER_MS = 1 / 60_000; // 1 unit per minute
export const MAX_STATIONS = 5;

interface ExtractorState {
  extractors: Record<string, Extractor>;
  placeExtractor: (extractor: Extractor) => void;
  collectExtractor: (key: string) => number;
  removeExtractor: (key: string) => void;
  restoreExtractors: (list: Extractor[]) => void;
}

export const useExtractorStore = create<ExtractorState>()(subscribeWithSelector((set, get) => ({
  extractors: {},

  placeExtractor: (extractor) => {
    if (Object.keys(get().extractors).length >= MAX_STATIONS) return;
    set((s) => ({ extractors: { ...s.extractors, [extractor.key]: extractor } }));
  },

  collectExtractor: (key) => {
    const extractor = get().extractors[key];
    if (!extractor) return 0;
    const now = Date.now();
    const amount = Math.floor((now - extractor.lastCollectedAt) * ACCUMULATION_RATE_PER_MS * extractor.rate);
    set((s) => ({
      extractors: {
        ...s.extractors,
        [key]: { ...s.extractors[key], lastCollectedAt: now },
      },
    }));
    return amount;
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
