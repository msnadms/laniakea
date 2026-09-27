import { LANIAKEA_SEED, MILKY_WAY_SEED } from '../game/hardcoded';
import { api } from './api';

export interface Discovery {
  firstBy: string;
  firstAt: number;
}

const discoveries = new Map<string, Promise<Discovery | null>>();

export function discoveryKey(superclusterSeed: number, galaxySeed: number | null): string {
  return galaxySeed === null ? `sc:${superclusterSeed}` : `g:${superclusterSeed}:${galaxySeed}`;
}

export function discover(superclusterSeed: number, galaxySeed: number | null): Promise<Discovery | null> {
  if (galaxySeed === null ? superclusterSeed === LANIAKEA_SEED : galaxySeed === MILKY_WAY_SEED) return Promise.resolve(null);
  const key = discoveryKey(superclusterSeed, galaxySeed);
  const known = discoveries.get(key);
  if (known) return known;
  const promise = api<{ discovery: Discovery | null }>('/discover', { superclusterSeed, galaxySeed })
    .then(({ discovery }) => discovery)
    .catch((err) => {
      discoveries.delete(key);
      console.error('discover failed:', err);
      return null;
    });
  discoveries.set(key, promise);
  return promise;
}
