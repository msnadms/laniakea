import { create } from 'zustand';
import type { DispatchResult } from './logisticsStore';

export interface DispatchNotification {
  id: string;
  routeName: string;
  result: DispatchResult;
  cost: { exotic: number; helium: number };
}

interface DispatchNotifyStore {
  queue: DispatchNotification[];
  pushDispatchNotification: (n: DispatchNotification) => void;
  shiftDispatchNotification: () => void;
}

const MAX_QUEUE = 5;

export const useDispatchNotifyStore = create<DispatchNotifyStore>((set) => ({
  queue: [],
  pushDispatchNotification: (n) => set((s) => ({ queue: [...s.queue, n].slice(-MAX_QUEUE) })),
  shiftDispatchNotification: () => set((s) => ({ queue: s.queue.slice(1) })),
}));
