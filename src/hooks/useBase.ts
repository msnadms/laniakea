import { useEffect, useState } from 'react';
import { settleBase, type Base } from '../game/base';
import { useBaseStore } from '../store/baseStore';

const REFRESH_MS = 1000;

export interface LiveBase {
  base: Base;
  now: number;
}

export function useBase(): LiveBase | null {
  const base = useBaseStore((s) => s.base);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!base) return;
    const timer = window.setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [base]);
  if (!base) return null;
  const at = Math.max(now, base.settledAt);
  return { base: settleBase(base, at), now: at };
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}
