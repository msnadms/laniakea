import { create } from 'zustand';
import type { Extractor, LogisticsRoute, ExtractorKey, Fabricator, Resource, FabricatorProductionItem, FabricatorState } from '../game/types';
import { COST_KEY_TO_RESOURCE } from '../game/types';
import { getCraftable } from '../data/upgrades';
import type { FabricatorDelivery } from './extractorStore';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers } from './extractorStore';
import { useFabricatorStore } from './fabricatorStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore, computeStorageCap, computeDriveMultiplier } from './uiStore';
import { galaxyTravelCost, superclusterTravelCost, flatTravelCost } from './travelCosts';

interface NodePos {
  galaxySeed: number;
  systemId: number;
  systemX: number;
  systemY: number;
  galaxyX: number;
  galaxyY: number;
  superclusSeed: number;
}

function resolveNodePos(
  key: string,
  extractors: Record<string, Extractor>,
  fabricators: Record<string, Fabricator>,
): NodePos | null {
  return extractors[key] ?? fabricators[key] ?? null;
}

function hopCost(a: NodePos, b: NodePos): { exotic: number; helium: number } {
  if (a.galaxySeed === b.galaxySeed && a.systemId === b.systemId) {
    return { exotic: 0, helium: 0 };
  }
  if (a.galaxySeed === b.galaxySeed) {
    // superclusSeed===0 is the legacy sentinel meaning position data was never stored
    if (a.superclusSeed === 0 || b.superclusSeed === 0) return flatTravelCost(15);
    const dist = Math.hypot(a.systemX - b.systemX, a.systemY - b.systemY);
    return galaxyTravelCost(dist);
  }
  if (a.superclusSeed !== 0 && b.superclusSeed !== 0 && a.superclusSeed === b.superclusSeed) {
    const dist = Math.hypot(a.galaxyX - b.galaxyX, a.galaxyY - b.galaxyY);
    return superclusterTravelCost(dist);
  }
  return flatTravelCost(100);
}

export function willRaiseDetection(
  keys: ExtractorKey[],
  extractors: Record<string, Extractor>,
): boolean {
  const { nodeEquipped } = useExtractorStore.getState();
  const stations = keys.map((k) => extractors[k]).filter(Boolean) as Extractor[];
  if (stations.length === 0) return false;
  // Extractors with signal_dampener equipped don't contribute to detection
  const undamped = stations.filter((s) => !getExtractorMultipliers(s.key, nodeEquipped).dampened);
  if (undamped.length === 0) return false;
  // Exclude superclusSeed=0 (legacy nodes with no stored supercluster)
  const stationSeeds = new Set(
    undamped.map((s) => s.superclusSeed).filter((seed) => seed !== 0),
  );
  if (stationSeeds.size === 0) return false;
  const all = Object.values(extractors).filter(
    (e) => e.superclusSeed !== 0 && !getExtractorMultipliers(e.key, nodeEquipped).dampened,
  );
  return [...stationSeeds].some(
    (seed) => all.filter((e) => e.superclusSeed === seed).length > 4,
  );
}

export function canFeedFabricatorMaterials(
  fabricatorKeys: string[],
  fabricatorStates: Record<string, FabricatorState>,
  held: Record<string, number>,
): boolean {
  return fabricatorKeys.some((k) =>
    (fabricatorStates[k]?.slots ?? []).some((slot) => {
      if (!slot.targetUpgradeId || slot.inProduction) return false;
      const recipe = getCraftable(slot.targetUpgradeId);
      if (!recipe) return false;
      return Object.entries(recipe.materials).some(
        ([matId, amt]) => (slot.pendingMaterials?.[matId] ?? 0) < amt && (held[matId] ?? 0) > 0,
      );
    }),
  );
}

export function computeRouteCost(
  nodeKeys: string[],
  extractors: Record<string, Extractor>,
  fabricators: Record<string, Fabricator> = {},
): { exotic: number; helium: number } {
  const nodes = nodeKeys
    .map((k) => resolveNodePos(k, extractors, fabricators))
    .filter(Boolean) as NodePos[];
  if (nodes.length === 0) return { exotic: 0, helium: 0 };
  const hops: NodePos[] = [];
  for (const n of nodes) {
    const last = hops[hops.length - 1];
    if (!last || last.galaxySeed !== n.galaxySeed || last.systemId !== n.systemId) hops.push(n);
  }
  const { driveA, driveB } = useUIStore.getState();
  const [me, mh] = computeDriveMultiplier(driveA, driveB);
  let totalExotic = Math.max(1, Math.round(50 * me));
  let totalHelium = Math.max(1, Math.round(25 * mh));
  for (let i = 0; i < hops.length - 1; i++) {
    const cost = hopCost(hops[i], hops[i + 1]);
    totalExotic += cost.exotic;
    totalHelium += cost.helium;
  }
  return { exotic: totalExotic, helium: totalHelium };
}

export interface DispatchResult {
  collected: { key: ExtractorKey; amount: number }[];
  deliveries: FabricatorDelivery[];
}

interface LogisticsState {
  routes: LogisticsRoute[];
  addRoute: (route: LogisticsRoute) => void;
  updateRoute: (id: string, patch: Partial<Pick<LogisticsRoute, 'name' | 'nodeKeys'>>) => void;
  removeRoute: (id: string) => void;
  dispatchRoute: (id: string) => DispatchResult | false;
  restoreRoutes: (routes: LogisticsRoute[]) => void;
}

