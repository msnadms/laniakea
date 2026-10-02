import { discoveryId, isChartedHome, type Discovery } from '../game/discovery';
import { api, withRetry } from './api';

export type { Discovery };

const discoveries = new Map<string, Promise<Discovery | null>>();

export function discoveryKey(superclusterSeed: number, galaxySeed: number | null, systemId: number | null = null): string {
  const kind = galaxySeed === null ? 'sc' : systemId === null ? 'g' : 's';
  return `${kind}:${discoveryId(superclusterSeed, galaxySeed, systemId)}`;
}

export function rememberGalaxyDiscovery(superclusterSeed: number, galaxySeed: number, discovery: Promise<Discovery | null>): void {
  const key = discoveryKey(superclusterSeed, galaxySeed);
  const settled = discovery.catch(() => {
    if (discoveries.get(key) === settled) discoveries.delete(key);
    return null;
  });
  discoveries.set(key, settled);
}

function fetchDiscovery(key: string, request: () => Promise<{ discovery: Discovery | null }>): Promise<Discovery | null> {
  const known = discoveries.get(key);
  if (known) return known;
  const promise = withRetry(request)
    .then(({ discovery }) => discovery)
    .catch((err) => {
      discoveries.delete(key);
      console.error('discover failed:', err);
      return null;
    });
  discoveries.set(key, promise);
  return promise;
}

export function galaxyEntered(superclusterSeed: number, galaxySeed: number): Promise<unknown> {
  return discoveries.get(discoveryKey(superclusterSeed, galaxySeed)) ?? Promise.resolve(null);
}

function discoverSystem(superclusterSeed: number, galaxySeed: number, systemId: number): Promise<Discovery | null> {
  return fetchDiscovery(discoveryKey(superclusterSeed, galaxySeed, systemId), () =>
    galaxyEntered(superclusterSeed, galaxySeed).then(() => api<{ discovery: Discovery | null }>('/discover/system', { superclusterSeed, galaxySeed, systemId })));
}

export function discover(superclusterSeed: number, galaxySeed: number | null, systemId: number | null = null): Promise<Discovery | null> {
  if (isChartedHome(superclusterSeed, galaxySeed)) return Promise.resolve(null);
  if (galaxySeed === null) {
    return fetchDiscovery(discoveryKey(superclusterSeed, null), () => api('/discover', { superclusterSeed }));
  }
  if (systemId !== null) return discoverSystem(superclusterSeed, galaxySeed, systemId);
  return discoveries.get(discoveryKey(superclusterSeed, galaxySeed)) ?? Promise.resolve(null);
}
