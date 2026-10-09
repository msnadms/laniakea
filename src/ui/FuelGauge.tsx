import { useEffect, useMemo } from 'react';
import { useFuelStore } from '../store/fuelStore';
import { harvestPerHour, travelReach } from '../game/fuel';
import { fuelAtShip } from '../net/ship';
import { tankCapacity } from '../game/tech';
import { useTechStore } from '../store/techStore';
import { formatCondensate, useFuel } from '../hooks/useFuel';
import './FuelGauge.css';

const NOTICE_MS = 5000;
const SIZE = 116;
const CENTER = SIZE / 2;
const RING_RADIUS = 58;
const SPIN_RADIUS = 61.5;
const MLY_PER_GLY = 1000;
const ARC_RADIUS = 46;
const TICK_OUTER = 52;
const TICK_MAJOR_INNER = 46;
const TICK_MINOR_INNER = 49;
const START_ANGLE = 135;
const SWEEP = 270;
const TICK_EVERY = 2;
const MAJOR_EVERY = 10;
const ARC_LENGTH = ARC_RADIUS * SWEEP * Math.PI / 180;

function polar(radius: number, degrees: number): [number, number] {
  const radians = degrees * Math.PI / 180;
  return [CENTER + radius * Math.cos(radians), CENTER + radius * Math.sin(radians)];
}

const [arcStartX, arcStartY] = polar(ARC_RADIUS, START_ANGLE);
const [arcEndX, arcEndY] = polar(ARC_RADIUS, START_ANGLE + SWEEP);
const ARC_PATH = `M ${arcStartX} ${arcStartY} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${arcEndX} ${arcEndY}`;

function gaugeTicks(capacity: number) {
  const angleOf = (condensate: number) => START_ANGLE + SWEEP * condensate / capacity;
  return Array.from({ length: Math.floor(capacity / TICK_EVERY) + 1 }, (_, i) => {
    const value = i * TICK_EVERY;
    const major = value % MAJOR_EVERY === 0;
    const [x1, y1] = polar(major ? TICK_MAJOR_INNER : TICK_MINOR_INNER, angleOf(value));
    const [x2, y2] = polar(TICK_OUTER, angleOf(value));
    return { x1, y1, x2, y2, major };
  });
}

function formatRange(mly: number): string {
  if (mly >= MLY_PER_GLY) return `${(mly / MLY_PER_GLY).toFixed(1)} Gly`;
  return `${Math.floor(mly)} Mly`;
}

export function FuelGauge() {
  const ship = useFuelStore((s) => s.ship);
  const notice = useFuelStore((s) => s.notice);
  const setNotice = useFuelStore((s) => s.setNotice);
  const fuel = useFuel();
  const capacity = tankCapacity(useTechStore((s) => s.levels.capacity));
  const setOpen = useTechStore((s) => s.setOpen);
  const ticks = useMemo(() => gaugeTicks(capacity), [capacity]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  if (!ship) return null;

  const fraction = Math.min(1, Math.max(0, fuel / capacity));
  const burn = Math.min(1 - fraction, Math.max(0, (fuelAtShip() - fuel) / capacity));
  const harvest = harvestPerHour(ship);
  const harvesting = fuel < capacity;
  const low = fuel < 1;

  return (
    <div className={`fuel-gauge${low ? ' fuel-gauge--low' : ''}`}>
      <button
        type="button"
        className="fuel-gauge-button"
        onClick={() => setOpen(true)}
        aria-label="Open ship upgrades"
        title="Ship upgrades"
      >
        <svg className="fuel-gauge-dial" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle className="fuel-gauge-ring" cx={CENTER} cy={CENTER} r={RING_RADIUS - 0.5} />
          <circle
            className={harvesting ? 'fuel-gauge-spin fuel-gauge-spin--harvesting' : 'fuel-gauge-spin'}
            cx={CENTER} cy={CENTER} r={SPIN_RADIUS}
          />
          {ticks.map((tick, i) => (
            <line
              key={i}
              className={tick.major ? 'fuel-gauge-tick fuel-gauge-tick--major' : 'fuel-gauge-tick'}
              x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2}
            />
          ))}
          <path className="fuel-gauge-track" d={ARC_PATH} />
          <path
            className="fuel-gauge-fill"
            d={ARC_PATH}
            strokeDasharray={`${ARC_LENGTH * fraction} ${ARC_LENGTH}`}
          />
          <path
            className="fuel-gauge-burn"
            d={ARC_PATH}
            strokeDasharray={`0 ${ARC_LENGTH * fraction} ${ARC_LENGTH * burn} ${ARC_LENGTH}`}
          />
        </svg>
        <span className="fuel-gauge-readout" role="status" aria-label={`${formatCondensate(fuel)} negative-energy condensate`}>
          <span className="fuel-gauge-value">{formatCondensate(fuel)}</span>
          <span className="fuel-gauge-range">Range {formatRange(travelReach(fuel))}</span>
          <span className={harvesting ? 'fuel-gauge-harvest' : 'fuel-gauge-harvest fuel-gauge-harvest--full'}>
            +{harvest.toFixed(1)} / h
          </span>
        </span>
      </button>
      {notice && <div className="fuel-gauge-notice" role="alert">{notice}</div>}
    </div>
  );
}
