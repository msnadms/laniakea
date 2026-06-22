import { memo, useEffect, useRef, useState } from 'react';
import { useUIStore, computeStorageCap, computeWeaponCap } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { flatTravelCost, trySpendTravelCost } from '../store/travelCosts';
import { useExtractorStore, AUTO_DELIVERY_COST_PER_STATION, peekAccumulated } from '../store/extractorStore';
import { RESOURCE_LABELS } from '../game/types';
import { useAuthStore } from '../store/authStore';
import { deleteExtractor } from '../firebase/extractors';
import { Codex } from './Codex';
import { ShipUpgradePanel } from './ShipUpgradePanel';
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
    <button className={`side-btn nav-back-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleBack}>
      <TrapezoidOutline points="0.99,0.19 0.38,0.19 0.22,1 0.825,1" />
      <span className="nav-back-btn-icon nav-back-content">◀</span>
      <span className="nav-back-btn-label">Back</span>
    </button>
  );
});

const NavRegen = memo(function NavRegen() {
  const regenerateSupercluster = useGameStore((s) => s.regenerateSupercluster);
  const setView = useUIStore((s) => s.setView);
  const clearAddress = useUIStore((s) => s.clearAddress);
  const view = useUIStore((s) => s.view);

  const disabled = view !== 'supercluster';

  function handleRegen() {
    if (!trySpendTravelCost(flatTravelCost(50))) return;
    regenerateSupercluster();
    clearAddress();
    setView('supercluster');
  }

  return (
    <button className={`side-btn nav-regen-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleRegen}>
      <TrapezoidOutline points="0.8,0 0.2,0 0.05,1 0.65,1" />
      <span className="nav-back-btn-icon nav-regen-icon">⟳</span>
      <span className="nav-back-btn-label">JUMP</span>
    </button>
  );
});

function DeliveryPanel({ onClose }: { onClose: () => void }) {
  const extractorMap = useExtractorStore((s) => s.extractors);
  const remoteCollectExtractor = useExtractorStore((s) => s.remoteCollectExtractor);
  const removeExtractor = useExtractorStore((s) => s.removeExtractor);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const triggerHudFlash = useUIStore((s) => s.triggerHudFlash);
  const user = useAuthStore((s) => s.user);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const extractors = Object.values(extractorMap);
  const canAffordOne = exoticMatter >= AUTO_DELIVERY_COST_PER_STATION;

  function handleExtractOne(key: string) {
    const success = remoteCollectExtractor(key);
    if (!success) triggerHudFlash();
  }

  return (
    <div className="delivery-panel">
      <div className="delivery-panel-header">
        <span className="delivery-panel-title">Extraction Network</span>
        <button className="delivery-panel-close" onClick={onClose}>✕</button>
      </div>

      {extractors.length === 0 ? (
        <div className="delivery-panel-empty">No active mining stations</div>
      ) : (
        <div className="delivery-panel-list">
          {extractors.map((ext) => {
            const accumulated = peekAccumulated(ext);
            return (
              <div key={ext.key} className="delivery-panel-row">
                <div className="delivery-panel-row-info">
                  <span className="delivery-panel-planet">{ext.planetName}</span>
                  <span className="delivery-panel-resource">{RESOURCE_LABELS[ext.resourceType]}</span>
                </div>
                <span className="delivery-panel-amount">+{accumulated}</span>
                <button
                  className={`delivery-panel-btn${!canAffordOne || accumulated <= 0 ? ' delivery-panel-btn--dim' : ''}`}
                  onClick={() => handleExtractOne(ext.key)}
                  disabled={!canAffordOne || accumulated <= 0}
                >
                  Collect
                </button>
                <button
                  className="delivery-panel-btn delivery-panel-discard-btn"
                  onClick={() => { removeExtractor(ext.key); if (user) deleteExtractor(user.uid, ext.key); }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const DeliveryButton = memo(function DeliveryButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
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

function DeliverySystem() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DeliveryButton open={open} onToggle={() => setOpen((o) => !o)} />
      {open && <DeliveryPanel onClose={() => setOpen(false)} />}
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
  const driveIntegrity = useUIStore((s) => s.driveIntegrity);
  const railgunAmmo = useUIStore((s) => s.railgunAmmo);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const alloys = useUIStore((s) => s.alloys);
  const nutrients = useUIStore((s) => s.nutrients);
  const hudFlash = useUIStore((s) => s.hudFlash);
  const storageA = useUIStore((s) => s.storageA);
  const weaponA = useUIStore((s) => s.weaponA);
  const weaponB = useUIStore((s) => s.weaponB);
  const driveA = useUIStore((s) => s.driveA);
  const driveB = useUIStore((s) => s.driveB);
  const logisticsA = useUIStore((s) => s.logisticsA);
  const logisticsB = useUIStore((s) => s.logisticsB);
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
      {driveA + driveB >= 3 && logisticsA + logisticsB >= 3 && <DeliverySystem />}
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

      <div className="hud-header">NAV CONSOLE</div>

      <div className="hud-content">
        <div className="hud-rows">
          <div className="hud-row">
            <span className="hud-label">EXOTIC MATTER</span>
            <StatBar value={exoticMatter} max={storageCap} />
            <span className="hud-value">{exoticMatter} <span className="hud-value-dim">/ {storageCap}</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label">HELIUM-3 RESERVES</span>
            <StatBar value={helium3Reserves} max={storageCap} />
            <span className="hud-value">{helium3Reserves} <span className="hud-value-dim">/ {storageCap}</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label">ALCUBIERRE DRIVE</span>
            <StatBar value={driveIntegrity} max={100} />
            <span className="hud-value">{driveIntegrity}%</span>
          </div>

          <div className="hud-row">
            <span className="hud-label">RAILGUN RESERVES</span>
            <StatBar value={railgunAmmo} max={weaponCap} />
            <span className="hud-value">{railgunAmmo} <span className="hud-value-dim">/ {weaponCap}</span></span>
          </div>
        </div>

        <div className="hud-cargo-bars">
          <VerticalCargoBar label="ALLOYS" value={alloys} max={storageCap} />
          <VerticalCargoBar label="NUTR" value={nutrients} max={storageCap} />
        </div>
      </div>
    </div>
  );
}
