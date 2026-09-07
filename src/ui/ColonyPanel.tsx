import { useColonyStore, canCharterWithAvailableAssemblies, colonyDemand, colonyFoodCapacity } from '../store/colonyStore';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { RESOURCE_LABELS, type Resource } from '../game/types';
import { useNow } from './useNow';
import './ColonyPanel.css';
import { colonyNextAction, colonyRunwayHours } from './colonyPresentation';

export function ColonySummary({ colonyKey }: { colonyKey: string }) {
  const colony = useColonyStore(state => state.colonies[colonyKey]);
  const galaxySeed = useGameStore(state => state.galaxy.seed);
  const systemId = useGameStore(state => state.system?.id);
  if (!colony) return null;
  const runway = colonyRunwayHours(colony.population, colony.supplies.nutrients ?? 0);
  const blockers = [
    ...canCharterWithAvailableAssemblies(colony) ? [] : ['charter assemblies'],
    ...galaxySeed === colony.galaxySeed && systemId === colony.systemId ? [] : ['the Peregrine in system'],
  ];
  return <section className="colony-summary">
    <strong>{colony.foundedAt ? `${Math.floor(colony.population).toLocaleString()} people` : 'Charter staging'}</strong>
    <span>{Number.isFinite(runway) ? `${runway.toFixed(1)}h food runway` : 'No food demand'} - {Math.floor(colony.supplies.nutrients ?? 0)} / {Math.floor(colonyFoodCapacity(colony))} nutrients</span>
    <span className={runway < 0.25 ? 'colony-warning' : ''}>{colonyNextAction(colony)}</span>
    {!colony.foundedAt && <button disabled={blockers.length > 0} title={blockers.length ? `Needs ${blockers.join(', ')}` : 'Charter this colony'} onClick={() => useColonyStore.getState().charterColony(colony.key)}>Charter colony - {blockers.length ? `needs ${blockers.join(', ')}` : 'ready'}</button>}
    <button onClick={() => useUIStore.getState().setShowSysPanel(true)}>Open Humanity</button>
  </section>;
}

export const ColonyDetails = ColonySummary;

export function StrikeWarning() {
  const strike = useUIStore(state => state.strike);
  const colonies = useColonyStore(state => state.colonies);
  const now = useNow(1000);
  if (!strike) return null;
  return <aside className="strike-warning" role="alert"><strong>Cannon transit - {strike.targetName}</strong><p>{Math.max(0, Math.ceil((strike.arrivesAt - now) / 1000))} seconds to impact.</p>
    {Object.values(colonies).filter(colony => colony.superclusSeed === strike.superclusSeed && colony.population > 0).map(colony => <button key={colony.key} disabled={now >= strike.arrivesAt} onClick={() => useColonyStore.getState().evacuate(colony.key)}>Evacuate {colony.planetName} - {Math.floor(colony.population)} people</button>)}
  </aside>;
}

export function ColonyDemandSummary({ colonyKey }: { colonyKey: string }) {
  const colony = useColonyStore(state => state.colonies[colonyKey]);
  if (!colony) return null;
  const demand = colonyDemand(colony);
  return <>{Object.entries(demand.raw).filter(([, amount]) => (amount ?? 0) > 0).map(([id, amount]) => <span key={id}>{RESOURCE_LABELS[id as Resource['type']]} {Math.ceil(amount ?? 0)}</span>)}</>;
}
