import { createPortal } from 'react-dom';
import type { Anomaly } from '../game/anomalies';
import { ANOMALY_LORE } from '../game/anomalyLore';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import './PlanetPanel.css';
import './AnomalyToast.css';
import './AnomalyPanel.css';

function bearing(anomaly: Anomaly): string | null {
  if (!anomaly.direction) return null;
  const degrees = (Math.atan2(anomaly.direction.y, anomaly.direction.x) * 180 / Math.PI + 360) % 360;
  return `${Math.round(degrees).toString().padStart(3, '0')}°`;
}

function AnomalyStats({ anomaly }: { anomaly: Anomaly }) {
  const heading = bearing(anomaly);
  return (
    <div className="anomaly-panel-stats">
      {anomaly.kind === 'blackHole' ? (
        <div className="anomaly-panel-stat">
          <span className="anomaly-panel-stat-label">State</span>
          <span className="anomaly-panel-stat-value">{anomaly.active ? 'Active' : 'Quiescent'}</span>
        </div>
      ) : (
        <div className="anomaly-panel-stat">
          <span className="anomaly-panel-stat-label">Integrity</span>
          <span className="anomaly-panel-stat-value">{Math.round(anomaly.integrity * 100)}%</span>
        </div>
      )}
      {heading && (
        <div className="anomaly-panel-stat">
          <span className="anomaly-panel-stat-label">{anomaly.kind === 'shkadovThruster' ? 'Heading' : 'Bearing'}</span>
          <span className="anomaly-panel-stat-value">{heading}</span>
        </div>
      )}
    </div>
  );
}

export function AnomalyPanel() {
  const open = useUIStore((s) => s.anomalyPanelOpen);
  const setOpen = useUIStore((s) => s.setAnomalyPanelOpen);
  const anomaly = useGameStore((s) => (s.system ? s.galaxyAnomalies.byHost.get(s.system.id) : undefined) ?? null);

  if (!open || !anomaly) return null;
  const lore = ANOMALY_LORE[anomaly.kind];

  return createPortal(
    <div className="planet-panel-overlay" onClick={() => setOpen(false)}>
      <div className="planet-panel anomaly-panel" onClick={(e) => e.stopPropagation()}>
        <button className="planet-panel-close" onClick={() => setOpen(false)}>✕</button>

        <div className="planet-panel-header">
          <span className={`anomaly-panel-glyph anomaly-tier-${lore.tier.toLowerCase()}`}>◬</span>
          <div>
            <div className={`planet-panel-name anomaly-tier-${lore.tier.toLowerCase()}`}>{lore.name}</div>
            <div className="planet-panel-zone">{lore.tier}</div>
          </div>
        </div>

        <AnomalyStats anomaly={anomaly} />

        <p className="anomaly-panel-lore">{lore.lore}</p>

        <div className="planet-panel-section-label">Survey Notes</div>
        <ul className="planet-panel-moons">
          {lore.notes.map((note) => (
            <li key={note} className="planet-panel-moon anomaly-panel-note">{note}</li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
