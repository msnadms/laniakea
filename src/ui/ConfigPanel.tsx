import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { useScanStore } from '../store/scanStore';
import { useAuthStore } from '../store/authStore';
import { deleteScanFindings } from '../firebase/scans';
import { CONDENSATE_PER_HOMEWORLD } from '../game/constants';
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

function CondensateGrant() {
  const condensate = useScanStore((s) => s.condensate);
  const gainCondensate = useScanStore((s) => s.gainCondensate);
  return (
    <div className="config-row config-row--action">
      <span className="config-row-label">Negative-Energy Condensate</span>
      <span className="config-row-value">{condensate}</span>
      <button className="config-action" onClick={() => gainCondensate(CONDENSATE_PER_HOMEWORLD)}>
        +{CONDENSATE_PER_HOMEWORLD}
      </button>
    </div>
  );
}

function ProbeFindings() {
  const findings = useScanStore((s) => s.findings);
  const clearFindings = useScanStore((s) => s.clearFindings);
  const user = useAuthStore((s) => s.user);
  const ids = Object.keys(findings);

  const clear = () => {
    clearFindings();
    if (user && ids.length > 0) deleteScanFindings(user.uid, ids);
  };

  return (
    <div className="config-row config-row--action">
      <span className="config-row-label">Probe Findings</span>
      <span className="config-row-value">{ids.length}</span>
      <button className="config-action" onClick={ids.length > 0 ? clear : undefined} disabled={ids.length === 0}>
        Clear
      </button>
    </div>
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
          <CondensateGrant />
          <ProbeFindings />
        </div>
      )}
      <TutorialPanel />
    </div>
  );
}
