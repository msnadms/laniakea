import { create } from 'zustand';
import type { FlyCamera } from '../game/types';

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

type CameraListener = (camera: FlyCamera | null) => void;

const cameraListeners = new Set<CameraListener>();

export function publishFlightCamera(camera: FlyCamera | null) {
  for (const listener of cameraListeners) listener(camera);
}

export function subscribeFlightCamera(listener: CameraListener): () => void {
  cameraListeners.add(listener);
  return () => {
    cameraListeners.delete(listener);
  };
}
