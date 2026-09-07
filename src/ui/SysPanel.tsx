import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DISTRICTS } from '../data/districts';
import { CIVILIZATION_RESEARCH, researchThreshold } from '../data/research';
import { materialName } from '../data/materials';
import type { DistrictId, JobType, Resource } from '../game/types';
import { RESOURCE_LABELS } from '../game/types';
import { colonyAmenityDemand, colonyAmenityRatio, colonyContentment, colonyDefense, colonyDemand, colonyDistrictCapacity, colonyDistrictsUsed, colonyFoodCapacity, colonyJobSlots, DYSON_COST, DYSON_LABOR, filledJobs, HOUR, NUTRIENTS_PER_PERSON_HOUR, PROBE_COST, PROBE_LABOR, useColonyStore } from '../store/colonyStore';
import { useResearchStore } from '../store/researchStore';
import { useStockpileStore } from '../store/stockpileStore';
import { detectionFloor, useUIStore } from '../store/uiStore';
import { districtBuildCost } from '../store/travelCosts';
import { civilizationMilestoneMet } from '../store/civStore';
import { colonyNextAction, colonyRunwayHours, districtBuildBlockers, districtUpkeepShortfall } from './colonyPresentation';
import './SysPanel.css';

type Tab = 'worlds' | 'civilization' | 'threat' | 'vault' | 'status';
const TABS: Tab[] = ['worlds', 'civilization', 'threat', 'vault', 'status'];

function costLabel(cost: Record<string, number>): string {
  return Object.entries(cost).map(([id, amount]) => `${amount} ${materialName(id)}`).join(' · ');
}

