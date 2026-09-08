import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Fabricator, FabricatorState, FabricatorProductionSlot, FabricatorProductionItem,
  MaterialCost, FabricatorTier, CraftCategory, Resource, SlotStatus, SlotFillMode,
} from '../game/types';
import {
  COST_KEY_TO_RESOURCE, makeEmptyFabricatorSlot, bufferDepth,
  includedFabricatorSlots, maxFabricatorSlots,
} from '../game/types';
import { getCraftable } from '../data/upgrades';
import type { Craftable } from '../data/upgrades';
import { useMilestoneStore } from './milestoneStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore, computeMaterialBandwidth, resourceAmount } from './uiStore';
import { useExtractorStore } from './extractorStore';

export function orderedSlotIndices(slots: FabricatorProductionSlot[]): number[] {
  return slots.map((slot, index) => ({ index, priority: slot.priority }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.index);
}

export function fabricatorCanCraft(tier: FabricatorTier | undefined, category: CraftCategory, minimumTier = 1): boolean {
  return (tier ?? 1) >= Math.max(minimumTier, category === 'rare' ? 2 : 1);
}

export interface MaterialBudget { remaining: number }

export interface SlotRunResult {
  slotIndex: number;
  targetUpgradeId: string | null;
  batches: number;
  status: SlotStatus;
  consumedResources: Partial<Record<Resource['type'], number>>;
  consumedMaterials: MaterialCost;
  produced: MaterialCost;
  byproductsCreated: MaterialCost;
  byproductsConsumedLocally: MaterialCost;
  byproductsRouted: MaterialCost;
  missingResources: Partial<Record<Resource['type'], number>>;
  missingMaterials: MaterialCost;
}

export interface FeedResult {
  consumed: Partial<Record<Resource['type'], number>>;
  consumedCarried: MaterialCost;
  consumedStockpile: MaterialCost;
  readyItems: FabricatorProductionItem[];
  statuses: SlotStatus[];
  slotResults: SlotRunResult[];
  changed: boolean;
}

export interface ProcessFabricatorOptions {
  stockpile?: MaterialCost;
  stockpileBudget?: MaterialBudget;
  canRouteByproduct?: (materialId: string) => boolean;
  fillMode?: SlotFillMode;
}

function resourceEntries(recipe: Craftable): Array<[Resource['type'], number]> {
  const out: Array<[Resource['type'], number]> = [];
  for (const [costKey, amount] of Object.entries(recipe.cost)) {
    if (!amount) continue;
    const type = COST_KEY_TO_RESOURCE[costKey];
    if (type) out.push([type, amount]);
  }
  return out;
}

function materialEntries(recipe: Craftable): Array<[string, number]> {
  return Object.entries(recipe.materials).filter(([, amount]) => !!amount) as Array<[string, number]>;
}

function cloneSlot(slot: FabricatorProductionSlot, index: number): FabricatorProductionSlot {
  return {
    targetUpgradeId: slot.targetUpgradeId ?? null,
    pendingResources: { ...(slot.pendingResources ?? {}) },
    pendingMaterials: { ...(slot.pendingMaterials ?? {}) },
    byproducts: { ...(slot.byproducts ?? {}) },
    priority: Number.isFinite(slot.priority) ? slot.priority : index,
  };
}

function makeSlots(count: number): FabricatorProductionSlot[] {
  return Array.from({ length: count }, (_, priority) => ({ ...makeEmptyFabricatorSlot(), priority }));
}

export function normalizeFabricatorState(
  state: FabricatorState | undefined,
  tier: FabricatorTier | undefined,
): FabricatorState {
  const slots = (state?.slots ?? []).map(cloneSlot);
  const wanted = Math.max(slots.length, includedFabricatorSlots(tier));
  for (let i = slots.length; i < wanted; i++) slots.push({ ...makeEmptyFabricatorSlot(), priority: i });
  const kept = slots.slice(0, maxFabricatorSlots(tier));
  orderedSlotIndices(kept).forEach((index, priority) => { kept[index].priority = priority; });
  return { slots: kept };
}

function sameAmounts(a: Record<string, number | undefined>, b: Record<string, number | undefined>): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ids].every((id) => (a[id] ?? 0) === (b[id] ?? 0));
}

