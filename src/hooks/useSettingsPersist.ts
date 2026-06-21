import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { saveUserSettings } from '../firebase/userDoc';

export function useSettingsPersist() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const unsubscribe = useUIStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { user, settingsLoaded } = useAuthStore.getState();
        if (!user || !settingsLoaded) return;
        const s = useUIStore.getState();
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
          storageA: s.storageA,
          storageB: s.storageB,
          driveA: s.driveA,
          driveB: s.driveB,
          weaponA: s.weaponA,
          weaponB: s.weaponB,
          logisticsA: s.logisticsA,
          logisticsB: s.logisticsB,
        });
      }, 2000);
    });

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
}
