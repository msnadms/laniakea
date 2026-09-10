import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../store/authStore';
import { useCodexStore } from '../store/codexStore';
import { generateSystemLayout, generatePlanets } from '../game/planetGen';
import { STAR_TYPE_LABELS, type StarType } from '../game/types';
import type { GalaxyRecord, SuperclusterRecord, SystemRecord } from '../firebase/discoveries';
import { deleteSystemDiscovery, deleteGalaxyDiscovery, deleteSuperclusterDiscovery } from '../firebase/discoveries';
import './Codex.css';
import { useUIStore } from '../store/uiStore';
import { fireCodexNavigate } from '../pixi/zoomAnim';
import { travelToSupercluster, travelToGalaxy, travelToSystem } from './navigation';

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
        <svg className="codex-btn-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <polygon
            vectorEffect="non-scaling-stroke"
            points="0,0.1 0.61,0.1 0.95,1 0.35,1"
            fill="transparent"
            stroke="rgba(0, 190, 230, 0.55)"
            strokeWidth="1"
            pointerEvents="all"
          />
        </svg>
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
  const deleteSystem = useCodexStore((s) => s.deleteSystem);
  const deleteGalaxy = useCodexStore((s) => s.deleteGalaxy);
  const deleteSupercluster = useCodexStore((s) => s.deleteSupercluster);
  const [query, setQuery] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);
  const q = query.trim().toLowerCase();

  function handleDeleteSystem(scSeed: number, galaxySeed: number, systemId: string) {
    deleteSystem(scSeed, galaxySeed, systemId);
    if (user) deleteSystemDiscovery(user.uid, scSeed, galaxySeed, systemId);
  }

  function handleDeleteGalaxy(scSeed: number, galaxySeed: number) {
    deleteGalaxy(scSeed, galaxySeed);
    if (user) deleteGalaxyDiscovery(user.uid, scSeed, galaxySeed);
  }

  function handleDeleteSupercluster(scSeed: number) {
    deleteSupercluster(scSeed);
    if (user) deleteSuperclusterDiscovery(user.uid, scSeed);
  }

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

  function handleNavigate(travel: () => void) {
    onClose();
    const animated = fireCodexNavigate(
      () => useUIStore.getState().setViewTransitioning(true),
      travel,
    );
    if (!animated) travel();
  }

  return (
    <div className={`codex-drawer${deleteMode ? ' codex-delete-mode' : ''}`}>
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
          {deleteMode ? (
            <div className="codex-forget-banner">Select entries to forget — this cannot be undone.</div>
          ) : (
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
          )}
          <div className="codex-stats">
            <span>
              {enriched.length} {enriched.length === 1 ? 'supercluster' : 'superclusters'} -{' '}
              {totalGalaxies} {totalGalaxies === 1 ? 'galaxy' : 'galaxies'} -{' '}
              {totalStars} {totalStars === 1 ? 'star' : 'stars'}
            </span>
            <button
              className={`codex-forget-btn${deleteMode ? ' active' : ''}`}
              title={deleteMode ? 'Exit forget mode' : 'Forget records'}
              onClick={() => { setDeleteMode((m) => !m); setQuery(''); }}
            >⊘</button>
          </div>
          <div className="codex-list">
            {filtered.length === 0 ? (
              <div className="codex-empty">No matches for "{query}"</div>
            ) : (
              filtered.map((sc) => (
                <SuperclusterEntry
                  key={sc.superclusterSeed}
                  supercluster={sc}
                  query={q}
                  deleteMode={deleteMode}
                  onNavigate={handleNavigate}
                  onDeleteSupercluster={handleDeleteSupercluster}
                  onDeleteGalaxy={handleDeleteGalaxy}
                  onDeleteSystem={handleDeleteSystem}
                />
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

interface EntryHandlers {
  onNavigate: (travel: () => void) => void;
  onDeleteSupercluster: (scSeed: number) => void;
  onDeleteGalaxy: (scSeed: number, galaxySeed: number) => void;
  onDeleteSystem: (scSeed: number, galaxySeed: number, systemId: string) => void;
}

function SuperclusterEntry({ supercluster, query, deleteMode, onNavigate, onDeleteSupercluster, onDeleteGalaxy, onDeleteSystem }: { supercluster: EnrichedSupercluster; query: string; deleteMode: boolean } & EntryHandlers) {
  const [expanded, setExpanded] = useState(true);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;

  return (
    <div className="codex-supercluster">
      <div className="codex-supercluster-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-supercluster-name">{highlight(supercluster.superclusterName, query)}</span>
        <div className="codex-row-right">
          <span className="codex-supercluster-count">
            {supercluster.enrichedGalaxies.length} {supercluster.enrichedGalaxies.length === 1 ? 'galaxy' : 'galaxies'}
          </span>
          {deleteMode ? (
            <button
              className="codex-delete-btn"
              title="Forget supercluster"
              onClick={(e) => { e.stopPropagation(); onDeleteSupercluster(supercluster.superclusterSeed); }}
            >✕</button>
          ) : (
            <button
              className="codex-travel-btn"
              title="Travel to supercluster"
              onClick={(e) => { e.stopPropagation(); onNavigate(() => travelToSupercluster(supercluster.superclusterSeed, supercluster.superclusterName)); }}
            >⊙</button>
          )}
        </div>
      </div>
      {isOpen && (
        <div className="codex-sc-galaxies">
          {supercluster.enrichedGalaxies.map((g) => (
            <GalaxyEntry
              key={g.galaxySeed}
              galaxy={g}
              query={query}
              superclusterSeed={supercluster.superclusterSeed}
              superclusterName={supercluster.superclusterName}
              deleteMode={deleteMode}
              onNavigate={onNavigate}
              onDeleteGalaxy={onDeleteGalaxy}
              onDeleteSystem={onDeleteSystem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GalaxyEntry({ galaxy, query, superclusterSeed, superclusterName, deleteMode, onNavigate, onDeleteGalaxy, onDeleteSystem }: { galaxy: EnrichedGalaxy; query: string; superclusterSeed: number; superclusterName: string; deleteMode: boolean } & Omit<EntryHandlers, 'onDeleteSupercluster'>) {
  const [expanded, setExpanded] = useState(false);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;
  const hasHabitable = useMemo(
    () => galaxy.enrichedSystems.some((s) => systemHasHabitable(s.seed, s.starType)),
    [galaxy.enrichedSystems],
  );

  return (
    <div className="codex-galaxy">
      <div className="codex-galaxy-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-galaxy-name">
          {highlight(galaxy.galaxyName, query)}
          {hasHabitable && <span className="codex-habitable-dot" title="Contains habitable planet" />}
        </span>
        <div className="codex-row-right">
          <span className="codex-galaxy-count">
            {galaxy.enrichedSystems.length} {galaxy.enrichedSystems.length === 1 ? 'star' : 'stars'}
          </span>
          {deleteMode ? (
            <button
              className="codex-delete-btn"
              title="Forget galaxy"
              onClick={(e) => { e.stopPropagation(); onDeleteGalaxy(superclusterSeed, galaxy.galaxySeed); }}
            >✕</button>
          ) : (
            <button
              className="codex-travel-btn"
              title="Travel to galaxy"
              onClick={(e) => { e.stopPropagation(); onNavigate(() => travelToGalaxy(superclusterSeed, superclusterName, galaxy.galaxySeed, galaxy.galaxyName)); }}
            >⊙</button>
          )}
        </div>
      </div>
      {isOpen && galaxy.enrichedSystems.length > 0 && (
        <div className="codex-systems">
          {galaxy.enrichedSystems.map((sys) => (
            <SystemEntry
              key={sys.id}
              system={sys}
              query={query}
              superclusterSeed={superclusterSeed}
              superclusterName={superclusterName}
              galaxySeed={galaxy.galaxySeed}
              galaxyName={galaxy.galaxyName}
              deleteMode={deleteMode}
              onNavigate={onNavigate}
              onDeleteSystem={onDeleteSystem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function systemHasHabitable(seed: number, starType?: StarType): boolean {
  if (starType === 'L') return false;
  return generateSystemLayout(seed, starType).planets.some((p) => p.zone === 'habitable');
}

function SystemPlanets({ seed, starType, query }: { seed: number; starType?: StarType; query: string }) {
  const planets = useMemo(
    () => generatePlanets(generateSystemLayout(seed, starType)),
    [seed, starType],
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

function SystemEntry({ system, query, superclusterSeed, superclusterName, galaxySeed, galaxyName, deleteMode, onNavigate, onDeleteSystem }: { system: EnrichedSystem; query: string; superclusterSeed: number; superclusterName: string; galaxySeed: number; galaxyName: string; deleteMode: boolean; onNavigate: EntryHandlers['onNavigate']; onDeleteSystem: EntryHandlers['onDeleteSystem'] }) {
  const [expanded, setExpanded] = useState(false);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;
  const hasHabitable = useMemo(() => systemHasHabitable(system.seed, system.starType), [system.seed, system.starType]);

  return (
    <div className="codex-system">
      <div className="codex-system-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-system-name">
          {highlight(system.name, query)}
          {hasHabitable && <span className="codex-habitable-dot" title="Contains habitable planet" />}
        </span>
        <div className="codex-row-right">
          <span className="codex-star-type">{STAR_TYPE_LABELS[system.starType]}</span>
          {deleteMode ? (
            <button
              className="codex-delete-btn"
              title="Forget system"
              onClick={(e) => { e.stopPropagation(); onDeleteSystem(superclusterSeed, galaxySeed, system.id); }}
            >✕</button>
          ) : (
            <button
              className="codex-travel-btn"
              title="Travel to system"
              onClick={(e) => { e.stopPropagation(); onNavigate(() => travelToSystem(superclusterSeed, superclusterName, galaxySeed, galaxyName, system.id, system.name)); }}
            >⊙</button>
          )}
        </div>
      </div>
      {isOpen && <SystemPlanets seed={system.seed} starType={system.starType} query={query} />}
    </div>
  );
}
