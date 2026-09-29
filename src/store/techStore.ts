import { create } from 'zustand';
import { NO_TECH, type TechLevels } from '../game/tech';

export interface TechLedger {
  technology: number;
  tech: TechLevels;
}

interface TechState {
  technology: number;
  levels: TechLevels;
  open: boolean;
  setLedger: (ledger: TechLedger) => void;
  setOpen: (open: boolean) => void;
}

export const useTechStore = create<TechState>((set) => ({
  technology: 0,
  levels: NO_TECH,
  open: false,
  setLedger: ({ technology, tech }) => set({ technology, levels: tech }),
  setOpen: (open) => set({ open }),
}));
