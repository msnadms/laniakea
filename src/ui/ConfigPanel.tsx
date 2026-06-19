import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import './ConfigPanel.css';

export function ConfigPanel() {
  const [expanded, setExpanded] = useState(false);
  const showHyperlanes = useUIStore((s) => s.showHyperlanes);
  const toggleHyperlanes = useUIStore((s) => s.toggleHyperlanes);
  const showAttractorLabels = useUIStore((s) => s.showAttractorLabels);
  const toggleAttractorLabels = useUIStore((s) => s.toggleAttractorLabels);
  const showOrbitRings = useUIStore((s) => s.showOrbitRings);
  const toggleOrbitRings = useUIStore((s) => s.toggleOrbitRings);
  const showHUD = useUIStore((s) => s.showHUD);
  const toggleHUD = useUIStore((s) => s.toggleHUD);
  const view = useUIStore((s) => s.view);
  const scSeed = useGameStore((s) => s.supercluster.seed);
  const regenerateSupercluster = useGameStore((s) => s.regenerateSupercluster);
  const [seedInput, setSeedInput] = useState('');

  function handleSeedSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseInt(seedInput, 10);
    regenerateSupercluster(isNaN(parsed) ? undefined : parsed);
    setSeedInput('');
  }

  return (
    <div className="config-panel">
      <button
        className="config-header"
        onClick={() => setExpanded((e) => !e)}
        title="Settings"
      >
        <span className="config-icon">⚙</span>
        <span className="config-label">Settings</span>
        <span className="config-chevron">{expanded ? '▲' : '▼'}</span>
      </button>
      
      {expanded && (
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

          {view === 'galaxy' && (
            <label className="config-row">
              <span className="config-row-label">Hyperlanes</span>
              <input
                type="checkbox"
                className="config-toggle-checkbox"
                checked={showHyperlanes}
                onChange={toggleHyperlanes}
              />
              <div className={`config-toggle ${showHyperlanes ? 'on' : 'off'}`} aria-hidden="true">
                <div className="config-toggle-thumb" />
              </div>
            </label>
          )}

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

          {view === 'supercluster' && (
            <div className="config-row config-row--seed">
              <span className="config-row-label">Seed</span>
              <form className="config-seed-form" onSubmit={handleSeedSubmit}>
                <input
                  type="text"
                  className="config-seed-input"
                  placeholder={String(scSeed)}
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                />
                <button type="submit" className="config-seed-btn">↺</button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
