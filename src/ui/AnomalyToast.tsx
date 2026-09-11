import { useEffect } from 'react';
import { ANOMALY_LORE } from '../game/anomalyLore';
import { anomalyRecordKey } from '../firebase/anomalies';
import { useAnomalyStore } from '../store/anomalyStore';
import './AnomalyToast.css';

const TOAST_DURATION_MS = 5000;

export function AnomalyToast() {
  const latest = useAnomalyStore((s) => s.latest);
  const dismissLatest = useAnomalyStore((s) => s.dismissLatest);

  useEffect(() => {
    if (!latest) return;
    const timer = window.setTimeout(dismissLatest, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [latest, dismissLatest]);

  if (!latest) return null;
  const lore = ANOMALY_LORE[latest.kind];

  return (
    <div
      key={`${anomalyRecordKey(latest.galaxySeed, latest.systemId)}-${latest.discoveredAt}`}
      className="anomaly-toast"
      role="status"
      style={{ animationDuration: `${TOAST_DURATION_MS}ms` }}
    >
      <span className="anomaly-toast-rule" />
      <span className="anomaly-toast-label">Anomaly Catalogued</span>
      <span className="anomaly-toast-sep">▸</span>
      <span className={`anomaly-toast-name anomaly-tier-${lore.tier.toLowerCase()}`}>{lore.name}</span>
      <span className="anomaly-toast-rule" />
    </div>
  );
}
