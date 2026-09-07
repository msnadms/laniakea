import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { CraftCategory, Extractor, FabricatorProductionItem } from '../game/types';
import { EXTRACTOR_UPGRADES, getCraftable } from '../data/upgrades';
import { materialName } from '../data/materials';
import { useStockpileStore } from './stockpileStore';
import { useUIStore, EXTRACTOR_HOLD_CAPS, LOGISTICS_B_RATE } from './uiStore';
import { canBuildExtractor } from './colonyStore';
import { useQuestStore } from './questStore';
import { effectiveExtractionPerHour, EXTRACTION_UNITS_PER_RATING_PER_HOUR } from '../game/economy';

export const ACCUMULATION_RATE_PER_MS = EXTRACTION_UNITS_PER_RATING_PER_HOUR / (60 * 60 * 1000);

export function extractorUnitsPerHour(
  extractor: Extractor,
  logisticsB: number,
  nodeEquipped: Record<string, [string | null, string | null]>,
): number {
  return effectiveExtractionPerHour(
    extractor.rate,
    LOGISTICS_B_RATE[logisticsB],
    getExtractorMultipliers(extractor.key, nodeEquipped).rateMultiplier,
  );
}

export function getExtractorMultipliers(
  extractorKey: string,
  nodeEquipped: Record<string, [string | null, string | null]>,
): { rateMultiplier: number; storageMultiplier: number; signalRiskMultiplier: number } {
  const slots = nodeEquipped[extractorKey] ?? [null, null];
  let rateMultiplier = 1;
  let storageMultiplier = 1;
  let signalDampeners = 0;
  for (const upgradeId of slots) {
    if (!upgradeId) continue;
    const def = EXTRACTOR_UPGRADES.find((u) => u.id === upgradeId);
    if (!def) continue;
    if (def.effect.upgType === 'rate') rateMultiplier *= def.effect.multiplier;
    if (def.effect.upgType === 'storage') storageMultiplier *= def.effect.multiplier;
    if (def.effect.upgType === 'detection') signalDampeners += 1;
  }
  return {
    rateMultiplier,
    storageMultiplier,
    signalRiskMultiplier: Math.max(0, 1 - signalDampeners * 0.5),
  };
}

export function peekAccumulated(extractor: Extractor, now: number = Date.now()): number {
  const { storageB, logisticsB } = useUIStore.getState();
  const { nodeEquipped } = useExtractorStore.getState();
  const { rateMultiplier, storageMultiplier } = getExtractorMultipliers(extractor.key, nodeEquipped);
  return Math.min(
    Math.floor(EXTRACTOR_HOLD_CAPS[storageB] * storageMultiplier),
    Math.floor((now - extractor.lastCollectedAt) * ACCUMULATION_RATE_PER_MS * extractor.rate * rateMultiplier * LOGISTICS_B_RATE[logisticsB]),
  );
}

export interface FabricatorDelivery {
  upgradeId: string;
  name: string;
  category: CraftCategory;
  count: number;
}

interface ExtractorState {
  extractors: Record<string, Extractor>;
  placeExtractor: (extractor: Extractor) => void;
  collectExtractor: (key: string, maxAmount?: number, now?: number) => number;
  removeExtractor: (key: string) => void;
  setExtractorReserve: (key: string, reserve: number) => void;
  restoreExtractors: (list: Extractor[]) => void;
  ownedUpgrades: string[];
  nodeEquipped: Record<string, [string | null, string | null]>;  // keyed by ExtractorKey
  purchaseUpgrade: (upgradeId: string) => boolean;
  equipUpgrade: (extractorKey: string, slot: 0 | 1, upgradeId: string | null) => void;
  receiveFabricatorItems: (items: FabricatorProductionItem[]) => FabricatorDelivery[];
  restoreUpgrades: (ownedUpgrades: string[], nodeEquipped: Record<string, [string | null, string | null]>) => void;
}