function sameSlotBuffers(a: FabricatorProductionSlot | undefined, b: FabricatorProductionSlot): boolean {
  return !!a
    && a.targetUpgradeId === b.targetUpgradeId
    && sameAmounts(a.pendingResources, b.pendingResources)
    && sameAmounts(a.pendingMaterials, b.pendingMaterials)
    && sameAmounts(a.byproducts, b.byproducts);
}

function recipeReady(slot: FabricatorProductionSlot, recipe: Craftable): boolean {
  return resourceEntries(recipe).every(([type, amount]) => (slot.pendingResources[type] ?? 0) >= amount)
    && materialEntries(recipe).every(([id, amount]) => (slot.pendingMaterials[id] ?? 0) >= amount);
}

function addAmount(target: MaterialCost, id: string, amount: number) {
  if (amount > 0) target[id] = (target[id] ?? 0) + amount;
}

function addResource(
  target: Partial<Record<Resource['type'], number>>,
  type: Resource['type'],
  amount: number,
) {
  if (amount > 0) target[type] = (target[type] ?? 0) + amount;
}

type InternalFeedResult = FeedResult & { slots: FabricatorProductionSlot[] };

/** Pure, clock-free fixed-point production pass used by dispatch and previews. */
export function processFabricator(
  sourceSlots: FabricatorProductionSlot[],
  tier: FabricatorTier | undefined,
  rawPool: Partial<Record<Resource['type'], number>>,
  carriedPool: MaterialCost,
  options: ProcessFabricatorOptions = {},
): InternalFeedResult {
  const depth = bufferDepth(tier);
  const slots = sourceSlots.map(cloneSlot);
  const remainingRaw = { ...rawPool };
  const remainingCarried = { ...carriedPool };
  const remainingStock = { ...(options.stockpile ?? {}) };
  const stockpileBudget = options.stockpileBudget ?? { remaining: 0 };
  const canRouteByproduct = options.canRouteByproduct ?? (() => true);
  const consumed: Partial<Record<Resource['type'], number>> = {};
  const consumedCarried: MaterialCost = {};
  const consumedStockpile: MaterialCost = {};
  const producedPool: MaterialCost = {};
  const byproductPool: MaterialCost = {};
  const immediateItems: FabricatorProductionItem[] = [];

  const slotResults: SlotRunResult[] = slots.map((slot, slotIndex) => ({
    slotIndex,
    targetUpgradeId: slot.targetUpgradeId,
    batches: 0,
    status: slot.targetUpgradeId ? 'starved' : 'idle',
    consumedResources: {},
    consumedMaterials: {},
    produced: {},
    byproductsCreated: {},
    byproductsConsumedLocally: {},
    byproductsRouted: {},
    missingResources: {},
    missingMaterials: {},
  }));

  const byproductOrigin = new Map<string, number>();
  slots.forEach((slot, index) => {
    for (const [id, amount] of Object.entries(slot.byproducts)) {
      if (amount > 0 && !byproductOrigin.has(id)) byproductOrigin.set(id, index);
      addAmount(byproductPool, id, amount);
    }
    slot.byproducts = {};
  });

  const byproductCapacity: MaterialCost = {};
  for (const slot of slots) {
    const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
    if (!recipe || !fabricatorCanCraft(tier, recipe.category, recipe.minimumFabricatorTier)) continue;
    for (const [id, amount] of Object.entries(recipe.byproducts)) addAmount(byproductCapacity, id, amount * depth);
  }
  const byproductHasExit = new Map<string, boolean>();
  const byproductCanLeave = (id: string) => {
    if (!byproductHasExit.has(id)) byproductHasExit.set(id, canRouteByproduct(id));
    return byproductHasExit.get(id)!;
  };

  const ordered = orderedSlotIndices(slots).map((index) => ({ slot: slots[index], index }));

  let quota = (options.fillMode ?? 'shared') === 'shared' ? 1 : depth;
  let passes = 0;
  while (passes++ < 100_000) {
    let progressed = false;
    for (const { slot, index } of ordered) {
      const result = slotResults[index];
      const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
      if (!recipe || !fabricatorCanCraft(tier, recipe.category, recipe.minimumFabricatorTier)) continue;

      for (const [type, perBatch] of resourceEntries(recipe)) {
        const need = Math.max(0, perBatch * quota - (slot.pendingResources[type] ?? 0));
        const take = Math.min(need, remainingRaw[type] ?? 0);
        if (take <= 0) continue;
        slot.pendingResources[type] = (slot.pendingResources[type] ?? 0) + take;
        remainingRaw[type] = (remainingRaw[type] ?? 0) - take;
        addResource(consumed, type, take);
        addResource(result.consumedResources, type, take);
        progressed = true;
      }

      for (const [id, perBatch] of materialEntries(recipe)) {
        let need = Math.max(0, perBatch * quota - (slot.pendingMaterials[id] ?? 0));
        const take = (pool: MaterialCost, limit: number) => {
          const moved = Math.min(need, pool[id] ?? 0, limit);
          if (moved <= 0) return 0;
          pool[id] = (pool[id] ?? 0) - moved;
          slot.pendingMaterials[id] = (slot.pendingMaterials[id] ?? 0) + moved;
          need -= moved;
          progressed = true;
          return moved;
        };
        const localByproduct = take(byproductPool, Number.POSITIVE_INFINITY);
        if (localByproduct > 0) addAmount(result.byproductsConsumedLocally, id, localByproduct);
        take(producedPool, Number.POSITIVE_INFINITY);
        const carried = take(remainingCarried, Number.POSITIVE_INFINITY);
        if (carried > 0) addAmount(consumedCarried, id, carried);
        const stocked = take(remainingStock, stockpileBudget.remaining);
        if (stocked > 0) {
          addAmount(consumedStockpile, id, stocked);
          stockpileBudget.remaining -= stocked;
        }
      }

      while (recipeReady(slot, recipe)) {
        const blocked = Object.entries(recipe.byproducts).some(
          ([id, amount]) => amount > 0 && !byproductCanLeave(id)
            && (byproductPool[id] ?? 0) + amount > (byproductCapacity[id] ?? 0),
        );
        if (blocked) break;
        for (const [type, amount] of resourceEntries(recipe)) {
          slot.pendingResources[type] = (slot.pendingResources[type] ?? 0) - amount;
        }
        for (const [id, amount] of materialEntries(recipe)) {
          slot.pendingMaterials[id] = (slot.pendingMaterials[id] ?? 0) - amount;
          addAmount(result.consumedMaterials, id, amount);
        }
        result.batches++;
        addAmount(result.produced, recipe.produces, recipe.outputs);
        if (recipe.category === 'material') addAmount(producedPool, recipe.produces, recipe.outputs);
        else immediateItems.push({ upgradeId: recipe.produces, category: recipe.category, count: recipe.outputs });
        for (const [id, amount] of Object.entries(recipe.byproducts)) {
          addAmount(byproductPool, id, amount);
          addAmount(result.byproductsCreated, id, amount);
        }
        progressed = true;
      }
    }
    if (!progressed) {
      if (quota >= depth) break;
      quota++;
    }
  }

  const readyItems = [...immediateItems];
  for (const [id, amount] of Object.entries(producedPool)) {
    if (amount > 0) readyItems.push({ upgradeId: id, category: 'material', count: amount });
  }

  for (const [id, total] of Object.entries(byproductPool)) {
    let left = total;
    if (left > 0 && byproductCanLeave(id)) {
      readyItems.push({ upgradeId: id, category: 'material', count: left });
      const producer = slotResults.find((result) => (result.byproductsCreated[id] ?? 0) > 0);
      if (producer) addAmount(producer.byproductsRouted, id, left);
      left = 0;
    }
    if (left <= 0) continue;
    for (const { slot, index } of ordered) {
      const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
      const perBatch = recipe?.byproducts[id] ?? 0;
      if (perBatch <= 0) continue;
      const keep = Math.min(left, perBatch * depth);
      if (keep > 0) slot.byproducts[id] = (slot.byproducts[id] ?? 0) + keep;
      left -= keep;
      if (keep >= perBatch * depth) slotResults[index].status = 'jammed';
      if (left <= 0) break;
    }
    if (left <= 0) continue;
    // A byproduct no current recipe emits still has to live somewhere rather than vanish.
    const fallback = byproductOrigin.get(id) ?? ordered[0]?.index;
    if (fallback === undefined) continue;
    slots[fallback].byproducts[id] = (slots[fallback].byproducts[id] ?? 0) + left;
    slotResults[fallback].status = 'jammed';
  }

  for (const { slot, index } of ordered) {
    const result = slotResults[index];
    const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
    if (!recipe || !fabricatorCanCraft(tier, recipe.category, recipe.minimumFabricatorTier)) {
      result.status = 'idle';
      continue;
    }
    for (const [type, amount] of resourceEntries(recipe)) {
      const missing = Math.max(0, amount - (slot.pendingResources[type] ?? 0));
      if (missing > 0) result.missingResources[type] = missing;
    }
    for (const [id, amount] of materialEntries(recipe)) {
      const missing = Math.max(0, amount - (slot.pendingMaterials[id] ?? 0));
      if (missing > 0) result.missingMaterials[id] = missing;
    }
    if (result.status !== 'jammed') {
      result.status = result.batches > 0 ? 'flowing' : recipeReady(slot, recipe) ? 'ready' : 'starved';
    }
  }

  const changed = Object.values(consumed).some((amount) => (amount ?? 0) > 0)
    || Object.values(consumedCarried).some((amount) => amount > 0)
    || Object.values(consumedStockpile).some((amount) => amount > 0)
    || readyItems.some((item) => item.count > 0)
    || slots.some((slot, index) => !sameSlotBuffers(sourceSlots[index], slot));

  return {
    consumed, consumedCarried, consumedStockpile, readyItems,
    statuses: slotResults.map((result) => result.status),
    slotResults, changed, slots,
  };
}

