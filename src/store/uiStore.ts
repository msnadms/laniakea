import { create } from 'zustand';
import type { AddressComponent, AddressComponentType, Resource } from '../game/types';
import type { UserSettings } from '../firebase/userDoc';
import { useQuestStore } from './questStore';
import { DEFAULT_ADDRESS } from '../game/hardcoded';
import { purgeCost } from './travelCosts';
import { beginDeathSequence } from './resetGame';

export type AppView = 'system' | 'galaxy' | 'supercluster';

export const DETECTION_DECAY_INTERVAL_MS = 15 * 60 * 1000;
export const PURGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function decayDetection(rating: number, lastChangeAt: number, now: number, perStep = 1): { detectionRating: number; lastDetectionChangeAt: number } {
  if (rating <= 0) return { detectionRating: rating, lastDetectionChangeAt: lastChangeAt };
  if (lastChangeAt <= 0) return { detectionRating: rating, lastDetectionChangeAt: now };
  const steps = Math.floor((now - lastChangeAt) / DETECTION_DECAY_INTERVAL_MS);
  if (steps <= 0) return { detectionRating: rating, lastDetectionChangeAt: lastChangeAt };
  return {
    detectionRating: Math.max(0, rating - steps * perStep),
    lastDetectionChangeAt: lastChangeAt + steps * DETECTION_DECAY_INTERVAL_MS,
  };
}

// UPGRADE_POOL is the shared pool cap. Each path caps at UPGRADE_POOL-1. COSTS arrays need UPGRADE_POOL entries; stat/name arrays need UPGRADE_POOL.
export const UPGRADE_POOL = 5;

const STORAGE_BASE = 500;
export const STORAGE_A_BONUS = [0, 500, 1500, 2000, 3000]; 
export function resourceAmount(
  state: { exoticMatter: number; helium3Reserves: number; alloys: number; nutrients: number; metallicHydrogen: number; neutronStarMatter: number },
  type: Resource['type'],
): number {
  if (type === 'exotic') return state.exoticMatter;
  if (type === 'helium-3') return state.helium3Reserves;
  return state[type];
}

export function cargoField(type: Resource['type']): 'exoticMatter' | 'helium3Reserves' | Exclude<Resource['type'], 'exotic' | 'helium-3'> {
  if (type === 'exotic') return 'exoticMatter';
  if (type === 'helium-3') return 'helium3Reserves';
  return type;
}

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

export const FIRE_COST = 5;
const DETENT_PER_SHOT = 1;
const FIRE_COOLDOWN_MS = 30 * 1000;
const RELOAD_HELIUM_PER_AMMO = 3;

const LOGISTICS_BASE = 5;
export const LOGISTICS_A_BONUS = [0, 3, 6, 9, 12];
export function computeLogisticsCap(a: number): number {
  return LOGISTICS_BASE + LOGISTICS_A_BONUS[a];
}
export const LOGISTICS_B_RATE = [1.0, 1.25, 1.5, 1.75, 2.0];

