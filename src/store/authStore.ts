import { create } from 'zustand';
import { signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/firebase';
import { initUserDoc } from '../firebase/userDoc';
import { loadAllDiscoveries } from '../firebase/discoveries';
import { useUIStore } from './uiStore';
import { useCodexStore } from './codexStore';
import { useGameStore } from './gameStore';

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
      const [settings, discoveries] = await Promise.all([
        initUserDoc(user),
        loadAllDiscoveries(user.uid),
      ]);
      useUIStore.setState({
        showHyperlanes: settings.showHyperlanes,
        showOrbitRings: settings.showOrbitRings,
        showAttractorLabels: settings.showAttractorLabels,
      });
      useCodexStore.getState().setAll(discoveries);

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

      useAuthStore.setState({ user, loading: false, settingsLoaded: true });
    } else {
      useAuthStore.setState({ user: null, loading: false, settingsLoaded: false });
    }
  });
}