export function slotStatus(
  slot: FabricatorProductionSlot,
  recipe: Craftable | undefined,
  depth: number,
): SlotStatus {
  if (!recipe || !slot.targetUpgradeId) return 'idle';
  const jammed = Object.entries(recipe.byproducts).some(
    ([id, amount]) => amount > 0 && (slot.byproducts[id] ?? 0) >= amount * depth,
  );
  if (jammed) return 'jammed';
  return recipeReady(slot, recipe) ? 'ready' : 'starved';
}

export function slotResourceDemand(
  slot: FabricatorProductionSlot,
  recipe: Craftable,
  depth: number,
): Partial<Record<Resource['type'], number>> {
  const demand: Partial<Record<Resource['type'], number>> = {};
  for (const [type, amount] of resourceEntries(recipe)) {
    const wanted = amount * depth - (slot.pendingResources[type] ?? 0);
    if (wanted > 0) demand[type] = wanted;
  }
  return demand;
}

export function slotMaterialDemand(slot: FabricatorProductionSlot, recipe: Craftable, depth: number): MaterialCost {
  const demand: MaterialCost = {};
  for (const [id, amount] of materialEntries(recipe)) {
    const wanted = amount * depth - (slot.pendingMaterials[id] ?? 0);
    if (wanted > 0) demand[id] = wanted;
  }
  return demand;
}

