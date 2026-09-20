import { useEffect } from 'react';
import { useScanStore } from '../store/scanStore';
import { useUIStore } from '../store/uiStore';
import { SCAN_HEAT_COLORS } from '../game/constants';
import './Probes.css';

const SCAN_VIEWS = new Set(['universe', 'supercluster']);
const OUTCOME_MS = 6000;

function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

const HEAT_GRADIENT = `linear-gradient(90deg, ${SCAN_HEAT_COLORS.map(hexColor).join(', ')})`;

function HeatLegend() {
  return (
    <div className="probe-panel-legend">
      <span className="probe-panel-legend-cap">silent</span>
      <div className="probe-panel-legend-bar" style={{ background: HEAT_GRADIENT }} />
      <span className="probe-panel-legend-cap">something here</span>
    </div>
  );
}

export function ProbeButton() {
  const view = useUIStore((s) => s.view);
  const active = useScanStore((s) => s.active);
  const condensate = useScanStore((s) => s.condensate);
  const toggleActive = useScanStore((s) => s.toggleActive);
  const setActive = useScanStore((s) => s.setActive);
  const available = SCAN_VIEWS.has(view);

  useEffect(() => {
    if (!available && active) setActive(false);
  }, [available, active, setActive]);

  useEffect(() => () => useScanStore.getState().setActive(false), []);

  return (
    <button
      className={`probe-btn${available ? '' : ' probe-btn--disabled'}${active ? ' probe-btn--active' : ''}`}
      onClick={available ? toggleActive : undefined}
      aria-label="Probe sweep"
    >
      <svg className="probe-btn-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <polygon
          vectorEffect="non-scaling-stroke"
          points="0,0.1 0.61,0.1 0.95,1 0.35,1"
          fill="transparent"
          stroke="rgba(0, 190, 230, 0.55)"
          strokeWidth="1"
          pointerEvents="all"
        />
      </svg>
      <svg className="probe-btn-icon" viewBox="0 0 16 16" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <line x1="9.9" y1="9.9" x2="14" y2="14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <span className="probe-btn-count">{condensate}</span>
    </button>
  );
}

export function ProbePanel() {
  const active = useScanStore((s) => s.active);
  const condensate = useScanStore((s) => s.condensate);
  const progress = useScanStore((s) => s.progress);
  const outcome = useScanStore((s) => s.outcome);
  const clearOutcome = useScanStore((s) => s.clearOutcome);

  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(clearOutcome, OUTCOME_MS);
    return () => window.clearTimeout(timer);
  }, [outcome, clearOutcome]);

  if (!active && !progress && !outcome) return null;

  return (
    <div className="probe-panel" role="status">
      <div className="probe-panel-rule" />
      <div className="probe-panel-body">
        {progress ? (
          <div className="probe-panel-row">
            <span className="probe-panel-label">Probes away</span>
            <span className="probe-panel-value">{progress.done} / {progress.total} surveyed</span>
            <div className="probe-panel-bar">
              <div
                className="probe-panel-bar-fill"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>
        ) : outcome ? (
          <span className="probe-panel-value">{outcome.text}</span>
        ) : (
          <>
            <div className="probe-panel-row">
              <span className="probe-panel-label">Probe sweep</span>
              <span className="probe-panel-value">Drag out from a dot to aim · {condensate} negative-energy condensate held</span>
            </div>
            <HeatLegend />
          </>
        )}
      </div>
      <div className="probe-panel-rule" />
    </div>
  );
}
