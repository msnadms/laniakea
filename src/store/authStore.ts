import { create } from 'zustand';
import { signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/firebase';
import { initUserDoc } from '../firebase/userDoc';
import { loadAllDiscoveries } from '../firebase/discoveries';
import { loadAllExtractors } from '../firebase/extractors';
import { loadAllSettlements } from '../firebase/settlements';
import { loadQuests } from '../firebase/quests';
import { loadLogisticsRoutes } from '../firebase/logisticsRoutes';
import { loadExtractorUpgrades } from '../firebase/extractorUpgrades';
import { useUIStore, computeStorageCap } from './uiStore';
import { useCodexStore } from './codexStore';
import { useGameStore } from './gameStore';
import { useExtractorStore } from './extractorStore';
import { useSettlementStore } from './settlementStore';
import { useLogisticsStore } from './logisticsStore';
import { useQuestStore } from './questStore';
import { loadNav } from '../lib/navLocalStorage';

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
      const [baseSettings, discoveries, extractors, settlements, quests, logisticsRoutes, extractorUpgrades] = await Promise.all([
        initUserDoc(user),
        loadAllDiscoveries(user.uid),
        loadAllExtractors(user.uid),
        loadAllSettlements(user.uid),
        loadQuests(user.uid),
        loadLogisticsRoutes(user.uid),
        loadExtractorUpgrades(user.uid),
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
      const cap = computeStorageCap(settings.storageA);
      useUIStore.setState({
        showOrbitRings: settings.showOrbitRings,
        showAttractorLabels: settings.showAttractorLabels,
        showHUD: settings.showHUD,
        showBootSequence: settings.showBootSequence,
        infiniteExplore: settings.infiniteExplore,
        exoticMatter: Math.min(settings.exoticMatter, cap),
        detectionRating: settings.detectionRating,
        railgunAmmo: settings.railgunAmmo,
        helium3Reserves: Math.min(settings.helium3Reserves, cap),
        alloys: Math.min(settings.alloys, cap),
        nutrients: Math.min(settings.nutrients, cap),
        metallicHydrogen: Math.min(settings.metallicHydrogen, cap),
        neutronStarMatter: Math.min(settings.neutronMatter, cap),
        storageA: settings.storageA,
        storageB: settings.storageB,
        driveA: settings.driveA,
        driveB: settings.driveB,
        weaponA: settings.weaponA,
        weaponB: settings.weaponB,
        logisticsA: settings.logisticsA,
        logisticsB: settings.logisticsB,
      });
      useExtractorStore.getState().restoreExtractors(extractors);
      useExtractorStore.getState().restoreUpgrades(extractorUpgrades.ownedUpgrades, extractorUpgrades.nodeEquipped, extractorUpgrades.pendingUpgrades ?? []);
      useSettlementStore.getState().restoreSettlements(settlements.settlements);
      useSettlementStore.getState().restoreColonyStates(settlements.colonyStates);
      useLogisticsStore.getState().restoreRoutes(logisticsRoutes);
      useCodexStore.getState().setAll(discoveries);
      useQuestStore.getState().restoreQuests(quests);

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

      useGameStore.getState().regenerateSupercluster(lastSuperclusterSeed);
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
    } else {
      useAuthStore.setState({ user: null, loading: false, settingsLoaded: false });
    }
  });
}
