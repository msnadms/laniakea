import { create } from 'zustand';
import { signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/firebase';
import { initUserDoc } from '../firebase/userDoc';
import { loadAllDiscoveries } from '../firebase/discoveries';
import { loadAnomalies } from '../firebase/anomalies';
import { useAnomalyStore } from './anomalyStore';
import { applyUserSettings, useUIStore } from './uiStore';
import { useCodexStore } from './codexStore';
import { useGameStore } from './gameStore';
import { loadNav } from '../lib/navLocalStorage';
import { getSuperclusterCoords } from '../game/superclusters';

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
        const [baseSettings, discoveries, anomalies] = await Promise.all([
          initUserDoc(user),
          loadAllDiscoveries(user.uid),
          loadAnomalies(user.uid),
        ]);
        // localStorage nav is more recent than Firebase's debounced write — prefer
        // it for galaxy/system/view when the entry is fresh (< 30s old).
        const localNav = loadNav(user.uid);
        const settings = localNav ? { ...baseSettings, ...localNav } : baseSettings;
        applyUserSettings(settings);
        useCodexStore.getState().setAll(discoveries);
        useAnomalyStore.getState().setAll(anomalies);

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

        const { lastSuperclusterSeed, lastGalaxySeed, lastSystemId } = settings;

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
        const [scX, scY, scZ] = getSuperclusterCoords(lastSuperclusterSeed);
        const address = settings.address.map((a) =>
          a.type === 'supercluster' ? { ...a, x: scX, y: scY, z: scZ } : a,
        );
        useUIStore.setState({ view: restoredView, address });

        useAuthStore.setState({ user, loading: false, settingsLoaded: true });
      } catch (err) {
        console.error('Auth init failed:', err);
        useAuthStore.setState({ user, loading: false, settingsLoaded: false });
      }
    } else {
      useAuthStore.setState({ user: null, loading: false, settingsLoaded: false });
    }
  });
}
