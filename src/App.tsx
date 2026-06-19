import { useEffect } from 'react';
import { GalaxyStage } from './pixi/GalaxyStage';
import { Supercluster } from './pixi/Supercluster';
import { ConfigPanel } from './ui/ConfigPanel';
import { useUIStore } from './store/uiStore';
import { useGameStore } from './store/gameStore';
import { generateGalaxyName } from './game/superclusters';
import './App.css';
import { Address } from './ui/Address';
import { SolarSystemStage } from './pixi/SolarSystem';
import { AuthButton } from './ui/AuthButton';
import { Codex } from './ui/Codex';
import { useSettingsPersist } from './hooks/useSettingsPersist';
import { initAuth } from './store/authStore';

export default function App() {
  useSettingsPersist();
  useEffect(() => initAuth(), []);
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const popAddress = useUIStore((s) => s.popAddress);
  const removeAddressType = useUIStore((s) => s.removeAddressType);
  const galaxySeed = useGameStore((s) => s.galaxy.seed);
  const setSystem = useGameStore((s) => s.setSystem);

  return (
    <div className="app">
      {view === 'galaxy' && (<GalaxyStage />)}
      {view === 'supercluster' && (<Supercluster />)}
      {view === 'system' && (<SolarSystemStage />)}
      <div className="top-left">
        {view === 'system' && (
          <button className="back-btn" onClick={() => { removeAddressType('system'); setSystem(null); setView('galaxy'); }}>
            ← Galaxy
          </button>
        )}
        {view === 'galaxy' && (
          <button className="back-btn" onClick={() => { popAddress(); removeAddressType('attractor'); setView('supercluster'); }}>
            ← Supercluster
          </button>
        )}
        <ConfigPanel />
        <Codex />
      </div>
      <div className="top-right">
        <AuthButton />
      </div>
      <Address />
      {view === 'galaxy' && (
        <div className="galaxy-title">{generateGalaxyName(galaxySeed)}</div>
      )}
    </div>
  );
}
