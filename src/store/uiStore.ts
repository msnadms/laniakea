import { create } from 'zustand';
import type { AddressComponent, AddressComponentType, Resource } from '../game/types';

export type AppView = 'system' | 'galaxy' | 'supercluster';

interface UIState {
  showAttractorLabels: boolean;
  toggleAttractorLabels: () => void;
  showOrbitRings: boolean;
  toggleOrbitRings: () => void;
  showHUD: boolean;
  toggleHUD: () => void;
  exoticMatter: number;
  driveIntegrity: number;
  railgunAmmo: number;
  helium3Reserves: number;
  alloys: number;
  nutrients: number;
  addCargo: (type: Resource['type'], amount: number) => void;
  selectedPlanetKey: string | null;
  setSelectedPlanet: (key: string | null) => void;
  setShipStats: (stats: { exoticMatter: number; driveIntegrity: number; railgunAmmo: number; helium3Reserves: number }) => void;
  consumeExoticMatter: (amount: number) => void;
  consumeHelium3: (amount: number) => void;
  spendAlloys: (amount: number) => void;
  consumeResources: (exotic: number, helium: number) => void;
  refillResources: () => void;
  infiniteExplore: boolean;
  toggleInfiniteExplore: () => void;
  hudFlash: number;
  triggerHudFlash: () => void;
  view: AppView;
  setView: (view: AppView) => void;
  address: AddressComponent[];
  pushAddress: (segment: AddressComponent) => void;
  popAddress: () => void;
  removeAddressType: (type: AddressComponentType) => void;
  clearAddress: () => void;
}

const obsUniverse: AddressComponent = {
  name: 'Observable Universe',
  x: 0,
  y: 0,
  z: 0,
  type: 'universe'
}

function upsertAddress(address: AddressComponent[], component: AddressComponent) {
  if (address.some((a) => a.type === component.type))
    return address.map((a) => (a.type === component.type ? component : a));
  return [...address, component];
}

export const useUIStore = create<UIState>((set) => ({
  showAttractorLabels: true,
  toggleAttractorLabels: () => set((s) => ({ showAttractorLabels: !s.showAttractorLabels })),
  showOrbitRings: false,
  toggleOrbitRings: () => set((s) => ({ showOrbitRings: !s.showOrbitRings })),
  showHUD: true,
  toggleHUD: () => set((s) => ({ showHUD: !s.showHUD })),
  alloys: 0,
  nutrients: 0,
  addCargo: (type, amount) => set((s) => {
    if (type === 'exotic') return { exoticMatter: Math.min(100, s.exoticMatter + amount) };
    if (type === 'helium-3') return { helium3Reserves: Math.min(500, s.helium3Reserves + amount) };
    if (type === 'alloys') return { alloys: Math.min(500, s.alloys + amount) };
    if (type === 'nutrients') return { nutrients: Math.min(500, s.nutrients + amount) };
    return {};
  }),
  selectedPlanetKey: null,
  setSelectedPlanet: (key) => set({ selectedPlanetKey: key }),
  exoticMatter: 75,
  driveIntegrity: 98,
  railgunAmmo: 350,
  helium3Reserves: 220,
  setShipStats: (stats) => set(stats),
  consumeExoticMatter: (amount) => set((s) => ({ exoticMatter: Math.max(0, s.exoticMatter - amount) })),
  consumeHelium3: (amount) => set((s) => ({ helium3Reserves: Math.max(0, s.helium3Reserves - amount) })),
  spendAlloys: (amount) => set((s) => ({ alloys: Math.max(0, s.alloys - amount) })),
  consumeResources: (exotic, helium) => set((s) => ({
    exoticMatter: Math.max(0, s.exoticMatter - exotic),
    helium3Reserves: Math.max(0, s.helium3Reserves - helium),
  })),
  refillResources: () => set({
    exoticMatter: 75,
    helium3Reserves: 220,
    alloys: 400,
    nutrients: 100
  }),
  infiniteExplore: false,
  toggleInfiniteExplore: () => set((s) => ({ infiniteExplore: !s.infiniteExplore })),
  hudFlash: 0,
  triggerHudFlash: () => set((s) => ({ hudFlash: s.hudFlash + 1 })),
  view: 'supercluster',
  setView: (view) => set({ view }),
  address: [obsUniverse],
  pushAddress: (segment) => set((s) => ({ address: upsertAddress(s.address, segment) })),
  popAddress: () => set((s) => ({ address: s.address.slice(0, -1) })),
  removeAddressType: (type) => set((s) => ({ address: s.address.filter((a) => a.type !== type) })),
  clearAddress: () => set({ address: [obsUniverse] }),
}));
