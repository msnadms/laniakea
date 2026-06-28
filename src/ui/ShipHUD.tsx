import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useUIStore, computeStorageCap, computeWeaponCap } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { flatTravelCost, trySpendTravelCost } from '../store/travelCosts';
import { LogisticsModal } from './LogisticsModal';
import { MSG_DRIVE_REQUIRED_SUPERCLUSTER, SHIP_NAME, fmt } from './strings';
import { fireBackZoom, fireCodexNavigate } from '../pixi/zoomAnim';
import { Codex } from './Codex';
import { ShipUpgradePanel } from './ShipUpgradePanel';
import { AlloysIcon, NutrientsIcon, MetallicHydrogenIcon, NeutronStarMatterIcon } from './CargoIcons';
import './ShipHUD.css';
import './ShipUpgradePanel.css';

const TrapezoidOutline = ({ points = "1,0.1 0.39,0.1 0.05,1 0.65,1" }: { points?: string }) => (
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

const DetectionBars = memo(function DetectionBars({ value }: { value: number }) {
  return (
    <div className="detection-bars">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={`detection-bar${i < value ? ' detection-bar-filled' : ''}`} />
      ))}
    </div>
  );
});

const VerticalCargoBar = memo(function VerticalCargoBar({ icon, label, value, max }: { icon: ReactNode; label: string; value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const low = pct < 25;
  return (
    <div className="hud-vcargo-col" data-tooltip={label}>
      <span className="hud-vcargo-value">{fmt(value)}</span>
      <div className="hud-vbar-track">
        <div
          className={`hud-vbar-fill${low ? ' hud-vbar-low' : ''}`}
          style={{ height: `${pct}%` }}
        />
      </div>
      <span className="hud-vcargo-label">{icon}</span>
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

const NavRegen = memo(function NavRegen() {
  const regenerateSupercluster = useGameStore((s) => s.regenerateSupercluster);
  const clearAddress = useUIStore((s) => s.clearAddress);
  const view = useUIStore((s) => s.view);

  const disabled = view !== 'supercluster';

  function handleRegen() {
    const { driveA, triggerHudNotify } = useUIStore.getState();
    if (driveA < 2) {
      triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
      return;
    }
    if (!trySpendTravelCost(flatTravelCost(50))) return;
    if (fireCodexNavigate(
      () => useUIStore.getState().setViewTransitioning(true),
      () => { regenerateSupercluster(); clearAddress(); },
    )) return;
    regenerateSupercluster();
    clearAddress();
  }

  return (
    <button className={`side-btn nav-regen-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleRegen}>
      <TrapezoidOutline points="0.8,0 0.2,0 0.05,1 0.65,1" />
      <span className="nav-back-btn-icon nav-regen-icon">⟳</span>
      <span className="nav-back-btn-label">JUMP</span>
    </button>
  );
});

const LogisticsButton = memo(function LogisticsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      className={`side-btn delivery-btn${open ? ' delivery-btn--active' : ''}`}
      onClick={onToggle}
      style={{ pointerEvents: 'all' }}
    >
      <svg className="nav-back-btn-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <polygon
          vectorEffect="non-scaling-stroke"
          points="0,0.1 0.61,0.1 0.95,1 0.35,1"
          fill="transparent"
          stroke="rgba(0, 190, 230, 0.55)"
          strokeWidth="1"
          pointerEvents="all"
        />
      </svg>
      <span className="delivery-btn-icon">⊕</span>
      <span className="nav-back-btn-label">AUTO</span>
    </button>
  );
});

function LogisticsSystem() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <LogisticsButton open={open} onToggle={() => setOpen((o) => !o)} />
      {open && <LogisticsModal onClose={() => setOpen(false)} />}
    </>
  );
}

const UpgradesButton = memo(function UpgradesButton() {

  const toggleUpgradePanel = useUIStore((s) => s.toggleUpgradePanel);

  return (
    <button className="side-btn upgrades-btn" onClick={toggleUpgradePanel} style={{ pointerEvents: 'all' }}>
      <TrapezoidOutline />
      <span className="nav-back-btn-icon upg-label">▲</span>
      <span className="nav-back-btn-label upg-label">WKSHP</span>
    </button>
  );
});

export function ShipHUD() {
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const detectionRating = useUIStore((s) => s.detectionRating);
  const railgunAmmo = useUIStore((s) => s.railgunAmmo);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const alloys = useUIStore((s) => s.alloys);
  const nutrients = useUIStore((s) => s.nutrients);
  const metallicHydrogen = useUIStore((s) => s.metallicHydrogen);
  const neutronStarMatter = useUIStore((s) => s.neutronStarMatter);
  const hudFlash = useUIStore((s) => s.hudFlash);
  const hudNotify = useUIStore((s) => s.hudNotify);
  const hudNotifyMsg = useUIStore((s) => s.hudNotifyMsg);
  const storageA = useUIStore((s) => s.storageA);
  const weaponA = useUIStore((s) => s.weaponA);
  const weaponB = useUIStore((s) => s.weaponB);
  const hudRef = useRef<HTMLDivElement>(null);

  const storageCap = computeStorageCap(storageA);
  const weaponCap = computeWeaponCap(weaponA, weaponB);

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
      <ShipUpgradePanel />
      <LogisticsSystem />
      <UpgradesButton />
      <NavBack />
      <NavRegen />
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

      {hudNotify > 0 && (
        <div key={hudNotify} className="hud-notification">{hudNotifyMsg}</div>
      )}
      <div className="hud-header">{SHIP_NAME} | CENTRAL CONTROL</div>

      <div className="hud-content">
        <div className="hud-rows">
          <div className="hud-row">
            <span className="hud-label">EXOTIC MATTER</span>
            <StatBar value={exoticMatter} max={storageCap} />
            <span className="hud-value">{fmt(exoticMatter)} <span className="hud-value-dim">/ {fmt(storageCap)}</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label">HELIUM-3 RESERVES</span>
            <StatBar value={helium3Reserves} max={storageCap} />
            <span className="hud-value">{fmt(helium3Reserves)} <span className="hud-value-dim">/ {fmt(storageCap)}</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label">RAILGUN RESERVES</span>
            <StatBar value={railgunAmmo} max={weaponCap} />
            <span className="hud-value">{fmt(railgunAmmo)} <span className="hud-value-dim">/ {fmt(weaponCap)}</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label">DETECTION RATING</span>
            <DetectionBars value={detectionRating} />
            <span className="hud-value">{detectionRating} <span className="hud-value-dim">/ 5</span></span>
          </div>
        </div>

        <div className="hud-cargo-section">
          <span className="hud-cargo-title">CARGO</span>
          <div className="hud-cargo-bars">
            <VerticalCargoBar icon={<AlloysIcon />} label="Alloys" value={alloys} max={storageCap} />
            <VerticalCargoBar icon={<NutrientsIcon />} label="Nutrients" value={nutrients} max={storageCap} />
            <VerticalCargoBar icon={<MetallicHydrogenIcon />} label="Metallic Hydrogen" value={metallicHydrogen} max={storageCap} />
            <VerticalCargoBar icon={<NeutronStarMatterIcon />} label="Neutron Star Matter" value={neutronStarMatter} max={storageCap} />
          </div>
        </div>
      </div>
    </div>
  );
}
