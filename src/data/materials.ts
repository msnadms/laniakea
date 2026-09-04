import type { CraftMaterial } from '../game/types';
import raw from './materials.json';

export const CRAFT_MATERIALS: CraftMaterial[] = raw.materials as unknown as CraftMaterial[];

export const MATERIAL_TIERS: number[] = [...new Set(CRAFT_MATERIALS.map((m) => m.tier))].sort();

export function getMaterial(id: string): CraftMaterial | undefined {
  return CRAFT_MATERIALS.find((m) => m.id === id);
}

export function materialName(id: string): string {
  return getMaterial(id)?.name ?? id;
}
