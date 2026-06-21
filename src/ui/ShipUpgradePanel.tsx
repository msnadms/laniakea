import { createPortal } from 'react-dom';
import {
  useUIStore,
  UPGRADE_COSTS, UPGRADE_POOL,
  EXTRACTOR_HOLD_CAPS, LOGISTICS_B_RATE,
  computeStorageCap, computeDriveMultiplier, computeWeaponCap, computeLogisticsCap,
} from '../store/uiStore';
import './ShipUpgradePanel.css';

// ── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_A_NAMES = [
  'Stock Configuration',
  'Expanded Bulkhead Mk.I',
  'Modular Bay Retrofit',
  'Compressed Lattice Array',
  'Quantum Storage Array',
];
const STORAGE_A_DESCS = [
  'Standard reinforced bulkheads with fixed shelving. No compression or volume optimization applied.',
  'Laminated alloy plating reinforces interior cargo walls, increasing usable hold volume without altering the ship\'s external profile.',
  'Interchangeable rack units replace fixed shelving, enabling denser packing across all resource categories.',
  'Compressed lattice framework restructures the interior geometry of each bay, allowing significantly more material per cubic unit.',
  'Subspace folding manifold creates localized pocket dimensions within each bay, pushing capacity toward theoretical hull limits.',
];
const STORAGE_B_NAMES = [
  'Standard Station Hold',
  'Reinforced Vault Mk.I',
  'High-Capacity Extraction Bay',
  'Pressurized Collection Array',
  'Deep Hold Manifest',
];
const STORAGE_B_DESCS = [
  'Mining stations use standard-capacity collection hoppers. Periodic manual collection required.',
  'Reinforced hopper casings expand per-station storage, allowing longer unattended operation before cargo overflow.',
  'High-capacity pressurized extraction bays dramatically extend unattended mining time before collection is required.',
  'Pressurized manifold systems further expand station hold capacity, reducing collection frequency across the network.',
  'Deep-hold retrofits bring extraction station storage to maximum capacity, enabling extended autonomous operation.',
];

// ── Drive ─────────────────────────────────────────────────────────────────────
const DRIVE_A_NAMES = [
  'Stock Drive',
  'Toroidal Warp Geometry',
  'Van Den Broeck Compression',
  'White-Juday Refinement',
  'Casimir Cavity Array',
];
const DRIVE_A_DESCS = [
  'Baseline Alcubierre configuration. No efficiency modifications applied to bubble geometry or exotic matter consumption.',
  'Reshapes the Alcubierre metric into a toroidal configuration, reducing exotic matter demand and improving bubble stability.',
  'Applies the Van den Broeck modification to shrink the bubble\'s external volume while preserving habitable interior space.',
  'Implements White-Juday interferometer field oscillation patterns that cancel exotic matter waste at the bubble boundary.',
  'Banks of engineered Casimir cavities generate negative energy density directly within the drive manifold.',
];
const DRIVE_B_NAMES = [
  'Helion Fusion Core',
  'Helion Burn Optimizer',
  'Cryo-Isotope Separator',
  'Fusion Yield Amplifier',
  'Aneutronic Reactor',
];
const DRIVE_B_DESCS = [
  'The baseline He-3 fusion reactor. Fuses helion (He-3) nuclei to generate the raw power output driving the warp field generator.',
  ' Dynamically tunes plasma injection timing and magnetic confinement geometry in real time.',
  'Cools harvested helium to near-superfluid temperatures and exploits the mass difference between He-3 and He-4.',
  'Increases the energy extracted per fusion event through tighter magnetic confinement and higher plasma densities.',
  'Refines the fusion process toward He-3 + He-3 and He-3 + deuterium reactions, which release energy primarily as charged particles rather than free neutrons.',
];

// ── Weapons ───────────────────────────────────────────────────────────────────
const WEAPON_A_NAMES = [
  'Stock Magazine',
  'Helium-3 Injectors',
  'Antimatter Propelled Rounds',
  'Dense-Pack Configuration',
  'Maximum Load-Out',
];
const WEAPON_A_DESCS = [
  'Standard kinetic slug magazines with chemical propellant. Factory-default capacity and ballistic performance.',
  'Superheated helium-3 plasma replaces chemical propellant, increasing muzzle velocity and allowing lighter, denser round packing.',
  'Each slug carries a micro-annihilation charge. The matter-antimatter event provides a secondary acceleration stage.',
  'Precision-toleranced dense-pack loading configuration stacks rounds at maximum volumetric density within the magazine.',
  'Full capacity load-out with all available bay volume allocated to ordnance, achieving maximum rounds-per-bay across the ship.',
];
const WEAPON_B_NAMES = [
  'Standard Barrel',
  'Gauss Coils',
  'Miniature Alcubierre Cannon',
  'Sustained-Fire Coil Bank',
  'Warp-Penetrator Array',
];
const WEAPON_B_DESCS = [
  'Conventional rifled barrel with no electromagnetic or exotic modifications.',
  'Electromagnetic coil array accelerates ferromagnetic slugs without combustion. Eliminates barrel wear and enables tighter round tolerances.',
  'Each projectile generates a miniaturized warp bubble at launch, slipping through local spacetime before countermeasures can respond.',
  'A multi-stage coil bank sustains magnetic acceleration across an extended barrel length, increasing round storage density.',
  'Full warp-penetrator array: continuous alcubierre bubble generation along the barrel allows rounds to bypass conventional armor.',
];

