import { useEffect } from 'react';
import { PixiApp } from './pixi/PixiApp';
import { ConfigPanel } from './ui/ConfigPanel';
import { useUIStore } from './store/uiStore';
import { useGameStore } from './store/gameStore';
import { generateGalaxyName } from './game/superclusters';
import './App.css';
import { AuthButton } from './ui/AuthButton';
import { ShipHUD } from './ui/ShipHUD';
import { useSettingsPersist } from './hooks/useSettingsPersist';
import { initAuth } from './store/authStore';

const COORD_TYPES = new Set(['supercluster', 'galaxy', 'system']);

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
  useEffect(() => initAuth(), []);
  const view = useUIStore((s) => s.view);
  const showHUD = useUIStore((s) => s.showHUD);
  const galaxySeed = useGameStore((s) => s.galaxy.seed);

  return (
    <div className="app">
      <PixiApp />
      <div className="top-left">
        <ConfigPanel />
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
      {view === 'galaxy' && (
        <div className="galaxy-title">{generateGalaxyName(galaxySeed)}</div>
      )}
    </div>
  );
}
