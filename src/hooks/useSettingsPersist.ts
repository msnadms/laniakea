import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { saveUserSettings } from '../firebase/userDoc';

export function useSettingsPersist() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const unsubscribe = useUIStore.subscribe((state) => {
      const { user, settingsLoaded } = useAuthStore.getState();
      if (!user || !settingsLoaded) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveUserSettings(user.uid, {
          showOrbitRings: state.showOrbitRings,
          showAttractorLabels: state.showAttractorLabels,
          showHUD: state.showHUD,
          exoticMatter: state.exoticMatter,
          driveIntegrity: state.driveIntegrity,
          railgunAmmo: state.railgunAmmo,
          helium3Reserves: state.helium3Reserves,
        });
      }, 2000);
    });

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
}
