import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { useStockpileStore } from '../store/stockpileStore';
import { saveStockpile } from '../firebase/stockpile';
import { RARE_RESOURCES } from '../data/rareResources';
import { CRAFT_MATERIALS } from '../data/materials';
import { TutorialPanel } from './TutorialPanel';
import './ConfigPanel.css';

export function ConfigPanel({ hidden }: { hidden?: boolean }) {
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const showAttractorLabels = useUIStore((s) => s.showAttractorLabels);
  const toggleAttractorLabels = useUIStore((s) => s.toggleAttractorLabels);
  const showOrbitRings = useUIStore((s) => s.showOrbitRings);
  const toggleOrbitRings = useUIStore((s) => s.toggleOrbitRings);
  const showHUD = useUIStore((s) => s.showHUD);
  const toggleHUD = useUIStore((s) => s.toggleHUD);
  const showScanlines = useUIStore((s) => s.showScanlines);
  const toggleScanlines = useUIStore((s) => s.toggleScanlines);
  const showBootSequence = useUIStore((s) => s.showBootSequence);
  const toggleBootSequence = useUIStore((s) => s.toggleBootSequence);
  const refillResources = useUIStore((s) => s.refillResources);
  const resetUpgrades = useUIStore((s) => s.resetUpgrades);
  const infiniteExplore = useUIStore((s) => s.infiniteExplore);
  const toggleInfiniteExplore = useUIStore((s) => s.toggleInfiniteExplore);
  const view = useUIStore((s) => s.view);
  const user = useAuthStore((s) => s.user);

  if (hidden) return null;

  function giveAdvancedResources() {
    const { addRare, addMaterial } = useStockpileStore.getState();
    for (const rare of RARE_RESOURCES) addRare(rare.id, 1);
    for (const material of CRAFT_MATERIALS.filter((m) => m.tier === 2)) addMaterial(material.id, 1);
    if (user) {
      const { materials, rares } = useStockpileStore.getState();
      saveStockpile(user.uid, materials, rares);
    }
  }

  return (
    <div className="config-panel">
      <button
        className={`config-header${settingsExpanded ? ' config-header--open' : ''}`}
        onClick={() => setSettingsExpanded((e) => !e)}
        title="Settings"
      >
        <span className="config-icon">⚙</span>
        <span className="config-label">Settings</span>
        <span className="config-chevron">{settingsExpanded ? '▲' : '▼'}</span>
      </button>
      
      {settingsExpanded && (
        <div className="config-body">
          <label className="config-row">
            <span className="config-row-label">Ship HUD</span>
            <input
              type="checkbox"
              className="config-toggle-checkbox"
              checked={showHUD}
              onChange={toggleHUD}
            />
            <div className={`config-toggle ${showHUD ? 'on' : 'off'}`} aria-hidden="true">
              <div className="config-toggle-thumb" />
            </div>
          </label>

          <label className="config-row">
            <span className="config-row-label">Scan Lines</span>
            <input
              type="checkbox"
              className="config-toggle-checkbox"
              checked={showScanlines}
              onChange={toggleScanlines}
            />
            <div className={`config-toggle ${showScanlines ? 'on' : 'off'}`} aria-hidden="true">
              <div className="config-toggle-thumb" />
            </div>
          </label>

          <label className="config-row">
            <span className="config-row-label">Boot Sequence</span>
            <input
              type="checkbox"
              className="config-toggle-checkbox"
              checked={showBootSequence}
              onChange={toggleBootSequence}
            />
            <div className={`config-toggle ${showBootSequence ? 'on' : 'off'}`} aria-hidden="true">
              <div className="config-toggle-thumb" />
            </div>
          </label>

          {view === 'supercluster' && (
            <label className="config-row">
              <span className="config-row-label">Attractor Labels</span>
              <input
                type="checkbox"
                className="config-toggle-checkbox"
                checked={showAttractorLabels}
                onChange={toggleAttractorLabels}
              />
              <div className={`config-toggle ${showAttractorLabels ? 'on' : 'off'}`} aria-hidden="true">
                <div className="config-toggle-thumb" />
              </div>
            </label>
          )}

          {view === 'system' && (
            <label className="config-row">
              <span className="config-row-label">Orbit Rings</span>
              <input
                type="checkbox"
                className="config-toggle-checkbox"
                checked={showOrbitRings}
                onChange={toggleOrbitRings}
              />
              <div className={`config-toggle ${showOrbitRings ? 'on' : 'off'}`} aria-hidden="true">
                <div className="config-toggle-thumb" />
              </div>
            </label>
          )}

          <label className="config-row">
            <span className="config-row-label">Infinite Explore</span>
            <input
              type="checkbox"
              className="config-toggle-checkbox"
              checked={infiniteExplore}
              onChange={toggleInfiniteExplore}
            />
            <div className={`config-toggle ${infiniteExplore ? 'on' : 'off'}`} aria-hidden="true">
              <div className="config-toggle-thumb" />
            </div>
          </label>

          <div className="config-row config-row--seed">
            <span className="config-row-label">Refill Reserves</span>
            <button className="config-refill-btn" onClick={refillResources} title="Reset exotic matter and helium-3 to full">↑</button>
          </div>

          <div className="config-row config-row--seed">
            <span className="config-row-label">Reset Upgrades</span>
            <button className="config-refill-btn" onClick={resetUpgrades} title="Set all upgrade levels to 0">↺</button>
          </div>

          <div className="config-row config-row--seed">
            <span className="config-row-label">Advanced Resources</span>
            <button className="config-refill-btn" onClick={giveAdvancedResources} title="Add one of every engineered material and rare assembly to the stockpile">+</button>
          </div>

        </div>
      )}
      <TutorialPanel />
    </div>
  );
}
