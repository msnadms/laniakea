import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Extractor, ColonyProductionItem } from '../game/types';
import { EXTRACTOR_UPGRADES } from '../data/upgrades';
import { useUIStore, EXTRACTOR_HOLD_CAPS, LOGISTICS_B_RATE, computeLogisticsCap } from './uiStore';
import { useQuestStore } from './questStore';

export const ACCUMULATION_RATE_PER_MS = 1 / (60 * 1000) // 1 unit per hour

export function getExtractorMultipliers(
  extractorKey: string,
  nodeEquipped: Record<string, [string | null, string | null]>,
): { rateMultiplier: number; storageMultiplier: number; dampened: boolean } {
  const slots = nodeEquipped[extractorKey] ?? [null, null];
  let rateMultiplier = 1;
  let storageMultiplier = 1;
  let dampened = false;
  for (const upgradeId of slots) {
    if (!upgradeId) continue;
    const def = EXTRACTOR_UPGRADES.find((u) => u.id === upgradeId);
    if (!def) continue;
    if (def.effect.upgType === 'rate') rateMultiplier *= def.effect.multiplier;
    if (def.effect.upgType === 'storage') storageMultiplier *= def.effect.multiplier;
    if (def.effect.upgType === 'detection') dampened = true;
  }
  return { rateMultiplier, storageMultiplier, dampened };
}

export function peekAccumulated(extractor: Extractor): number {
  const { storageB, logisticsB } = useUIStore.getState();
  const { nodeEquipped } = useExtractorStore.getState();
  const { rateMultiplier, storageMultiplier } = getExtractorMultipliers(extractor.key, nodeEquipped);
  return Math.min(
    Math.floor(EXTRACTOR_HOLD_CAPS[storageB] * storageMultiplier),
    Math.floor((Date.now() - extractor.lastCollectedAt) * ACCUMULATION_RATE_PER_MS * extractor.rate * rateMultiplier * LOGISTICS_B_RATE[logisticsB]),
  );
}

export interface PendingUpgrade {
  id: string;
  upgradeId: string;
  availableAt: number;
}

interface ExtractorState {
  extractors: Record<string, Extractor>;
  placeExtractor: (extractor: Extractor) => void;
  collectExtractor: (key: string, maxAmount?: number) => number;
  removeExtractor: (key: string) => void;
  restoreExtractors: (list: Extractor[]) => void;
  ownedUpgrades: string[];
  nodeEquipped: Record<string, [string | null, string | null]>;  // keyed by ExtractorKey
  pendingUpgrades: PendingUpgrade[];
  purchaseUpgrade: (upgradeId: string) => boolean;
  equipUpgrade: (extractorKey: string, slot: 0 | 1, upgradeId: string | null) => void;
  receiveColonyItems: (items: ColonyProductionItem[]) => void;
  claimPendingUpgrade: (id: string) => boolean;
  restoreUpgrades: (ownedUpgrades: string[], nodeEquipped: Record<string, [string | null, string | null]>, pendingUpgrades?: PendingUpgrade[]) => void;
}

export const useExtractorStore = create<ExtractorState>()(subscribeWithSelector((set, get) => ({
  extractors: {},

  placeExtractor: (extractor) => {
    const maxStations = computeLogisticsCap(useUIStore.getState().logisticsA);
    if (Object.keys(get().extractors).length >= maxStations) return;
    set((s) => ({ extractors: { ...s.extractors, [extractor.key]: extractor } }));
    useQuestStore.getState().completeQuest('first_extractor');
  },

  collectExtractor: (key, maxAmount?) => {
    const extractor = get().extractors[key];
    if (!extractor) return 0;
    const now = Date.now();
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

  restoreExtractors: (list) => {
    const map: Record<string, Extractor> = {};
    for (const e of list) map[e.key] = e;
    set({ extractors: map });
  },

  ownedUpgrades: [],
  nodeEquipped: {},
  pendingUpgrades: [],

  receiveColonyItems: (items) => {
    const newPending: PendingUpgrade[] = items.map((item) => ({
      id: crypto.randomUUID(),
      upgradeId: item.upgradeId,
      availableAt: item.availableAt,
    }));
    set((s) => ({ pendingUpgrades: [...s.pendingUpgrades, ...newPending] }));
  },

  claimPendingUpgrade: (id) => {
    const pending = get().pendingUpgrades.find((p) => p.id === id);
    if (!pending || pending.availableAt > Date.now()) return false;
    set((s) => ({
      pendingUpgrades: s.pendingUpgrades.filter((p) => p.id !== id),
      ownedUpgrades: [...s.ownedUpgrades, pending.upgradeId],
    }));
    return true;
  },

  restoreUpgrades: (ownedUpgrades, nodeEquipped, pendingUpgrades = []) =>
    set({ ownedUpgrades, nodeEquipped, pendingUpgrades }),

  purchaseUpgrade: (upgradeId) => {
    const def = EXTRACTOR_UPGRADES.find((u) => u.id === upgradeId);
    if (!def) return false;
    const ui = useUIStore.getState();
    if ((def.cost.alloys ?? 0) > ui.alloys) return false;
    if ((def.cost.exotic ?? 0) > ui.exoticMatter) return false;
    if ((def.cost.helium ?? 0) > ui.helium3Reserves) return false;
    if (def.cost.alloys) ui.spendAlloys(def.cost.alloys);
    if (def.cost.exotic) ui.consumeExoticMatter(def.cost.exotic);
    if (def.cost.helium) ui.consumeHelium3(def.cost.helium);
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
