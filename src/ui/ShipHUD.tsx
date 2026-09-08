import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useUIStore, computeStorageCap, computeWeaponCap } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { flatTravelCost, trySpendTravelCost } from '../store/travelCosts';
import { LogisticsModal } from './LogisticsModal';
import { MSG_DRIVE_REQUIRED_SUPERCLUSTER, MSG_SCAN_UNAVAILABLE, SHIP_NAME, fmt } from './strings';
import { fireBackZoom, fireCodexNavigate } from '../pixi/zoomAnim';
import { Codex } from './Codex';
import { canTravelToSystem, travelToSystem } from './navigation';
import { generateGalaxyName } from '../game/superclusters';
import { ShipUpgradePanel } from './ShipUpgradePanel';
import { AlloysIcon, NutrientsIcon, MetallicHydrogenIcon, NeutronStarMatterIcon, ExoticMatterIcon, Helium3Icon, RailgunIcon, ProbeAttentionIcon } from './CargoIcons';
import './ShipHUD.css';
import './ShipUpgradePanel.css';
import { SysPanel } from './SysPanel';
import { useColonyStore } from '../store/colonyStore';
import { emergencyStatus, performDistressRecovery, requestEmergencyTanker } from '../store/emergencyRecovery';
import { EMERGENCY_RESERVE_EXOTIC, EMERGENCY_RESERVE_HELIUM } from '../store/emergencyFuel';

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

const RESERVE_VISUAL_PERCENT = 15;

const StatBar = memo(function StatBar({ value, max, reserve = 0, reserveMax = 0, onReserveClick }: {
  value: number;
  max: number;
  reserve?: number;
  reserveMax?: number;
  onReserveClick?: () => void;
}) {
  const hasReserve = reserveMax > 0;
  const reserveZone = hasReserve ? RESERVE_VISUAL_PERCENT : 0;
  const operationalZone = 100 - reserveZone;
  const reservePct = hasReserve ? Math.min(1, reserve / reserveMax) * reserveZone : 0;
  const operationalPct = max > 0 ? Math.min(1, value / max) * operationalZone : 0;
  const pct = reservePct + operationalPct;
  const reserveLinePct = reserveZone;
  const low = pct < 25;
  const reserveDepleted = reserve < reserveMax;
  return (
    <div
      className={`hud-bar-track${hasReserve ? ' hud-bar-track--fuel' : ''}${reserveDepleted ? ' hud-bar-track--reserve-low' : ''}`}
      title={hasReserve
        ? reserveDepleted
          ? `Emergency reserve ${fmt(reserve)} / ${fmt(reserveMax)} — click to reseal from operational fuel`
          : `Emergency reserve sealed at ${fmt(reserveMax)}`
        : undefined}
      onClick={reserveDepleted ? onReserveClick : undefined}
    >
      <div
        className={`hud-bar-fill${low ? ' hud-bar-low' : ''}`}
        style={{ width: `${pct}%` }}
      />
      {hasReserve && <>
        <span className="hud-bar-reserve-fill" style={{ width: `${reservePct}%` }} />
        <span className="hud-bar-reserve-line" style={{ left: `${reserveLinePct}%` }} />
      </>}
    </div>
  );
});

const DetectionBars = memo(function DetectionBars({ value }: { value: number }) {
  const critical = value >= 5;
  return (
    <div className={`detection-bars${critical ? ' detection-bars--critical' : ''}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="detection-bar">
          <span className="detection-bar-progress" style={{ width: `${Math.max(0, Math.min(1, value - i)) * 100}%` }} />
        </div>
      ))}
    </div>
  );
});

const VerticalCargoBar = memo(function VerticalCargoBar({ icon, label, value, max }: { icon: ReactNode; label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
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
    if (useUIStore.getState().checkDetectionLethal()) return;
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

const NavCurrent = memo(function NavCurrent() {
  const view = useUIStore((s) => s.view);
  const system = useGameStore((s) => s.system);

  const disabled = view === 'system' && system?.current === true;

  function handleCurrent() {
    const gameState = useGameStore.getState();
    const currentSys = gameState.galaxy.systems.find((s) => s.current);
    if (!currentSys) return;
    const scSeed = gameState.supercluster.seed;
    const scName = gameState.supercluster.name;
    const galaxySeed = gameState.galaxy.seed;
    const galaxyName = generateGalaxyName(galaxySeed);
    const systemId = String(currentSys.id);
    const systemName = currentSys.name;
    if (!canTravelToSystem(scSeed, galaxySeed, systemId)) return;
    const travel = () => travelToSystem(scSeed, scName, galaxySeed, galaxyName, systemId, systemName);
    if (fireCodexNavigate(() => useUIStore.getState().setViewTransitioning(true), travel)) return;
    travel();
  }

  return (
    <button className={`side-btn nav-current-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleCurrent}>
      <TrapezoidOutline points="0.99,0.19 0.38,0.19 0.22,1 0.825,1" />
      <span className="nav-back-btn-icon nav-back-content">◎</span>
      <span className="nav-back-btn-label">Home</span>
    </button>
  );
});

