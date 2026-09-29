import { useEffect } from 'react';
import { getAnomalyLore } from '../game/anomalyLore';
import { anomalyRecordKey } from '../game/anomalyRecord';
import { useAnomalyStore } from '../store/anomalyStore';
import './AnomalyToast.css';

const TOAST_DURATION_MS = 5000;

export function AnomalyToast() {
  const latest = useAnomalyStore((s) => s.latest);
  const awarded = useAnomalyStore((s) => s.latestAwarded);
  const technology = useAnomalyStore((s) => s.latestTechnology);
  const dismissLatest = useAnomalyStore((s) => s.dismissLatest);

  useEffect(() => {
    if (!latest) return;
    const timer = window.setTimeout(dismissLatest, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [latest, dismissLatest]);

  if (!latest) return null;
  const lore = getAnomalyLore(latest);

  return (
    <div
      key={`${anomalyRecordKey(latest.superclusterSeed, latest.galaxySeed, latest.systemId)}-${latest.discoveredAt}`}
      className={`anomaly-toast${latest.living ? ' anomaly-toast--living' : ''}`}
      role="status"
      style={{ animationDuration: `${TOAST_DURATION_MS}ms` }}
    >
      <span className="anomaly-toast-rule" />
      <span className="anomaly-toast-label">{latest.living ? 'Signal Detected' : 'Anomaly Catalogued'}</span>
      <span className="anomaly-toast-sep">▸</span>
      <span className={`anomaly-toast-name anomaly-tier-${lore.tier.toLowerCase()}`}>{lore.name}</span>
      {awarded > 0 && (
        <>
          <span className="anomaly-toast-sep">▸</span>
          <span className="anomaly-toast-gain">+{awarded} negative-energy condensate</span>
        </>
      )}
      {technology > 0 && (
        <>
          <span className="anomaly-toast-sep">▸</span>
          <span className="anomaly-toast-gain">+{technology} advanced technology</span>
        </>
      )}
      <span className="anomaly-toast-rule" />
    </div>
  );
}
