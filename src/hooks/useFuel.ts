import { useEffect, useState } from 'react';
import { useFuelStore } from '../store/fuelStore';
import { useScanStore } from '../store/scanStore';
import { fuelNow } from '../net/ship';

const REFRESH_MS = 500;

export function formatCondensate(value: number): string {
  return (Math.floor(value * 10) / 10).toFixed(1);
}

export function useFuel(): number {
  const [, setTick] = useState(0);
  useScanStore((s) => s.condensate);
  useFuelStore((s) => s.ship);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  return fuelNow();
}
