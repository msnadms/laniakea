import type { AnomalySeeds } from '../game/anomalies';
import type { Discovery } from '../game/discovery';
import { MILKY_WAY_SEED } from '../game/hardcoded';
import { anomalySeedsKey, cachedAnomalySeeds, useAnomalySeedsStore } from '../store/anomalySeedsStore';
import { api, withRetry } from './api';
import { rememberGalaxyDiscovery } from './discoveries';

interface GalaxyEntry {
  seeds: AnomalySeeds;
  discovery: Discovery | null;
}

const inFlight = new Map<string, Promise<GalaxyEntry>>();
let lastEntry: Promise<unknown> = Promise.resolve();

function load(superclusterSeed: number, galaxySeed: number, peek: boolean): Promise<GalaxyEntry> {
  const key = `${anomalySeedsKey(superclusterSeed, galaxySeed)}${peek ? ':peek' : ''}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const path = `/galaxy/${superclusterSeed}/${galaxySeed}/anomaly-seeds${peek ? '?peek=1' : ''}`;
  const promise = withRetry(() => api<GalaxyEntry>(path))
    .then((entry) => {
      useAnomalySeedsStore.getState().put(superclusterSeed, galaxySeed, entry.seeds);
      return entry;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function enterGalaxy(superclusterSeed: number, galaxySeed: number): Promise<AnomalySeeds> | null {
  if (galaxySeed === MILKY_WAY_SEED) return null;
  const entry = load(superclusterSeed, galaxySeed, false);
  rememberGalaxyDiscovery(superclusterSeed, galaxySeed, entry.then(({ discovery }) => discovery));
  lastEntry = entry.catch(() => undefined);
  return entry.then(({ seeds }) => seeds);
}

export function galaxyEntered(): Promise<unknown> {
  return lastEntry;
}

export function peekAnomalySeeds(superclusterSeed: number, galaxySeed: number): void {
  if (galaxySeed === MILKY_WAY_SEED || cachedAnomalySeeds(superclusterSeed, galaxySeed)) return;
  load(superclusterSeed, galaxySeed, true).catch((err) => console.error('peekAnomalySeeds failed:', err));
}
