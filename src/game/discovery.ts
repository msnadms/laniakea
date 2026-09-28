import { LANIAKEA_SEED, MILKY_WAY_SEED } from './hardcoded';

export interface Discovery {
  firstBy: string;
  firstAt: number;
}

export function isChartedHome(superclusterSeed: number, galaxySeed: number | null): boolean {
  return galaxySeed === null ? superclusterSeed === LANIAKEA_SEED : galaxySeed === MILKY_WAY_SEED;
}

export function discoveryId(superclusterSeed: number, galaxySeed: number | null, systemId: number | null = null): string {
  if (galaxySeed === null) return String(superclusterSeed);
  return systemId === null ? `${superclusterSeed}-${galaxySeed}` : `${superclusterSeed}-${galaxySeed}-${systemId}`;
}
