import { useEffect } from 'react';
import { useFuelStore } from '../store/fuelStore';
import { useUIStore } from '../store/uiStore';
import { harvestPerHour, travelReach } from '../game/fuel';
import { FUEL_HARVEST_CAP } from '../game/constants';
import { formatCondensate, useFuel } from '../hooks/useFuel';

const NOTICE_MS = 5000;

export function FuelReadout() {
  const view = useUIStore((s) => s.view);
  const ship = useFuelStore((s) => s.ship);
  const notice = useFuelStore((s) => s.notice);
  const setNotice = useFuelStore((s) => s.setNotice);
  const fuel = useFuel();

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  if (!ship) return null;
  const harvest = fuel >= FUEL_HARVEST_CAP ? 0 : harvestPerHour(ship);

  return (
    <div className="hud-fuel">
      <span className={`hud-fuel-balance${fuel < 1 ? ' hud-fuel-balance--low' : ''}`}>
        {formatCondensate(fuel)} negative-energy condensate
      </span>
      {view === 'universe' && (
        <span className="hud-fuel-detail">reach {Math.round(travelReach(fuel)).toLocaleString('en-US')} Mly</span>
      )}
      <span className="hud-fuel-detail">
        {harvest > 0 ? `void harvest +${harvest.toFixed(1)} / h` : 'harvest idle'}
      </span>
      {notice && <span className="hud-fuel-notice">{notice}</span>}
    </div>
  );
}