function WorldsTab() {
  const colonies = useColonyStore(state => state.colonies);
  const selectedPlanetKey = useUIStore(state => state.selectedPlanetKey);
  const tier = useUIStore(state => state.kardashevTier);
  const research = useResearchStore(state => state.points);
  const materials = useStockpileStore(state => state.materials);
  const rares = useStockpileStore(state => state.rares);
  const exoticMatter = useUIStore(state => state.exoticMatter);
  const helium3Reserves = useUIStore(state => state.helium3Reserves);
  const infiniteExplore = useUIStore(state => state.infiniteExplore);
  const roster = Object.values(colonies);
  const [selectedKey, setSelectedKey] = useState(() => selectedPlanetKey && colonies[selectedPlanetKey] ? selectedPlanetKey : roster[0]?.key ?? '');
  const [razing, setRazing] = useState<DistrictId | null>(null);
  const colony = colonies[selectedKey] ?? roster[0];
  if (!colony) return <p>Upgrade a habitable world's fabricator and stage a colony charter to begin.</p>;
  const slots = colonyJobSlots(colony);
  const filled = filledJobs(colony);
  const demand = colonyDemand(colony);
  const capacity = colonyDistrictCapacity(colony);
  const used = colonyDistrictsUsed(colony);
  const cost = districtBuildCost();
  const hold = { materials, rares };
  const fuel = { exotic: infiniteExplore ? Infinity : exoticMatter, helium: infiniteExplore ? Infinity : helium3Reserves };
  const runway = colonyRunwayHours(colony.population, colony.supplies.nutrients ?? 0);
  const amenityRatio = colonyAmenityRatio(colony);
  const amenityDemand = colonyAmenityDemand(colony);
  const orderedJobs = [...colony.jobPriority];
  const moveJob = (job: JobType, direction: -1 | 1) => {
    const priority = [...orderedJobs];
    const index = priority.indexOf(job);
    const other = index + direction;
    if (other < 0 || other >= priority.length) return;
    [priority[index], priority[other]] = [priority[other], priority[index]];
    useColonyStore.getState().setJobPriority(colony.key, priority);
  };
  return <div className="sys-world-layout">
    <nav className="sys-world-roster">{roster.map(world => <button className={world.key === colony.key ? 'active' : ''} key={world.key} onClick={() => { setSelectedKey(world.key); setRazing(null); }}><strong>{world.planetName}</strong><span>{colonyNextAction(world)}</span></button>)}</nav>
    <div className="sys-world-detail">
      <header><div><h3>{colony.planetName}</h3><span>{Math.floor(colony.population).toLocaleString()} people · {used}/{capacity} districts</span></div><strong>{colonyNextAction(colony)}</strong></header>
      <div className="sys-strip"><span>FOOD RUNWAY</span><div><i style={{ width: `${Math.min(100, runway / 2 * 100)}%` }} /></div><b>{Number.isFinite(runway) ? `${runway.toFixed(2)}h` : '∞'}</b></div>
      <div className="sys-strip"><span>AMENITIES</span><div><i style={{ width: `${Math.min(100, amenityRatio * 100)}%` }} /></div><b>{Math.round(amenityRatio * amenityDemand)} / {Math.round(amenityDemand)}</b></div>
      <h4>DISTRICTS · {used} / {capacity} SLOTS USED</h4>
      <div className="sys-district-grid">{DISTRICTS.map(district => {
        const count = colony.districts[district.id] ?? 0;
        const blockers = districtBuildBlockers(colony, district, capacity - used, hold, fuel);
        return <article key={district.id} className={count ? 'built' : ''}><strong>{district.name}</strong><b>{count} built</b><span>{district.description}</span><span className={blockers.length ? 'sys-district-cost short' : 'sys-district-cost'}>{costLabel(district.builtWith)} · {cost.exotic} exotic · {cost.helium} He-3</span><div className="sys-district-actions"><span className="sys-build" title={blockers.length ? `Needs ${blockers.join(', ')}` : `Build one ${district.name}`}><button disabled={blockers.length > 0} onClick={() => useColonyStore.getState().buildDistrict(colony.key, district.id)}>BUILD</button></span><button className={razing === district.id ? 'sys-raze armed' : 'sys-raze'} disabled={!count} title={razing === district.id ? `Confirm razing one ${district.name}` : `Raze one ${district.name}`} aria-label={razing === district.id ? `Confirm razing one ${district.name}` : `Raze one ${district.name}`} onClick={() => { if (razing !== district.id) { setRazing(district.id); return; } useColonyStore.getState().demolishDistrict(colony.key, district.id); setRazing(null); }}>{razing === district.id ? '✓' : '✕'}</button></div></article>;
      })}</div>
      <h4>JOBS</h4>
      <div className="sys-jobs"><div className="sys-table-head"><span>PRIORITY / JOB</span><span>SLOTS</span><span>FILLED</span><span>OUTPUT / HOUR</span><span>UPKEEP / HOUR</span></div>{orderedJobs.map(job => {
        const district = DISTRICTS.find(item => item.job === job)!;
        const output = [...Object.entries(district.output.raw ?? {}), ...Object.entries(district.output.materials ?? {})].map(([id, rate]) => `${((rate ?? 0) * filled[job]).toFixed(1)} ${RESOURCE_LABELS[id as Resource['type']] ?? materialName(id)}`).concat(district.output.research ? [`${(district.output.research * filled[job]).toFixed(1)} research`] : [], district.output.amenities ? [`${(district.output.amenities * filled[job]).toFixed(0)} amenities`] : []).join(', ') || 'none';
        const upkeep = [...Object.entries(district.upkeep.raw ?? {}), ...Object.entries(district.upkeep.materials ?? {})].map(([id, rate]) => `${rate} ${RESOURCE_LABELS[id as Resource['type']] ?? materialName(id)}`).join(', ') || 'none';
        const shortfall = districtUpkeepShortfall(colony, district);
        return <div key={job}><span><button onClick={() => moveJob(job, -1)}>↑</button><button onClick={() => moveJob(job, 1)}>↓</button>{job.toUpperCase()}</span><span>{slots[job].toLocaleString()}</span><span>{Math.round(filled[job]).toLocaleString()}</span><span className={shortfall.length ? 'colony-warning' : ''}>{shortfall.length ? 'STALLED' : output}</span><span className={shortfall.length ? 'colony-warning' : ''}>{shortfall.length ? `NO ${shortfall.join(', ').toUpperCase()}` : upkeep}</span></div>;
      })}</div>
      <h4>DELIVERY</h4>
      <div className="sys-delivery">{Object.entries(demand.raw).filter(([, amount]) => (amount ?? 0) > 0).map(([id, amount]) => <span key={id}>{RESOURCE_LABELS[id as Resource['type']]} · {Math.ceil(amount ?? 0)}</span>)}{Object.entries(demand.materials).filter(([, amount]) => amount > 0).map(([id, amount]) => <span key={id}>{materialName(id)} · {Math.ceil(amount)}</span>)}{Object.values(demand.raw).every(amount => !amount) && Object.values(demand.materials).every(amount => !amount) && <span>No inbound cargo needed.</span>}</div>
      <h4>STELLAR PROJECT</h4>
      {colony.project ? <div className="sys-project"><strong>{colony.project === 'dyson' ? 'DYSON SWARM' : 'REPLICATION NETWORK'}</strong><span>Colonist labor {(colony.projectDelivered.labor ?? 0).toFixed(1)} / {colony.project === 'dyson' ? DYSON_LABOR : PROBE_LABOR}</span>{Object.entries(colony.project === 'dyson' ? DYSON_COST : PROBE_COST).map(([id, amount]) => <span key={id}>{materialName(id)} {colony.projectDelivered[id] ?? 0} / {amount}</span>)}</div> : <div className="sys-project"><button disabled={colony.swarmComplete || tier < 1 || research < researchThreshold(2)} onClick={() => useColonyStore.getState().startProject(colony.key, 'dyson')}>{colony.swarmComplete ? 'DYSON SWARM ONLINE' : research < researchThreshold(2) ? 'RESEARCH STELLAR THEORY' : 'COMMISSION DYSON SWARM'}</button><button disabled={!colony.swarmComplete || colony.probeCoverage >= 1 || tier < 2 || research < researchThreshold(3)} onClick={() => useColonyStore.getState().startProject(colony.key, 'probes')}>{colony.probeCoverage >= 1 ? 'REPLICATION NETWORK ONLINE' : research < researchThreshold(3) ? 'RESEARCH GALACTIC THEORY' : 'COMMISSION REPLICATION NETWORK'}</button></div>}
      <small>Food capacity {Math.floor(colonyFoodCapacity(colony)).toLocaleString()} · consumption {(colony.population * NUTRIENTS_PER_PERSON_HOUR).toFixed(0)}/hour · planetary integration {Math.min(100, (colony.planetaryProgressMs ?? 0) / HOUR * 100).toFixed(0)}% · growth {(colonyContentment(colony) * 100).toFixed(0)}% of normal</small>
    </div>
  </div>;
}

