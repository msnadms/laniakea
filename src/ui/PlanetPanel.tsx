import { createPortal } from 'react-dom';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import type { ZoneType } from '../game/types';
import './PlanetPanel.css';

const ZONE_LABELS: Record<ZoneType, string> = {
  hot: 'Hot Zone',
  marginal: 'Marginal Zone',
  habitable: 'Habitable Zone',
  gas: 'Gas Giant',
  ice: 'Ice Planet',
};

export function PlanetPanel() {
  const selectedName = useUIStore((s) => s.selectedPlanetName);
  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);
  const planet = useGameStore((s) => s.system?.planets?.find((p) => p.name === selectedName) ?? null);

  if (!planet) return null;

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
