import { create } from 'zustand';
import type { AddressComponent, AddressComponentType, Resource } from '../game/types';
import { useQuestStore } from './questStore';

export type AppView = 'system' | 'galaxy' | 'supercluster';

// UPGRADE_POOL is the shared pool cap. Each path caps at UPGRADE_POOL-1. COSTS arrays need UPGRADE_POOL entries; stat/name arrays need UPGRADE_POOL.
export const UPGRADE_POOL = 5;

const STORAGE_BASE = 500;
export const STORAGE_A_BONUS = [0, 600, 1500, 2000, 3000]; 
export function computeStorageCap(a: number): number {
  return STORAGE_BASE + STORAGE_A_BONUS[a];
}

export const EXTRACTOR_HOLD_CAPS = [200, 300, 450, 600, 750];

export const DRIVE_A_REDUCTION = [0.0, 0.15, 0.30, 0.45, 0.60];
export const DRIVE_B_REDUCTION = [0.0, 0.15, 0.30, 0.45, 0.60];
export function computeDriveMultiplier(a: number, b: number): [number, number] {
  return [1.0 - DRIVE_A_REDUCTION[a], 1.0 - DRIVE_B_REDUCTION[b]]
}

const WEAPON_BASE = 20;
export const WEAPON_A_BONUS = [0, 10, 20, 35, 60];
export const WEAPON_B_BONUS = [0, 10, 20, 35, 60];
export function computeWeaponCap(a: number, b: number): number {
  return WEAPON_BASE + WEAPON_A_BONUS[a] + WEAPON_B_BONUS[b];
}

const LOGISTICS_BASE = 5;
export const LOGISTICS_A_BONUS = [0, 1, 2, 3, 5];
export function computeLogisticsCap(a: number): number {
  return LOGISTICS_BASE + LOGISTICS_A_BONUS[a];
}
export const LOGISTICS_B_RATE = [1.0, 1.25, 1.5, 1.75, 2.0];

// Unlock threshold for the remote delivery panel (requires both logistics paths ≥ this tier).
export const DELIVERY_UNLOCK_THRESHOLD = 2;

export const UPGRADE_COSTS = {
  storageA:   [150, 300, 600, 1000, 2000] as const,
  storageB:   [100, 250, 500,  900, 1600] as const,
  driveA:     [150, 300, 600, 1000, 1800] as const,
  driveB:     [150, 300, 600, 1000, 1800] as const,
  weaponA:    [100, 200, 400,  800, 2000] as const,
  weaponB:    [100, 200, 400,  800, 2000] as const,
  logisticsA: [200, 400, 700, 1200, 1800] as const,
  logisticsB: [200, 400, 700, 1200, 1800] as const,
};

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
  metallicHydrogen: number;
  neutronStarMatter: number;
  addCargo: (type: Resource['type'], amount: number) => void;
  selectedPlanetKey: string | null;
  setSelectedPlanet: (key: string | null) => void;
  setShipStats: (stats: { exoticMatter: number; driveIntegrity: number; railgunAmmo: number; helium3Reserves: number }) => void;
  consumeExoticMatter: (amount: number) => void;
  consumeHelium3: (amount: number) => void;
  spendAlloys: (amount: number) => void;
  spendNutrients: (amount: number) => void;
  spendMetallicHydrogen: (amount: number) => void;
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
  storageA: number;
  storageB: number;
  driveA: number;
  driveB: number;
  weaponA: number;
  weaponB: number;
  logisticsA: number;
  logisticsB: number;
  showUpgradePanel: boolean;
  toggleUpgradePanel: () => void;
  resetUpgrades: () => void;
  upgradeStorageA: () => void;
  upgradeStorageB: () => void;
  upgradeDriveA: () => void;
  upgradeDriveB: () => void;
  upgradeWeaponA: () => void;
  upgradeWeaponB: () => void;
  upgradeLogisticsA: () => void;
  upgradeLogisticsB: () => void;
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