const MATERIAL_BANDWIDTH_BASE = 4;
export const LOGISTICS_A_BANDWIDTH = [0, 2, 4, 7, 10];
export const LOGISTICS_B_BANDWIDTH = [0, 1, 3, 5, 8];
export function computeMaterialBandwidth(a: number, b: number): number {
  return MATERIAL_BANDWIDTH_BASE + LOGISTICS_A_BANDWIDTH[a] + LOGISTICS_B_BANDWIDTH[b];
}

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
  showScanlines: boolean;
  toggleScanlines: () => void;
  showBootSequence: boolean;
  toggleBootSequence: () => void;
  exoticMatter: number;
  detectionRating: number;
  lastDetectionChangeAt: number;
  lastPurgeAt: number;
  destroyed: boolean;
  railgunAmmo: number;
  lastFireAt: number;
  helium3Reserves: number;
  alloys: number;
  nutrients: number;
  metallicHydrogen: number;
  neutronStarMatter: number;
  raiseDetection: (chance: number) => void;
  raiseDetectionBy: (points: number) => void;
  tickDetectionDecay: () => void;
  checkDetectionLethal: () => boolean;
  purgeDetection: () => boolean;
  fireRailgun: () => void;
  reloadRailgun: () => void;
  addCargo: (type: Resource['type'], amount: number) => void;
  depositCargo: (type: Resource['type'], amount: number) => number;
  withdrawCargo: (amounts: Partial<Record<Resource['type'], number>>) => void;
  selectedPlanetKey: string | null;
  setSelectedPlanet: (key: string | null) => void;
  setShipStats: (stats: { exoticMatter: number; detectionRating: number; railgunAmmo: number; helium3Reserves: number; lastDetectionChangeAt?: number; lastPurgeAt?: number }) => void;
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
  hudNotify: number;
  hudNotifyMsg: string;
  triggerHudNotify: (msg: string) => void;
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
  storageA: number;
  storageB: number;
  driveA: number;
  driveB: number;
  weaponA: number;
  weaponB: number;
  logisticsA: number;
  logisticsB: number;
  fuelReserveExotic: number;
  fuelReserveHelium3: number;
  setFuelReserve: (exotic: number, helium3: number) => void;
  adoptLegacyFuelReserve: (reserve: { exotic: number; helium3: number }) => void;
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
  showScanlines: true,
  toggleScanlines: () => set((s) => ({ showScanlines: !s.showScanlines })),
  showBootSequence: true,
  toggleBootSequence: () => set((s) => ({ showBootSequence: !s.showBootSequence })),
  alloys: 0,
  nutrients: 0,
  metallicHydrogen: 0,
  neutronStarMatter: 0,
  raiseDetection: (chance) => {
    get().tickDetectionDecay();
    if (Math.random() >= chance) return;
    get().raiseDetectionBy(1);
  },
  raiseDetectionBy: (points) => {
    const steps = Math.floor(points);
    if (steps <= 0) return;
    get().tickDetectionDecay();
    const wasBelowMax = get().detectionRating < 5;
    set((s) => ({ detectionRating: Math.min(5, s.detectionRating + steps), lastDetectionChangeAt: Date.now() }));
    if (wasBelowMax && get().detectionRating === 5) {
      get().triggerHudNotify('SIGNAL LOCKED — ALCUBIERRE CANNON CHARGING');
    }
  },
  tickDetectionDecay: () => {
    const s = get();
    const now = Date.now();
    const next = decayDetection(s.detectionRating, s.lastDetectionChangeAt, now, 1);
    if (next.detectionRating !== s.detectionRating || next.lastDetectionChangeAt !== s.lastDetectionChangeAt) {
      set({ detectionRating: next.detectionRating, lastDetectionChangeAt: next.lastDetectionChangeAt });
    }
  },
  checkDetectionLethal: () => {
    if (get().destroyed) return true;
    get().tickDetectionDecay();
    if (get().detectionRating < 5) return false;
    beginDeathSequence();
    return true;
  },
  fireRailgun: () => {
    if (get().destroyed) return;
    get().tickDetectionDecay();
    const s = get();
    const now = Date.now();
    if (now - s.lastFireAt < FIRE_COOLDOWN_MS) return;
    if (s.detectionRating <= 0) return;
    if (s.railgunAmmo < FIRE_COST) { s.triggerHudFlash(); return; }
    set({
      railgunAmmo: s.railgunAmmo - FIRE_COST,
      detectionRating: Math.max(0, s.detectionRating - DETENT_PER_SHOT),
      lastDetectionChangeAt: now,
      lastFireAt: now,
    });
  },
  reloadRailgun: () => {
    const s = get();
    const missing = computeWeaponCap(s.weaponA, s.weaponB) - s.railgunAmmo;
    if (missing <= 0) return;
    const affordable = Math.min(missing, Math.floor(s.helium3Reserves / RELOAD_HELIUM_PER_AMMO));
    if (affordable <= 0) { s.triggerHudFlash(); return; }
    set({ railgunAmmo: s.railgunAmmo + affordable, helium3Reserves: s.helium3Reserves - affordable * RELOAD_HELIUM_PER_AMMO });
  },
  purgeDetection: () => {
    if (get().destroyed) return false;
    get().tickDetectionDecay();
    const s = get();
    const now = Date.now();
    if (now - s.lastPurgeAt < PURGE_COOLDOWN_MS) return false;
    const cost = purgeCost();
    if (s.exoticMatter < cost.exotic || s.helium3Reserves < cost.helium) {
      s.triggerHudFlash();
      return false;
    }
    set({
      exoticMatter: s.exoticMatter - cost.exotic,
      helium3Reserves: s.helium3Reserves - cost.helium,
      detectionRating: 0,
      lastDetectionChangeAt: now,
      lastPurgeAt: now,
    });
    return true;
  },
  depositCargo: (type, amount): number => {
    const before = resourceAmount(get(), type);
    get().addCargo(type, amount);
    return Math.max(0, resourceAmount(get(), type) - before);
  },
  withdrawCargo: (amounts) => set((s) => {
    const patch: Partial<UIState> = {};
    for (const [type, amount] of Object.entries(amounts)) {
      const taken = Math.max(0, Math.min(resourceAmount(s, type as Resource['type']), amount ?? 0));
      if (taken > 0) patch[cargoField(type as Resource['type'])] = resourceAmount(s, type as Resource['type']) - taken;
    }
    return patch;
  }),
  addCargo: (type, amount) => {
    if (type === 'exotic') useQuestStore.getState().completeQuest('first_exotic');
    set((s) => {
      const cap = computeStorageCap(s.storageA);
      if (type === 'exotic') return { exoticMatter: Math.min(cap, s.exoticMatter + amount) };
      if (type === 'helium-3') return { helium3Reserves: Math.min(cap, s.helium3Reserves + amount) };
      if (type === 'alloys') return { alloys: Math.min(cap, s.alloys + amount) };
      if (type === 'nutrients') return { nutrients: Math.min(cap, s.nutrients + amount) };
      if (type === 'metallicHydrogen') return { metallicHydrogen: Math.min(cap, s.metallicHydrogen + amount) };
      if (type === 'neutronStarMatter') return { neutronStarMatter: Math.min(cap, s.neutronStarMatter + amount) };
      return {};
    });
  },
  selectedPlanetKey: null,
  setSelectedPlanet: (key) => set({ selectedPlanetKey: key }),
  exoticMatter: 250,
  detectionRating: 0,
  lastDetectionChangeAt: 0,
  lastPurgeAt: 0,
  destroyed: false,
  railgunAmmo: 20,
  lastFireAt: 0,
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
  hudNotify: 0,
  hudNotifyMsg: '',
  triggerHudNotify: (msg) => set((s) => ({ hudNotify: s.hudNotify + 1, hudNotifyMsg: msg })),
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
  storageA: 0,
  storageB: 0,
  driveA: 0,
  driveB: 0,
  weaponA: 0,
  weaponB: 0,
  logisticsA: 0,
  logisticsB: 0,
  fuelReserveExotic: 0,
  fuelReserveHelium3: 0,
  setFuelReserve: (exotic, helium3) => set({
    fuelReserveExotic: Math.max(0, Math.floor(exotic)),
    fuelReserveHelium3: Math.max(0, Math.floor(helium3)),
  }),
  adoptLegacyFuelReserve: (reserve) => set((s) => ({
    fuelReserveExotic: s.fuelReserveExotic || Math.max(0, Math.floor(reserve.exotic)),
    fuelReserveHelium3: s.fuelReserveHelium3 || Math.max(0, Math.floor(reserve.helium3)),
  })),
  showUpgradePanel: false,
  toggleUpgradePanel: () => set((s) => ({ showUpgradePanel: !s.showUpgradePanel })),
  resetUpgrades: () => set((s) => ({ storageA: 0, storageB: 0, driveA: 0, driveB: 0, weaponA: 0, weaponB: 0, logisticsA: 0, logisticsB: 0, lastFireAt: 0, railgunAmmo: Math.min(s.railgunAmmo, WEAPON_BASE) })),
  upgradeStorageA: () => {
    if (get().checkDetectionLethal()) return;
    const { storageA, storageB, alloys } = get();
    if (storageA >= UPGRADE_POOL - 1 || storageA + storageB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.storageA[storageA];
    if (alloys < cost) return;
    set((s) => ({ storageA: s.storageA + 1, alloys: s.alloys - cost }));
    useQuestStore.getState().completeQuest('upgrade_storage');
  },
  upgradeStorageB: () => {
    if (get().checkDetectionLethal()) return;
    const { storageA, storageB, alloys } = get();
    if (storageB >= UPGRADE_POOL - 1 || storageA + storageB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.storageB[storageB];
    if (alloys < cost) return;
    set((s) => ({ storageB: s.storageB + 1, alloys: s.alloys - cost }));
    useQuestStore.getState().completeQuest('upgrade_storage');
  },
  upgradeDriveA: () => {
    if (get().checkDetectionLethal()) return;
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
    if (get().checkDetectionLethal()) return;
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
    if (get().checkDetectionLethal()) return;
    const { weaponA, weaponB, alloys } = get();
    if (weaponA >= UPGRADE_POOL - 1 || weaponA + weaponB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.weaponA[weaponA];
    if (alloys < cost) return;
    set((s) => ({ weaponA: s.weaponA + 1, alloys: s.alloys - cost }));
  },
  upgradeWeaponB: () => {
    if (get().checkDetectionLethal()) return;
    const { weaponA, weaponB, alloys } = get();
    if (weaponB >= UPGRADE_POOL - 1 || weaponA + weaponB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.weaponB[weaponB];
    if (alloys < cost) return;
    set((s) => ({ weaponB: s.weaponB + 1, alloys: s.alloys - cost }));
  },
  upgradeLogisticsA: () => {
    if (get().checkDetectionLethal()) return;
    const { logisticsA, logisticsB, alloys } = get();
    if (logisticsA >= UPGRADE_POOL - 1 || logisticsA + logisticsB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.logisticsA[logisticsA];
    if (alloys < cost) return;
    set((s) => ({ logisticsA: s.logisticsA + 1, alloys: s.alloys - cost }));
    const s = get();
    if (s.driveA + s.driveB >= 3 && s.logisticsA + s.logisticsB >= 3) useQuestStore.getState().completeQuest('delivery_network');
  },
  upgradeLogisticsB: () => {
    if (get().checkDetectionLethal()) return;
    const { logisticsA, logisticsB, alloys } = get();
    if (logisticsB >= UPGRADE_POOL - 1 || logisticsA + logisticsB >= UPGRADE_POOL) return;
    const cost = UPGRADE_COSTS.logisticsB[logisticsB];
    if (alloys < cost) return;
    set((s) => ({ logisticsB: s.logisticsB + 1, alloys: s.alloys - cost }));
    const s = get();
    if (s.driveA + s.driveB >= 3 && s.logisticsA + s.logisticsB >= 3) useQuestStore.getState().completeQuest('delivery_network');
  },
}));

export function applyUserSettings(settings: UserSettings): void {
  const cap = computeStorageCap(settings.storageA);
  useUIStore.setState({
    showOrbitRings: settings.showOrbitRings,
    showAttractorLabels: settings.showAttractorLabels,
    showHUD: settings.showHUD,
    showBootSequence: settings.showBootSequence,
    infiniteExplore: settings.infiniteExplore,
    exoticMatter: Math.min(settings.exoticMatter, cap),
    detectionRating: settings.detectionRating,
    lastDetectionChangeAt: settings.lastDetectionChangeAt,
    lastPurgeAt: settings.lastPurgeAt,
    destroyed: false,
    selectedPlanetKey: null,
    showUpgradePanel: false,
    railgunAmmo: settings.railgunAmmo,
    lastFireAt: settings.lastFireAt,
    helium3Reserves: Math.min(settings.helium3Reserves, cap),
    alloys: Math.min(settings.alloys, cap),
    nutrients: Math.min(settings.nutrients, cap),
    metallicHydrogen: Math.min(settings.metallicHydrogen, cap),
    neutronStarMatter: Math.min(settings.neutronMatter, cap),
    storageA: settings.storageA,
    storageB: settings.storageB,
    driveA: settings.driveA,
    driveB: settings.driveB,
    weaponA: settings.weaponA,
    weaponB: settings.weaponB,
    logisticsA: settings.logisticsA,
    logisticsB: settings.logisticsB,
    fuelReserveExotic: settings.fuelReserveExotic ?? 0,
    fuelReserveHelium3: settings.fuelReserveHelium3 ?? 0,
  });
}
