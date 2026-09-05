import type { ExtractorUpgrade, CraftCategory, ResourceCost, MaterialCost } from '../game/types';
import { CRAFTABLE_MATERIALS } from './materials';
import { RARE_RESOURCES } from './rareResources';
import raw from './upgrades.json';

export const EXTRACTOR_UPGRADES: ExtractorUpgrade[] = raw.extractorUpgrades as unknown as ExtractorUpgrade[];

export interface Craftable {
  id: string;
  name: string;
  cost: ResourceCost;
  materials: MaterialCost;
  category: CraftCategory;
  outputs: number;
  byproducts: MaterialCost;
  produces: string;
}

export const ALL_CRAFTABLES: Craftable[] = [
  ...CRAFTABLE_MATERIALS.map((m) => ({
    id: m.id,
    name: m.name,
    cost: m.cost,
    materials: m.materials,
    category: 'material' as const,
    outputs: m.outputs ?? 1,
    byproducts: m.byproducts ?? {},
    produces: m.produces ?? m.id,
  })),
  ...EXTRACTOR_UPGRADES.map((u) => ({
    id: u.id,
    name: u.name,
    cost: u.cost,
    materials: u.materials,
    category: 'extractor' as const,
    outputs: 1,
    byproducts: {},
    produces: u.id,
  })),
  ...RARE_RESOURCES.map((r) => ({
    id: r.id,
    name: r.name,
    cost: r.cost,
    materials: r.materials,
    category: 'rare' as const,
    outputs: 1,
    byproducts: {},
    produces: r.id,
  })),
];

const BY_ID = new Map(ALL_CRAFTABLES.map((c) => [c.id, c]));

export function getCraftable(id: string): Craftable | undefined {
  return BY_ID.get(id);
}
