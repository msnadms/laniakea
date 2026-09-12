import { createPortal } from 'react-dom';
import { getAnomalyLore } from '../game/anomalyLore';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import type { ZoneType } from '../game/types';
import './PlanetPanel.css';
import './AnomalyToast.css';

const ZONE_LABELS: Record<ZoneType, string> = {
  hot: 'Hot Zone',
  marginal: 'Marginal Zone',
  habitable: 'Habitable Zone',
  populated: 'Populated Habitable',
  ecumenopolis: 'Ecumenopolis',
  foundry: 'Foundry World',
  gas: 'Gas Giant',
  ice: 'Ice Planet',
};

const ANOMALY_WORLDS: ReadonlySet<ZoneType> = new Set(['ecumenopolis', 'foundry']);

export function PlanetPanel() {
  const selectedName = useUIStore((s) => s.selectedPlanetName);
  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);
  const planet = useGameStore((s) => s.system?.planets?.find((p) => p.name === selectedName) ?? null);
  const hostAnomaly = useGameStore((s) => (s.system ? s.galaxyAnomalies.byHost.get(s.system.id) : undefined) ?? null);

  if (!planet) return null;
  const anomalyLore = hostAnomaly && ANOMALY_WORLDS.has(planet.type) ? getAnomalyLore(hostAnomaly) : null;

  function openAnomaly() {
    setSelectedPlanet(null);
    useUIStore.getState().setAnomalyPanelOpen(true);
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

        {anomalyLore && (
          <button className={`planet-panel-anomaly anomaly-tier-${anomalyLore.tier.toLowerCase()}`} onClick={openAnomaly}>
            ◬ {anomalyLore.name}
          </button>
        )}

        <div className="planet-panel-section-label">
          {planet.moons.length > 0 ? `MOONS — ${planet.moons.length}` : 'NO MOONS'}
        </div>
        {planet.moons.length > 0 && (
          <ul className="planet-panel-moons">
            {planet.moons.map((moon) => (
              <li key={moon.name} className="planet-panel-moon">
                <span className="planet-panel-moon-name">{moon.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
