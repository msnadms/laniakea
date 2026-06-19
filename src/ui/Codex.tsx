import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../store/authStore';
import { useCodexStore } from '../store/codexStore';
import { generateSystemLayout, generatePlanets } from '../game/planetGen';
import { STAR_TYPE_LABELS, buildAddressComponent } from '../game/types';
import { getSuperclusterCoords } from '../game/superclusters';
import { SC_ATTRACTOR_LABEL_MAX_DIST } from '../game/constants';
import type { GalaxyRecord, SuperclusterRecord, SystemRecord } from '../firebase/discoveries';
import './Codex.css';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';

interface EnrichedSystem extends SystemRecord {
  id: string;
}

interface EnrichedGalaxy extends GalaxyRecord {
  enrichedSystems: EnrichedSystem[];
}

interface EnrichedSupercluster extends SuperclusterRecord {
  enrichedGalaxies: EnrichedGalaxy[];
}

export function Codex() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="codex-btn" onClick={() => setOpen((o) => !o)}>
        <span className="codex-btn-icon">◈</span>
        <span className="codex-btn-label">Codex</span>
      </button>
      {open && createPortal(
        <div className="codex-overlay">
          <CodexDrawer onClose={() => setOpen(false)} />
        </div>,
        document.body,
      )}
    </>
  );
}

