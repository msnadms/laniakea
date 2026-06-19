import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { saveUserSettings } from '../firebase/userDoc';

export function useSettingsPersist() {
  const user = useAuthStore((s) => s.user);
  const settingsLoaded = useAuthStore((s) => s.settingsLoaded);
  const showHyperlanes = useUIStore((s) => s.showHyperlanes);
  const showOrbitRings = useUIStore((s) => s.showOrbitRings);
  const showAttractorLabels = useUIStore((s) => s.showAttractorLabels);
  const showHUD = useUIStore((s) => s.showHUD);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const driveIntegrity = useUIStore((s) => s.driveIntegrity);
  const railgunAmmo = useUIStore((s) => s.railgunAmmo);

  useEffect(() => {
    if (!user || !settingsLoaded) return;
    saveUserSettings(user.uid, { showHyperlanes, showOrbitRings, showAttractorLabels, showHUD, exoticMatter, driveIntegrity, railgunAmmo });
  }, [user, settingsLoaded, showHyperlanes, showOrbitRings, showAttractorLabels, showHUD, exoticMatter, driveIntegrity, railgunAmmo]);
}
