import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import './ConfigPanel.css';

export function ConfigPanel({ hidden }: { hidden?: boolean }) {
  if (hidden) return null;
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [tutorialExpanded, setTutorialExpanded] = useState(false);
  const showAttractorLabels = useUIStore((s) => s.showAttractorLabels);
  const toggleAttractorLabels = useUIStore((s) => s.toggleAttractorLabels);
  const showOrbitRings = useUIStore((s) => s.showOrbitRings);
  const toggleOrbitRings = useUIStore((s) => s.toggleOrbitRings);
  const showHUD = useUIStore((s) => s.showHUD);
  const toggleHUD = useUIStore((s) => s.toggleHUD);
  const refillResources = useUIStore((s) => s.refillResources);
  const resetUpgrades = useUIStore((s) => s.resetUpgrades);
  const infiniteExplore = useUIStore((s) => s.infiniteExplore);
  const toggleInfiniteExplore = useUIStore((s) => s.toggleInfiniteExplore);
  const view = useUIStore((s) => s.view);

  return (
    <div className="config-panel">
      <button
        className="config-header"
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

        </div>
      )}
      <button className="config-header" onClick={() => setTutorialExpanded((e) => !e)}>
        <span className="config-label">Tutorial</span>
        <span className="config-chevron">{tutorialExpanded ? '▲' : '▼'}</span>
      </button>
      {tutorialExpanded && (
        <div className="config-body tutorial-body">
          <div className="tutorial-section">
            <div className="tutorial-section-title">Supercluster View</div>
            <div className="tutorial-item">Zoom in and click on a galaxy to visit it and add it to your codex. Visit a new supercluster in the settings menu, or by refreshing.</div>
          </div>
          <div className="tutorial-section">
            <div className="tutorial-section-title">Galaxy View</div>
            <div className="tutorial-item">Click on a star to visit it and add it to your codex.</div>
          </div>
          <div className="tutorial-section">
            <div className="tutorial-section-title">Codex</div>
            <div className="tutorial-item">Click the travel button to go to any visited supercluster, galaxy, or system. Remove destinations from your codex with forget mode.</div>
          </div>
          <div className="tutorial-section">
            <div className="tutorial-section-title">Resources</div>
            <div className="tutorial-item">Manage your <a href="https://en.wikipedia.org/wiki/Exotic_matter" target="_blank" rel="noopener noreferrer">exotic matter</a> reserves, <a href="https://en.wikipedia.org/wiki/Alcubierre_drive" target="_blank" rel="noopener noreferrer">Alcubierre drive</a> integrity, Railgun ammo, and Helium-3 reserves to travel and explore the universe.</div>
          </div>
          <div className="tutorial-section">
            <div className="tutorial-section-title">Extraction</div>
            <div className="tutorial-item">Build extraction stations on planets to gather alloys, nutrients, exotic matter, and Helium-3.</div>
          </div>
        </div>
      )}
    </div>
  );
}
