import { memo, useEffect, useState } from 'react';
import { PixiApp } from './pixi/PixiApp';
import { ConfigPanel } from './ui/ConfigPanel';
import { useUIStore } from './store/uiStore';
import { useGameStore } from './store/gameStore';
import { generateGalaxyName } from './game/superclusters';
import './App.css';
import { AuthButton } from './ui/AuthButton';
import { ShipHUD } from './ui/ShipHUD';
import { PlanetPanel } from './ui/PlanetPanel';
import { useSettingsPersist } from './hooks/useSettingsPersist';
import { initAuth, useAuthStore } from './store/authStore';
import { InfoPanel } from './ui/InfoPanel';
import { LoginScreen } from './ui/LoginScreen';
import { TopNavBar } from './ui/TopNavBar';
import { AnomalyPanel } from './ui/AnomalyPanel';
import { AnomalyToast } from './ui/AnomalyToast';
import { useAnomalyWatcher } from './hooks/useAnomalyWatcher';

const ViewTitle = memo(function ViewTitle() {
  const view = useUIStore((s) => s.view);
  const superclusterName = useGameStore((s) => s.supercluster.name);
  const galaxyName = useGameStore((s) => generateGalaxyName(s.galaxy.seed));
  const systemName = useGameStore((s) => s.system?.name ?? null);

  const title =
    view === 'supercluster' ? superclusterName :
    view === 'galaxy' ? galaxyName :
    systemName;

  if (!title) return null;
  return (
    <div className="galaxy-title">
      {title}
    </div>
  );
});

export default function App() {
  useSettingsPersist();
  useAnomalyWatcher();
  useEffect(() => initAuth(), []);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const view = useUIStore((s) => s.view);
  const showHUD = useUIStore((s) => s.showHUD);
  const showScanlines = useUIStore((s) => s.showScanlines);
  const [infoOpen, setInfoOpen] = useState(false);

  if (authLoading || !user) return <LoginScreen />;

  return (
    <div className="app">
      <PixiApp />
      {showScanlines && <div className="app-scanlines" />}
      <TopNavBar />
      <InfoPanel open={infoOpen} onOpenChange={setInfoOpen} />
      <div className="top-left">
        <ConfigPanel hidden={infoOpen} />
      </div>
      <div className="top-right">
        <AuthButton />
      </div>
      {showHUD && (
        <div className="hud-wrap">
          <ShipHUD />
        </div>
      )}
      <ViewTitle />
      <AnomalyToast />
      {view === 'system' && <PlanetPanel />}
      {view === 'system' && <AnomalyPanel />}
    </div>
  );
}
