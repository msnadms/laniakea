import { useEffect } from 'react';
import { useDispatchNotifyStore } from '../store/dispatchNotifyStore';
import { useUIStore } from '../store/uiStore';
import { useExtractorStore } from '../store/extractorStore';
import { buildDispatchLines } from './dispatchLines';
import './DispatchNotifyHUD.css';

const DISPLAY_MS = 4000;

export function DispatchNotifyHUD() {
  const current = useDispatchNotifyStore((s) => s.queue[0] ?? null);
  const shift = useDispatchNotifyStore((s) => s.shiftDispatchNotification);
  const panelOpen = useUIStore((s) => s.logisticsPanelOpen);
  const extractors = useExtractorStore((s) => s.extractors);

  useEffect(() => {
    if (!current || panelOpen) return;
    const t = setTimeout(shift, DISPLAY_MS);
    return () => clearTimeout(t);
  }, [current, panelOpen, shift]);

  if (!current || panelOpen) return null;

  const lines = buildDispatchLines(current.result, current.cost, extractors);
  if (lines.length === 0) return null;

  return (
    <div className="dispatch-notify-hud" key={current.id}>
      <div className="dispatch-notify-head">
        <span className="dispatch-notify-title">{current.routeName}</span>
        <span className="dispatch-notify-sub">Dispatched</span>
      </div>
      <div className="dispatch-notify-lines">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`dispatch-notify-line${l.isCost ? ' dispatch-notify-line--cost' : ' dispatch-notify-line--collect'}`}
          >
            <span className="dispatch-notify-sign">{l.isCost ? '−' : '+'}</span>
            <span className="dispatch-notify-text">{l.text.replace(/^[-+]/, '')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
