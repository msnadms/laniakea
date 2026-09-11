import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { TutorialPanel } from './TutorialPanel';
import './ConfigPanel.css';

function ConfigToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="config-row">
      <span className="config-row-label">{label}</span>
      <input
        type="checkbox"
        className="config-toggle-checkbox"
        checked={checked}
        onChange={onChange}
      />
      <div className={`config-toggle ${checked ? 'on' : 'off'}`} aria-hidden="true">
        <div className="config-toggle-thumb" />
      </div>
    </label>
  );
}

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
  const showAnomalyDebug = useUIStore((s) => s.showAnomalyDebug);
  const toggleAnomalyDebug = useUIStore((s) => s.toggleAnomalyDebug);
  const view = useUIStore((s) => s.view);

  if (hidden) return null;

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
          <ConfigToggle label="HUD" checked={showHUD} onChange={toggleHUD} />
          <ConfigToggle label="Scan Lines" checked={showScanlines} onChange={toggleScanlines} />
          {view === 'supercluster' && (
            <ConfigToggle label="Attractor Labels" checked={showAttractorLabels} onChange={toggleAttractorLabels} />
          )}
          {view === 'system' && (
            <ConfigToggle label="Orbit Rings" checked={showOrbitRings} onChange={toggleOrbitRings} />
          )}
          {view !== 'system' && (
            <ConfigToggle label="Anomaly Debug" checked={showAnomalyDebug} onChange={toggleAnomalyDebug} />
          )}
        </div>
      )}
      <TutorialPanel />
    </div>
  );
}
