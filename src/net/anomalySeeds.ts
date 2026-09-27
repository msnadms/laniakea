import type { AnomalySeeds } from '../game/anomalies';
import { MILKY_WAY_SEED } from '../game/hardcoded';
import { anomalySeedsKey, cachedAnomalySeeds, useAnomalySeedsStore } from '../store/anomalySeedsStore';
import { api, ApiError } from './api';

const RETRIES = 3;

const inFlight = new Map<string, Promise<AnomalySeeds>>();
let lastEntry: Promise<unknown> = Promise.resolve();

async function request(superclusterSeed: number, galaxySeed: number, peek: boolean): Promise<AnomalySeeds> {
  const path = `/galaxy/${superclusterSeed}/${galaxySeed}/anomaly-seeds${peek ? '?peek=1' : ''}`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<AnomalySeeds>(path);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429 || attempt >= RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, (err.retryAfter ?? 2) * 1000));
    }
  }
}

function load(superclusterSeed: number, galaxySeed: number, peek: boolean): Promise<AnomalySeeds> {
  const key = `${anomalySeedsKey(superclusterSeed, galaxySeed)}${peek ? ':peek' : ''}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = request(superclusterSeed, galaxySeed, peek)
    .then((seeds) => {
      useAnomalySeedsStore.getState().put(superclusterSeed, galaxySeed, seeds);
      return seeds;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function enterGalaxy(superclusterSeed: number, galaxySeed: number): Promise<AnomalySeeds> | null {
  if (galaxySeed === MILKY_WAY_SEED) return null;
  const entry = load(superclusterSeed, galaxySeed, false);
  lastEntry = entry.catch(() => undefined);
  return entry;
}

export function galaxyEntered(): Promise<unknown> {
  return lastEntry;
}

export function peekAnomalySeeds(superclusterSeed: number, galaxySeed: number): void {
  if (galaxySeed === MILKY_WAY_SEED || cachedAnomalySeeds(superclusterSeed, galaxySeed)) return;
  load(superclusterSeed, galaxySeed, true).catch((err) => console.error('peekAnomalySeeds failed:', err));
}
