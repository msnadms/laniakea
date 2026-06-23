import { create } from 'zustand';
import type { QuestId } from '../game/quests';

export type CompletedQuests = Partial<Record<QuestId, true>>;

interface QuestState {
  completed: CompletedQuests;
  completeQuest: (id: QuestId) => boolean;
  restoreQuests: (data: CompletedQuests) => void;
}

export const useQuestStore = create<QuestState>((set, get) => ({
  completed: {},
  completeQuest: (id) => {
    if (get().completed[id]) return false;
    set((s) => ({ completed: { ...s.completed, [id]: true } }));
    return true;
  },
  restoreQuests: (data) => set({ completed: data }),
}));
