import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../store/authStore';
import { useCodexStore } from '../store/codexStore';
import { generateSystemLayout, generatePlanets } from '../game/planetGen';
import { STAR_TYPE_LABELS, buildAddressComponent } from '../game/types';
import { getSuperclusterCoords, pushAttractorAddress } from '../game/superclusters';
import { galaxyTravelCost, superclusterTravelCost, flatTravelCost, trySpendTravelCost } from '../store/travelCosts';
import type { GalaxyRecord, SuperclusterRecord, SystemRecord } from '../firebase/discoveries';
import { deleteSystemDiscovery, deleteGalaxyDiscovery, deleteSuperclusterDiscovery } from '../firebase/discoveries';
import './Codex.css';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { fireCodexNavigate } from '../pixi/zoomAnim';
import { MSG_DRIVE_REQUIRED_GALAXY, MSG_DRIVE_REQUIRED_SUPERCLUSTER } from './strings';
import { useExtractorStore } from '../store/extractorStore';
import { useFabricatorStore } from '../store/fabricatorStore';

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
  const allExtractorKeys = useExtractorStore((s) => Object.keys(s.extractors).sort().join('\0'));
  const allFabricatorKeys = useFabricatorStore((s) => Object.keys(s.fabricators).sort().join('\0'));
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

  function handleNavigate(preCheck: () => boolean, travel: () => void) {
    if (!preCheck()) return;
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
              {enriched.length} {enriched.length === 1 ? 'supercluster' : 'superclusters'} ·{' '}
              {totalGalaxies} {totalGalaxies === 1 ? 'galaxy' : 'galaxies'} ·{' '}
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
                  allExtractorKeys={allExtractorKeys}
                  allFabricatorKeys={allFabricatorKeys}
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

function pushAttractor(ui: ReturnType<typeof useUIStore.getState>, sc: ReturnType<typeof useGameStore.getState>['supercluster'], dotX: number, dotY: number) {
  pushAttractorAddress(sc.attractors, dotX, dotY, ui.pushAddress, ui.removeAddressType);
}

function canTravelToSupercluster(scSeed: number): boolean {
  const { supercluster } = useGameStore.getState();
  const { driveA, triggerHudNotify } = useUIStore.getState();
  if (supercluster.seed !== scSeed && driveA < 2) {
    triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
    return false;
  }
  return true;
}

function canTravelToGalaxy(scSeed: number, galaxySeed: number): boolean {
  const game = useGameStore.getState();
  const { driveA, triggerHudNotify } = useUIStore.getState();
  const isCurrent = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed;
  if (!isCurrent) {
    if (game.supercluster.seed !== scSeed) {
      if (driveA < 2) { triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER); return false; }
    } else if (driveA < 1) {
      triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY);
      return false;
    }
  }
  return true;
}

function canTravelToSystem(scSeed: number, galaxySeed: number, systemId: string): boolean {
  const game = useGameStore.getState();
  const { driveA, triggerHudNotify } = useUIStore.getState();
  const isCurrent = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed && String(game.system?.id) === systemId;
  if (!isCurrent) {
    if (game.supercluster.seed !== scSeed) {
      if (driveA < 2) { triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER); return false; }
    } else if (game.galaxy.seed !== galaxySeed) {
      if (driveA < 1) { triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY); return false; }
    }
  }
  return true;
}

