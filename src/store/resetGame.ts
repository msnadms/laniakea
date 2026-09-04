import { useAuthStore } from './authStore';
import { useUIStore, applyUserSettings } from './uiStore';
import { useGameStore } from './gameStore';
import { useExtractorStore } from './extractorStore';
import { useFabricatorStore } from './fabricatorStore';
import { useLogisticsStore } from './logisticsStore';
import { useStockpileStore } from './stockpileStore';
import { useCodexStore } from './codexStore';
import { useQuestStore } from './questStore';
import { defaultSettings, saveUserSettings } from '../firebase/userDoc';
import { deleteAllExtractors } from '../firebase/extractors';
import { deleteAllFabricators } from '../firebase/fabricators';
import { deleteAllLogisticsRoutes } from '../firebase/logisticsRoutes';
import { deleteAllDiscoveries } from '../firebase/discoveries';
import { deleteQuests } from '../firebase/quests';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { saveStockpile } from '../firebase/stockpile';
import { clearFirstVisit } from '../lib/firstVisit';

export const DEATH_SEQUENCE_MS = 2800;

let deathTimer: ReturnType<typeof setTimeout> | null = null;

export function beginDeathSequence(): void {
  if (deathTimer !== null) return;
  useUIStore.setState({ destroyed: true });
  deathTimer = setTimeout(() => {
    deathTimer = null;
    void resetGame();
  }, DEATH_SEQUENCE_MS);
}

export function cancelDeathSequence(): void {
  if (deathTimer !== null) {
    clearTimeout(deathTimer);
    deathTimer = null;
  }
  if (useUIStore.getState().destroyed) useUIStore.setState({ destroyed: false });
}

export async function resetGame(): Promise<void> {
  const { user } = useAuthStore.getState();

  clearFirstVisit();
  applyUserSettings(defaultSettings);
  useUIStore.setState({ view: defaultSettings.lastView, address: defaultSettings.address });
  useGameStore.getState().resetToInitial();
  useExtractorStore.setState({ extractors: {}, ownedUpgrades: [], nodeEquipped: {}, pendingUpgrades: [] });
  useFabricatorStore.setState({ fabricators: {}, fabricatorStates: {} });
  useLogisticsStore.setState({ routes: [] });
  useStockpileStore.setState({ materials: {}, rares: {} });
  useCodexStore.getState().setAll([]);
  useQuestStore.getState().resetQuests();

  if (!user) return;

  await Promise.all([
    saveUserSettings(user.uid, defaultSettings),
    deleteAllExtractors(user.uid),
    deleteAllFabricators(user.uid),
    deleteAllLogisticsRoutes(user.uid),
    deleteAllDiscoveries(user.uid),
    deleteQuests(user.uid),
    saveExtractorUpgrades(user.uid, { ownedUpgrades: [], nodeEquipped: {}, pendingUpgrades: [] }),
    saveStockpile(user.uid, {}, {}),
  ]);
}