function CodexDrawer({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const superclusters = useCodexStore((s) => s.superclusters);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const enriched = useMemo<EnrichedSupercluster[]>(
    () =>
      Object.values(superclusters)
        .sort((a, b) => b.discoveredAt - a.discoveredAt)
        .map((sc) => ({
          ...sc,
          enrichedGalaxies: Object.values(sc.galaxies)
            .sort((a, b) => b.discoveredAt - a.discoveredAt)
            .map((g) => ({
              ...g,
              enrichedSystems: Object.entries(g.systems)
                .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                .map(([id, sys]) => ({ id, ...sys })),
            })),
        })),
    [superclusters],
  );

  const { totalGalaxies, totalStars } = useMemo(() => {
    let galaxies = 0; let stars = 0;
    for (const sc of enriched) {
      galaxies += sc.enrichedGalaxies.length;
      for (const g of sc.enrichedGalaxies) stars += g.enrichedSystems.length;
    }
    return { totalGalaxies: galaxies, totalStars: stars };
  }, [enriched]);

  const filtered = useMemo<EnrichedSupercluster[]>(() => {
    if (!q) return enriched;
    return enriched.flatMap((sc) => {
      const matchingGalaxies = sc.enrichedGalaxies.flatMap((g) => {
        const matchingSystems = g.enrichedSystems.filter((sys) =>
          sys.name.toLowerCase().includes(q),
        );
        const galMatches = g.galaxyName.toLowerCase().includes(q);
        if (!galMatches && matchingSystems.length === 0) return [];
        return [{ ...g, enrichedSystems: galMatches ? g.enrichedSystems : matchingSystems }];
      });
      const scMatches = sc.superclusterName.toLowerCase().includes(q);
      if (!scMatches && matchingGalaxies.length === 0) return [];
      return [{ ...sc, enrichedGalaxies: scMatches ? sc.enrichedGalaxies : matchingGalaxies }];
    });
  }, [enriched, q]);

  const hasDiscoveries = enriched.length > 0;

  return (
    <div className="codex-drawer">
      <div className="codex-header">
        <span className="codex-title">Discovery Codex</span>
        <button className="codex-close" onClick={onClose}>✕</button>
      </div>

      {!user ? (
        <div className="codex-empty">Sign in to save your discoveries across sessions.</div>
      ) : !hasDiscoveries ? (
        <>
          <div className="codex-stats">No discoveries yet</div>
          <div className="codex-empty">Explore galaxies and star systems to fill your codex.</div>
        </>
      ) : (
        <>
          <div className="codex-search">
            <input
              className="codex-search-input"
              type="text"
              placeholder="Search superclusters, galaxies, stars…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button className="codex-search-clear" onClick={() => setQuery('')}>✕</button>
            )}
          </div>
          <div className="codex-stats">
            {enriched.length} {enriched.length === 1 ? 'supercluster' : 'superclusters'} ·{' '}
            {totalGalaxies} {totalGalaxies === 1 ? 'galaxy' : 'galaxies'} ·{' '}
            {totalStars} {totalStars === 1 ? 'star' : 'stars'}
          </div>
          <div className="codex-list">
            {filtered.length === 0 ? (
              <div className="codex-empty">No matches for "{query}"</div>
            ) : (
              filtered.map((sc) => (
                <SuperclusterEntry key={sc.superclusterSeed} supercluster={sc} query={q} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function highlight(text: string, query: string) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="codex-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function pushAttractor(ui: ReturnType<typeof useUIStore.getState>, sc: ReturnType<typeof useGameStore.getState>['supercluster'], dotX: number, dotY: number) {
  let nearest = sc.attractors[0];
  let nearestDist = Infinity;
  for (const att of sc.attractors) {
    const d = Math.hypot(dotX - att.x, dotY - att.y);
    if (d < nearestDist) { nearestDist = d; nearest = att; }
  }
  if (nearest && nearestDist <= SC_ATTRACTOR_LABEL_MAX_DIST) {
    ui.pushAddress(buildAddressComponent(nearest.name, nearest.x, nearest.y, nearest.z, 'attractor'));
  } else {
    ui.removeAddressType('attractor');
  }
}

function travelToSupercluster(scSeed: number, scName: string) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  ui.clearAddress();
  game.regenerateSupercluster(scSeed);
  const [x, y, z] = getSuperclusterCoords(scSeed);
  ui.pushAddress(buildAddressComponent(scName, x, y, z, 'supercluster'));
  ui.removeAddressType('attractor');
  ui.setView('supercluster');
}

function travelToGalaxy(scSeed: number, scName: string, galaxySeed: number, galaxyName: string) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  ui.clearAddress();
  if (game.supercluster.seed !== scSeed) game.regenerateSupercluster(scSeed);
  game.regenerateGalaxy(galaxySeed);
  const sc = useGameStore.getState().supercluster;
  game.markDotVisited(galaxySeed);
  const dot = sc.dots.find((d) => d.seed === galaxySeed);
  const [scx, scy, scz] = getSuperclusterCoords(scSeed);
  ui.pushAddress(buildAddressComponent(scName, scx, scy, scz, 'supercluster'));
  pushAttractor(ui, sc, dot?.x ?? 0, dot?.y ?? 0);
  ui.pushAddress(buildAddressComponent(galaxyName, dot?.x ?? 0, dot?.y ?? 0, dot?.z ?? 0, 'galaxy'));
  ui.setView('galaxy');
}

function travelToSystem(
  scSeed: number, scName: string,
  galaxySeed: number, galaxyName: string,
  systemId: string, systemName: string,
) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  ui.clearAddress();
  if (game.supercluster.seed !== scSeed) game.regenerateSupercluster(scSeed);
  game.regenerateGalaxy(galaxySeed);
  const state = useGameStore.getState();
  const system = state.galaxy.systems.find((s) => String(s.id) === systemId);
  if (!system) return;
  game.markDotVisited(galaxySeed);
  game.markSystemVisited(system.id);
  game.setSystem(system);
  const dot = state.supercluster.dots.find((d) => d.seed === galaxySeed);
  const [scx, scy, scz] = getSuperclusterCoords(scSeed);
  ui.pushAddress(buildAddressComponent(scName, scx, scy, scz, 'supercluster'));
  pushAttractor(ui, state.supercluster, dot?.x ?? 0, dot?.y ?? 0);
  ui.pushAddress(buildAddressComponent(galaxyName, dot?.x ?? 0, dot?.y ?? 0, dot?.z ?? 0, 'galaxy'));
  ui.pushAddress(buildAddressComponent(systemName, system.x, system.y, 0, 'system'));
  ui.setView('system');
}

function SuperclusterEntry({ supercluster, query }: { supercluster: EnrichedSupercluster; query: string }) {
  const [expanded, setExpanded] = useState(true);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;

  return (
    <div className="codex-supercluster">
      <div className="codex-supercluster-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-supercluster-name">{highlight(supercluster.superclusterName, query)}</span>
        <span className="codex-supercluster-count">
          {supercluster.enrichedGalaxies.length} {supercluster.enrichedGalaxies.length === 1 ? 'galaxy' : 'galaxies'}
        </span>
        <button
          className="codex-travel-btn"
          title="Travel to supercluster"
          onClick={(e) => { e.stopPropagation(); travelToSupercluster(supercluster.superclusterSeed, supercluster.superclusterName); }}
        >⊙</button>
      </div>
      {isOpen && (
        <div className="codex-sc-galaxies">
          {supercluster.enrichedGalaxies.map((g) => (
            <GalaxyEntry key={g.galaxySeed} galaxy={g} query={query} superclusterSeed={supercluster.superclusterSeed} superclusterName={supercluster.superclusterName} />
          ))}
        </div>
      )}
    </div>
  );
}

function GalaxyEntry({ galaxy, query, superclusterSeed, superclusterName }: { galaxy: EnrichedGalaxy; query: string; superclusterSeed: number; superclusterName: string }) {
  const [expanded, setExpanded] = useState(false);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;

  return (
    <div className="codex-galaxy">
      <div className="codex-galaxy-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-galaxy-name">{highlight(galaxy.galaxyName, query)}</span>
        <span className="codex-galaxy-count">
          {galaxy.enrichedSystems.length} {galaxy.enrichedSystems.length === 1 ? 'star' : 'stars'}
        </span>
        <button
          className="codex-travel-btn"
          title="Travel to galaxy"
          onClick={(e) => { e.stopPropagation(); travelToGalaxy(superclusterSeed, superclusterName, galaxy.galaxySeed, galaxy.galaxyName); }}
        >⊙</button>
      </div>
      {isOpen && galaxy.enrichedSystems.length > 0 && (
        <div className="codex-systems">
          {galaxy.enrichedSystems.map((sys) => (
            <SystemEntry key={sys.id} system={sys} query={query} superclusterSeed={superclusterSeed} superclusterName={superclusterName} galaxySeed={galaxy.galaxySeed} galaxyName={galaxy.galaxyName} />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemPlanets({ seed, name, query }: { seed: number; name: string; query: string }) {
  const planets = useMemo(
    () => generatePlanets(generateSystemLayout(seed), name),
    [seed, name],
  );
  return (
    <div className="codex-planets">
      {planets.map((planet) => (
        <div key={planet.name} className="codex-planet">
          <div className="codex-planet-row">
            <span className={`codex-zone-dot ${planet.type}`} />
            <span className="codex-planet-name">{highlight(planet.name, query)}</span>
          </div>
          {planet.moons.length > 0 && (
            <div className="codex-moons">
              {planet.moons.map((moon) => (
                <span key={moon.name} className="codex-moon">
                  {highlight(moon.name, query)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SystemEntry({ system, query, superclusterSeed, superclusterName, galaxySeed, galaxyName }: { system: EnrichedSystem; query: string; superclusterSeed: number; superclusterName: string; galaxySeed: number; galaxyName: string }) {
  const [expanded, setExpanded] = useState(false);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;

  return (
    <div className="codex-system">
      <div className="codex-system-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-system-name">{highlight(system.name, query)}</span>
        <span className="codex-star-type">{STAR_TYPE_LABELS[system.starType]}</span>
        <button
          className="codex-travel-btn"
          title="Travel to system"
          onClick={(e) => { e.stopPropagation(); travelToSystem(superclusterSeed, superclusterName, galaxySeed, galaxyName, system.id, system.name); }}
        >⊙</button>
      </div>
      {isOpen && <SystemPlanets seed={system.seed} name={system.name} query={query} />}
    </div>
  );
}