const HOLD_RAW_TYPES: Resource['type'][] = ['exotic', 'alloys', 'nutrients', 'helium-3', 'metallicHydrogen', 'neutronStarMatter', 'alienMatter'];

export interface HoldFeedSource {
  exoticMatter: number;
  helium3Reserves: number;
  alloys: number;
  nutrients: number;
  metallicHydrogen: number;
  neutronStarMatter: number;
  alienMatter?: number;
  logisticsA: number;
  logisticsB: number;
}

export interface HoldFeedPools {
  raw: Partial<Record<Resource['type'], number>>;
  stockpile: MaterialCost;
  bandwidth: number;
}

export function holdFeedPools(source: HoldFeedSource, materials: MaterialCost): HoldFeedPools {
  const raw: Partial<Record<Resource['type'], number>> = {};
  for (const type of HOLD_RAW_TYPES) {
    const available = resourceAmount(source, type);
    if (available > 0) raw[type] = available;
  }
  return {
    raw,
    stockpile: { ...materials },
    bandwidth: computeMaterialBandwidth(source.logisticsA, source.logisticsB),
  };
}

export function previewHoldFeed(
  state: FabricatorState | undefined,
  tier: FabricatorTier | undefined,
  pools: HoldFeedPools,
  fillMode?: SlotFillMode,
): FeedResult {
  const normalized = normalizeFabricatorState(state, tier);
  return processFabricator(normalized.slots, tier, pools.raw, {}, {
    stockpile: pools.stockpile,
    stockpileBudget: { remaining: pools.bandwidth },
    fillMode,
  });
}

