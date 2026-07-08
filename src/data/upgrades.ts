import type { ExtractorUpgrade, CombatCore, CraftCategory, ResourceCost } from '../game/types';
import raw from './upgrades.json';

export const EXTRACTOR_UPGRADES: ExtractorUpgrade[] = raw.extractorUpgrades as ExtractorUpgrade[];
export const COMBAT_CORES: CombatCore[] = raw.combatCores as CombatCore[];

export interface Craftable {
  id: string;
  name: string;
  cost: ResourceCost;
  category: CraftCategory;
}

export const ALL_CRAFTABLES: Craftable[] = [
  ...EXTRACTOR_UPGRADES.map((u) => ({ id: u.id, name: u.name, cost: u.cost, category: 'extractor' as const })),
  ...COMBAT_CORES.map((c) => ({ id: c.id, name: c.name, cost: c.cost, category: 'core' as const })),
];

export function getCraftable(id: string): Craftable | undefined {
  return ALL_CRAFTABLES.find((c) => c.id === id);
}
