import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { saveUserSettings } from '../firebase/userDoc';

export function useSettingsPersist() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const save = () => {
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
          infiniteExplore: s.infiniteExplore,
          exoticMatter: s.exoticMatter,
          driveIntegrity: s.driveIntegrity,
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
