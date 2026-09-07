import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DISTRICTS } from '../data/districts';
import { CIVILIZATION_RESEARCH, researchThreshold } from '../data/research';
import { materialName } from '../data/materials';
import type { DistrictId, JobType, Resource } from '../game/types';
import { RESOURCE_LABELS } from '../game/types';
import { CHARTER_ASSEMBLIES, colonyAmenityDemand, colonyAmenityRatio, colonyContentment, colonyDefense, colonyDistrictCapacity, colonyDistrictsUsed, colonyFoodCapacity, colonyFuelCap, colonyJobSlots, colonyNetProduction, DEFAULT_JOB_WEIGHT, DYSON_COST, DYSON_LABOR, filledJobs, HOUR, JOB_WEIGHT_MAX, NUTRIENTS_PER_PERSON_HOUR, PROBE_COST, PROBE_LABOR, useColonyStore } from '../store/colonyStore';
import { useResearchStore } from '../store/researchStore';
import { useStockpileStore } from '../store/stockpileStore';
import { detectionFloor, useUIStore } from '../store/uiStore';
import { districtBuildCost } from '../store/travelCosts';
import { civilizationMilestoneMet } from '../store/civStore';
import { useFabricatorStore } from '../store/fabricatorStore';
import { RARE_RESOURCES } from '../data/rareResources';
import { AlloysIcon, AmenitiesIcon, ExoticMatterIcon, Helium3Icon, MetallicHydrogenIcon, NeutronStarMatterIcon, NutrientsIcon, UpgradeModuleIcon } from './CargoIcons';
import { DistrictIcon } from './DistrictIcons';
import { colonyNextAction, colonyRunwayHours, districtBuildBlockers, districtUpkeepShortfall } from './colonyPresentation';
import './SysPanel.css';

type Tab = 'worlds' | 'civilization' | 'threat' | 'status';
const TABS: Tab[] = ['worlds', 'civilization', 'threat', 'status'];

type ColonyFlow = {
  id: string;
  label: string;
  rate: number;
  kind: 'raw' | 'research' | 'material';
};

function ColonyFlowIcon({ flow }: { flow: ColonyFlow }) {
  if (flow.kind === 'research') return <DistrictIcon id="research_district" />;
  if (flow.kind === 'material') return <UpgradeModuleIcon />;
  switch (flow.id as Resource['type']) {
    case 'alloys': return <AlloysIcon />;
    case 'nutrients': return <NutrientsIcon />;
    case 'metallicHydrogen': return <MetallicHydrogenIcon />;
    case 'neutronStarMatter': return <NeutronStarMatterIcon />;
    case 'exotic': return <ExoticMatterIcon />;
    case 'helium-3': return <Helium3Icon />;
    default: return <UpgradeModuleIcon />;
  }
}

function formatFlowRate(rate: number): string {
  const absolute = Math.abs(rate);
  return absolute.toLocaleString(undefined, {
    maximumFractionDigits: absolute < 1 ? 3 : absolute < 10 ? 2 : absolute < 100 ? 1 : 0,
  });
}

