import { create } from 'zustand';
import type { ShipState } from '../game/fuel';

interface FuelState {
  ship: ShipState | null;
  notice: string | null;
  setShip: (ship: ShipState | null) => void;
  setNotice: (notice: string | null) => void;
}

export const useFuelStore = create<FuelState>((set) => ({
  ship: null,
  notice: null,
  setShip: (ship) => set({ ship }),
  setNotice: (notice) => set({ notice }),
}));
