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
          showBootSequence: s.showBootSequence,
          infiniteExplore: s.infiniteExplore,
          exoticMatter: s.exoticMatter,
          detectionRating: s.detectionRating,
          railgunAmmo: s.railgunAmmo,
          helium3Reserves: s.helium3Reserves,
          alloys: s.alloys,
          nutrients: s.nutrients,
          metallicHydrogen: s.metallicHydrogen,
          neutronMatter: s.neutronStarMatter,
          storageA: s.storageA,
          storageB: s.storageB,
          driveA: s.driveA,
          driveB: s.driveB,
          weaponA: s.weaponA,
          weaponB: s.weaponB,
          logisticsA: s.logisticsA,
          logisticsB: s.logisticsB,
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
