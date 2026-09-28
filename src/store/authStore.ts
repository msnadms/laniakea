import { create } from 'zustand';
import { signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/firebase';
import { initUserDoc } from '../firebase/userDoc';
import { loadAllDiscoveries } from '../firebase/discoveries';
import { loadAnomalies } from '../firebase/anomalies';
import { subscribeScanFindings } from '../firebase/scans';
import { useScanStore } from './scanStore';
import { useAnomalyStore } from './anomalyStore';
import { applyUserSettings, useUIStore } from './uiStore';
import { useCodexStore } from './codexStore';
import { useGameStore } from './gameStore';
import { loadNav } from '../lib/navLocalStorage';
import { getSuperclusterCoords } from '../game/universe';
import { subscribeLedger } from '../firebase/ledger';
import { api } from '../net/api';

interface AuthState {
  user: User | null;
  explorerName: string | null;
  needsExplorerName: boolean;
  loading: boolean;
  settingsLoaded: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(() => ({
  user: null,
  explorerName: null,
  needsExplorerName: false,
  loading: true,
  settingsLoaded: false,
  signIn: async () => {
    await signInWithPopup(auth, googleProvider);
  },
  signOut: async () => {
    await signOut(auth);
  },
}));

function watchServerState(uid: string): () => void {
  api<{ condensate: number }>('/ledger')
    .then(({ condensate }) => useScanStore.getState().setCondensate(condensate))
    .catch((err) => console.error('ledger failed:', err));
  const unsubscribeLedger = subscribeLedger(uid, (condensate) => useScanStore.getState().setCondensate(condensate));
  const unsubscribeScans = subscribeScanFindings(uid, (findings) => useScanStore.getState().setAllFindings(findings));
  return () => {
    unsubscribeLedger();
    unsubscribeScans();
  };
}

let pendingRestore: (() => void) | null = null;

export async function chooseExplorerName(value: string): Promise<void> {
  const { explorerName } = await api<{ explorerName: string }>('/profile', { explorerName: value });
  useAuthStore.setState({ explorerName, needsExplorerName: false });
  const restore = pendingRestore;
  pendingRestore = null;
  restore?.();
}

// Call once from App on mount. Returns the Firebase unsubscribe function.
export function initAuth(): () => void {
  let unsubscribeServerState: (() => void) | null = null;
  const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
    unsubscribeServerState?.();
    unsubscribeServerState = null;
    pendingRestore = null;
    if (user) {
      unsubscribeServerState = watchServerState(user.uid);
      try {
        const [userDoc, discoveries, anomalies] = await Promise.all([
          initUserDoc(user),
          loadAllDiscoveries(user.uid),
          loadAnomalies(user.uid),
        ]);
        // localStorage nav is more recent than Firebase's debounced write — prefer
        // it for galaxy/system/view when the entry is fresh (< 30s old).
        const localNav = loadNav(user.uid);
        const settings = localNav ? { ...userDoc.settings, ...localNav } : userDoc.settings;
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

        const restore = () => {
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
          useAuthStore.setState({ settingsLoaded: true });
        };

        if (userDoc.explorerName) restore();
        else pendingRestore = restore;
        useAuthStore.setState({ user, explorerName: userDoc.explorerName, needsExplorerName: !userDoc.explorerName, loading: false });
      } catch (err) {
        console.error('Auth init failed:', err);
        useAuthStore.setState({ user, loading: false, settingsLoaded: false });
      }
    } else {
      useAuthStore.setState({ user: null, explorerName: null, needsExplorerName: false, loading: false, settingsLoaded: false });
    }
  });
  return () => {
    unsubscribeAuth();
    unsubscribeServerState?.();
  };
}
