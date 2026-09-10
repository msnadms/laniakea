import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { saveUserSettings } from '../firebase/userDoc';
import { saveNav } from '../lib/navLocalStorage';

export function useSettingsPersist() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const save = () => {
      // Synchronous localStorage write so a refresh within the 2s Firebase
      // debounce window still restores the correct location.
      const auth = useAuthStore.getState();
      if (auth.user && auth.settingsLoaded) {
        const s = useUIStore.getState();
        const g = useGameStore.getState();
        saveNav(auth.user.uid, {
          lastView: s.view,
          lastSuperclusterSeed: g.supercluster.seed,
          lastGalaxySeed: g.galaxy.seed,
          lastSystemId: g.system?.id ?? null,
          address: s.address,
        });
      }

      clearTimeout(timer);
      timer = setTimeout(() => {
        const { user, settingsLoaded } = useAuthStore.getState();
        if (!user || !settingsLoaded) return;
        const s = useUIStore.getState();
        const g = useGameStore.getState();
        saveUserSettings(user.uid, {
          showOrbitRings: s.showOrbitRings,
          showAttractorLabels: s.showAttractorLabels,
          showHUD: s.showHUD,
          lastView: s.view,
          lastSuperclusterSeed: g.supercluster.seed,
          lastGalaxySeed: g.galaxy.seed,
          lastSystemId: g.system?.id ?? null,
          address: s.address,
        });
      }, 2000);
    };

    const unsubUI = useUIStore.subscribe(save);
    const unsubGame = useGameStore.subscribe(save);

    return () => {
      unsubUI();
      unsubGame();
      clearTimeout(timer);
    };
  }, []);
}