function CivilizationTab() {
  const research = useResearchStore(state => state.points);
  const tier = useUIStore(state => state.kardashevTier);
  const colonies = useColonyStore(state => state.colonies);
  const next = CIVILIZATION_RESEARCH.find(entry => entry.tier > tier);
  const previousThreshold = researchThreshold(tier);
  const progress = next ? Math.min(1, Math.max(0, (research - previousThreshold) / (next.threshold - previousThreshold))) : 1;
  return <div className="sys-civilization"><header><div><h3>HUMAN CIVILIZATION · TYPE {['0', 'I', 'II', 'III'][tier]}</h3><span>Research is shared instantly across every colony. It is knowledge, not cargo.</span></div><strong>{research.toFixed(1)} RESEARCH</strong></header>{next && <div className="sys-strip"><span>TYPE {['0', 'I', 'II', 'III'][next.tier]} THEORY</span><div><i style={{ width: `${progress * 100}%` }} /></div><b>{Math.min(research, next.threshold).toFixed(1)} / {next.threshold}</b></div>}<div className="sys-research-branches">{CIVILIZATION_RESEARCH.map(entry => {
    const reached = tier >= entry.tier;
    const scienceReady = research >= entry.threshold;
    const milestoneReady = civilizationMilestoneMet(Object.values(colonies), entry.tier);
    const status = reached ? 'CIVILIZATION LEVEL REACHED' : scienceReady && milestoneReady ? 'ADVANCEMENT IMMINENT' : scienceReady ? 'AWAITING PHYSICAL MILESTONE' : milestoneReady ? 'INFRASTRUCTURE READY · RESEARCH CONTINUES' : `${research.toFixed(1)} / ${entry.threshold} RESEARCH`;
    return <article key={entry.tier} className={reached ? 'unlocked' : ''}><strong>TYPE {['0', 'I', 'II', 'III'][entry.tier]} · {entry.name}</strong><p>{entry.description}</p><span>RESEARCH · {entry.threshold} cumulative</span><span>MILESTONE · {entry.milestone}</span><span>UNLOCKS · {entry.unlock}</span><b>{status}</b></article>;
  })}</div><p>Current permanent probe-attention floor: {detectionFloor(tier)}. Research accumulates automatically while staffed research districts operate.</p></div>;
}

