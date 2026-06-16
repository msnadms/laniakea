import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import './ConfigPanel.css';

export function ConfigPanel() {
  const [expanded, setExpanded] = useState(false);
  const showHyperlanes = useUIStore((s) => s.showHyperlanes);
  const toggleHyperlanes = useUIStore((s) => s.toggleHyperlanes);
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const seed = useGameStore((s) => s.galaxy.seed);
  const regenerateGalaxy = useGameStore((s) => s.regenerateGalaxy);
  const regenerateSupercluster = useGameStore((s) => s.regenerateSupercluster);
  const [seedInput, setSeedInput] = useState('');

  function handleSeedSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseInt(seedInput, 10);
    view == 'galaxy' ? 
      regenerateGalaxy(isNaN(parsed) ? undefined : parsed) :
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
          <div className="config-row config-row--view">
            <span className="config-row-label">View</span>
            <div className="config-view-toggle">
              <button
                className={`config-view-btn${view === 'galaxy' ? ' active' : ''}`}
                onClick={() => setView('galaxy')}
              >
                Galaxy
              </button>
              <button
                className={`config-view-btn${view === 'supercluster' ? ' active' : ''}`}
                onClick={() => setView('supercluster')}
              >
                Cluster
              </button>
            </div>
          </div>

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

          <div className="config-row config-row--seed">
            <span className="config-row-label">Seed</span>
            <form className="config-seed-form" onSubmit={handleSeedSubmit}>
              <input
                type="text"
                className="config-seed-input"
                placeholder={String(seed)}
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
              />
              <button type="submit" className="config-seed-btn">↺</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