export const useExtractorStore = create<ExtractorState>()(subscribeWithSelector((set, get) => ({
  extractors: {},

  placeExtractor: (extractor) => {
    if (useUIStore.getState().checkDetectionLethal()) return;
    if (extractor.resourceType === 'alienMatter' || !canBuildExtractor(extractor.galaxySeed, extractor.systemId)) return;
    set((s) => ({ extractors: { ...s.extractors, [extractor.key]: extractor } }));
    useQuestStore.getState().completeQuest('first_extractor');
  },

  collectExtractor: (key, maxAmount?, now = Date.now()) => {
    if (useUIStore.getState().checkDetectionLethal()) return 0;
    const extractor = get().extractors[key];
    if (!extractor) return 0;
    const { storageB, logisticsB } = useUIStore.getState();
    const { rateMultiplier, storageMultiplier } = getExtractorMultipliers(key, get().nodeEquipped);
    const extractorMax = Math.floor(EXTRACTOR_HOLD_CAPS[storageB] * storageMultiplier);
    const unitsPerMs = ACCUMULATION_RATE_PER_MS * extractor.rate * rateMultiplier * LOGISTICS_B_RATE[logisticsB];
    const rawAmount = Math.min(Math.floor((now - extractor.lastCollectedAt) * unitsPerMs), extractorMax);
    const amount = maxAmount !== undefined ? Math.min(rawAmount, maxAmount) : rawAmount;
    if (amount <= 0) return 0;
    const newLastCollectedAt = rawAmount > amount ? now - (rawAmount - amount) / unitsPerMs : now;
    set((s) => ({
      extractors: {
        ...s.extractors,
        [key]: { ...s.extractors[key], lastCollectedAt: newLastCollectedAt },
      },
    }));
    return amount;
  },

  removeExtractor: (key) =>
    set((s) => {
      const { [key]: _, ...rest } = s.extractors;
      return { extractors: rest };
    }),

  setExtractorReserve: (key, reserve) => {
    set((s) => s.extractors[key]
      ? { extractors: { ...s.extractors, [key]: { ...s.extractors[key], reserve: Math.max(0, Math.floor(reserve)) } } }
      : s);
  },

  restoreExtractors: (list) => {
    const map: Record<string, Extractor> = {};
    for (const e of list) map[e.key] = e;
    set({ extractors: map });
  },

  ownedUpgrades: [],
  nodeEquipped: {},

  receiveFabricatorItems: (items) => {
    const deliveries = new Map<string, FabricatorDelivery>();
    const modules: string[] = [];
    const stockpile = useStockpileStore.getState();
    for (const item of items) {
      if (item.count <= 0) continue;
      const name = getCraftable(item.upgradeId)?.name ?? materialName(item.upgradeId);
      if (item.category === 'material') stockpile.addMaterial(item.upgradeId, item.count);
      else if (item.category === 'rare') stockpile.addRare(item.upgradeId, item.count);
      else for (let i = 0; i < item.count; i++) modules.push(item.upgradeId);
      const existing = deliveries.get(item.upgradeId);
      if (existing) existing.count += item.count;
      else deliveries.set(item.upgradeId, {
        upgradeId: item.upgradeId,
        name,
        category: item.category,
        count: item.count,
      });
    }
    if (modules.length > 0) set((s) => ({ ownedUpgrades: [...s.ownedUpgrades, ...modules] }));
    return [...deliveries.values()];
  },

  restoreUpgrades: (ownedUpgrades, nodeEquipped) => set({ ownedUpgrades, nodeEquipped }),

  purchaseUpgrade: (upgradeId) => {
    if (useUIStore.getState().checkDetectionLethal()) return false;
    const def = EXTRACTOR_UPGRADES.find((u) => u.id === upgradeId);
    if (!def) return false;
    const ui = useUIStore.getState();
    if ((def.cost.alloys ?? 0) > ui.alloys) return false;
    if ((def.cost.exotic ?? 0) > ui.exoticMatter) return false;
    if ((def.cost.helium ?? 0) > ui.helium3Reserves) return false;
    if (!useStockpileStore.getState().hasMaterials(def.materials)) return false;
    if (def.cost.alloys) ui.spendAlloys(def.cost.alloys);
    if (def.cost.exotic) ui.consumeExoticMatter(def.cost.exotic);
    if (def.cost.helium) ui.consumeHelium3(def.cost.helium);
    useStockpileStore.getState().consumeMaterials(def.materials);
    set((s) => ({ ownedUpgrades: [...s.ownedUpgrades, upgradeId] }));
    return true;
  },

  equipUpgrade: (extractorKey, slot, upgradeId) => {
    set((s) => {
      const equipped = { ...s.nodeEquipped };
      const current: [string | null, string | null] = equipped[extractorKey]
        ? [...equipped[extractorKey]] as [string | null, string | null]
        : [null, null];
      current[slot] = upgradeId;
      equipped[extractorKey] = current;
      return { nodeEquipped: equipped };
    });
  },
})));