function travelToSupercluster(scSeed: number, scName: string) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  if (ui.checkDetectionLethal()) return;
  if (game.supercluster.seed !== scSeed) {
    if (ui.driveA < 2) {
      ui.triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
      return;
    }
    if (!trySpendTravelCost(flatTravelCost(50))) return;
  }
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
  if (ui.checkDetectionLethal()) return;
  const isCurrent = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed;
  if (!isCurrent) {
    let cost: { exotic: number; helium: number };
    if (game.supercluster.seed !== scSeed) {
      if (ui.driveA < 2) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
        return;
      }
      cost = flatTravelCost(50);
    } else {
      if (ui.driveA < 1) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY);
        return;
      }
      const currentDot = game.supercluster.dots.find((d) => d.seed === game.galaxy.seed);
      const targetDot = game.supercluster.dots.find((d) => d.seed === galaxySeed);
      const dist = Math.hypot((targetDot?.x ?? 0) - (currentDot?.x ?? 0), (targetDot?.y ?? 0) - (currentDot?.y ?? 0));
      cost = superclusterTravelCost(dist);
    }
    if (!trySpendTravelCost(cost)) return;
  }
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
  if (ui.checkDetectionLethal()) return;
  const isCurrent = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed && String(game.system?.id) === systemId;
  if (!isCurrent) {
    let cost: { exotic: number; helium: number };
    if (game.supercluster.seed !== scSeed) {
      if (ui.driveA < 2) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
        return;
      }
      cost = flatTravelCost(50);
    } else if (game.galaxy.seed !== galaxySeed) {
      if (ui.driveA < 1) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY);
        return;
      }
      cost = flatTravelCost(15);
    } else {
      const currentSystem = game.system;
      const fromX = currentSystem?.x ?? 0;
      const fromY = currentSystem?.y ?? 0;
      const targetSys = game.galaxy.systems.find((s) => String(s.id) === systemId);
      const dist = Math.hypot((targetSys?.x ?? 0) - fromX, (targetSys?.y ?? 0) - fromY);
      cost = galaxyTravelCost(dist);
    }
    if (!trySpendTravelCost(cost)) return;
  }
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
  ui.pushAddress(buildAddressComponent(systemName, system.x, system.y, system.z, 'system'));
  ui.setView('system');
}

interface DeleteHandlers {
  onNavigate: (preCheck: () => boolean, travel: () => void) => void;
  onDeleteSupercluster: (scSeed: number) => void;
  onDeleteGalaxy: (scSeed: number, galaxySeed: number) => void;
  onDeleteSystem: (scSeed: number, galaxySeed: number, systemId: string) => void;
}

