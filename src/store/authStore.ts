import { create } from 'zustand';
import { signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/firebase';
import { initUserDoc } from '../firebase/userDoc';
import { loadAllDiscoveries } from '../firebase/discoveries';
import { loadAllExtractors } from '../firebase/extractors';
import { loadAllFabricators, saveFabricatorState } from '../firebase/fabricators';
import { loadMilestones } from '../firebase/milestones';
import { loadLogisticsRoutes, saveLogisticsRoute } from '../firebase/logisticsRoutes';
import { loadExtractorUpgrades, saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { loadStockpile, saveStockpile } from '../firebase/stockpile';
import { applyUserSettings, useUIStore } from './uiStore';
import { cancelDeathSequence } from './resetGame';
import { useCodexStore } from './codexStore';
import { useGameStore } from './gameStore';
import { useExtractorStore } from './extractorStore';
import { useFabricatorStore } from './fabricatorStore';
import { useColonyStore } from './colonyStore';
import { loadAllColonies } from '../firebase/colonies';
import { useLogisticsStore } from './logisticsStore';
import { useStockpileStore } from './stockpileStore';
import { useMilestoneStore } from './milestoneStore';
import { loadNav } from '../lib/navLocalStorage';
import { loadResearch, saveResearch } from '../firebase/research';
import { useResearchStore } from './researchStore';

interface AuthState {
  user: User | null;
  loading: boolean;
  settingsLoaded: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(() => ({
  user: null,
  loading: true,
  settingsLoaded: false,
  signIn: async () => {
    await signInWithPopup(auth, googleProvider);
  },
  signOut: async () => {
    await signOut(auth);
  },
}));

// Call once from App on mount. Returns the Firebase unsubscribe function.
export function initAuth(): () => void {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const [baseSettings, discoveries, extractors, fabricators, milestones, logisticsRoutes, extractorUpgrades, stockpile, colonies, research] = await Promise.all([
          initUserDoc(user),
          loadAllDiscoveries(user.uid),
          loadAllExtractors(user.uid),
          loadAllFabricators(user.uid),
          loadMilestones(user.uid),
          loadLogisticsRoutes(user.uid),
          loadExtractorUpgrades(user.uid),
          loadStockpile(user.uid),
          loadAllColonies(user.uid),
          loadResearch(user.uid),
        ]);
        // localStorage nav is more recent than Firebase's debounced write — prefer
        // it for galaxy/system/view when the entry is fresh (< 30s old).
        const localNav = loadNav(user.uid);
        const settings = localNav
          ? {
              ...baseSettings,
              lastView: localNav.lastView,
              lastSuperclusterSeed: localNav.lastSuperclusterSeed,
              lastGalaxySeed: localNav.lastGalaxySeed,
              lastSystemId: localNav.lastSystemId,
              address: localNav.address,
            }
          : baseSettings;
        applyUserSettings(settings);
        useExtractorStore.getState().restoreExtractors(extractors);
        useExtractorStore.getState().restoreUpgrades(extractorUpgrades.ownedUpgrades, extractorUpgrades.nodeEquipped);
        useFabricatorStore.getState().restoreFabricators(fabricators.fabricators);
        useFabricatorStore.getState().restoreFabricatorStates(fabricators.fabricatorStates);
        useColonyStore.getState().restoreColonies(colonies);
        useLogisticsStore.getState().restoreRoutes(logisticsRoutes);
        const legacyDataCores = stockpile.materials.data_core ?? 0;
        const stockpileMaterials = { ...stockpile.materials };
        delete stockpileMaterials.data_core;
        useStockpileStore.getState().restoreStockpile(stockpileMaterials, stockpile.rares);
        useResearchStore.getState().restoreResearch(research, legacyDataCores);
        const legacyProductionItems = [
          ...fabricators.legacyProductionItems,
          ...(extractorUpgrades.legacyProductionItems ?? []),
        ];
        const migratedRoutes = logisticsRoutes.some((route) => route.legacyNodeKeys !== undefined);
        const migratedResearch = research.points === undefined || legacyDataCores > 0;
        if (legacyProductionItems.length > 0 || migratedRoutes || migratedResearch) {
          useExtractorStore.getState().receiveFabricatorItems(legacyProductionItems);
          const normalizedStates = useFabricatorStore.getState().fabricatorStates;
          const migratedStockpile = useStockpileStore.getState();
          const migratedUpgrades = useExtractorStore.getState();
          await Promise.all([
            ...Object.entries(normalizedStates).map(([key, state]) => saveFabricatorState(user.uid, key, state)),
            saveStockpile(user.uid, migratedStockpile.materials, migratedStockpile.rares),
            saveResearch(user.uid, { points: useResearchStore.getState().points }),
            saveExtractorUpgrades(user.uid, {
              ownedUpgrades: migratedUpgrades.ownedUpgrades,
              nodeEquipped: migratedUpgrades.nodeEquipped,
            }),
            ...useLogisticsStore.getState().routes.map((route) => saveLogisticsRoute(user.uid, route)),
          ]);
        }
        useCodexStore.getState().setAll(discoveries);
        useMilestoneStore.getState().restoreMilestones(milestones);

        const visitedSystems: Record<number, number[]> = {};
        const visitedGalaxies: Record<number, number[]> = {};
        for (const sc of discoveries) {
          const galaxySeeds: number[] = [];
          for (const galaxy of Object.values(sc.galaxies)) {
            galaxySeeds.push(galaxy.galaxySeed);
            const systemIds = Object.keys(galaxy.systems).map(Number);
            if (systemIds.length > 0) visitedSystems[galaxy.galaxySeed] = systemIds;
          }
          if (galaxySeeds.length > 0) visitedGalaxies[sc.superclusterSeed] = galaxySeeds;
        }
        useGameStore.getState().restoreVisited(visitedSystems, visitedGalaxies);

        const lastSuperclusterSeed = settings.lastSuperclusterSeed;
        const lastGalaxySeed = settings.lastGalaxySeed;
        const lastSystemId = settings.lastSystemId;

        useGameStore.getState().restoreSupercluster(lastSuperclusterSeed);
        useGameStore.setState((state) => ({
          supercluster: {
            ...state.supercluster,
            dots: state.supercluster.dots.map((d) =>
              d.seed === lastGalaxySeed ? { ...d, current: true } : d.current ? { ...d, current: false } : d,
            ),
          },
        }));

        useGameStore.getState().restoreGalaxyAndSystem(lastGalaxySeed, lastSystemId);

        const restoredSystem = useGameStore.getState().system;
        const restoredView = settings.lastView === 'system' && restoredSystem === null
          ? 'galaxy'
          : settings.lastView;
        useUIStore.setState({ view: restoredView, address: settings.address });

        useAuthStore.setState({ user, loading: false, settingsLoaded: true });
      } catch (err) {
        console.error('Auth init failed:', err);
        useAuthStore.setState({ user, loading: false, settingsLoaded: false });
      }
    } else {
      cancelDeathSequence();
      useAuthStore.setState({ user: null, loading: false, settingsLoaded: false });
    }
  });
}
