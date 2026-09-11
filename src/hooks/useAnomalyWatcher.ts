import { useEffect } from 'react';
import { auth } from '../firebase/firebase';
import { anomalyRecordKey, saveAnomalyDiscovery, type AnomalyRecord } from '../firebase/anomalies';
import { generateGalaxyName } from '../game/superclusters';
import type { StarSystem } from '../game/types';
import { useAnomalyStore } from '../store/anomalyStore';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';

function catalogue(system: StarSystem | null) {
  if (!system) return;
  const game = useGameStore.getState();
  const anomaly = game.galaxyAnomalies.byHost.get(system.id);
  if (!anomaly) return;
  const anomalies = useAnomalyStore.getState();
  if (anomalies.records[anomalyRecordKey(game.galaxy.seed, system.id)]) return;
  const record: AnomalyRecord = {
    kind: anomaly.kind,
    superclusterSeed: game.supercluster.seed,
    superclusterName: game.supercluster.name,
    galaxySeed: game.galaxy.seed,
    galaxyName: generateGalaxyName(game.galaxy.seed),
    systemId: system.id,
    systemName: system.name,
    discoveredAt: Date.now(),
  };
  anomalies.add(record);
  const uid = auth.currentUser?.uid;
  if (uid) saveAnomalyDiscovery(uid, record).catch((err) => console.error('saveAnomalyDiscovery failed:', err));
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
