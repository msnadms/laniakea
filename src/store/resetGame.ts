import { useAuthStore } from './authStore';
import { useUIStore, applyUserSettings } from './uiStore';
import { useGameStore } from './gameStore';
import { useExtractorStore } from './extractorStore';
import { useSettlementStore } from './settlementStore';
import { useLogisticsStore } from './logisticsStore';
import { useCodexStore } from './codexStore';
import { useQuestStore } from './questStore';
import { defaultSettings, saveUserSettings } from '../firebase/userDoc';
import { deleteAllExtractors } from '../firebase/extractors';
import { deleteAllSettlements } from '../firebase/settlements';
import { deleteAllLogisticsRoutes } from '../firebase/logisticsRoutes';
import { deleteAllDiscoveries } from '../firebase/discoveries';
import { deleteQuests } from '../firebase/quests';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
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
  useSettlementStore.setState({ settlements: {}, colonyStates: {} });
  useLogisticsStore.setState({ routes: [] });
  useCodexStore.getState().setAll([]);
  useQuestStore.getState().resetQuests();

  if (!user) return;

  await Promise.all([
    saveUserSettings(user.uid, defaultSettings),
    deleteAllExtractors(user.uid),
    deleteAllSettlements(user.uid),
    deleteAllLogisticsRoutes(user.uid),
    deleteAllDiscoveries(user.uid),
    deleteQuests(user.uid),
    saveExtractorUpgrades(user.uid, { ownedUpgrades: [], nodeEquipped: {}, pendingUpgrades: [] }),
  ]);
}