interface FabricatorStoreState {
  fabricators: Record<string, Fabricator>;
  fabricatorStates: Record<string, FabricatorState>;
  lastRun: Record<string, SlotRunResult[]>;
  placeFabricator: (fabricator: Fabricator) => void;
  removeFabricator: (key: string) => void;
  upgradeFabricator: (key: string) => boolean;
  restoreFabricators: (list: Fabricator[]) => void;
  setSlotTarget: (key: string, slotIdx: number, upgradeId: string | null) => void;
  setSlotPriority: (key: string, slotIdx: number, priority: number) => void;
  moveSlotOrder: (key: string, slotIdx: number, direction: -1 | 1) => void;
  unlockFabricatorSlot: (key: string) => boolean;
  feedFabricator: (
    key: string,
    pool: Partial<Record<Resource['type'], number>>,
    carried: MaterialCost,
    budget: MaterialBudget,
    canRouteByproduct?: (materialId: string) => boolean,
    stockpileSource?: MaterialCost,
  ) => FeedResult;
  setDrawFromHold: (key: string, enabled: boolean) => void;
  setFillMode: (key: string, mode: SlotFillMode) => void;
  loadFromHold: (key: string) => FeedResult | null;
  runHoldFeeds: () => string[];
  restoreFabricatorStates: (states: Record<string, FabricatorState>) => void;
}

