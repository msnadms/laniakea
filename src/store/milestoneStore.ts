import { create } from 'zustand';
import type { MilestoneId } from '../game/milestones';

export type CompletedMilestones = Partial<Record<MilestoneId, true>>;

interface MilestoneState {
  completed: CompletedMilestones;
  popupQueue: MilestoneId[];
  completeMilestone: (id: MilestoneId) => boolean;
  dismissPopup: () => void;
  restoreMilestones: (data: CompletedMilestones) => void;
  resetMilestones: () => void;
}

export const useMilestoneStore = create<MilestoneState>((set, get) => ({
  completed: {},
  popupQueue: [],
  completeMilestone: (id) => {
    if (get().completed[id]) return false;
    set((s) => ({ completed: { ...s.completed, [id]: true }, popupQueue: [...s.popupQueue, id] }));
    return true;
  },
  dismissPopup: () => set((s) => ({ popupQueue: s.popupQueue.slice(1) })),
  restoreMilestones: (data) => set((s) => ({ completed: { ...s.completed, ...data } })),
  resetMilestones: () => set({ completed: {}, popupQueue: [] }),
}));
