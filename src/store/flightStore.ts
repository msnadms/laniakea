import { create } from 'zustand';

interface FlightState {
  position: [number, number, number] | null;
  setPosition: (x: number, y: number, z: number) => void;
  clearPosition: () => void;
}

export const useFlightStore = create<FlightState>((set, get) => ({
  position: null,
  setPosition: (x, y, z) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const current = get().position;
    if (current && current[0] === rx && current[1] === ry && current[2] === rz) return;
    set({ position: [rx, ry, rz] });
  },
  clearPosition: () => set({ position: null }),
}));