function SuperclusterEntry({ supercluster, query, deleteMode, allExtractorKeys, allFabricatorKeys, onNavigate, onDeleteSupercluster, onDeleteGalaxy, onDeleteSystem }: { supercluster: EnrichedSupercluster; query: string; deleteMode: boolean; allExtractorKeys: string; allFabricatorKeys: string } & DeleteHandlers) {
  const [expanded, setExpanded] = useState(true);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;
  const hasActiveInstallation = useMemo(() => {
    const galSeeds = supercluster.enrichedGalaxies.map((g) => `${g.galaxySeed}|`);
    const keys = allExtractorKeys.split('\0');
    const settKeys = allFabricatorKeys.split('\0');
    return galSeeds.some((prefix) => keys.some((k) => k.startsWith(prefix)) || settKeys.some((k) => k.startsWith(prefix)));
  }, [supercluster.enrichedGalaxies, allExtractorKeys, allFabricatorKeys]);

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
              title={hasActiveInstallation ? 'Cannot forget: has active extraction station or fabricator' : 'Forget supercluster'}
              disabled={hasActiveInstallation}
              onClick={(e) => { e.stopPropagation(); onDeleteSupercluster(supercluster.superclusterSeed); }}
            >✕</button>
          ) : (
            <button
              className="codex-travel-btn"
              title="Travel to supercluster"
              onClick={(e) => { e.stopPropagation(); onNavigate(() => canTravelToSupercluster(supercluster.superclusterSeed), () => travelToSupercluster(supercluster.superclusterSeed, supercluster.superclusterName)); }}
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
              allExtractorKeys={allExtractorKeys}
              allFabricatorKeys={allFabricatorKeys}
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

function GalaxyEntry({ galaxy, query, superclusterSeed, superclusterName, deleteMode, allExtractorKeys, allFabricatorKeys, onNavigate, onDeleteGalaxy, onDeleteSystem }: { galaxy: EnrichedGalaxy; query: string; superclusterSeed: number; superclusterName: string; deleteMode: boolean; allExtractorKeys: string; allFabricatorKeys: string } & Omit<DeleteHandlers, 'onDeleteSupercluster'>) {
  const [expanded, setExpanded] = useState(false);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;
  const hasHabitable = useMemo(
    () => galaxy.enrichedSystems.some((s) => systemHasHabitable(s.seed, s.starType)),
    [galaxy.enrichedSystems],
  );
  const hasMiningStation = useMemo(
    () => {
      const prefix = `${galaxy.galaxySeed}|`;
      return allExtractorKeys.split('\0').some((k) => k.startsWith(prefix));
    },
    [allExtractorKeys, galaxy.galaxySeed],
  );
  const hasFabricator = useMemo(
    () => {
      const prefix = `${galaxy.galaxySeed}|`;
      return allFabricatorKeys.split('\0').some((k) => k.startsWith(prefix));
    },
    [allFabricatorKeys, galaxy.galaxySeed],
  );

  return (
    <div className="codex-galaxy">
      <div className="codex-galaxy-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-galaxy-name">
          {highlight(galaxy.galaxyName, query)}
          {hasHabitable && <span className="codex-habitable-dot" title="Contains habitable planet" />}
          {hasMiningStation && <span className="codex-extractor-dot" title="Has mining station" />}
          {hasFabricator && <span className="codex-fabricator-dot" title="Has fabricator" />}
        </span>
        <div className="codex-row-right">
          <span className="codex-galaxy-count">
            {galaxy.enrichedSystems.length} {galaxy.enrichedSystems.length === 1 ? 'star' : 'stars'}
          </span>
          {deleteMode ? (
            <button
              className="codex-delete-btn"
              title={hasMiningStation || hasFabricator ? 'Cannot forget: has active extraction station or fabricator' : 'Forget galaxy'}
              disabled={hasMiningStation || hasFabricator}
              onClick={(e) => { e.stopPropagation(); onDeleteGalaxy(superclusterSeed, galaxy.galaxySeed); }}
            >✕</button>
          ) : (
            <button
              className="codex-travel-btn"
              title="Travel to galaxy"
              onClick={(e) => { e.stopPropagation(); onNavigate(() => canTravelToGalaxy(superclusterSeed, galaxy.galaxySeed), () => travelToGalaxy(superclusterSeed, superclusterName, galaxy.galaxySeed, galaxy.galaxyName)); }}
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
              allExtractorKeys={allExtractorKeys}
              allFabricatorKeys={allFabricatorKeys}
              onNavigate={onNavigate}
              onDeleteSystem={onDeleteSystem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function systemHasHabitable(seed: number, starType?: import('../game/types').StarType): boolean {
  if (starType === 'L') return false;
  return generateSystemLayout(seed, starType).planets.some((p) => p.zone === 'habitable');
}

function SystemPlanets({ seed, starType, query, galaxySeed, systemId, allExtractorKeys, allFabricatorKeys }: { seed: number; starType?: import('../game/types').StarType; query: string; galaxySeed: number; systemId: string; allExtractorKeys: string; allFabricatorKeys: string }) {
  const planets = useMemo(
    () => generatePlanets(generateSystemLayout(seed, starType)),
    [seed, starType],
  );
  const systemPrefix = `${galaxySeed}|${systemId}|`;
  const systemExtractors = useMemo(
    () => new Set(allExtractorKeys.split('\0').filter((k) => k.startsWith(systemPrefix))),
    [allExtractorKeys, systemPrefix],
  );
  const systemFabricators = useMemo(
    () => new Set(allFabricatorKeys.split('\0').filter((k) => k.startsWith(systemPrefix))),
    [allFabricatorKeys, systemPrefix],
  );
  return (
    <div className="codex-planets">
      {planets.map((planet) => {
        const hasExtractor = systemExtractors.has(`${systemPrefix}${planet.name}`);
        const hasFabricator = systemFabricators.has(`${systemPrefix}${planet.name}`);
        return (
        <div key={planet.name} className="codex-planet">
          <div className="codex-planet-row">
            <span className={`codex-zone-dot ${planet.type}`} />
            <span className="codex-planet-name">{highlight(planet.name, query)}</span>
            {hasExtractor && <span className="codex-extractor-dot" title="Mining station active" />}
            {hasFabricator && <span className="codex-fabricator-dot" title="Fabricator established" />}
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
        );
      })}
    </div>
  );
}

function SystemEntry({ system, query, superclusterSeed, superclusterName, galaxySeed, galaxyName, deleteMode, allExtractorKeys, allFabricatorKeys, onNavigate, onDeleteSystem }: { system: EnrichedSystem; query: string; superclusterSeed: number; superclusterName: string; galaxySeed: number; galaxyName: string; deleteMode: boolean; allExtractorKeys: string; allFabricatorKeys: string; onNavigate: DeleteHandlers['onNavigate']; onDeleteSystem: DeleteHandlers['onDeleteSystem'] }) {
  const [expanded, setExpanded] = useState(false);
  const forceExpand = query.length > 0;
  const isOpen = forceExpand || expanded;
  const hasHabitable = useMemo(() => systemHasHabitable(system.seed, system.starType), [system.seed, system.starType]);
  const hasMiningStation = useMemo(
    () => {
      const prefix = `${galaxySeed}|${system.id}|`;
      return allExtractorKeys.split('\0').some((k) => k.startsWith(prefix));
    },
    [allExtractorKeys, galaxySeed, system.id],
  );
  const hasFabricator = useMemo(
    () => {
      const prefix = `${galaxySeed}|${system.id}|`;
      return allFabricatorKeys.split('\0').some((k) => k.startsWith(prefix));
    },
    [allFabricatorKeys, galaxySeed, system.id],
  );

  return (
    <div className="codex-system">
      <div className="codex-system-header" onClick={() => !forceExpand && setExpanded((e) => !e)}>
        <span className="codex-chevron">{isOpen ? '▼' : '▶'}</span>
        <span className="codex-system-name">
          {highlight(system.name, query)}
          {hasHabitable && <span className="codex-habitable-dot" title="Contains habitable planet" />}
          {hasMiningStation && <span className="codex-extractor-dot" title="Has mining station" />}
          {hasFabricator && <span className="codex-fabricator-dot" title="Has fabricator" />}
        </span>
        <div className="codex-row-right">
          <span className="codex-star-type">{STAR_TYPE_LABELS[system.starType]}</span>
          {deleteMode ? (
            <button
              className="codex-delete-btn"
              title={hasMiningStation || hasFabricator ? 'Cannot forget: has active extraction station or fabricator' : 'Forget system'}
              disabled={hasMiningStation || hasFabricator}
              onClick={(e) => { e.stopPropagation(); onDeleteSystem(superclusterSeed, galaxySeed, system.id); }}
            >✕</button>
          ) : (
            <button
              className="codex-travel-btn"
              title="Travel to system"
              onClick={(e) => { e.stopPropagation(); onNavigate(() => canTravelToSystem(superclusterSeed, galaxySeed, system.id), () => travelToSystem(superclusterSeed, superclusterName, galaxySeed, galaxyName, system.id, system.name)); }}
            >⊙</button>
          )}
        </div>
      </div>
      {isOpen && <SystemPlanets seed={system.seed} starType={system.starType} query={query} galaxySeed={galaxySeed} systemId={system.id} allExtractorKeys={allExtractorKeys} allFabricatorKeys={allFabricatorKeys} />}
    </div>
  );
}
