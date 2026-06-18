import { create } from 'zustand';
import type { AddressComponent, AddressComponentType } from '../game/types';

export type AppView = 'system' | 'galaxy' | 'supercluster';

interface UIState {
  showHyperlanes: boolean;
  toggleHyperlanes: () => void;
  showAttractorLabels: boolean;
  toggleAttractorLabels: () => void;
  showOrbitRings: boolean;
  toggleOrbitRings: () => void;
  view: AppView;
  setView: (view: AppView) => void;
  address: AddressComponent[];
  pushAddress: (segment: AddressComponent) => void;
  popAddress: () => void;
  removeAddressType: (type: AddressComponentType) => void;
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
  showHyperlanes: false,
  toggleHyperlanes: () => set((s) => ({ showHyperlanes: !s.showHyperlanes })),
  showAttractorLabels: true,
  toggleAttractorLabels: () => set((s) => ({ showAttractorLabels: !s.showAttractorLabels })),
  showOrbitRings: false,
  toggleOrbitRings: () => set((s) => ({ showOrbitRings: !s.showOrbitRings })),
  view: 'supercluster',
  setView: (view) => set({ view }),
  address: [obsUniverse],
  pushAddress: (segment) => set((s) => ({ address: upsertAddress(s.address, segment) })),
  popAddress: () => set((s) => ({ address: s.address.slice(0, -1) })),
  removeAddressType: (type) => set((s) => ({ address: s.address.filter((a) => a.type !== type) })),
}));
