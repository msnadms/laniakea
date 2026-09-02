import type { ExtractorUpgrade, CraftCategory, ResourceCost } from '../game/types';
import raw from './upgrades.json';

export const EXTRACTOR_UPGRADES: ExtractorUpgrade[] = raw.extractorUpgrades as ExtractorUpgrade[];

export interface Craftable {
  id: string;
  name: string;
  cost: ResourceCost;
  category: CraftCategory;
}

export const ALL_CRAFTABLES: Craftable[] = [
  ...EXTRACTOR_UPGRADES.map((u) => ({ id: u.id, name: u.name, cost: u.cost, category: 'extractor' as const })),
];

export function getCraftable(id: string): Craftable | undefined {
  return ALL_CRAFTABLES.find((c) => c.id === id);
}