function ThreatTab() {
  const colonies = useColonyStore(state => state.colonies);
  const exposure = useUIStore(state => state.exposure);
  const nextStrike = useUIStore(state => state.nextStrikeExposure);
  const strike = useUIStore(state => state.strike);
  return <div><div className="sys-strip"><span>EXPOSURE</span><div><i style={{ width: `${Math.min(100, exposure / nextStrike * 100)}%` }} /></div><b>{exposure} / {nextStrike}</b></div>{strike && <p className="colony-warning">Cannon transit to {strike.targetName}.</p>}<div className="sys-threat-list">{Object.values(colonies).map(colony => <article key={colony.key}><strong>{colony.planetName}</strong><span>local heat {colony.localHeat.toFixed(1)} · sentinel coverage {colonyDefense(colony).ammoCap} rounds</span><button disabled={colony.population <= 0} onClick={() => useColonyStore.getState().evacuate(colony.key)}>Evacuate {Math.floor(colony.population)} people</button></article>)}</div></div>;
}

function VaultTab() {
  const lines = useUIStore(state => state.geneLines);
  const evacuated = useUIStore(state => state.evacuatedPopulation);
  const returned = useStockpileStore(state => state.materials.viable_line ?? 0);
  return <div className="sys-vault"><h3>THE VAULT</h3><strong>{lines} viable lines aboard</strong><p>{returned.toFixed(2)} lines in returned cargo · {evacuated.toLocaleString()} people evacuated.</p><div className="sys-strip"><span>HUMAN LEDGER</span><div><i style={{ width: `${Math.min(100, evacuated / 873 * 100)}%` }} /></div><b>{evacuated} / 873</b></div></div>;
}

function StatusTab() {
  const exposure = useUIStore(state => state.exposure);
  const geneLines = useUIStore(state => state.geneLines);
  const alienMatter = useUIStore(state => state.alienMatter);
  const nextStrike = useUIStore(state => state.nextStrikeExposure);
  return <div className="sys-status">
    <h3>SHIP STATUS</h3>
    <div><span>EXPOSURE</span><b>{exposure}</b><small>Census probes that escaped and reported your position. It never goes down. At {nextStrike} the cannon fires on one of your worlds.</small></div>
    <div><span>VIABLE LINES</span><b>{geneLines}</b><small>Frozen human genetic lines held aboard. A colony charter costs two; evacuating a colony returns them.</small></div>
    <div><span>ALIEN MATTER</span><b>{alienMatter}</b><small>Salvage recovered from probes shot down nearby. Used as a build resource.</small></div>
  </div>;
}

export function SysPanel() {
  const show = useUIStore(state => state.showSysPanel);
  const [tab, setTab] = useState<Tab>('worlds');
  if (!show) return null;
  return createPortal(<div className="sys-overlay" onClick={() => useUIStore.getState().setShowSysPanel(false)}><section className="sys-panel" role="dialog" aria-modal="true" aria-label="Humanity" onClick={event => event.stopPropagation()}><button className="sys-close" onClick={() => useUIStore.getState().setShowSysPanel(false)}>×</button><nav className="sys-tabs">{TABS.map(item => <button className={`${item === 'status' ? 'sys-tab-right' : ''}${tab === item ? ' active' : ''}`} key={item} onClick={() => setTab(item)}>{item.toUpperCase()}</button>)}</nav><main>{tab === 'worlds' ? <WorldsTab /> : tab === 'civilization' ? <CivilizationTab /> : tab === 'threat' ? <ThreatTab /> : tab === 'vault' ? <VaultTab /> : <StatusTab />}</main></section></div>, document.body);
}