export const useFabricatorStore = create<FabricatorStoreState>()(
  subscribeWithSelector((set, get) => ({
    fabricators: {}, fabricatorStates: {}, lastRun: {},

    placeFabricator: (fabricator) => {
      if (useUIStore.getState().checkDetectionLethal()) return;
      set((state) => ({
        fabricators: { ...state.fabricators, [fabricator.key]: fabricator },
        fabricatorStates: {
          ...state.fabricatorStates,
          [fabricator.key]: { slots: makeSlots(includedFabricatorSlots(fabricator.tier)) },
        },
      }));
      useMilestoneStore.getState().completeMilestone('first_fabricator');
    },

    upgradeFabricator: (key) => {
      const fabricator = get().fabricators[key];
      if (!fabricator || fabricator.tier >= 2) return false;
      set((state) => ({
        fabricators: { ...state.fabricators, [key]: { ...fabricator, tier: 2 } },
        fabricatorStates: {
          ...state.fabricatorStates,
          [key]: normalizeFabricatorState(state.fabricatorStates[key], 2),
        },
      }));
      return true;
    },

    removeFabricator: (key) => set((state) => {
      const { [key]: _fabricator, ...fabricators } = state.fabricators;
      const { [key]: _state, ...fabricatorStates } = state.fabricatorStates;
      const { [key]: _run, ...lastRun } = state.lastRun;
      return { fabricators, fabricatorStates, lastRun };
    }),

    restoreFabricators: (list) => {
      const fabricators: Record<string, Fabricator> = {};
      for (const fabricator of list) fabricators[fabricator.key] = fabricator;
      set({ fabricators });
    },

    setSlotTarget: (key, slotIdx, upgradeId) => {
      const fabricator = get().fabricators[key];
      const recipe = upgradeId ? getCraftable(upgradeId) : undefined;
      if (recipe && !fabricatorCanCraft(fabricator?.tier, recipe.category, recipe.minimumFabricatorTier)) return;
      const state = normalizeFabricatorState(get().fabricatorStates[key], fabricator?.tier);
      const current = state.slots[slotIdx];
      if (!current || current.targetUpgradeId === (upgradeId ?? null)) return;
      const stockpile = useStockpileStore.getState();
      const unrefunded: Partial<Record<Resource['type'], number>> = {};
      for (const [type, amount] of Object.entries(current.pendingResources)) {
        if ((amount ?? 0) <= 0) continue;
        const accepted = useUIStore.getState().depositCargo(type as Resource['type'], amount ?? 0);
        const left = (amount ?? 0) - accepted;
        if (left > 0) unrefunded[type as Resource['type']] = left;
      }
      for (const source of [current.pendingMaterials, current.byproducts]) {
        for (const [id, amount] of Object.entries(source)) if (amount > 0) stockpile.addMaterial(id, amount);
      }
      const slots = state.slots.map((slot, index) => index === slotIdx
        ? { ...makeEmptyFabricatorSlot(), targetUpgradeId: upgradeId, priority: slot.priority, pendingResources: unrefunded }
        : slot);
      set((store) => ({ fabricatorStates: { ...store.fabricatorStates, [key]: { slots } } }));
    },

    setSlotPriority: (key, slotIdx, priority) => set((state) => {
      const fabricatorState = normalizeFabricatorState(state.fabricatorStates[key], state.fabricators[key]?.tier);
      const orderedIndices = orderedSlotIndices(fabricatorState.slots).filter((index) => index !== slotIdx);
      orderedIndices.splice(Math.max(0, Math.min(orderedIndices.length, Math.floor(priority))), 0, slotIdx);
      const rankByIndex = new Map(orderedIndices.map((index, rank) => [index, rank]));
      return { fabricatorStates: { ...state.fabricatorStates, [key]: {
        slots: fabricatorState.slots.map((slot, index) => ({ ...slot, priority: rankByIndex.get(index) ?? index })),
      } } };
    }),

    moveSlotOrder: (key, slotIdx, direction) => {
      const state = get();
      const slots = normalizeFabricatorState(state.fabricatorStates[key], state.fabricators[key]?.tier).slots;
      const ordered = orderedSlotIndices(slots);
      const configured = ordered.filter((index) => slots[index].targetUpgradeId);
      const at = configured.indexOf(slotIdx);
      const neighbour = configured[at + direction];
      if (at < 0 || neighbour === undefined) return;
      get().setSlotPriority(key, slotIdx, ordered.indexOf(neighbour));
    },

    unlockFabricatorSlot: (key) => {
      let unlocked = false;
      set((state) => {
        const tier = state.fabricators[key]?.tier;
        const fabricatorState = normalizeFabricatorState(state.fabricatorStates[key], tier);
        if (fabricatorState.slots.length >= maxFabricatorSlots(tier)) return state;
        unlocked = true;
        return { fabricatorStates: { ...state.fabricatorStates, [key]: {
          slots: [...fabricatorState.slots, { ...makeEmptyFabricatorSlot(), priority: fabricatorState.slots.length }],
        } } };
      });
      return unlocked;
    },

    feedFabricator: (key, pool, carried, budget, canRouteByproduct, stockpileSource) => {
      const fabricator = get().fabricators[key];
      const state = normalizeFabricatorState(get().fabricatorStates[key], fabricator?.tier);
      const result = processFabricator(state.slots, fabricator?.tier, pool, carried, {
        stockpile: stockpileSource ?? {},
        stockpileBudget: budget,
        canRouteByproduct,
        fillMode: fabricator?.fillMode,
      });
      if (Object.keys(result.consumedStockpile).length > 0) {
        useStockpileStore.getState().consumeMaterials(result.consumedStockpile);
        if (stockpileSource) {
          for (const [id, amount] of Object.entries(result.consumedStockpile)) {
            stockpileSource[id] = Math.max(0, (stockpileSource[id] ?? 0) - amount);
          }
        }
      }
      set((store) => ({
        fabricatorStates: { ...store.fabricatorStates, [key]: { slots: result.slots } },
        lastRun: { ...store.lastRun, [key]: result.slotResults },
      }));
      return result;
    },

    setDrawFromHold: (key, enabled) => set((state) => {
      const fabricator = state.fabricators[key];
      if (!fabricator || (fabricator.drawFromHold ?? false) === enabled) return state;
      return { fabricators: { ...state.fabricators, [key]: { ...fabricator, drawFromHold: enabled } } };
    }),

    setFillMode: (key, mode) => set((state) => {
      const fabricator = state.fabricators[key];
      if (!fabricator || (fabricator.fillMode ?? 'shared') === mode) return state;
      return { fabricators: { ...state.fabricators, [key]: { ...fabricator, fillMode: mode } } };
    }),

    loadFromHold: (key) => {
      if (!get().fabricators[key]) return null;
      const { raw, stockpile, bandwidth } = holdFeedPools(
        useUIStore.getState(),
        useStockpileStore.getState().materials,
      );
      const result = get().feedFabricator(key, raw, {}, { remaining: bandwidth }, () => true, stockpile);
      useUIStore.getState().withdrawCargo(result.consumed);
      if (result.readyItems.length > 0) useExtractorStore.getState().receiveFabricatorItems(result.readyItems);
      return result;
    },

    runHoldFeeds: () => {
      const fed: string[] = [];
      const keys = Object.keys(get().fabricators).sort();
      for (const key of keys) {
        if (!get().fabricators[key].drawFromHold) continue;
        const result = get().loadFromHold(key);
        if (result?.changed) fed.push(key);
      }
      return fed;
    },

    restoreFabricatorStates: (states) => {
      const normalized: Record<string, FabricatorState> = {};
      for (const [key, fabricator] of Object.entries(get().fabricators)) {
        normalized[key] = normalizeFabricatorState(states[key], fabricator.tier);
      }
      set({ fabricatorStates: normalized, lastRun: {} });
    },
  })),
);