const NavScan = memo(function NavScan() {
  function handleScan() {
    useUIStore.getState().triggerHudNotify(MSG_SCAN_UNAVAILABLE);
  }

  return (
    <button className="side-btn nav-scan-btn" onClick={handleScan}>
      <TrapezoidOutline points="0.8,0 0.2,0 0.05,1 0.65,1" />
      <span className="nav-back-btn-icon nav-regen-icon">⌕</span>
      <span className="nav-back-btn-label">Scan</span>
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

function EmergencyFuelControls() {
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const emergencyReserveExotic = useUIStore((s) => s.emergencyReserveExotic);
  const emergencyReserveHelium = useUIStore((s) => s.emergencyReserveHelium);
  const systemId = useGameStore((s) => s.system?.id ?? null);
  const galaxySeed = useGameStore((s) => s.galaxy.seed);
  const colonies = useColonyStore((s) => s.colonies);
  void exoticMatter; void helium3Reserves; void emergencyReserveExotic; void emergencyReserveHelium;
  void systemId; void galaxySeed; void colonies;

  const status = emergencyStatus();
  if (!status.stranded) return null;

  function handleTanker() {
    if (!status.tanker) return;
    if (!window.confirm(
      `REQUEST TANKER FROM ${status.tanker.planetName.toUpperCase()}?\n\n`
      + 'The colony will transfer 30 Exotic Matter and 25 Helium-3. The signal adds 0.5 probe attention.',
    )) return;
    requestEmergencyTanker();
  }

  function handleRecovery() {
    if (!window.confirm(
      'AUTHORIZE DISTRESS RECOVERY TO SOL?\n\nRecovery jettisons 25% of raw cargo and adds 1 probe attention. '
      + 'You will receive one intra-galaxy jump of fuel.',
    )) return;
    performDistressRecovery();
  }

  return (
    <div className="hud-emergency">
      <div>
        <strong>PROPULSION LOCK</strong>
        <span>Insufficient fuel for the cheapest outbound jump</span>
      </div>
      {status.tanker && <button className="hud-action-btn" onClick={handleTanker}>Request tanker</button>}
      <button className="hud-action-btn hud-recovery-btn" onClick={handleRecovery}>Recover to Sol</button>
    </div>
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

const HumanityButton = memo(function HumanityButton() {
  const open = useUIStore(state => state.showSysPanel);
  return (
    <button aria-label="Humanity" className={`side-btn combat-btn${open ? ' delivery-btn--active' : ''}`} onClick={() => useUIStore.getState().setShowSysPanel(!open)} style={{ pointerEvents: 'all' }}>
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
      <span className="delivery-btn-icon">✦</span>
      <span className="nav-back-btn-label">HMNTY</span>
    </button>
  );
});

export function ShipHUD() {
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const emergencyReserveExotic = useUIStore((s) => s.emergencyReserveExotic);
  const detectionHeat = useUIStore((s) => s.detectionHeat);
  const railgunAmmo = useUIStore((s) => s.railgunAmmo);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const emergencyReserveHelium = useUIStore((s) => s.emergencyReserveHelium);
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
  const replenishEmergencyReserve = useUIStore((s) => s.replenishEmergencyReserve);
  const hudRef = useRef<HTMLDivElement>(null);

  const storageCap = computeStorageCap(storageA);
  const weaponCap = computeWeaponCap(weaponA, weaponB);
  useEffect(() => {
    useUIStore.getState().tickRailgunSuppression();
    const id = setInterval(() => useUIStore.getState().tickRailgunSuppression(), 10000);
    return () => clearInterval(id);
  }, []);

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
    <div ref={hudRef} className="ship-hud">
      <Codex />
      <ShipUpgradePanel />
      <SysPanel />
      <LogisticsSystem />
      <UpgradesButton />
      <HumanityButton />
      <NavBack />
      <NavRegen />
      <NavCurrent />
      <NavScan />
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
            <span className="hud-label hud-label-icon" data-tooltip="Exotic Matter"><ExoticMatterIcon /></span>
            <StatBar
              value={exoticMatter}
              max={storageCap}
              reserve={emergencyReserveExotic}
              reserveMax={EMERGENCY_RESERVE_EXOTIC}
              onReserveClick={replenishEmergencyReserve}
            />
            <span className="hud-value">{fmt(exoticMatter + emergencyReserveExotic)} <span className="hud-value-dim">/ {fmt(storageCap + EMERGENCY_RESERVE_EXOTIC)}</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label hud-label-icon" data-tooltip="Helium-3 Reserves"><Helium3Icon /></span>
            <StatBar
              value={helium3Reserves}
              max={storageCap}
              reserve={emergencyReserveHelium}
              reserveMax={EMERGENCY_RESERVE_HELIUM}
              onReserveClick={replenishEmergencyReserve}
            />
            <span className="hud-value">{fmt(helium3Reserves + emergencyReserveHelium)} <span className="hud-value-dim">/ {fmt(storageCap + EMERGENCY_RESERVE_HELIUM)}</span></span>
          </div>

          <div className="hud-row">
            <span className="hud-label hud-label-icon" data-tooltip="Railgun Reserves"><RailgunIcon /></span>
            <StatBar value={railgunAmmo} max={weaponCap} />
            <span className="hud-value">{fmt(railgunAmmo)} <span className="hud-value-dim">/ {fmt(weaponCap)}</span></span>
            <button
              className="hud-action-btn"
              onClick={() => useUIStore.getState().reloadRailgun()}
              disabled={railgunAmmo >= weaponCap}
            >Reload</button>
          </div>

          <div className="hud-row">
            <span className="hud-label hud-label-icon" data-tooltip="Probe Attention"><ProbeAttentionIcon /></span>
            <DetectionBars value={detectionHeat} />
            <span className="hud-value">{detectionHeat.toFixed(1)} <span className="hud-value-dim">/ 5</span></span>
          </div>
          <EmergencyFuelControls />
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
