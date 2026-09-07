import { useEffect, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { DEATH_SEQUENCE_MS } from '../store/resetGame';
import './DeathOverlay.css';

const LINES = [
  'A census probe reached weapons range.',
  'The Peregrine is gone.',
  '873 people. No reply.',
];

const LINE_INTERVAL_MS = DEATH_SEQUENCE_MS / (LINES.length + 1);

export function DeathOverlay() {
  const destroyed = useUIStore((s) => s.destroyed);
  if (!destroyed) return null;
  return <DeathSequence />;
}

function DeathSequence() {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    const timers = LINES.map((_, i) => setTimeout(() => setVisibleLines(i + 1), i * LINE_INTERVAL_MS));
    return () => timers.forEach((id) => clearTimeout(id));
  }, []);

  return (
    <div className="death-overlay">
      <div className="death-lines">
        {LINES.slice(0, visibleLines).map((line, i) => (
          <div key={i} className="death-line">{line}</div>
        ))}
      </div>
    </div>
  );
}
