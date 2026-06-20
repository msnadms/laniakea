import { memo, useEffect, useRef } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { Codex } from './Codex';
import './ShipHUD.css';

const StatBar = memo(function StatBar({ value, max }: { value: number; max: number }) {
  const pct = (value / max) * 100;
  const low = pct < 25;
  return (
    <div className="hud-bar-track">
      <div
        className={`hud-bar-fill${low ? ' hud-bar-low' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});

const VerticalCargoBar = memo(function VerticalCargoBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const low = pct < 25;
  return (
    <div className="hud-vcargo-col">
      <span className="hud-vcargo-value">{value}</span>
      <div className="hud-vbar-track">
        <div
          className={`hud-vbar-fill${low ? ' hud-vbar-low' : ''}`}
          style={{ height: `${pct}%` }}
        />
      </div>
      <span className="hud-vcargo-label">{label}</span>
    </div>
  );
});

const NavBack = memo(function NavBack() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const popAddress = useUIStore((s) => s.popAddress);
  const removeAddressType = useUIStore((s) => s.removeAddressType);
  const setSystem = useGameStore((s) => s.setSystem);

  const disabled = view === 'supercluster';

  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);

  function handleBack() {
    if (view === 'system') {
      setSelectedPlanet(null);
      removeAddressType('system');
      setSystem(null);
      setView('galaxy');
    } else if (view === 'galaxy') {
      popAddress();
      removeAddressType('attractor');
      setView('supercluster');
    }
  }

  return (
    <button className={`nav-back-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleBack}>
      <svg className="nav-back-btn-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <polygon
          vectorEffect="non-scaling-stroke"
          points="1,0.1 0.39,0.1 0.05,1 0.65,1"
          fill="transparent"
          stroke="rgba(0, 190, 230, 0.55)"
          strokeWidth="1"
          pointerEvents="all"
        />
      </svg>
      <span className="nav-back-btn-icon">◂</span>
      <span className="nav-back-btn-label">Back</span>
    </button>
  );
});

export function ShipHUD() {
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const driveIntegrity = useUIStore((s) => s.driveIntegrity);
  const railgunAmmo = useUIStore((s) => s.railgunAmmo);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const alloys = useUIStore((s) => s.alloys);
  const nutrients = useUIStore((s) => s.nutrients);
  const hudFlash = useUIStore((s) => s.hudFlash);
  const hudRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hudFlash === 0) return;
    const el = hudRef.current;
    if (!el) return;
    el.classList.remove('ship-hud--alert');
    void el.offsetWidth;
    el.classList.add('ship-hud--alert');
    const onEnd = () => el.classList.remove('ship-hud--alert');
    el.addEventListener('animationend', onEnd, { once: true });
    return () => el.removeEventListener('animationend', onEnd);
  }, [hudFlash]);

  return (
    <div ref={hudRef} className="ship-hud" aria-hidden="true">
      <Codex />
      <NavBack />
      {/* trapezoid outline: wide at top, narrows at bottom, no top edge */}
      <svg className="hud-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <polyline
          vectorEffect="non-scaling-stroke"
          points="0,0.1 0.05,1 0.95,1 1,0.1"
          fill="none"
          stroke="rgba(0, 190, 230, 0.55)"
          strokeWidth="1"
        />
        {/* small tick marks at top corners */}
        <line vectorEffect="non-scaling-stroke" x1="0" y1="0.1" x2="0.04" y2="0.1" stroke="rgba(0, 210, 255, 0.7)" strokeWidth="1" />
        <line vectorEffect="non-scaling-stroke" x1="1" y1="0.1" x2="0.96" y2="0.1" stroke="rgba(0, 210, 255, 0.7)" strokeWidth="1" />
      </svg>

      <div className="hud-header">NAV CONSOLE</div>

      <div className="hud-content">
        <div className="hud-rows">
          <div className="hud-row">
            <span className="hud-label">EXOTIC MATTER</span>
            <StatBar value={exoticMatter} max={100} />
            <span className="hud-value">{exoticMatter}%</span>
          </div>

          <div className="hud-row">
            <span className="hud-label">HELIUM-3 RESERVES</span>
            <StatBar value={helium3Reserves} max={500} />
            <span className="hud-value">{helium3Reserves} <span className="hud-value-dim">/ 500</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label">ALCUBIERRE DRIVE</span>
            <StatBar value={driveIntegrity} max={100} />
            <span className="hud-value">{driveIntegrity}%</span>
          </div>

          <div className="hud-row">
            <span className="hud-label">RAILGUN RESERVES</span>
            <StatBar value={railgunAmmo} max={500} />
            <span className="hud-value">{railgunAmmo} <span className="hud-value-dim">/ 500</span></span>
          </div>
        </div>

        <div className="hud-cargo-bars">
          <VerticalCargoBar label="ALLOYS" value={alloys} max={500} />
          <VerticalCargoBar label="NUTR" value={nutrients} max={500} />
        </div>
      </div>
    </div>
  );
}