export const useLogisticsStore = create<LogisticsState>()((set, get) => ({
  routes: [],

  addRoute: (route) => set((s) => ({ routes: [...s.routes, route] })),

  updateRoute: (id, patch) =>
    set((s) => ({
      routes: s.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  removeRoute: (id) => set((s) => ({ routes: s.routes.filter((r) => r.id !== id) })),

  dispatchRoute: (id) => {
    if (useUIStore.getState().checkDetectionLethal()) return false;
    const route = get().routes.find((r) => r.id === id);
    if (!route || route.nodeKeys.length < 2) return false;

    const extractors = useExtractorStore.getState().extractors;
    const { fabricators, fabricatorStates } = useFabricatorStore.getState();
    const extractorKeys = route.nodeKeys.filter((k) => !!extractors[k]);
    const fabricatorKeys = route.nodeKeys.filter((k) => !!fabricators[k]);
    const stations = extractorKeys.map((k) => extractors[k]) as Extractor[];

    const fabricatorCapacity: Partial<Record<Resource['type'], number>> = {};
    for (const fabricatorKey of fabricatorKeys) {
      const cs = fabricatorStates[fabricatorKey];
      if (!cs) continue;
      for (const slot of cs.slots) {
        if (!slot.targetUpgradeId) continue;
        if (slot.inProduction && slot.inProduction.availableAt > Date.now()) continue;
        const recipe = getCraftable(slot.targetUpgradeId);
        if (!recipe) continue;
        const isCompleted = !!slot.inProduction;
        for (const [costKey, costAmt] of Object.entries(recipe.cost)) {
          if (!costAmt) continue;
          const resourceType = COST_KEY_TO_RESOURCE[costKey];
          if (!resourceType) continue;
          const have = isCompleted ? 0 : (slot.pendingResources[resourceType] ?? 0);
          const need = Math.max(0, costAmt - have);
          fabricatorCapacity[resourceType] = (fabricatorCapacity[resourceType] ?? 0) + need;
        }
      }
    }

    const hasReadyFabricatorItems = fabricatorKeys.some((k) =>
      (fabricatorStates[k]?.slots ?? []).some(
        (slot) => slot.inProduction && slot.inProduction.availableAt <= Date.now(),
      ),
    );

    const canFeedMaterials = canFeedFabricatorMaterials(
      fabricatorKeys,
      fabricatorStates,
      useStockpileStore.getState().materials,
    );

    if (stations.length < 1 && !hasReadyFabricatorItems && !canFeedMaterials) return false;

    const cost = computeRouteCost(route.nodeKeys, extractors, fabricators);
    const ui = useUIStore.getState();

    if (ui.exoticMatter < cost.exotic || ui.helium3Reserves < cost.helium) {
      ui.triggerHudFlash();
      return false;
    }

    const preStorageCap = computeStorageCap(ui.storageA);
    const preCargoMap: Record<string, number> = {
      exotic: ui.exoticMatter - cost.exotic,
      'helium-3': ui.helium3Reserves - cost.helium,
      alloys: ui.alloys,
      nutrients: ui.nutrients,
      metallicHydrogen: ui.metallicHydrogen,
      neutronStarMatter: ui.neutronStarMatter,
    };

    const stationsCanDeliver = stations.some((s) => {
      if (peekAccumulated(s) === 0) return false;
      const cargoSpace = preStorageCap - (preCargoMap[s.resourceType] ?? 0);
      const fabricatorSpace = fabricatorCapacity[s.resourceType] ?? 0;
      return cargoSpace + fabricatorSpace > 0;
    });

    if (!hasReadyFabricatorItems && !canFeedMaterials && !stationsCanDeliver) {
      ui.triggerHudFlash();
      return false;
    }

    ui.consumeResources(cost.exotic, cost.helium);

    const uiState = useUIStore.getState();
    const storageCap = computeStorageCap(uiState.storageA);
    const cargoMap: Record<string, number> = {
      exotic: uiState.exoticMatter,
      'helium-3': uiState.helium3Reserves,
      alloys: uiState.alloys,
      nutrients: uiState.nutrients,
      metallicHydrogen: uiState.metallicHydrogen,
      neutronStarMatter: uiState.neutronStarMatter,
    };

    const pool: Partial<Record<Resource['type'], number>> = {};
    const collected: { key: ExtractorKey; amount: number }[] = [];

    for (const station of stations) {
      const type = station.resourceType;
      const cargoSpace = Math.max(0, storageCap - (cargoMap[type] ?? 0));
      const fabricatorSpace = fabricatorCapacity[type] ?? 0;
      const maxCollect = cargoSpace + fabricatorSpace;
      if (maxCollect <= 0) continue;
      const amount = useExtractorStore.getState().collectExtractor(station.key, maxCollect);
      if (amount > 0) {
        pool[type] = (pool[type] ?? 0) + amount;
        collected.push({ key: station.key, amount });
        const toFabricator = Math.min(amount, fabricatorSpace);
        fabricatorCapacity[type] = fabricatorSpace - toFabricator;
        cargoMap[type] = (cargoMap[type] ?? 0) + (amount - toFabricator);
      }
    }

    const readyItems: FabricatorProductionItem[] = [];
    for (const fabricatorKey of fabricatorKeys) {
      const result = useFabricatorStore.getState().feedFabricator(fabricatorKey, pool);
      for (const [type, amt] of Object.entries(result.consumed)) {
        pool[type as Resource['type']] = Math.max(0, (pool[type as Resource['type']] ?? 0) - (amt as number));
      }
      readyItems.push(...result.readyItems);
    }

    for (const [type, amount] of Object.entries(pool)) {
      if (!amount || amount <= 0) continue;
      useUIStore.getState().addCargo(type as Resource['type'], amount);
    }

    const deliveries =
      readyItems.length > 0 ? useExtractorStore.getState().receiveFabricatorItems(readyItems) : [];

    if (willRaiseDetection(extractorKeys, extractors)) ui.raiseDetection(1);

    return { collected, deliveries };
  },

  restoreRoutes: (routes) => set({ routes }),
}));
