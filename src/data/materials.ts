import type { CraftMaterial } from '../game/types';
import raw from './materials.json';

export const CRAFT_MATERIALS: CraftMaterial[] = raw.materials as unknown as CraftMaterial[];

export const STOCKED_MATERIALS: CraftMaterial[] = CRAFT_MATERIALS.filter((m) => !m.produces);

export const CRAFTABLE_MATERIALS: CraftMaterial[] = CRAFT_MATERIALS.filter((m) => !m.byproductOnly);

export const MATERIAL_TIERS: number[] = [...new Set(CRAFT_MATERIALS.map((m) => m.tier))].sort();

const BY_ID = new Map(CRAFT_MATERIALS.map((m) => [m.id, m]));

export function getMaterial(id: string): CraftMaterial | undefined {
  return BY_ID.get(id);
}

export function materialName(id: string): string {
  return getMaterial(id)?.name ?? id;
}
