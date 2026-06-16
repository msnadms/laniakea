import { create } from 'zustand';

export type AppView = 'galaxy' | 'supercluster';

interface UIState {
  selectedSystemId: number | null;
  selectSystem: (id: number | null) => void;
  showHyperlanes: boolean;
  toggleHyperlanes: () => void;
  view: AppView;
  setView: (view: AppView) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSystemId: null,
  selectSystem: (id) => set({ selectedSystemId: id }),
  showHyperlanes: true,
  toggleHyperlanes: () => set((s) => ({ showHyperlanes: !s.showHyperlanes })),
  view: 'supercluster',
  setView: (view) => set({ view }),
}));
