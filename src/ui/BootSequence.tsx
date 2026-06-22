import { useEffect, useRef, useState } from 'react';
import './BootSequence.css';

const LINES = [
  'Alcubierre drive disengaged...',
  'Exiting warp. Calibrating systems...',
  'All systems nominal.',
];
const CHAR_MS = 42;
const LINE_PAUSE_MS = 2000;
const LINGER_MS = 900;
const FADE_MS = 700;

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  const [typed, setTyped] = useState<string[]>([]);
  const [exiting, setExiting] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let lineIdx = 0;
    let charIdx = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (lineIdx >= LINES.length) {
        timer = setTimeout(() => {
          setExiting(true);
          setTimeout(() => onCompleteRef.current(), FADE_MS);
        }, LINGER_MS);
        return;
      }

      const li = lineIdx;
      const line = LINES[li];
      charIdx++;
      const ci = charIdx;

      setTyped(prev => {
        const next = [...prev];
        if (next.length <= li) next.push('');
        next[li] = line.slice(0, ci);
        return next;
      });

      if (ci >= line.length) {
        lineIdx++;
        charIdx = 0;
        timer = setTimeout(tick, LINE_PAUSE_MS);
      } else {
        timer = setTimeout(tick, CHAR_MS);
      }
    };

    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, []);

  const doneTyping = typed.length === LINES.length && typed[LINES.length - 1] === LINES[LINES.length - 1];

  return (
    <div className={`boot-overlay${exiting ? ' boot-overlay--exit' : ''}`}>
      <div className="boot-lines">
        {typed.map((text, i) => {
          const isActive = i === typed.length - 1 && !doneTyping;
          return (
            <div key={i} className="boot-line">
              {text}
              {isActive && <span className="boot-cursor" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
