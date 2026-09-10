import { memo } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { fireBackZoom, fireCodexNavigate } from '../pixi/zoomAnim';
import { Codex } from './Codex';
import './ShipHUD.css';

const COORD_TYPES = new Set(['supercluster', 'galaxy', 'system']);

const TrapezoidOutline = ({ points }: { points: string }) => (
  <svg className="nav-back-btn-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <polygon
      vectorEffect="non-scaling-stroke"
      points={points}
      fill="transparent"
      stroke="rgba(0, 190, 230, 0.55)"
      strokeWidth="1"
      pointerEvents="all"
    />
  </svg>
);

const NavBack = memo(function NavBack() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const popAddress = useUIStore((s) => s.popAddress);
  const removeAddressType = useUIStore((s) => s.removeAddressType);
  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);
  const setSystem = useGameStore((s) => s.setSystem);

  const disabled = view === 'supercluster';

  function handleBack() {
    if (fireBackZoom()) return;
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
    <button className={`side-btn nav-back-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleBack}>
      <TrapezoidOutline points="0.99,0.19 0.38,0.19 0.22,1 0.825,1" />
      <span className="nav-back-btn-icon nav-back-content">◀</span>
      <span className="nav-back-btn-label">Back</span>
    </button>
  );
});

const NavJump = memo(function NavJump() {
  const regenerateSupercluster = useGameStore((s) => s.regenerateSupercluster);
  const clearAddress = useUIStore((s) => s.clearAddress);
  const view = useUIStore((s) => s.view);

  const disabled = view !== 'supercluster';

  function handleJump() {
    const jump = () => { regenerateSupercluster(); clearAddress(); };
    if (fireCodexNavigate(() => useUIStore.getState().setViewTransitioning(true), jump)) return;
    jump();
  }

  return (
    <button className={`side-btn nav-regen-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleJump}>
      <TrapezoidOutline points="0.8,0 0.2,0 0.05,1 0.65,1" />
      <span className="nav-back-btn-icon nav-regen-icon">⟳</span>
      <span className="nav-back-btn-label">JUMP</span>
    </button>
  );
});

function AddressReadout() {
  const address = useUIStore((s) => s.address);
  const coords = address
    .filter((s) => COORD_TYPES.has(s.type))
    .map((s) => { const z = Math.round(s.z); return `${Math.round(s.x)}.${Math.round(s.y)}${z !== 0 ? `.${z}` : ''}`; })
    .join(':');
  return (
    <div className="hud-address">
      <div className="hud-address-breadcrumb">
        {address.map((segment, i) => (
          <span key={i}>
            {i > 0 && <span className="hud-address-sep">›</span>}
            <span className={`hud-address-seg${i === address.length - 1 ? ' hud-address-seg--current' : ''}`}>
              {segment.name}
            </span>
          </span>
        ))}
      </div>
      {coords && <div className="hud-address-coords">{coords}</div>}
    </div>
  );
}

export function ShipHUD() {
  return (
    <div className="ship-hud">
      <Codex />
      <NavBack />
      <NavJump />
      <svg className="hud-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <polyline
          vectorEffect="non-scaling-stroke"
          points="0,0.1 0.05,1 0.95,1 1,0.1"
          fill="none"
          stroke="rgba(0, 190, 230, 0.55)"
          strokeWidth="1"
        />
        <line vectorEffect="non-scaling-stroke" x1="0" y1="0.1" x2="0.04" y2="0.1" stroke="rgba(0, 210, 255, 0.7)" strokeWidth="1" />
        <line vectorEffect="non-scaling-stroke" x1="1" y1="0.1" x2="0.96" y2="0.1" stroke="rgba(0, 210, 255, 0.7)" strokeWidth="1" />
      </svg>
      <div className="hud-header">Navigation</div>
      <AddressReadout />
    </div>
  );
}
