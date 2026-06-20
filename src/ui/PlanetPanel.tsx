import { createPortal } from 'react-dom';
import { useState, useEffect, useMemo } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { useExtractorStore, ACCUMULATION_RATE_PER_MS, MAX_STATIONS } from '../store/extractorStore';
import { makeExtractorKey } from '../game/types';
import type { Extractor, Resource } from '../game/types';
import { saveExtractor, updateExtractorCollected, deleteExtractor } from '../firebase/extractors';
import './PlanetPanel.css';

const ZONE_LABELS: Record<string, string> = {
  hot: 'Hot Zone',
  marginal: 'Marginal Zone',
  habitable: 'Habitable Zone',
  gas: 'Gas Giant',
  ice: 'Ice Planet',
};

const RESOURCE_LABELS: Record<string, string> = {
  exotic: 'Exotic Matter',
  alloys: 'Alloys',
  nutrients: 'Nutrients',
  'helium-3': 'Helium-3',
};

function getAccumulated(extractor: Extractor): number {
  return Math.floor((Date.now() - extractor.lastCollectedAt) * ACCUMULATION_RATE_PER_MS * extractor.rate);
}

export function PlanetPanel() {
  const selectedKey = useUIStore((s) => s.selectedPlanetKey);
  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);
  const addCargo = useUIStore((s) => s.addCargo);
  const spendAlloys = useUIStore((s) => s.spendAlloys);
  const alloys = useUIStore((s) => s.alloys);
  const system = useGameStore((s) => s.system);
  const galaxySeed = useGameStore((s) => s.galaxy.seed);
  const extractor = useExtractorStore((s) => selectedKey ? s.extractors[selectedKey] : undefined);
  const atMax = useExtractorStore((s) => Object.keys(s.extractors).length >= MAX_STATIONS);
  const placeExtractor = useExtractorStore((s) => s.placeExtractor);
  const collectExtractor = useExtractorStore((s) => s.collectExtractor);
  const removeExtractor = useExtractorStore((s) => s.removeExtractor);
  const user = useAuthStore((s) => s.user);
  const [accumulated, setAccumulated] = useState(0);

  useEffect(() => {
    setAccumulated(extractor ? getAccumulated(extractor) : 0);
  }, [extractor]);

  useEffect(() => {
    if (!extractor) return;
    const key = extractor.key;
    const id = setInterval(() => {
      const current = useExtractorStore.getState().extractors[key];
      if (current) setAccumulated(getAccumulated(current));
    }, 5000);
    return () => clearInterval(id);
  }, [extractor?.key]);

  const planetName = selectedKey ? selectedKey.split('|')[2] : null;
  const planet = system?.planets?.find((p) => p.name === planetName) ?? null;

  const allResources = useMemo(() => {
    if (!planet) return [];
    const resources = planet.resources.map((r) => ({ ...r }));
    for (const moon of planet.moons) {
      for (const r of moon.resources) {
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
    const amount = collectExtractor(selectedKey);
    if (amount > 0) {
      addCargo(extractor.resourceType, amount);
      if (user) updateExtractorCollected(user.uid, selectedKey, Date.now());
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
          {planet.resources.map((r) => (
            <li key={r.type} className="planet-panel-resource">
              <span className={`planet-panel-resource-dot res-${r.type}`} />
              <span className="planet-panel-resource-label">{RESOURCE_LABELS[r.type]}</span>
              <span className="planet-panel-resource-count">{r.count}</span>
            </li>
          ))}
        </ul>

        {planet.moons.length > 0 && (
          <>
            <div className="planet-panel-section-label">MOONS — {planet.moons.length}</div>
            <ul className="planet-panel-moons">
              {planet.moons.map((moon) => (
                <li key={moon.name} className="planet-panel-moon">
                  <span className="planet-panel-moon-name">{moon.name}</span>
                  <span className="planet-panel-moon-resources">
                    {moon.resources.map((r) => `${r.count} ${RESOURCE_LABELS[r.type]}`).join(', ')}
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
              Max stations reached ({MAX_STATIONS})
            </button>
          ) : allResources.length === 1 ? (
            <button
              className={`planet-panel-btn${alloys < STATION_COST ? ' planet-panel-btn--dim' : ''}`}
              onClick={() => handlePlace(allResources[0])}
              disabled={alloys < STATION_COST}
            >
              {alloys < STATION_COST ? `Need ${STATION_COST} alloys` : `Place Mining Station (${STATION_COST} alloys)`}
            </button>
          ) : (
            <>
              <div className="planet-panel-section-label">
                MINE WHICH RESOURCE? · {STATION_COST} alloys
              </div>
              <div className="planet-panel-resource-picker">
                {allResources.map((r) => (
                  <button
                    key={r.type}
                    className={`planet-panel-btn planet-panel-btn--pick${alloys < STATION_COST ? ' planet-panel-btn--dim' : ''}`}
                    onClick={() => handlePlace(r)}
                    disabled={alloys < STATION_COST}
                  >
                    <span className={`planet-panel-resource-dot res-${r.type}`} />
                    {RESOURCE_LABELS[r.type]} ({r.count}/min)
                  </button>
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
              <span className="planet-panel-extractor-label">MINING STATION ACTIVE</span>
              <span className="planet-panel-extractor-resource">
                Harvesting: {RESOURCE_LABELS[extractor.resourceType]}
              </span>
              <span className="planet-panel-extractor-rate">+{extractor.rate} / min · cargo cap 500</span>
            </div>
            <button
              className={`planet-panel-btn${accumulated === 0 ? ' planet-panel-btn--dim' : ''}`}
              onClick={handleCollect}
              disabled={accumulated === 0}
            >
              Collect {accumulated > 0 ? `${accumulated} ${RESOURCE_LABELS[extractor.resourceType]}` : '(nothing yet)'}
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
