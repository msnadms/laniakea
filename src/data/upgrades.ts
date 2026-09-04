import type { ExtractorUpgrade, CraftCategory, ResourceCost, MaterialCost } from '../game/types';
import { CRAFT_MATERIALS } from './materials';
import { RARE_RESOURCES } from './rareResources';
import raw from './upgrades.json';

export const EXTRACTOR_UPGRADES: ExtractorUpgrade[] = raw.extractorUpgrades as unknown as ExtractorUpgrade[];

export interface Craftable {
  id: string;
  name: string;
  cost: ResourceCost;
  materials: MaterialCost;
  craftHours: number;
  category: CraftCategory;
}

export const ALL_CRAFTABLES: Craftable[] = [
  ...CRAFT_MATERIALS.map((m) => ({
    id: m.id,
    name: m.name,
    cost: m.cost,
    materials: m.materials,
    craftHours: m.craftHours,
    category: 'material' as const,
  })),
  ...EXTRACTOR_UPGRADES.map((u) => ({
    id: u.id,
    name: u.name,
    cost: u.cost,
    materials: u.materials,
    craftHours: u.craftHours,
    category: 'extractor' as const,
  })),
  ...RARE_RESOURCES.map((r) => ({
    id: r.id,
    name: r.name,
    cost: r.cost,
    materials: r.materials,
    craftHours: r.craftHours,
    category: 'rare' as const,
  })),
];

const BY_ID = new Map(ALL_CRAFTABLES.map((c) => [c.id, c]));

export function getCraftable(id: string): Craftable | undefined {
  return BY_ID.get(id);
}
