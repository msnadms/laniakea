import { useEffect, useRef, useState } from 'react';
import './BootSequence.css';

const LINES = [
  'Alcubierre drive disengaged...',
  'Exiting warp. Calibrating systems...',
  'All systems nominal.',
];
const LINES_INIT = [
  'Humanity realized Alcubierre Drives in the year 2077 CE, when dark matter was discovered in Neptune\'s atmosphere.',
  'In 2087 CE, Earth was atomized. Estimated casualties: 23 billion.',
  'The axioms, in retrospect, are inescapable. Any civilization capable of interstellar travel is also capable of destroying what it finds when it arrives.',
  'The only rational action is a preemptive strike.'
];
const CHAR_MS = 42;
const MID_PERIOD_MS = 1000;
const LINE_PAUSE_MS = 2000;
const LINGER_MS = 900;
const FADE_MS = 700;
const CLEAR_PAUSE_MS = 1200;

export function BootSequence({ onComplete, isFirstVisit }: { onComplete: () => void; isFirstVisit?: boolean }) {
  const [typed, setTyped] = useState<string[]>([]);
  const [phase, setPhase] = useState<'init' | 'main'>(isFirstVisit ? 'init' : 'main');
  const [exiting, setExiting] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let lineIdx = 0;
    let charIdx = 0;
    let timer: ReturnType<typeof setTimeout>;

    const typeLines = (lines: string[], onDone: () => void) => {
      lineIdx = 0;
      charIdx = 0;
      const tick = () => {
        if (lineIdx >= lines.length) {
          onDone();
          return;
        }
        const li = lineIdx;
        const line = lines[li];
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
          const delay = line[ci - 1] === '.' && line[ci] === ' ' ? MID_PERIOD_MS : CHAR_MS;
          timer = setTimeout(tick, delay);
        }
      };
      tick();
    };

    const startMain = () => {
      setPhase('main');
      setTyped([]);
      typeLines(LINES, () => {
        timer = setTimeout(() => {
          setExiting(true);
          setTimeout(() => onCompleteRef.current(), FADE_MS);
        }, LINGER_MS);
      });
    };

    if (isFirstVisit) {
      timer = setTimeout(() => {
        typeLines(LINES_INIT, () => {
          timer = setTimeout(() => {
            timer = setTimeout(startMain, 300);
          }, CLEAR_PAUSE_MS);
        });
      }, 500);
    } else {
      timer = setTimeout(startMain, 500);
    }

    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeLines = phase === 'init' ? LINES_INIT : LINES;
  const doneTyping = typed.length === activeLines.length && typed[activeLines.length - 1] === activeLines[activeLines.length - 1];

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
