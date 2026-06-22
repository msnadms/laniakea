import { createPortal } from 'react-dom';
import { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { useExtractorStore, peekAccumulated } from '../store/extractorStore';
import { EXTRACTOR_HOLD_CAPS, computeStorageCap, computeLogisticsCap, UPGRADE_POOL } from '../store/uiStore';
import { makeExtractorKey, RESOURCE_LABELS } from '../game/types';
import type { Extractor, Resource } from '../game/types';
import { RESOURCE_MAX_RATE } from '../game/planetGen';
import { saveExtractor, updateExtractorCollected, deleteExtractor } from '../firebase/extractors';
import './PlanetPanel.css';

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

const ZONE_LABELS: Record<string, string> = {
  hot: 'Hot Zone',
  marginal: 'Marginal Zone',
  habitable: 'Habitable Zone',
  gas: 'Gas Giant',
  ice: 'Ice Planet',
};

export function PlanetPanel() {
  const selectedKey = useUIStore((s) => s.selectedPlanetKey);
  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);
  const addCargo = useUIStore((s) => s.addCargo);
  const spendAlloys = useUIStore((s) => s.spendAlloys);
  const alloys = useUIStore((s) => s.alloys);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const nutrients = useUIStore((s) => s.nutrients);
  const hydrogen = 0;
  const neutronMatter = 0;
  const system = useGameStore((s) => s.system);
  const galaxySeed = useGameStore((s) => s.galaxy.seed);
  const extractor = useExtractorStore((s) => selectedKey ? s.extractors[selectedKey] : undefined);
  const logisticsA = useUIStore((s) => s.logisticsA);
  const logisticsB = useUIStore((s) => s.logisticsB);
  const maxStations = computeLogisticsCap(logisticsA);
  const atMax = useExtractorStore((s) => Object.keys(s.extractors).length >= maxStations);
  const placeExtractor = useExtractorStore((s) => s.placeExtractor);
  const collectExtractor = useExtractorStore((s) => s.collectExtractor);
  const removeExtractor = useExtractorStore((s) => s.removeExtractor);
  const storageA = useUIStore((s) => s.storageA);
  const storageB = useUIStore((s) => s.storageB);
  const user = useAuthStore((s) => s.user);
  const [accumulated, setAccumulated] = useState(0);

  const cap = computeStorageCap(storageA);

  useEffect(() => {
    setAccumulated(extractor ? peekAccumulated(extractor) : 0);
  }, [extractor, storageB, logisticsB]);

  useEffect(() => {
    if (!extractor) return;
    const key = extractor.key;
    const id = setInterval(() => {
      const current = useExtractorStore.getState().extractors[key];
      if (current) setAccumulated(peekAccumulated(current));
    }, 5000);
    return () => clearInterval(id);
  }, [extractor?.key]);

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

  const currentCargo: Record<Resource['type'], number> = {
    exotic: exoticMatter,
    'helium-3': helium3Reserves,
    alloys,
    nutrients,
    metallicHydrogen: hydrogen,
    neutronStarMatter: neutronMatter
  };
  const cargoSpace = extractor ? Math.max(0, cap - currentCargo[extractor.resourceType]) : 0;
  const collectable = Math.min(accumulated, cargoSpace);

  function handlePlace(resource: { type: Resource['type']; count: number }) {
    if (!system || alloys < STATION_COST) return;
    spendAlloys(STATION_COST);
    const now = Date.now();
    const key = makeExtractorKey(galaxySeed, system.id, planet!.name);
    const newExtractor: Extractor = {
      key,
      galaxySeed,
      systemId: system.id,
      planetName: planet!.name,
      resourceType: resource.type,
      rate: resource.count,
      placedAt: now,
      lastCollectedAt: now,
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
    if (!selectedKey) return;
    removeExtractor(selectedKey);
    addCargo('alloys', STATION_REFUND);
    if (user) deleteExtractor(user.uid, selectedKey);
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
                {allResources.map((r) => {
                  const neutronLocked = r.type === 'neutronStarMatter' && logisticsA + logisticsB < UPGRADE_POOL;
                  return (
                    <button
                      key={r.type}
                      className={`planet-panel-btn planet-panel-btn--pick${alloys < STATION_COST || neutronLocked ? ' planet-panel-btn--dim' : ''}`}
                      onClick={() => handlePlace(r)}
                      disabled={alloys < STATION_COST || neutronLocked}
                    >
                      <span className={`planet-panel-resource-dot res-${r.type}`} />
                      {neutronLocked
                        ? `${RESOURCE_LABELS[r.type]} (logistics ${logisticsA + logisticsB}/${UPGRADE_POOL})`
                        : `${RESOURCE_LABELS[r.type]} (${r.count}/min)`}
                      {!neutronLocked && <TierBadge type={r.type} count={r.count} />}
                    </button>
                  );
                })}
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
              <span className="planet-panel-extractor-rate">+{extractor.rate * 3} / hour · stores up to {EXTRACTOR_HOLD_CAPS[storageB]} · cargo cap {cap}</span>
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
      </div>
    </div>,
    document.body,
  );
}