function WorldsTab() {
  const colonies = useColonyStore(state => state.colonies);
  const fabricators = useFabricatorStore(state => state.fabricators);
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
  if (!colony) return <div className="sys-status">
    <h3>COLONY ROADMAP</h3>
    <div><span>1 - STAGE</span><b>Basic Fabricator</b><small>Build a fabricator on a habitable world and stage its charter to expose delivery demand.</small></div>
    <div><span>2 - ASSEMBLE</span><b>Advanced Fabricator</b><small>Upgrade that fabricator, then produce the five rare charter assemblies.</small></div>
    <div><span>3 - FOUND</span><b>Complete Charter</b><small>Deliver every assembly and bring the Peregrine to the staged world to found the colony.</small></div>
  </div>;
  if (!colony.foundedAt) {
    const tier = fabricators[colony.fabricatorKey]?.tier ?? 1;
    return <div className="sys-world-layout">
      <nav className="sys-world-roster">{roster.map(world => <button className={world.key === colony.key ? 'active' : ''} key={world.key} onClick={() => setSelectedKey(world.key)}><strong>{world.planetName}</strong><span>charter staging</span></button>)}</nav>
      <div className="sys-world-detail">
        <header><div><h3>{colony.planetName}</h3><span>STAGED CHARTER - NO POPULATION</span></div><strong>{tier >= 2 ? 'ASSEMBLY PRODUCTION OPEN' : 'ADVANCED FABRICATOR REQUIRED'}</strong></header>
        <p>A basic fabricator exposes this site as a logistics sink. Upgrade it to advanced fabrication to produce the rare assemblies; founding remains locked until every assembly is delivered.</p>
        <h4>CHARTER ASSEMBLIES</h4>
        <div className="sys-status">{Object.entries(CHARTER_ASSEMBLIES).map(([id, required]) => {
          const delivered = colony.assemblies[id] ?? 0;
          const aboard = rares[id] ?? materials[id] ?? 0;
          const name = RARE_RESOURCES.find(resource => resource.id === id)?.name ?? materialName(id);
          return <div key={id}><span>{name}</span><b>{Math.min(required, delivered)} / {required} delivered</b><small>{aboard > 0 ? `${aboard} aboard the Peregrine` : 'Route demand active'}</small></div>;
        })}</div>
        <p>{tier >= 2 ? 'Produce and deliver the listed assemblies, then return here to found the colony.' : 'Next step: upgrade the site fabricator. Rare recipes remain unavailable at tier 1.'}</p>
      </div>
    </div>;
  }
  const slots = colonyJobSlots(colony);
  const filled = filledJobs(colony);
  const netProduction = colonyNetProduction(colony);
  const flows: ColonyFlow[] = [
    ...Object.entries(netProduction.raw).map(([id, rate]) => ({
      id, label: RESOURCE_LABELS[id as Resource['type']], rate: rate ?? 0, kind: 'raw' as const,
    })),
    ...(netProduction.research ? [{ id: 'research', label: 'Research', rate: netProduction.research, kind: 'research' as const }] : []),
    ...Object.entries(netProduction.materials).map(([id, rate]) => ({
      id, label: materialName(id), rate, kind: 'material' as const,
    })),
  ].filter(flow => Math.abs(flow.rate) >= 0.0005);
  const capacity = colonyDistrictCapacity(colony);
  const used = colonyDistrictsUsed(colony);
  const cost = districtBuildCost();
  const hold = { materials, rares };
  const fuel = { exotic: infiniteExplore ? Infinity : exoticMatter, helium: infiniteExplore ? Infinity : helium3Reserves };
  const runway = colonyRunwayHours(colony.population, colony.supplies.nutrients ?? 0);
  const helium3 = Math.max(0, colony.supplies['helium-3'] ?? 0);
  const helium3Capacity = colonyFuelCap(colony);
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
      <header><div><h3>{colony.planetName}</h3><span>{Math.floor(colony.population).toLocaleString()} people - {used}/{capacity} districts</span></div><strong>{colonyNextAction(colony)}</strong></header>
      <div className="sys-vitals">
        <div className="sys-vital" title="Food runway"><NutrientsIcon /><b>{Number.isFinite(runway) ? `${runway.toFixed(2)}h` : '∞'}</b></div>
        <div className="sys-vital" title="He-3 inventory"><Helium3Icon /><b>{Math.floor(helium3).toLocaleString()} / {Math.floor(helium3Capacity).toLocaleString()}</b></div>
        <div className="sys-vital" title="Amenities"><AmenitiesIcon /><b>{Math.round(amenityRatio * amenityDemand)} / {Math.round(amenityDemand)}</b></div>
      </div>
      <h4>DISTRICTS - {used} / {capacity} SLOTS USED</h4>
      <div className="sys-district-grid">{DISTRICTS.map(district => {
        const count = colony.districts[district.id] ?? 0;
        const blockers = districtBuildBlockers(colony, district, capacity - used, hold, fuel);
        const costLines = [...Object.entries(district.builtWith).map(([id, amount]) => `${amount} ${materialName(id)}`), `${cost.exotic} exotic`, `${cost.helium} He-3`];
        return <article key={district.id} className={count ? 'built' : ''}><b>{count}</b><i className="sys-district-art" aria-hidden="true"><DistrictIcon id={district.id} /></i><strong title={district.description}>{district.name.replace(' District', '')}</strong><ul className={blockers.length ? 'sys-district-cost short' : 'sys-district-cost'}>{costLines.map(line => <li key={line}>{line}</li>)}</ul><div className="sys-district-actions"><span className="sys-build" title={blockers.length ? `Needs ${blockers.join(', ')}` : `Build one ${district.name} — ${costLines.join(' - ')}`}><button disabled={blockers.length > 0} onClick={() => useColonyStore.getState().buildDistrict(colony.key, district.id)}>BUILD</button></span><button className={razing === district.id ? 'sys-raze armed' : 'sys-raze'} disabled={!count} title={razing === district.id ? `Confirm razing one ${district.name}` : `Raze one ${district.name}`} aria-label={razing === district.id ? `Confirm razing one ${district.name}` : `Raze one ${district.name}`} onClick={() => { if (razing !== district.id) { setRazing(district.id); return; } useColonyStore.getState().demolishDistrict(colony.key, district.id); setRazing(null); }}>{razing === district.id ? '✓' : '✕'}</button></div></article>;
      })}</div>
      <h4>JOBS - {Math.round(Object.values(filled).reduce((sum, amount) => sum + amount, 0)).toLocaleString()} OF {Math.floor(colony.population).toLocaleString()} ASSIGNED</h4>
      <div className="sys-jobs"><div className="sys-table-head"><span>PRIORITY / JOB</span><span>SHARE</span><span>SLOTS</span><span>FILLED</span><span>OUTPUT / HOUR</span><span>UPKEEP / HOUR - TOTAL</span></div>{orderedJobs.map(job => {
        const district = DISTRICTS.find(item => item.job === job)!;
        const districtCount = colony.districts[district.id] ?? 0;
        const jobCapacity = districtCount * district.jobs;
        const staffedFraction = jobCapacity > 0 ? Math.min(1, filled[job] / jobCapacity) : 0;
        const heatSuppression = Math.max(0, -(district.heat ?? 0));
        const sentinelsNeeded = Math.max(0, Math.ceil(jobCapacity - filled[job]));
        const defenseOutput = heatSuppression > 0 && districtCount > 0
          ? [`${formatFlowRate(heatSuppression * districtCount * staffedFraction)} / ${formatFlowRate(heatSuppression * districtCount)} heat/h suppressed${sentinelsNeeded ? ` - ${sentinelsNeeded.toLocaleString()} more sentinels for full output` : ''}`]
          : [];
        const output = [...Object.entries(district.output.raw ?? {}), ...Object.entries(district.output.materials ?? {})].map(([id, rate]) => `${((rate ?? 0) * filled[job]).toFixed(1)} ${RESOURCE_LABELS[id as Resource['type']] ?? materialName(id)}`).concat(district.output.research ? [`${(district.output.research * filled[job]).toFixed(1)} research`] : [], district.output.amenities ? [`${(district.output.amenities * filled[job]).toFixed(0)} amenities`] : [], defenseOutput).join(', ') || 'none';
        const upkeep = districtCount > 0
          ? [...Object.entries(district.upkeep.raw ?? {}), ...Object.entries(district.upkeep.materials ?? {})].map(([id, rate]) => `${formatFlowRate(rate * districtCount)} ${RESOURCE_LABELS[id as Resource['type']] ?? materialName(id)}`).join(', ') || 'none'
          : 'none';
        const shortfall = districtUpkeepShortfall(colony, district);
        const weight = colony.jobWeights?.[job] ?? DEFAULT_JOB_WEIGHT;
        return <div key={job}><span><button onClick={() => moveJob(job, -1)}>↑</button><button onClick={() => moveJob(job, 1)}>↓</button>{job.toUpperCase()}</span><span className="sys-job-weight"><input type="range" min={0} max={JOB_WEIGHT_MAX} step={1} value={weight} aria-label={`${job} staffing share`} title={weight ? `Share ${weight} of ${JOB_WEIGHT_MAX}` : 'Unstaffed'} onChange={event => useColonyStore.getState().setJobWeight(colony.key, job, Number(event.target.value))} /><b>{weight}</b></span><span>{slots[job].toLocaleString()}</span><span>{Math.round(filled[job]).toLocaleString()}</span><span className={shortfall.length ? 'colony-warning' : ''}>{shortfall.length ? 'STALLED' : output}</span><span className={shortfall.length ? 'colony-warning' : ''}>{upkeep}{shortfall.length ? ` - NO ${shortfall.join(', ').toUpperCase()}` : ''}</span></div>;
      })}<div className="sys-resident-load"><span title="Every resident consumes food, including residents without a job.">RESIDENTS</span><span>—</span><span>—</span><span>{Math.floor(colony.population).toLocaleString()}</span><span>none</span><span>{formatFlowRate(colony.population * NUTRIENTS_PER_PERSON_HOUR)} {RESOURCE_LABELS.nutrients}</span></div></div>
      <h4>PRODUCTION / DEFICIT <small>NET PER HOUR - OUTPUT − TOTAL UPKEEP</small></h4>
      <div className="sys-colony-flows">{flows.map(flow => <article key={`${flow.kind}:${flow.id}`} className={flow.rate > 0 ? 'production' : 'deficit'} title={`${flow.label}: ${flow.rate > 0 ? 'net production' : 'net deficit'} at current staffing`}><i aria-hidden="true"><ColonyFlowIcon flow={flow} /></i><span><strong>{flow.label}</strong><small>{flow.rate > 0 ? 'PRODUCTION' : 'DEFICIT'}</small></span><b>{flow.rate > 0 ? '+' : '−'}{formatFlowRate(flow.rate)} / h</b></article>)}{flows.length === 0 && <p>No active production or deficits.</p>}</div>
      <h4>STELLAR PROJECT</h4>
      {colony.project ? <div className="sys-project"><strong>{colony.project === 'dyson' ? 'DYSON SWARM' : 'REPLICATION NETWORK'}</strong><span>Colonist labor {(colony.projectDelivered.labor ?? 0).toFixed(1)} / {colony.project === 'dyson' ? DYSON_LABOR : PROBE_LABOR}</span>{Object.entries(colony.project === 'dyson' ? DYSON_COST : PROBE_COST).map(([id, amount]) => <span key={id}>{materialName(id)} {colony.projectDelivered[id] ?? 0} / {amount}</span>)}</div> : <div className="sys-project"><button disabled={colony.swarmComplete || tier < 1 || research < researchThreshold(2)} onClick={() => useColonyStore.getState().startProject(colony.key, 'dyson')}>{colony.swarmComplete ? 'DYSON SWARM ONLINE' : research < researchThreshold(2) ? 'RESEARCH STELLAR THEORY' : 'COMMISSION DYSON SWARM'}</button><button disabled={!colony.swarmComplete || colony.probeCoverage >= 1 || tier < 2 || research < researchThreshold(3)} onClick={() => useColonyStore.getState().startProject(colony.key, 'probes')}>{colony.probeCoverage >= 1 ? 'REPLICATION NETWORK ONLINE' : research < researchThreshold(3) ? 'RESEARCH GALACTIC THEORY' : 'COMMISSION REPLICATION NETWORK'}</button></div>}
      <small>Food capacity {Math.floor(colonyFoodCapacity(colony)).toLocaleString()} - consumption {(colony.population * NUTRIENTS_PER_PERSON_HOUR).toFixed(0)}/hour - planetary integration {Math.min(100, (colony.planetaryProgressMs ?? 0) / HOUR * 100).toFixed(0)}% - growth {(colonyContentment(colony) * 100).toFixed(0)}% of normal</small>
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
  return <div className="sys-civilization"><header><div><h3>HUMAN CIVILIZATION - TYPE {['0', 'I', 'II', 'III'][tier]}</h3><span>With the warp drive, unlocking the resources for megaengineering is at humanity's fingertips</span></div><strong>{research.toFixed(1)} RESEARCH</strong></header>{next && <div className="sys-strip"><span>TYPE {['0', 'I', 'II', 'III'][next.tier]} THEORY</span><div><i style={{ width: `${progress * 100}%` }} /></div><b>{Math.min(research, next.threshold).toFixed(1)} / {next.threshold}</b></div>}<div className="sys-research-branches">{CIVILIZATION_RESEARCH.map(entry => {
    const reached = tier >= entry.tier;
    const scienceReady = research >= entry.threshold;
    const milestoneReady = civilizationMilestoneMet(Object.values(colonies), entry.tier);
    const status = reached ? 'CIVILIZATION LEVEL REACHED' : scienceReady && milestoneReady ? 'ADVANCEMENT IMMINENT' : scienceReady ? 'AWAITING PHYSICAL MILESTONE' : milestoneReady ? 'INFRASTRUCTURE READY - RESEARCH CONTINUES' : `${research.toFixed(1)} / ${entry.threshold} RESEARCH`;
    return <article key={entry.tier} className={reached ? 'unlocked' : ''}><strong>TYPE {['0', 'I', 'II', 'III'][entry.tier]} - {entry.name}</strong><p>{entry.description}</p><span>RESEARCH - {entry.threshold} cumulative</span>{entry.milestone && <span>MILESTONE - {entry.milestone}</span>}<span>UNLOCKS - {entry.unlock}</span><b>{status}</b></article>;
  })}</div><p>Current permanent probe-attention floor: {detectionFloor(tier)}. Research accumulates automatically while staffed research districts operate.</p></div>;
}