export const useUIStore = create<UIState>((set, get) => ({
  showAttractorLabels: true,
  toggleAttractorLabels: () => set((s) => ({ showAttractorLabels: !s.showAttractorLabels })),
  showOrbitRings: false,
  toggleOrbitRings: () => set((s) => ({ showOrbitRings: !s.showOrbitRings })),
  showHUD: true,
  toggleHUD: () => set((s) => ({ showHUD: !s.showHUD })),
  alloys: 0,
  nutrients: 0,
  metallicHydrogen: 0,
  neutronStarMatter: 0,
  addCargo: (type, amount) => set((s) => {
    if (type === 'exotic') {
      useQuestStore.getState().completeQuest('first_exotic');
      return { exoticMatter: Math.min(computeStorageCap(s.storageA), s.exoticMatter + amount) };
    }
    const cap = computeStorageCap(s.storageA);
    if (type === 'helium-3') return { helium3Reserves: Math.min(cap, s.helium3Reserves + amount) };
    if (type === 'alloys') return { alloys: Math.min(cap, s.alloys + amount) };
    if (type === 'nutrients') return { nutrients: Math.min(cap, s.nutrients + amount) };
    if (type === 'metallicHydrogen') return { metallicHydrogen: Math.min(cap, s.metallicHydrogen + amount) };
    if (type === 'neutronStarMatter') return { neutronStarMatter: Math.min(cap, s.neutronStarMatter + amount) };
    return {};
  }),
  selectedPlanetKey: null,
  setSelectedPlanet: (key) => set({ selectedPlanetKey: key }),
  exoticMatter: 250,
  driveIntegrity: 98,
  railgunAmmo: 20,
  helium3Reserves: 200,
  setShipStats: (stats) => set(stats),
  consumeExoticMatter: (amount) => set((s) => ({ exoticMatter: Math.max(0, s.exoticMatter - amount) })),
  consumeHelium3: (amount) => set((s) => ({ helium3Reserves: Math.max(0, s.helium3Reserves - amount) })),
  spendAlloys: (amount) => set((s) => ({ alloys: Math.max(0, s.alloys - amount) })),
  spendNutrients: (amount) => set((s) => ({ nutrients: Math.max(0, s.nutrients - amount) })),
  spendMetallicHydrogen: (amount) => set((s) => ({ metallicHydrogen: Math.max(0, s.metallicHydrogen - amount) })),
  consumeResources: (exotic, helium) => set((s) => ({
    exoticMatter: Math.max(0, s.exoticMatter - exotic),
    helium3Reserves: Math.max(0, s.helium3Reserves - helium),
  })),
  refillResources: () => set((s) => {
    const cap = computeStorageCap(s.storageA);
    return { exoticMatter: cap, helium3Reserves: cap, alloys: cap, nutrients: cap, metallicHydrogen: cap, neutronStarMatter: cap };
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
  storageA: 0,
  storageB: 0,
  driveA: 0,
  driveB: 0,
  weaponA: 0,
  weaponB: 0,
  logisticsA: 0,
  logisticsB: 0,
  showUpgradePanel: false,
  toggleUpgradePanel: () => set((s) => ({ showUpgradePanel: !s.showUpgradePanel })),
  resetUpgrades: () => set((s) => ({ storageA: 0, storageB: 0, driveA: 0, driveB: 0, weaponA: 0, weaponB: 0, logisticsA: 0, logisticsB: 0, railgunAmmo: Math.min(s.railgunAmmo, WEAPON_BASE) })),
  upgradeStorageA: () => {
    const { storageA, storageB, alloys } = get();
    if (storageA >= UPGRADE_POOL - 1 || storageA + storageB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.storageA[storageA];
    if (alloys < cost) return;
    set((s) => ({ storageA: s.storageA + 1, alloys: s.alloys - cost }));
    useQuestStore.getState().completeQuest('upgrade_storage');
  },
  upgradeStorageB: () => {
    const { storageA, storageB, alloys } = get();
    if (storageB >= UPGRADE_POOL - 1 || storageA + storageB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.storageB[storageB];
    if (alloys < cost) return;
    set((s) => ({ storageB: s.storageB + 1, alloys: s.alloys - cost }));
    useQuestStore.getState().completeQuest('upgrade_storage');
  },
  upgradeDriveA: () => {
    const { driveA, driveB, exoticMatter } = get();
    if (driveA >= UPGRADE_POOL - 1 || driveA + driveB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.driveA[driveA];
    if (exoticMatter < cost) return;
    set((s) => ({ driveA: s.driveA + 1, exoticMatter: s.exoticMatter - cost }));
    const s = get();
    useQuestStore.getState().completeQuest('upgrade_drive');
    if (s.driveA + s.driveB >= 3 && s.logisticsA + s.logisticsB >= 3) useQuestStore.getState().completeQuest('delivery_network');
  },
  upgradeDriveB: () => {
    const { driveA, driveB, helium3Reserves } = get();
    if (driveB >= UPGRADE_POOL - 1 || driveA + driveB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.driveB[driveB];
    if (helium3Reserves < cost) return;
    set((s) => ({ driveB: s.driveB + 1, helium3Reserves: s.helium3Reserves - cost }));
    const s = get();
    useQuestStore.getState().completeQuest('upgrade_drive');
    if (s.driveA + s.driveB >= 3 && s.logisticsA + s.logisticsB >= 3) useQuestStore.getState().completeQuest('delivery_network');
  },
  upgradeWeaponA: () => {
    const { weaponA, weaponB, alloys } = get();
    if (weaponA >= UPGRADE_POOL - 1 || weaponA + weaponB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.weaponA[weaponA];
    if (alloys < cost) return;
    set((s) => ({ weaponA: s.weaponA + 1, alloys: s.alloys - cost }));
  },
  upgradeWeaponB: () => {
    const { weaponA, weaponB, alloys } = get();
    if (weaponB >= UPGRADE_POOL - 1 || weaponA + weaponB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.weaponB[weaponB];
    if (alloys < cost) return;
    set((s) => ({ weaponB: s.weaponB + 1, alloys: s.alloys - cost }));
  },
  upgradeLogisticsA: () => {
    const { logisticsA, logisticsB, alloys } = get();
    if (logisticsA >= UPGRADE_POOL - 1 || logisticsA + logisticsB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.logisticsA[logisticsA];
    if (alloys < cost) return;
    set((s) => ({ logisticsA: s.logisticsA + 1, alloys: s.alloys - cost }));
    const s = get();
    if (s.driveA + s.driveB >= 3 && s.logisticsA + s.logisticsB >= 3) useQuestStore.getState().completeQuest('delivery_network');
  },
  upgradeLogisticsB: () => {
    const { logisticsA, logisticsB, alloys } = get();
    if (logisticsB >= UPGRADE_POOL - 1 || logisticsA + logisticsB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.logisticsB[logisticsB];
    if (alloys < cost) return;
    set((s) => ({ logisticsB: s.logisticsB + 1, alloys: s.alloys - cost }));
    const s = get();
    if (s.driveA + s.driveB >= 3 && s.logisticsA + s.logisticsB >= 3) useQuestStore.getState().completeQuest('delivery_network');
  },
}));
