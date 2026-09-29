import { useEffect } from 'react';
import { anomalyRecordKey, type AnomalyRecord, type WorldAnomaly } from '../game/anomalyRecord';
import type { StarSystem } from '../game/types';
import { api, ApiError } from '../net/api';
import { enterGalaxy, galaxyEntered } from '../net/anomalySeeds';
import { useAnomalyStore } from '../store/anomalyStore';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';

interface CatalogueResponse {
  record: AnomalyRecord;
  awarded: number;
  technologyAwarded: number;
  world: WorldAnomaly;
}

const cataloguing = new Set<string>();

function catalogue(system: StarSystem | null) {
  if (!system) return;
  const game = useGameStore.getState();
  if (!game.galaxyAnomalies.byHost.has(system.id)) return;
  const key = anomalyRecordKey(game.supercluster.seed, game.galaxy.seed, system.id);
  if (useAnomalyStore.getState().records[key] || cataloguing.has(key)) return;
  cataloguing.add(key);
  const superclusterSeed = game.supercluster.seed;
  const galaxySeed = game.galaxy.seed;
  const post = () => api<CatalogueResponse>('/catalogue', { superclusterSeed, galaxySeed, systemId: system.id });
  const stillHere = () => {
    const now = useGameStore.getState();
    return now.supercluster.seed === superclusterSeed && now.galaxy.seed === galaxySeed && now.system?.id === system.id;
  };
  galaxyEntered()
    .then(post)
    .catch(async (err) => {
      if (!(err instanceof ApiError) || err.status !== 409 || !stillHere()) throw err;
      await enterGalaxy(superclusterSeed, galaxySeed);
      return post();
    })
    .then(({ record, awarded, technologyAwarded, world }) => {
      useAnomalyStore.getState().add(record, awarded, technologyAwarded);
      useAnomalyStore.getState().setWorld(key, world);
    })
    .catch((err) => console.error('catalogue failed:', err))
    .finally(() => cataloguing.delete(key));
}

export function useAnomalyWatcher() {
  useEffect(() => {
    catalogue(useGameStore.getState().system);
    return useGameStore.subscribe((state, prev) => {
      if (state.system === prev.system) return;
      if (state.system?.id !== prev.system?.id || state.galaxy.seed !== prev.galaxy.seed) {
        useUIStore.getState().setAnomalyPanelOpen(false);
      }
      catalogue(state.system);
    });
  }, []);
}
