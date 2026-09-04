import type { RareResource } from '../game/types';
import raw from './rareResources.json';

export const RARE_RESOURCES: RareResource[] = raw.rareResources as unknown as RareResource[];

export const RARE_ROLES: string[] = [...new Set(RARE_RESOURCES.map((r) => r.role))];

export function getRareResource(id: string): RareResource | undefined {
  return RARE_RESOURCES.find((r) => r.id === id);
}

export function rareResourceName(id: string): string {
  return getRareResource(id)?.name ?? id;
}
