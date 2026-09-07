import { createPortal } from 'react-dom';
import { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { useExtractorStore, peekAccumulated } from '../store/extractorStore';
import { EXTRACTOR_HOLD_CAPS, computeStorageCap, computeLogisticsCap, UPGRADE_POOL } from '../store/uiStore';
import { makeExtractorKey, makeFabricatorKey, RESOURCE_LABELS } from '../game/types';
import { FABRICATOR_COST, FABRICATOR_UPGRADE_COST, FABRICATOR_UPGRADE_MATERIALS, FABRICATOR_TIER_LABELS } from '../game/types';
import type { Extractor, Resource, Fabricator } from '../game/types';
import { useFabricatorStore } from '../store/fabricatorStore';
import { useStockpileStore } from '../store/stockpileStore';
import { materialName } from '../data/materials';
import { saveFabricator, deleteFabricator } from '../firebase/fabricators';
import { saveStockpile } from '../firebase/stockpile';
import { RESOURCE_MAX_RATE } from '../game/planetGen';
import { saveExtractor, updateExtractorCollected, deleteExtractor } from '../firebase/extractors';
import './PlanetPanel.css';
import { ColonyDetails } from './ColonyPanel';
import { useColonyStore, canBuildExtractor } from '../store/colonyStore';

const TIERS = [
  { min: 0.80, label: 'S' },
  { min: 0.60, label: 'A' },
  { min: 0.40, label: 'B' },
  { min: 0.20, label: 'C' },
  { min: 0.10, label: 'D' },
  { min: 0,    label: 'F' },
] as const;

function getTier(type: Resource['type'], count: number): string {
  const pct = count / RESOURCE_MAX_RATE[type];
  return TIERS.find((t) => pct >= t.min)?.label ?? 'F';
}

function TierBadge({ type, count }: { type: Resource['type']; count: number }) {
  const tier = getTier(type, count);
  return <span className={`tier-badge tier-${tier}`}>{tier}</span>;
}

const COST_UNITS: Record<string, string> = {
  alloys: 'alloys',
  helium3: 'He-3',
  nutrients: 'nutrients',
  metallicHydrogen: 'MH',
};

function costLabel(cost: Record<string, number>): string {
  return Object.entries(cost).map(([k, v]) => `${v} ${COST_UNITS[k] ?? k}`).join(' · ');
}

const ZONE_LABELS: Record<string, string> = {
  hot: 'Hot Zone',
  marginal: 'Marginal Zone',
  habitable: 'Habitable Zone',
  gas: 'Gas Giant',
  ice: 'Ice Planet',
};

function ResourcePickButton({ resource, affordable, locked, logisticsTier, onPlace }: {
  resource: { type: Resource['type']; count: number };
  affordable: boolean;
  locked: boolean;
  logisticsTier: number;
  onPlace: (resource: { type: Resource['type']; count: number }) => void;
}) {
  return (
    <button
      className={`planet-panel-btn planet-panel-btn--pick${!affordable || locked ? ' planet-panel-btn--dim' : ''}`}
      onClick={() => onPlace(resource)}
      disabled={!affordable || locked}
    >
      <span className={`planet-panel-resource-dot res-${resource.type}`} />
      {locked
        ? `${RESOURCE_LABELS[resource.type]} (logistics ${logisticsTier}/${UPGRADE_POOL})`
        : `${RESOURCE_LABELS[resource.type]} (${resource.count}/hour)`}
      {!locked && <TierBadge type={resource.type} count={resource.count} />}
    </button>
  );
}

export function PlanetPanel() {
  const selectedKey = useUIStore((s) => s.selectedPlanetKey);
  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);
  const addCargo = useUIStore((s) => s.addCargo);
  const spendAlloys = useUIStore((s) => s.spendAlloys);
  const consumeHelium3 = useUIStore((s) => s.consumeHelium3);
  const alloys = useUIStore((s) => s.alloys);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const nutrients = useUIStore((s) => s.nutrients);
  const metallicHydrogen = useUIStore((s) => s.metallicHydrogen);
  const neutronMatter = useUIStore((s) => s.neutronStarMatter);
  const system = useGameStore((s) => s.system);
  const galaxySeed = useGameStore((s) => s.galaxy.seed);
  const galaxy = useGameStore((s) => s.galaxy);
  const supercluster = useGameStore((s) => s.supercluster);
  const extractor = useExtractorStore((s) => selectedKey ? s.extractors[selectedKey] : undefined);
  const fabricator = useFabricatorStore((s) => selectedKey ? s.fabricators[selectedKey] : undefined);
  const colony = useColonyStore(s => selectedKey ? s.colonies[selectedKey] : undefined);
  const spendNutrients = useUIStore((s) => s.spendNutrients);
  const spendMetallicHydrogen = useUIStore((s) => s.spendMetallicHydrogen);
  const logisticsA = useUIStore((s) => s.logisticsA);
  const logisticsB = useUIStore((s) => s.logisticsB);
  const maxStations = computeLogisticsCap(logisticsA);
  const extractorRoster = useExtractorStore(s => s.extractors);
  const colonyRoster = useColonyStore(s => s.colonies);
  const atMax = useMemo(() => {
    void extractorRoster; void colonyRoster; void logisticsA;
    return !canBuildExtractor(galaxySeed, system?.id ?? -1);
  }, [extractorRoster, colonyRoster, galaxySeed, system?.id, logisticsA]);
  const placeExtractor = useExtractorStore((s) => s.placeExtractor);
  const collectExtractor = useExtractorStore((s) => s.collectExtractor);
  const removeExtractor = useExtractorStore((s) => s.removeExtractor);
  const storageA = useUIStore((s) => s.storageA);
  const storageB = useUIStore((s) => s.storageB);
  const stockpileMaterials = useStockpileStore((s) => s.materials);
  const user = useAuthStore((s) => s.user);
  const [, setTick] = useState(0);

  const cap = computeStorageCap(storageA);
  const accumulated = extractor ? peekAccumulated(extractor) : 0;

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const planetName = selectedKey ? selectedKey.split('|')[2] : null;
  const planet = system?.planets?.find((p) => p.name === planetName) ?? null;

  const allResources = useMemo(() => {
    if (!planet) return [];
    const resources = planet.resources?.map((r) => ({ ...r })) ?? [];
    for (const moon of planet.moons) {
      for (const r of moon.resources ?? []) {
        const existing = resources.find((x) => x.type === r.type);
        if (existing) existing.count += r.count;
        else resources.push({ ...r });
      }
    }
    return resources;
  }, [planet]);

  if (!selectedKey || !system?.planets) return null;
  if (!planet) return null;

  const STATION_COST = 200;
  const STATION_REFUND = 50;

  function canAffordCost(cost: typeof FABRICATOR_COST | typeof FABRICATOR_UPGRADE_COST): boolean {
    return alloys >= cost.alloys && helium3Reserves >= cost.helium3
      && nutrients >= cost.nutrients && metallicHydrogen >= cost.metallicHydrogen;
  }

  function canAffordUpgrade(): boolean {
    return canAffordCost(FABRICATOR_UPGRADE_COST) && Object.entries(FABRICATOR_UPGRADE_MATERIALS).every(
      ([id, amt]) => (stockpileMaterials[id] ?? 0) >= amt,
    );
  }

  const canBuildHere = planet?.type === 'habitable' && !fabricator;

  const currentCargo: Record<Resource['type'], number> = {
    exotic: exoticMatter,
    'helium-3': helium3Reserves,
    alloys,
    nutrients,
    metallicHydrogen,
    neutronStarMatter: neutronMatter,
    alienMatter: useUIStore.getState().alienMatter,
  };
  const cargoSpace = extractor ? Math.max(0, cap - currentCargo[extractor.resourceType]) : 0;
  const collectable = Math.min(accumulated, cargoSpace);

  function handlePlace(resource: { type: Resource['type']; count: number }) {
    if (useUIStore.getState().checkDetectionLethal()) return;
    if (!system || alloys < STATION_COST || !canBuildExtractor(galaxySeed, system.id)) return;
    spendAlloys(STATION_COST);
    const now = Date.now();
    const key = makeExtractorKey(galaxySeed, system.id, planet!.name);
    const galaxyDot = supercluster.dots.find((d) => d.seed === galaxy.seed);
    const newExtractor: Extractor = {
      key,
      galaxySeed,
      systemId: system.id,
      systemName: system.name,
      planetName: planet!.name,
      resourceType: resource.type,
      rate: resource.count,
      placedAt: now,
      lastCollectedAt: now,
      systemX: system.x,
      systemY: system.y,
      galaxyX: galaxyDot?.x ?? 0,
      galaxyY: galaxyDot?.y ?? 0,
      superclusSeed: supercluster.seed,
    };
    placeExtractor(newExtractor);
    if (user) saveExtractor(user.uid, newExtractor);
  }

  function handleCollect() {
    if (!extractor || !selectedKey) return;
    const space = cargoSpace;
    if (space <= 0) return;
    const amount = collectExtractor(selectedKey, space);
    if (amount > 0) {
      addCargo(extractor.resourceType, amount);
      const newLastCollected = useExtractorStore.getState().extractors[selectedKey]?.lastCollectedAt ?? Date.now();
      if (user) updateExtractorCollected(user.uid, selectedKey, newLastCollected);
    }
  }

  function handleDismantle() {
    if (useUIStore.getState().checkDetectionLethal()) return;
    if (!selectedKey) return;
    removeExtractor(selectedKey);
    addCargo('alloys', STATION_REFUND);
    if (user) deleteExtractor(user.uid, selectedKey);
  }

  function handleSettle() {
    if (useUIStore.getState().checkDetectionLethal()) return;
    if (!system || !planet || planet.type !== 'habitable') return;
    if (fabricator || !canAffordCost(FABRICATOR_COST)) return;
    const cost = FABRICATOR_COST;
    spendAlloys(cost.alloys);
    consumeHelium3(cost.helium3);
    spendNutrients(cost.nutrients);
    spendMetallicHydrogen(cost.metallicHydrogen);
    const key = makeFabricatorKey(galaxySeed, system.id, planet.name);
    const galaxyDot = supercluster.dots.find((d) => d.seed === galaxy.seed);
    const newFabricator: Fabricator = {
      key,
      tier: 1,
      galaxySeed,
      systemId: system.id,
      systemName: system.name,
      planetName: planet.name,
      builtAt: Date.now(),
      systemX: system.x,
      systemY: system.y,
      galaxyX: galaxyDot?.x ?? 0,
      galaxyY: galaxyDot?.y ?? 0,
      superclusSeed: supercluster.seed,
    };
    useFabricatorStore.getState().placeFabricator(newFabricator);
    if (user) saveFabricator(user.uid, newFabricator);
  }

  function handleUpgradeFabricator() {
    if (useUIStore.getState().checkDetectionLethal()) return;
    if (!selectedKey || !fabricator || (fabricator.tier ?? 1) >= 2 || !canAffordUpgrade()) return;
    if (!useStockpileStore.getState().consumeMaterials(FABRICATOR_UPGRADE_MATERIALS)) return;
    spendAlloys(FABRICATOR_UPGRADE_COST.alloys);
    consumeHelium3(FABRICATOR_UPGRADE_COST.helium3);
    spendNutrients(FABRICATOR_UPGRADE_COST.nutrients);
    spendMetallicHydrogen(FABRICATOR_UPGRADE_COST.metallicHydrogen);
    if (!useFabricatorStore.getState().upgradeFabricator(selectedKey)) return;
    if (user) {
      const upgraded = useFabricatorStore.getState().fabricators[selectedKey];
      if (upgraded) saveFabricator(user.uid, upgraded);
      const { materials, rares } = useStockpileStore.getState();
      saveStockpile(user.uid, materials, rares);
    }
  }

  function handleAbandon() {
    if (!selectedKey) return;
    if (colony) return;
    useFabricatorStore.getState().removeFabricator(selectedKey);
    if (user) deleteFabricator(user.uid, selectedKey);
  }

  return createPortal(
    <div className="planet-panel-overlay" onClick={() => setSelectedPlanet(null)}>
      <div className="planet-panel" onClick={(e) => e.stopPropagation()}>
        <button className="planet-panel-close" onClick={() => setSelectedPlanet(null)}>✕</button>

        <div className="planet-panel-header">
          <span className={`planet-panel-zone-dot ${planet.type}`} />
          <div>
            <div className="planet-panel-name">{planet.name}</div>
            <div className="planet-panel-zone">{ZONE_LABELS[planet.type]}</div>
          </div>
        </div>

        <div className="planet-panel-section-label">SURFACE RESOURCES</div>
        <ul className="planet-panel-resources">
          {planet.resources ? planet.resources.map((r) => (
            <li key={r.type} className="planet-panel-resource">
              <span className={`planet-panel-resource-dot res-${r.type}`} />
              <span className="planet-panel-resource-label">{RESOURCE_LABELS[r.type]}</span>
              <span className="planet-panel-resource-count">{r.count}</span>
              <TierBadge type={r.type} count={r.count} />
            </li>
          )) : <span>Barren</span>}
        </ul>

        {planet.moons.length > 0 && (
          <>
            <div className="planet-panel-section-label">MOONS — {planet.moons.length}</div>
            <ul className="planet-panel-moons">
              {planet.moons.map((moon) => (
                <li key={moon.name} className="planet-panel-moon">
                  <span className="planet-panel-moon-name">{moon.name}</span>
                  <span className="planet-panel-moon-resources">
                    {moon.resources ? moon.resources.map((r) => `${r.count} ${RESOURCE_LABELS[r.type]}`).join(', ') : <span>Barren</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="planet-panel-divider" />

        {fabricator ? (
          <div className="planet-panel-fabricator">
            <div className="planet-panel-fabricator-label">
              {FABRICATOR_TIER_LABELS[fabricator.tier ?? 1].toUpperCase()} ACTIVE
            </div>
            <span className="planet-panel-fabricator-since">
              Established {new Date(fabricator.builtAt).toLocaleDateString()}
            </span>
            {extractor && (
              <div className="planet-panel-extractor">
                <div className="planet-panel-extractor-info">
                  <div className="planet-panel-extractor-header">
                    <span className="planet-panel-extractor-label">MINING STATION ACTIVE</span>
                    <TierBadge type={extractor.resourceType} count={extractor.rate} />
                  </div>
                  <span className="planet-panel-extractor-resource">
                    Harvesting: {RESOURCE_LABELS[extractor.resourceType]}
                  </span>
                  <span className="planet-panel-extractor-rate">+{extractor.rate} / hour · stores up to {EXTRACTOR_HOLD_CAPS[storageB]} · cargo cap {cap}</span>
                </div>
                <button
                  className={`planet-panel-btn${collectable === 0 ? ' planet-panel-btn--dim' : ''}`}
                  onClick={handleCollect}
                  disabled={collectable === 0}
                >
                  {collectable > 0
                    ? `Collect ${collectable} ${RESOURCE_LABELS[extractor.resourceType]}`
                    : cargoSpace === 0 ? 'Cargo full' : '(nothing yet)'}
                </button>
                <button className="planet-panel-btn planet-panel-btn--dismantle" onClick={handleDismantle}>
                  Dismantle Station (+{STATION_REFUND} alloys)
                </button>
              </div>
            )}
            {(fabricator.tier ?? 1) < 2 && (
              <div className="planet-panel-fabricator-option">
                {canAffordUpgrade() ? (
                  <button className="planet-panel-btn planet-panel-btn--settle" onClick={handleUpgradeFabricator}>
                    Upgrade to {FABRICATOR_TIER_LABELS[2]} ({costLabel(FABRICATOR_UPGRADE_COST)})
                  </button>
                ) : (
                  <button className="planet-panel-btn planet-panel-btn--dim" disabled>
                    {FABRICATOR_TIER_LABELS[2]} requires: {costLabel(FABRICATOR_UPGRADE_COST)}
                  </button>
                )}
                <span className="planet-panel-extractor-rate">
                  Plus {Object.entries(FABRICATOR_UPGRADE_MATERIALS)
                    .map(([id, amt]) => `${amt}x ${materialName(id)} (${stockpileMaterials[id] ?? 0} held)`)
                    .join(' · ')} — assembles rare components for future bases
                </span>
              </div>
            )}
            {fabricator.tier === 2 && !colony && <button className="planet-panel-btn" onClick={() => useColonyStore.getState().planCharter(fabricator.key)}>Stage colony charter · open delivery demand</button>}
            {colony && <ColonyDetails colonyKey={colony.key} />}
            <button className="planet-panel-btn planet-panel-btn--abandon" disabled={!!colony} onClick={handleAbandon}>
              Abandon {FABRICATOR_TIER_LABELS[fabricator.tier ?? 1]}
            </button>
          </div>
        ) : (
          <>
            {!extractor ? (
              atMax ? (
                <button className="planet-panel-btn planet-panel-btn--dim" disabled>
                  Max stations reached ({maxStations})
                </button>
              ) : allResources.length === 1 ? (
                allResources[0].type === 'neutronStarMatter' && logisticsA + logisticsB < UPGRADE_POOL ? (
                  <button className="planet-panel-btn planet-panel-btn--dim" disabled>
                    Requires full logistics upgrade ({logisticsA + logisticsB}/{UPGRADE_POOL})
                  </button>
                ) : (
                  <button
                    className={`planet-panel-btn${alloys < STATION_COST ? ' planet-panel-btn--dim' : ''}`}
                    onClick={() => handlePlace(allResources[0])}
                    disabled={alloys < STATION_COST}
                  >
                    {alloys < STATION_COST ? `Need ${STATION_COST} alloys` : `Place Mining Station (${STATION_COST} alloys)`}
                    {alloys >= STATION_COST && <TierBadge type={allResources[0].type} count={allResources[0].count} />}
                  </button>
                )
              ) : (
                <>
                  <div className="planet-panel-section-label">
                    MINE WHICH RESOURCE? · {STATION_COST} alloys
                  </div>
                  <div className="planet-panel-resource-picker">
                    {allResources.map((r) => (
                      <ResourcePickButton
                        key={r.type}
                        resource={r}
                        affordable={alloys >= STATION_COST}
                        locked={r.type === 'neutronStarMatter' && logisticsA + logisticsB < UPGRADE_POOL}
                        logisticsTier={logisticsA + logisticsB}
                        onPlace={handlePlace}
                      />
                    ))}
                    {alloys < STATION_COST && (
                      <span className="planet-panel-extractor-rate">Need {STATION_COST} alloys to build</span>
                    )}
                  </div>
                </>
              )
            ) : (
              <div className="planet-panel-extractor">
                <div className="planet-panel-extractor-info">
                  <div className="planet-panel-extractor-header">
                    <span className="planet-panel-extractor-label">MINING STATION ACTIVE</span>
                    <TierBadge type={extractor.resourceType} count={extractor.rate} />
                  </div>
                  <span className="planet-panel-extractor-resource">
                    Harvesting: {RESOURCE_LABELS[extractor.resourceType]}
                  </span>
                  <span className="planet-panel-extractor-rate">+{extractor.rate} / hour · stores up to {EXTRACTOR_HOLD_CAPS[storageB]} · cargo cap {cap}</span>
                </div>
                <button
                  className={`planet-panel-btn${collectable === 0 ? ' planet-panel-btn--dim' : ''}`}
                  onClick={handleCollect}
                  disabled={collectable === 0}
                >
                  {collectable > 0
                    ? `Collect ${collectable} ${RESOURCE_LABELS[extractor.resourceType]}`
                    : cargoSpace === 0 ? 'Cargo full' : '(nothing yet)'}
                </button>
                <button className="planet-panel-btn planet-panel-btn--dismantle" onClick={handleDismantle}>
                  Dismantle Station (+{STATION_REFUND} alloys)
                </button>
              </div>
            )}
            {canBuildHere && (
              <div className="planet-panel-settle-section">
                <div className="planet-panel-divider" />
                <div className="planet-panel-fabricator-option">
                  {canAffordCost(FABRICATOR_COST) ? (
                    <button className="planet-panel-btn planet-panel-btn--settle" onClick={handleSettle}>
                      Establish {FABRICATOR_TIER_LABELS[1]} ({costLabel(FABRICATOR_COST)})
                    </button>
                  ) : (
                    <button className="planet-panel-btn planet-panel-btn--dim" disabled>
                      {FABRICATOR_TIER_LABELS[1]} requires: {costLabel(FABRICATOR_COST)}
                    </button>
                  )}
                  <span className="planet-panel-extractor-rate">
                    Can be upgraded to an {FABRICATOR_TIER_LABELS[2]} once built
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