// ── Logistics ─────────────────────────────────────────────────────────────────
const LOGISTICS_A_NAMES = [
  'Stock Logistics',
  'Relay Beacon Array',
  'Subspace Logistics Net',
  'Distributed Mesh Array',
  'Quantum Coordination Grid',
];
const LOGISTICS_A_DESCS = [
  'Direct telemetry links to up to five simultaneous mining stations within standard coordination range.',
  'A sparse network of relay beacons extends the ship\'s coordination bandwidth, adding a synchronized mining station to the extraction mesh.',
  'Quantum-paired subspace relays maintain phase-locked telemetry across wider deployment zones, pushing station capacity further.',
  'A distributed relay mesh extends coordination across multiple star systems, enabling additional simultaneous mining operations.',
  'Quantum-entangled coordination nodes maintain zero-latency telemetry across any distance, supporting ten simultaneous extraction platforms.',
];
const LOGISTICS_B_NAMES = [
  'Standard Drill Rate',
  'Overclocked Drill Protocol',
  'Resonance Extraction Array',
  'Phase-Locked Drill Sync',
  'Overdrive Mining Array',
];
const LOGISTICS_B_DESCS = [
  'Mining stations operate at baseline extraction velocity. No rate enhancements applied.',
  'Upgraded drill heads and optimized power routing push extraction speed beyond baseline, compressing time between collections.',
  'Synchronized resonance pulses between drill arrays maximize material dislodgement rates, accelerating per-minute yield.',
  'Phase-synchronized drill timing eliminates mechanical interference between adjacent units, pushing throughput well beyond standard limits.',
  'Full overdrive mode engages all drill systems at maximum resonance frequency, doubling per-minute extraction yield.',
];

// ── Components ────────────────────────────────────────────────────────────────

interface PathProps {
  level: number;
  maxLevel: number; // UPGRADE_POOL - otherLevel for shared-pool paths
  names: string[];
  descs: string[];
  stat: (level: number) => string;
  costs: readonly number[];
  currency: string;
  canAfford: boolean;
  onUpgrade: () => void;
}

interface SectionProps {
  title: string;
  pool: number;
  pathA: PathProps;
  pathB: PathProps;
}

