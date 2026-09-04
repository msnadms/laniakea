import { memo, useCallback, useEffect, useState } from 'react';
import { PixiApp } from './pixi/PixiApp';
import { ConfigPanel } from './ui/ConfigPanel';
import { useUIStore } from './store/uiStore';
import { useGameStore } from './store/gameStore';
import { generateGalaxyName } from './game/superclusters';
import { GALAXY_TYPE_LABELS } from './game/types';
import './App.css';
import { AuthButton } from './ui/AuthButton';
import { ShipHUD } from './ui/ShipHUD';
import { PlanetPanel } from './ui/PlanetPanel';
import { useSettingsPersist } from './hooks/useSettingsPersist';
import { useQuestPersist } from './hooks/useQuestPersist';
import { initAuth, useAuthStore } from './store/authStore';
import { InfoPanel } from './ui/InfoPanel';
import { BootSequence } from './ui/BootSequence';
import { LoginScreen } from './ui/LoginScreen';
import { TopNavBar } from './ui/TopNavBar';
import { DeathOverlay } from './ui/DeathOverlay';
import { consumeFirstVisit } from './lib/firstVisit';

const COORD_TYPES = new Set(['supercluster', 'galaxy', 'system']);

const ViewTitle = memo(function ViewTitle() {
  const view = useUIStore((s) => s.view);
  const supercluterName = useGameStore((s) => s.supercluster.name);
  const galaxyName = useGameStore((s) => generateGalaxyName(s.galaxy.seed));
  const galaxyType = useGameStore((s) => s.galaxy.config.type);
  const systemName = useGameStore((s) => s.system?.name ?? null);

  const title =
    view === 'supercluster' ? supercluterName :
    view === 'galaxy' ? galaxyName :
    systemName;

  if (!title) return null;
  return (
    <div className="galaxy-title">
      {title}
      {view === 'galaxy' && <div className="galaxy-title-sub">{GALAXY_TYPE_LABELS[galaxyType]}</div>}
    </div>
  );
});

function AddressBar() {
  const address = useUIStore((s) => s.address);
  const coords = address
    .filter((s) => COORD_TYPES.has(s.type))
    .map((s) => { const z = Math.round(s.z); return `${Math.round(s.x)}.${Math.round(s.y)}${z !== 0 ? `.${z}` : ''}`; })
    .join(':');
  return (
    <div className="hud-address-bar">
      <div className="hud-address-breadcrumb">
        {address.map((segment, i) => (
          <span key={i}>
            {i > 0 && <span className="hud-address-sep">›</span>}
            <span className={`hud-address-seg${i === address.length - 1 ? ' hud-address-seg--current' : ''}`}>
              {segment.name}
            </span>
          </span>
        ))}
      </div>
      {coords && <div className="hud-address-coords">{coords}</div>}
    </div>
  );
}

export default function App() {
  useSettingsPersist();
  useQuestPersist();
  useEffect(() => initAuth(), []);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const view = useUIStore((s) => s.view);
  const showHUD = useUIStore((s) => s.showHUD);
  const showScanlines = useUIStore((s) => s.showScanlines);
  const [infoOpen, setInfoOpen] = useState(false);
  const showBoot = useUIStore((s) => s.showBootSequence);
  const [isFirstVisit] = useState(consumeFirstVisit);

  const handleBootComplete = useCallback(() => {
    if (isFirstVisit) setInfoOpen(true);
  }, [isFirstVisit]);

  if (authLoading || !user) return <LoginScreen />;

  return (
    <div className="app">
      <PixiApp />
      {showScanlines && <div className="app-scanlines" />}
      {showBoot && <BootSequence onComplete={handleBootComplete} isFirstVisit={isFirstVisit} />}
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
      {showHUD && <AddressBar />}
      <ViewTitle />
      {view === 'system' && <PlanetPanel />}
      <DeathOverlay />
    </div>
  );
}
