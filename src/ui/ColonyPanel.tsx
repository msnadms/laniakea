import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useColonyStore, colonyDemand, colonyPopCap, colonyDefense, colonyFoodCapacity, CHARTER_ASSEMBLIES, DYSON_COST, PROBE_COST, DYSON_LABOR, PROBE_LABOR, NUTRIENTS_PER_PERSON_HOUR, MATURITY_POPULATION, charterAssemblyAvailability, canCharterWithAvailableAssemblies } from '../store/colonyStore';
import { useStockpileStore } from '../store/stockpileStore';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { RARE_RESOURCES } from '../data/rareResources';
import { getCraftable } from '../data/upgrades';
import { RESOURCE_LABELS } from '../game/types';
import type { Resource } from '../game/types';
import { useNow } from './useNow';
import './ColonyPanel.css';

function formatSpan(hours: number): string {
  if (!Number.isFinite(hours)) return 'indefinite';
  const minutes = Math.max(0, Math.round(hours * 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export function ColonyDetails({ colonyKey, showTitle = true }: { colonyKey: string; showTitle?: boolean }) {
  const c = useColonyStore(s => s.colonies[colonyKey]);
  const store = useColonyStore();
  const geneLines = useUIStore(s => s.geneLines);
  const tier = useUIStore(s => s.kardashevTier);
  const galaxySeed = useGameStore(s => s.galaxy.seed);
  const systemId = useGameStore(s => s.system?.id);
  const peregrineRares = useStockpileStore(s => s.rares);
  const peregrineMaterials = useStockpileStore(s => s.materials);
  if (!c) return null;
  const demand = colonyDemand(c);
  const present = galaxySeed === c.galaxySeed && systemId === c.systemId;
  // Subscribe to the ship holds here; availability itself also accounts for route deliveries.
  void peregrineRares; void peregrineMaterials;
  const availableAssemblies = charterAssemblyAvailability(c);
  const ready = canCharterWithAvailableAssemblies(c);
  const food = c.supplies.nutrients ?? 0;
  const burnPerHour = c.population * NUTRIENTS_PER_PERSON_HOUR;
  const foodHours = burnPerHour > 0 ? food / burnPerHour : Infinity;
  const projectCost = c.project === 'dyson' ? DYSON_COST : PROBE_COST;
  const projectLabor = c.project === 'dyson' ? DYSON_LABOR : PROBE_LABOR;
  return <section className="colony-details">
    {showTitle && <h3>{c.planetName} · {c.foundedAt ? 'Colony' : 'Charter staging'}</h3>}
    {!c.foundedAt ? <>
      <p>Route deliveries and assemblies aboard the Peregrine can be combined. Chartering consumes two viable lines and requires the Peregrine in this system.</p>
      {Object.entries(CHARTER_ASSEMBLIES).map(([id, n]) => <div className="colony-meter" key={id}><span>{getCraftable(id)?.name}</span><span>{availableAssemblies[id] ?? 0} / {n} available · {c.assemblies[id] ?? 0} delivered</span></div>)}
      <button disabled={!present || !ready || geneLines < 2} onClick={() => store.charterColony(c.key)}>Charter colony · 2 viable lines{!present ? ' · ship absent' : ''}</button>
    </> : <>
      <p>{Math.floor(c.population).toLocaleString()} people / {colonyPopCap(c).toLocaleString()} capacity · {c.exportedLines} / {c.populationTier} lines returned</p>
      <p className={foodHours < 0.5 ? 'colony-warning' : undefined}>
        {Math.floor(food).toLocaleString()} / {colonyFoodCapacity(c).toLocaleString()} nutrients · {formatSpan(foodHours)} of food · burns {Math.round(burnPerHour).toLocaleString()}/hour
      </p>
      <p>{Math.floor(c.labor).toLocaleString()} labor · {c.localHeat.toFixed(1)} probe attention</p>
      {c.population <= 0 && <p className="colony-warning">No residents remain. This colony cannot regrow.</p>}
      {c.starvationMs > 0 && <p className="colony-warning">Food exhausted. Growth has stopped. Starvation begins after 30 minutes. {Math.floor(c.lostPeople)} people lost.</p>}
      <p>{c.ammo} / {colonyDefense(c).ammoCap} rounds · fires every {(colonyDefense(c).cooldownMs / 1000).toFixed(0)}s</p>
      <p>A full store turns routes away on its own. Type I needs {MATURITY_POPULATION}+ people fed by local extractors alone, with no delivery for a full hour.</p>
      {RARE_RESOURCES.map(r => <div className="colony-meter" key={r.id}>
        <span>{r.name} · {c.installed[r.id] ?? (r.id === 'ectogenesis_bank' ? c.populationTier : 0)}</span>
        <span className="colony-order">
          <button title={`Order fewer ${r.name}`} disabled={(c.requested[r.id] ?? 0) < 1} onClick={() => store.setRequest(c.key, r.id, (c.requested[r.id] ?? 0) - 1)}>−</button>
          <span title="Standing order carried by routes and held back from export">order {c.requested[r.id] ?? 0}</span>
          <button title={`Order another ${r.name}`} onClick={() => store.setRequest(c.key, r.id, (c.requested[r.id] ?? 0) + 1)}>+</button>
        </span>
        <button title={r.desc} disabled={(c.assemblies[r.id] ?? 0) < 1 || c.population <= 0 || (r.id === 'ectogenesis_bank' && c.population < c.populationTier * 900)} onClick={() => store.installAssembly(c.key, r.id)}>Install ({c.assemblies[r.id] ?? 0})</button>
      </div>)}
      {c.project ? <>
        <h4>{c.project === 'dyson' ? 'Dyson swarm' : 'Galactic probe network'} under construction</h4>
        {Object.entries(projectCost).map(([id, n]) => <div className="colony-meter" key={id}><span>{getCraftable(id)?.name}</span><span>{c.projectDelivered[id] ?? 0} / {n}</span></div>)}
      <p>Labor: {Math.floor(c.labor)} / {projectLabor}. The project produces nothing until all deliveries and labor are complete.</p>
      </> : <>
      <p>{c.swarmComplete ? 'Dyson swarm online.' : 'No stellar infrastructure.'} {c.probeCoverage >= 1 ? 'Replication network covers this star’s sector.' : ''}</p>
        {!c.swarmComplete && <button disabled={tier < 1 || c.population <= 0} onClick={() => store.startProject(c.key, 'dyson')}>Commission Dyson swarm · Type I required</button>}
        {c.swarmComplete && c.probeCoverage < 1 && <button onClick={() => store.startProject(c.key, 'probes')}>Commission self-replicating network</button>}
      </>}
      <button className="colony-danger" disabled={c.population <= 0} onClick={() => store.evacuate(c.key)}>Evacuate {Math.floor(c.population)} people · abandon all installed assemblies</button>
    </>}
    <h4>Standing delivery demand</h4>
    {Object.entries(demand.raw).map(([id, n]) => <div className="colony-meter" key={id}><span>{RESOURCE_LABELS[id as Resource['type']]}</span><span>{Math.floor(c.supplies[id as Resource['type']] ?? 0)} stored · {Math.ceil(n ?? 0)} wanted</span></div>)}
    {Object.entries(demand.materials).filter(([, n]) => n > 0).map(([id, n]) => <div className="colony-meter" key={id}><span>{getCraftable(id)?.name ?? id}</span><span>{n} wanted</span></div>)}
  </section>;
}

function ColonyAccordion({ colonyKey }: { colonyKey: string }) {
  const colony = useColonyStore(s => s.colonies[colonyKey]);
  if (!colony) return null;
  const status = colony.foundedAt
    ? `${Math.floor(colony.population).toLocaleString()} people`
    : 'Charter staging';

  return <details className="colony-accordion">
    <summary>
      <span>{colony.planetName}</span>
      <span>{status}</span>
    </summary>
    <ColonyDetails colonyKey={colonyKey} showTitle={false} />
  </details>;
}

export function CivilizationButton() {
  const [open, setOpen] = useState(false);
  const tier = useUIStore(s => s.kardashevTier);
  return <><button className="hud-action-btn" onClick={() => setOpen(true)}>Humanity · Type {['0','I','II','III'][tier]}</button>{open && <CivilizationPanel onClose={() => setOpen(false)} />}</>;
}

function CivilizationPanel({ onClose }: { onClose: () => void }) {
  const colonies = useColonyStore(s => s.colonies);
  const tier = useUIStore(s => s.kardashevTier);
  const evacuated = useUIStore(s => s.evacuatedPopulation);
  const living = Object.values(colonies).filter(c => c.population > 0);
  return createPortal(<div className="civilization-overlay" onClick={onClose}><div className="civilization-panel" role="dialog" aria-modal="true" aria-label="Humanity" onClick={e => e.stopPropagation()}>
    <button className="civilization-close" onClick={onClose} aria-label="Close humanity panel">×</button>
    <h2>Humanity · Type {['0','I','II','III'][tier]}</h2>
<p>873 aboard the Peregrine. {living.reduce((n,c) => n + Math.floor(c.population), 0).toLocaleString()} on living worlds. {evacuated.toLocaleString()} evacuated.</p>
    <ul className="civilization-type-list">
      <li><strong>Type I</strong> — 500 people, with local food surplus for an hour and no supply deliveries for the preceding hour.</li>
      <li><strong>Type II</strong> — Assemble a Dyson swarm.</li>
      <li><strong>Type III</strong> — Complete swarms and replication networks at three different stars in one galaxy.</li>
    </ul>
<p>Type II sets a permanent probe attention floor of one bar; Type III sets it at two. The civilization that destroyed Earth operates at Type IV, beyond our reach.</p>
<p>A colony returns one viable line per population tier, after six fed hours at {MATURITY_POPULATION} people or more. Ectogenesis banks unlock another tier — and another line — at 900 people per existing tier. Industry in a colony’s system keeps using its supplies while the Peregrine is away.</p>
    {Object.values(colonies).map(c => <ColonyAccordion key={c.key} colonyKey={c.key} />)}
    {Object.keys(colonies).length === 0 && <p>Upgrade a habitable world's fabricator to tier 2, then stage a charter in its planet panel.</p>}
  </div></div>, document.body);
}

export function StrikeWarning() {
  const strike = useUIStore(s => s.strike);
  const colonies = useColonyStore(s => s.colonies);
  const now = useNow(1000);
  if (!strike) return null;
  return <aside className="strike-warning" role="alert"><strong>Cannon transit · {strike.targetName}</strong><p>{Math.max(0, Math.ceil((strike.arrivesAt - now) / 1000))} seconds to impact.</p>
    {Object.values(colonies).filter(c => c.superclusSeed === strike.superclusSeed && c.population > 0).map(c => <button key={c.key} disabled={now >= strike.arrivesAt} onClick={() => useColonyStore.getState().evacuate(c.key)}>Evacuate {c.planetName} · {Math.floor(c.population)} people</button>)}
  </aside>;
}