function UpgradeSection({ title, pool, pathA, pathB }: SectionProps) {
  const aMaxed = pathA.level >= pathA.maxLevel;
  const bMaxed = pathB.level >= pathB.maxLevel;

  return (
    <div className="ship-upgrade-section">
      <div className="ship-upgrade-section-header">
        <span className="planet-panel-section-label">{title}</span>
        <div className="ship-upgrade-pool-dots">
          {Array.from({ length: UPGRADE_POOL }, (_, i) => (
            <div key={i} className={`ship-upgrade-dot${i < pool ? ' ship-upgrade-dot--filled' : ''}`} />
          ))}
        </div>
      </div>

      <div className="ship-upgrade-cell ship-upgrade-cell--current">
        <div className="ship-upgrade-dual">
          <div className="ship-upgrade-subcell ship-upgrade-subcell--current">
            <div className="ship-upgrade-cell-name">
              {pathA.names[pathA.level]}
              <span className="ship-upgrade-level-count">{pathA.level}/{UPGRADE_POOL}</span>
            </div>
            <div className="ship-upgrade-cell-stat">{pathA.stat(pathA.level)}</div>
            <div className="ship-upgrade-cell-desc">{pathA.descs[pathA.level]}</div>
          </div>
          <div className="ship-upgrade-subcell ship-upgrade-subcell--current">
            <div className="ship-upgrade-cell-name">
              {pathB.names[pathB.level]}
              <span className="ship-upgrade-level-count">{pathB.level}/{UPGRADE_POOL}</span>
            </div>
            <div className="ship-upgrade-cell-stat">{pathB.stat(pathB.level)}</div>
            <div className="ship-upgrade-cell-desc">{pathB.descs[pathB.level]}</div>
          </div>
        </div>
      </div>

      <div className={`ship-upgrade-cell ship-upgrade-cell--next${aMaxed && bMaxed ? ' ship-upgrade-cell--maxed' : ''}`}>
        {aMaxed && bMaxed ? (
          <span className="ship-upgrade-maxed">FULLY UPGRADED</span>
        ) : (
          <div className="ship-upgrade-dual">
            <div className="ship-upgrade-subcell ship-upgrade-subcell--next">
              {aMaxed ? (
                <span className="ship-upgrade-maxed">MAXED</span>
              ) : (
                <>
                  <div className="ship-upgrade-cell-name">{pathA.names[pathA.level + 1]}</div>
                  <div className="ship-upgrade-cell-stat">{pathA.stat(pathA.level + 1)}</div>
                  <div className="ship-upgrade-cell-desc">{pathA.descs[pathA.level + 1]}</div>
                  <div className="ship-upgrade-cell-footer">
                    <button
                      className={`planet-panel-btn${!pathA.canAfford ? ' planet-panel-btn--dim' : ''}`}
                      onClick={pathA.onUpgrade}
                      disabled={!pathA.canAfford}
                    >{pathA.costs[pathA.level]} {pathA.currency}</button>
                  </div>
                </>
              )}
            </div>
            <div className="ship-upgrade-subcell ship-upgrade-subcell--next">
              {bMaxed ? (
                <span className="ship-upgrade-maxed">MAXED</span>
              ) : (
                <>
                  <div className="ship-upgrade-cell-name">{pathB.names[pathB.level + 1]}</div>
                  <div className="ship-upgrade-cell-stat">{pathB.stat(pathB.level + 1)}</div>
                  <div className="ship-upgrade-cell-desc">{pathB.descs[pathB.level + 1]}</div>
                  <div className="ship-upgrade-cell-footer">
                    <button
                      className={`planet-panel-btn${!pathB.canAfford ? ' planet-panel-btn--dim' : ''}`}
                      onClick={pathB.onUpgrade}
                      disabled={!pathB.canAfford}
                    >{pathB.costs[pathB.level]} {pathB.currency}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ShipUpgradePanel() {
  const show = useUIStore((s) => s.showUpgradePanel);
  if (!show) return null;
  return <ShipUpgradePanelInner />;
}

function ShipUpgradePanelInner() {
  const toggle = useUIStore((s) => s.toggleUpgradePanel);
  const storageA = useUIStore((s) => s.storageA);
  const storageB = useUIStore((s) => s.storageB);
  const driveA = useUIStore((s) => s.driveA);
  const driveB = useUIStore((s) => s.driveB);
  const weaponA = useUIStore((s) => s.weaponA);
  const weaponB = useUIStore((s) => s.weaponB);
  const logisticsA = useUIStore((s) => s.logisticsA);
  const logisticsB = useUIStore((s) => s.logisticsB);
  const alloys = useUIStore((s) => s.alloys);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const upgradeStorageA = useUIStore((s) => s.upgradeStorageA);
  const upgradeStorageB = useUIStore((s) => s.upgradeStorageB);
  const upgradeDriveA = useUIStore((s) => s.upgradeDriveA);
  const upgradeDriveB = useUIStore((s) => s.upgradeDriveB);
  const upgradeWeaponA = useUIStore((s) => s.upgradeWeaponA);
  const upgradeWeaponB = useUIStore((s) => s.upgradeWeaponB);
  const upgradeLogisticsA = useUIStore((s) => s.upgradeLogisticsA);
  const upgradeLogisticsB = useUIStore((s) => s.upgradeLogisticsB);

  const storageACost = UPGRADE_COSTS.storageA[storageA] ?? 0;
  const storageBCost = UPGRADE_COSTS.storageB[storageB] ?? 0;
  const driveACost = UPGRADE_COSTS.driveA[driveA] ?? 0;
  const driveBCost = UPGRADE_COSTS.driveB[driveB] ?? 0;
  const weaponACost = UPGRADE_COSTS.weaponA[weaponA] ?? 0;
  const weaponBCost = UPGRADE_COSTS.weaponB[weaponB] ?? 0;
  const logisticsACost = UPGRADE_COSTS.logisticsA[logisticsA] ?? 0;
  const logisticsBCost = UPGRADE_COSTS.logisticsB[logisticsB] ?? 0;

  return createPortal(
    <div className="ship-upgrade-overlay" onClick={toggle}>
      <div className="ship-upgrade-panel" onClick={(e) => e.stopPropagation()}>
        <button className="planet-panel-close" onClick={toggle}>✕</button>

        <div className="planet-panel-header">
          <div>
            <div className="planet-panel-name">SHIP WORKSHOP</div>
            <div className="planet-panel-zone">Upgrades &amp; Modifications</div>
          </div>
        </div>

        <div className="ship-upgrade-grid">
          <UpgradeSection
            title="CARGO HOLD"
            pool={storageA + storageB}
            pathA={{
              level: storageA,
              maxLevel: UPGRADE_POOL - storageB,
              names: STORAGE_A_NAMES,
              descs: STORAGE_A_DESCS,
              stat: (lvl) => `${computeStorageCap(lvl)} / resource`,
              costs: UPGRADE_COSTS.storageA,
              currency: 'alloys',
              canAfford: alloys >= storageACost,
              onUpgrade: upgradeStorageA,
            }}
            pathB={{
              level: storageB,
              maxLevel: UPGRADE_POOL - storageA,
              names: STORAGE_B_NAMES,
              descs: STORAGE_B_DESCS,
              stat: (lvl) => `${EXTRACTOR_HOLD_CAPS[lvl]} / station`,
              costs: UPGRADE_COSTS.storageB,
              currency: 'alloys',
              canAfford: alloys >= storageBCost,
              onUpgrade: upgradeStorageB,
            }}
          />

          <UpgradeSection
            title="DRIVE EFFICIENCY"
            pool={driveA + driveB}
            pathA={{
              level: driveA,
              maxLevel: UPGRADE_POOL - driveB,
              names: DRIVE_A_NAMES,
              descs: DRIVE_A_DESCS,
              stat: (lvl) => { const pct = Math.round((1 - computeDriveMultiplier(lvl, driveB)[0]) * 100); return pct === 0 ? 'Stock efficiency' : `-${pct}% fuel cost`; },
              costs: UPGRADE_COSTS.driveA,
              currency: 'exotic matter',
              canAfford: exoticMatter >= driveACost,
              onUpgrade: upgradeDriveA,
            }}
            pathB={{
              level: driveB,
              maxLevel: UPGRADE_POOL - driveA,
              names: DRIVE_B_NAMES,
              descs: DRIVE_B_DESCS,
              stat: (lvl) => { const pct = Math.round((1 - computeDriveMultiplier(driveA, lvl)[1]) * 100); return pct === 0 ? 'Stock efficiency' : `-${pct}% fuel cost`; },
              costs: UPGRADE_COSTS.driveB,
              currency: 'helium-3',
              canAfford: helium3Reserves >= driveBCost,
              onUpgrade: upgradeDriveB,
            }}
          />

          <UpgradeSection
            title="WEAPON SYSTEMS"
            pool={weaponA + weaponB}
            pathA={{
              level: weaponA,
              maxLevel: UPGRADE_POOL - weaponB,
              names: WEAPON_A_NAMES,
              descs: WEAPON_A_DESCS,
              stat: (lvl) => `${computeWeaponCap(lvl, weaponB)} rounds`,
              costs: UPGRADE_COSTS.weaponA,
              currency: 'alloys',
              canAfford: alloys >= weaponACost,
              onUpgrade: upgradeWeaponA,
            }}
            pathB={{
              level: weaponB,
              maxLevel: UPGRADE_POOL - weaponA,
              names: WEAPON_B_NAMES,
              descs: WEAPON_B_DESCS,
              stat: (lvl) => `${computeWeaponCap(weaponA, lvl)} rounds`,
              costs: UPGRADE_COSTS.weaponB,
              currency: 'alloys',
              canAfford: alloys >= weaponBCost,
              onUpgrade: upgradeWeaponB,
            }}
          />

          <UpgradeSection
            title="EXTRACTION LOGISTICS"
            pool={logisticsA + logisticsB}
            pathA={{
              level: logisticsA,
              maxLevel: UPGRADE_POOL - logisticsB,
              names: LOGISTICS_A_NAMES,
              descs: LOGISTICS_A_DESCS,
              stat: (lvl) => `${computeLogisticsCap(lvl)} station cap`,
              costs: UPGRADE_COSTS.logisticsA,
              currency: 'alloys',
              canAfford: alloys >= logisticsACost,
              onUpgrade: upgradeLogisticsA,
            }}
            pathB={{
              level: logisticsB,
              maxLevel: UPGRADE_POOL - logisticsA,
              names: LOGISTICS_B_NAMES,
              descs: LOGISTICS_B_DESCS,
              stat: (lvl) => `${LOGISTICS_B_RATE[lvl]}× collection rate`,
              costs: UPGRADE_COSTS.logisticsB,
              currency: 'alloys',
              canAfford: alloys >= logisticsBCost,
              onUpgrade: upgradeLogisticsB,
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
