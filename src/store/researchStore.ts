import { create } from 'zustand';
import { researchThreshold, researchTier } from '../data/research';

export interface ResearchStateData {
  points: number;
}

export interface LegacyResearchStateData {
  points?: number;
  unlocked?: string[];
}

interface ResearchState extends ResearchStateData {
  addResearch: (amount: number) => void;
  restoreResearch: (data?: LegacyResearchStateData | null, legacyDataCores?: number) => void;
}

function legacyResearchPoints(unlocked: string[] = []): number {
  if (unlocked.includes('von_neumann_doctrine')) return researchThreshold(3);
  if (unlocked.includes('stellar_engineering')) return researchThreshold(2);
  if (unlocked.includes('planetary_integration')) return researchThreshold(1);
  return 0;
}

export const useResearchStore = create<ResearchState>((set) => ({
  points: 0,
  addResearch: amount => {
    if (Number.isFinite(amount) && amount > 0) set(state => ({ points: state.points + amount }));
  },
  restoreResearch: (data, legacyDataCores = 0) => set({
    points: Math.max(0, data?.points ?? legacyResearchPoints(data?.unlocked) + Math.max(0, legacyDataCores)),
  }),
}));

export const currentResearchTier = () => researchTier(useResearchStore.getState().points);
