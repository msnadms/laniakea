import { create } from 'zustand';
import type { Extractor, LogisticsRoute, ExtractorKey, Settlement, SettlementKey, Resource, ColonyProductionItem } from '../game/types';
import { EXTRACTOR_UPGRADES, COST_KEY_TO_RESOURCE } from '../game/types';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers } from './extractorStore';
import { useSettlementStore } from './settlementStore';
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
  settlements: Record<string, Settlement>,
): NodePos | null {
  return extractors[key] ?? settlements[key] ?? null;
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

export function computeRouteCost(
  nodeKeys: string[],
  extractors: Record<string, Extractor>,
  settlements: Record<string, Settlement> = {},
): { exotic: number; helium: number } {
  const nodes = nodeKeys
    .map((k) => resolveNodePos(k, extractors, settlements))
    .filter(Boolean) as NodePos[];
  if (nodes.length === 0) return { exotic: 0, helium: 0 };
  // Deduplicate consecutive same-system nodes for cost calculation
  const hops: NodePos[] = [];
  for (const n of nodes) {
    const last = hops[hops.length - 1];
    if (!last || last.galaxySeed !== n.galaxySeed || last.systemId !== n.systemId) hops.push(n);
  }
  // Base dispatch fee applies to all routes (including same-system), scaled by drive tier
  const { driveA, driveB } = useUIStore.getState();
  const [me, mh] = computeDriveMultiplier(driveA, driveB);
  let totalExotic = Math.max(1, Math.round(100 * me));
  let totalHelium = Math.max(1, Math.round(100 * mh));
  for (let i = 0; i < hops.length - 1; i++) {
    const cost = hopCost(hops[i], hops[i + 1]);
    totalExotic += cost.exotic;
    totalHelium += cost.helium;
  }
  return { exotic: totalExotic, helium: totalHelium };
}

interface LogisticsState {
  routes: LogisticsRoute[];
  addRoute: (route: LogisticsRoute) => void;
  updateRoute: (id: string, patch: Partial<Pick<LogisticsRoute, 'name' | 'nodeKeys'>>) => void;
  removeRoute: (id: string) => void;
  dispatchRoute: (id: string) => string[] | false;
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
    const route = get().routes.find((r) => r.id === id);
    if (!route || route.nodeKeys.length < 2) return false;

    const extractors = useExtractorStore.getState().extractors;
    const { settlements, colonyStates } = useSettlementStore.getState();
    const extractorKeys = route.nodeKeys.filter((k) => !!extractors[k]);
    const colonyKeys = route.nodeKeys.filter((k) => !!settlements[k]);
    const stations = extractorKeys.map((k) => extractors[k]) as Extractor[];

    // FIX: include completed slots — they deliver and immediately accept resources for the next cycle
    const colonyCapacity: Partial<Record<Resource['type'], number>> = {};
    for (const colonyKey of colonyKeys) {
      const cs = colonyStates[colonyKey];
      if (!cs) continue;
      for (const slot of cs.slots) {
        if (!slot.targetUpgradeId) continue;
        if (slot.inProduction && slot.inProduction.availableAt > Date.now()) continue;
        const recipe = EXTRACTOR_UPGRADES.find((u) => u.id === slot.targetUpgradeId);
        if (!recipe) continue;
        // Completed slots have empty pendingResources (consumed when production started)
        const isCompleted = !!slot.inProduction;
        for (const [costKey, costAmt] of Object.entries(recipe.cost)) {
          if (!costAmt) continue;
          const resourceType = COST_KEY_TO_RESOURCE[costKey];
          if (!resourceType) continue;
          const have = isCompleted ? 0 : (slot.pendingResources[resourceType] ?? 0);
          const need = Math.max(0, costAmt - have);
          colonyCapacity[resourceType] = (colonyCapacity[resourceType] ?? 0) + need;
        }
      }
    }

    // FIX: evaluate colony readiness before the stations guard so colony-only dispatches work
    const hasReadyColonyItems = colonyKeys.some((k) =>
      (colonyStates[k]?.slots ?? []).some(
        (slot) => slot.inProduction && slot.inProduction.availableAt <= Date.now(),
      ),
    );

    // FIX: only bail early when there are no stations AND no ready colony items
    if (stations.length < 1 && !hasReadyColonyItems) return false;

    // FIX: compute cost up front so we can subtract it from the pre-check cargo map;
    // this prevents exotic/helium collectors being refused because cargo is currently full
    // when paying the dispatch fee would immediately free that space
    const cost = computeRouteCost(route.nodeKeys, extractors, settlements);
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
      const colonySpace = colonyCapacity[s.resourceType] ?? 0;
      return cargoSpace + colonySpace > 0;
    });

    // FIX: flash on all dead-end paths (not just unaffordable)
    if (!hasReadyColonyItems && !stationsCanDeliver) {
      ui.triggerHudFlash();
      return false;
    }

    ui.consumeResources(cost.exotic, cost.helium);

    if (willRaiseDetection(extractorKeys, extractors)) ui.raiseDetection(1);

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
    const collectedKeys: string[] = [];

    for (const station of stations) {
      const type = station.resourceType;
      const cargoSpace = Math.max(0, storageCap - (cargoMap[type] ?? 0));
      const colonySpace = colonyCapacity[type] ?? 0;
      const maxCollect = cargoSpace + colonySpace;
      if (maxCollect <= 0) continue;
      const amount = useExtractorStore.getState().collectExtractor(station.key, maxCollect);
      if (amount > 0) {
        pool[type] = (pool[type] ?? 0) + amount;
        collectedKeys.push(station.key);
        // FIX: update cargoMap so subsequent same-resource stations see the reduced available space
        cargoMap[type] = (cargoMap[type] ?? 0) + amount;
      }
    }

    const readyItems: ColonyProductionItem[] = [];
    for (const colonyKey of colonyKeys) {
      const result = useSettlementStore.getState().feedColony(colonyKey, pool);
      for (const [type, amt] of Object.entries(result.consumed)) {
        pool[type as Resource['type']] = Math.max(0, (pool[type as Resource['type']] ?? 0) - (amt as number));
      }
      readyItems.push(...result.readyItems);
    }

    for (const [type, amount] of Object.entries(pool)) {
      if (!amount || amount <= 0) continue;
      useUIStore.getState().addCargo(type as Resource['type'], amount);
    }

    if (readyItems.length > 0) {
      useExtractorStore.getState().receiveColonyItems(readyItems);
    }

    return collectedKeys;
  },

  restoreRoutes: (routes) => set({ routes }),
}));