function ThreatTab() {
  const colonies = useColonyStore(state => state.colonies);
  const exposure = useUIStore(state => state.exposure);
  const nextStrike = useUIStore(state => state.nextStrikeExposure);
  const strike = useUIStore(state => state.strike);
  return <div><div className="sys-strip"><span>EXPOSURE</span><div><i style={{ width: `${Math.min(100, exposure / nextStrike * 100)}%` }} /></div><b>{exposure} / {nextStrike}</b></div>{strike && <p className="colony-warning">Cannon transit to {strike.targetName}.</p>}<div className="sys-threat-list">{Object.values(colonies).map(colony => <article key={colony.key}><strong>{colony.planetName}</strong><span>local heat {colony.localHeat.toFixed(1)} - {colonyDefense(colony).batteries} defense districts</span><button disabled={colony.population <= 0} onClick={() => useColonyStore.getState().evacuate(colony.key)}>Evacuate {Math.floor(colony.population)} people</button></article>)}</div></div>;
}

function StatusTab() {
  const exposure = useUIStore(state => state.exposure);
  const evacuated = useUIStore(state => state.evacuatedPopulation);
  const alienMatter = useUIStore(state => state.alienMatter);
  const nextStrike = useUIStore(state => state.nextStrikeExposure);
  return <div className="sys-status">
    <h3>SHIP STATUS</h3>
    <div><span>EXPOSURE</span><b>{exposure}</b><small>Census probes that escaped and reported your position. It never goes down. At {nextStrike} the cannon fires on one of your worlds.</small></div>
    <div><span>EVACUATED</span><b>{evacuated.toLocaleString()}</b><small>People preserved in flotillas after their colonies were evacuated.</small></div>
    <div><span>ALIEN MATTER</span><b>{alienMatter}</b><small>Salvage recovered from probes shot down nearby. Used as a build resource.</small></div>
  </div>;
}

export function SysPanel() {
  const show = useUIStore(state => state.showSysPanel);
  const [tab, setTab] = useState<Tab>('worlds');
  if (!show) return null;
  return createPortal(<div className="sys-overlay" onClick={() => useUIStore.getState().setShowSysPanel(false)}><section className="sys-panel" role="dialog" aria-modal="true" aria-label="Humanity" onClick={event => event.stopPropagation()}><button className="sys-close" onClick={() => useUIStore.getState().setShowSysPanel(false)}>×</button><nav className="sys-tabs">{TABS.map(item => <button className={`${item === 'status' ? 'sys-tab-right' : ''}${tab === item ? ' active' : ''}`} key={item} onClick={() => setTab(item)}>{item.toUpperCase()}</button>)}</nav><main>{tab === 'worlds' ? <WorldsTab /> : tab === 'civilization' ? <CivilizationTab /> : tab === 'threat' ? <ThreatTab /> : <StatusTab />}</main></section></div>, document.body);
}
