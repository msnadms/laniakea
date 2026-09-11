import { create } from 'zustand';
import type { AddressComponent, AddressComponentType } from '../game/types';
import type { UserSettings } from '../firebase/userDoc';
import { DEFAULT_ADDRESS } from '../game/hardcoded';

export type AppView = 'system' | 'galaxy' | 'supercluster';

interface UIState {
  showAttractorLabels: boolean;
  toggleAttractorLabels: () => void;
  showOrbitRings: boolean;
  toggleOrbitRings: () => void;
  showHUD: boolean;
  toggleHUD: () => void;
  showScanlines: boolean;
  toggleScanlines: () => void;
  showAnomalyDebug: boolean;
  toggleAnomalyDebug: () => void;
  selectedPlanetName: string | null;
  setSelectedPlanet: (name: string | null) => void;
  anomalyPanelOpen: boolean;
  setAnomalyPanelOpen: (open: boolean) => void;
  view: AppView;
  setView: (view: AppView) => void;
  viewTransitioning: boolean;
  setViewTransitioning: (v: boolean) => void;
  transitionBack: boolean;
  setTransitionBack: (v: boolean) => void;
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
  showScanlines: true,
  toggleScanlines: () => set((s) => ({ showScanlines: !s.showScanlines })),
  showAnomalyDebug: false,
  toggleAnomalyDebug: () => set((s) => ({ showAnomalyDebug: !s.showAnomalyDebug })),
  selectedPlanetName: null,
  setSelectedPlanet: (name) => set({ selectedPlanetName: name }),
  anomalyPanelOpen: false,
  setAnomalyPanelOpen: (open) => set({ anomalyPanelOpen: open }),
  view: 'system',
  setView: (view) => set({ view }),
  viewTransitioning: false,
  setViewTransitioning: (v) => set({ viewTransitioning: v }),
  transitionBack: false,
  setTransitionBack: (v) => set({ transitionBack: v }),
  address: DEFAULT_ADDRESS,
  pushAddress: (segment) => set((s) => ({ address: upsertAddress(s.address, segment) })),
  popAddress: () => set((s) => ({ address: s.address.slice(0, -1) })),
  removeAddressType: (type) => set((s) => ({ address: s.address.filter((a) => a.type !== type) })),
  clearAddress: () => set({ address: [obsUniverse] }),
}));

export function applyUserSettings(settings: UserSettings): void {
  useUIStore.setState({
    showOrbitRings: settings.showOrbitRings,
    showAttractorLabels: settings.showAttractorLabels,
    showHUD: settings.showHUD,
    selectedPlanetName: null,
    anomalyPanelOpen: false,
  });
}
